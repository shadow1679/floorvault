// Coin metadata is a JSON data URI built in the browser, so no upload service is needed.

export type CoinMetadata = {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
};

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function buildTokenUri(meta: { name: string; symbol: string; imageUrl?: string; description?: string }): string {
  const json: Record<string, string> = { name: meta.name.trim(), symbol: meta.symbol.trim() };
  if (meta.description?.trim()) json.description = meta.description.trim();
  if (meta.imageUrl?.trim()) json.image = meta.imageUrl.trim();
  return `data:application/json;base64,${utf8ToBase64(JSON.stringify(json))}`;
}

/** Only render images from schemes that cannot run script: https, http, ipfs, or raster data URIs. */
export function safeImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (v === "" || v.length > 200_000) return undefined;
  if (/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(v)) return v;
  return metadataFetchUrl(v);
}

// ipfs.io and dweb.link now answer 429 ("service worker gateway only"); this one serves JSON and images with CORS.
const IPFS_GATEWAY = "https://ipfs.filebase.io/ipfs/";
const METADATA_TIMEOUT_MS = 5_000;
const METADATA_MAX_BYTES = 256 * 1024;

/** Where to fetch a tokenURI or image from: http(s) as is, ipfs:// through the gateway, anything else not at all. */
export function metadataFetchUrl(uri: string): string | undefined {
  const v = uri.trim();
  if (/^ipfs:\/\//i.test(v)) {
    const path = v.replace(/^ipfs:\/\/(ipfs\/)?/i, "");
    return path && !path.split("/").includes("..") ? `${IPFS_GATEWAY}${path}` : undefined;
  }
  if (/^https?:\/\//i.test(v)) {
    try {
      new URL(v);
      return v;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Read a response body as text, giving up (null) as soon as it passes the byte cap. */
async function readCappedText(res: Response): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return new TextEncoder().encode(text).length > METADATA_MAX_BYTES ? null : text;
  }
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > METADATA_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * Image for an NFT whose tokenURI is an http(s) or ipfs URL. Reads the JSON `image` (or `image_url`) field,
 * or uses the URL itself when it serves an image. Returns null when there is definitely no usable image
 * (bad status, not JSON, oversize, unsafe image). Throws when the answer is unknown (network error, timeout,
 * 429 or 5xx) so callers can retry instead of remembering "no image".
 */
export async function fetchNftImage(
  uri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = metadataFetchUrl(uri);
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), METADATA_TIMEOUT_MS);
  try {
    // The tokenURI is chosen by whoever launched the coin, so send the viewer's browser as little as possible.
    const res = await fetchImpl(url, { signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (res.status === 429 || res.status >= 500) throw new Error(`metadata HTTP ${res.status}`);
    if (!res.ok) return null;
    if (/^image\//i.test(res.headers.get("content-type") ?? "")) {
      void res.body?.cancel();
      return safeImageUrl(url) ?? null;
    }
    if (Number(res.headers.get("content-length")) > METADATA_MAX_BYTES) {
      void res.body?.cancel();
      return null;
    }
    const text = await readCappedText(res);
    if (text === null) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    return safeImageUrl(obj.image) ?? safeImageUrl(obj.image_url) ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a data: JSON tokenURI. Returns {} for anything it cannot read (http/ipfs URIs go through fetchNftImage). */
export function parseTokenUri(uri: string): CoinMetadata {
  try {
    const match = /^data:application\/json(?:;charset=[^;,]+)?(;base64)?,(.*)$/is.exec(uri.trim());
    if (!match) return {};
    const payload = match[1] ? base64ToUtf8(match[2]) : decodeURIComponent(match[2]);
    const raw = JSON.parse(payload) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 500) : undefined);
    return {
      name: str(raw.name),
      symbol: str(raw.symbol),
      description: str(raw.description),
      image: safeImageUrl(raw.image),
    };
  } catch {
    return {};
  }
}
