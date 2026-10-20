// Client for nad.fun's REST API. A coin has to go through it to be indexed: the image and metadata are
// uploaded to nad.fun storage, the vanity salt is mined by the API, and later the chart is read from it.
import type { Address, Hash } from "viem";
import { NADFUN_API_URL } from "./constants";

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
export const CHART_COUNTBACK = 3000;

type Fetch = typeof fetch;

export class NadfunApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "NadfunApiError";
  }
}

async function readError(res: Response): Promise<string> {
  const text = (await res.text().catch(() => "")).trim();
  try {
    const json = JSON.parse(text) as { error?: unknown };
    if (typeof json.error === "string") return json.error;
  } catch {
    // not JSON
  }
  return text.slice(0, 200) || `HTTP ${res.status}`;
}

async function request<T>(fetchImpl: Fetch, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${NADFUN_API_URL}${path}`, init);
  } catch {
    throw new NadfunApiError("Could not reach the nad.fun API. Check your connection and try again.", 0);
  }
  if (!res.ok) throw new NadfunApiError(await readError(res), res.status);
  return (await res.json()) as T;
}

export function validateImageFile(file: { type: string; size: number } | null): string | null {
  if (!file) return "Add a picture for your coin.";
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return "Use a PNG, JPEG, WebP or SVG image.";
  if (file.size > IMAGE_MAX_BYTES) return "The image must be 5 MB or smaller.";
  return null;
}

export type LaunchAssets = { tokenURI: string; salt: Hash; predictedToken: Address };

/**
 * Everything nad.fun wants before `create`: upload the image, upload the metadata that points at it
 * (the returned URI becomes the on-chain tokenURI), then mine the vanity salt. `creator` is the
 * contract that calls the router, because that is the address the CREATE2 salt is checked against.
 */
export async function prepareLaunchAssets(
  input: { image: File; name: string; symbol: string; description?: string; creator: Address },
  fetchImpl: Fetch = fetch,
): Promise<LaunchAssets> {
  const imageError = validateImageFile(input.image);
  if (imageError) throw new Error(imageError);

  const uploaded = await request<{ is_nsfw: boolean; image_uri: string }>(fetchImpl, "/metadata/image", {
    method: "POST",
    headers: { "content-type": input.image.type },
    body: input.image,
  });
  if (uploaded.is_nsfw) throw new Error("nad.fun flagged this image as NSFW. Pick a different picture.");

  // The NSFW verdict is cached server side for a short while, so this must follow the upload quickly.
  const meta = await request<{ metadata_uri: string }>(fetchImpl, "/metadata/metadata", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      image_uri: uploaded.image_uri,
      name: input.name,
      symbol: input.symbol,
      ...(input.description ? { description: input.description } : {}),
    }),
  });

  const mined = await request<{ salt: Hash; address: Address }>(fetchImpl, "/token/salt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      creator: input.creator,
      name: input.name,
      symbol: input.symbol,
      metadata_uri: meta.metadata_uri,
      version: "V2",
    }),
  });
  return { tokenURI: meta.metadata_uri, salt: mined.salt, predictedToken: mined.address };
}

/** The candle width (in minutes, or "240") to ask for so `CHART_COUNTBACK` candles cover `ageSeconds`. */
export function chartResolution(ageSeconds: number): "1" | "5" | "15" | "30" | "60" | "240" {
  const minutes = Math.max(0, ageSeconds) / 60;
  for (const width of [1, 5, 15, 30, 60] as const) {
    if (minutes / width <= CHART_COUNTBACK) return String(width) as "1" | "5" | "15" | "30" | "60";
  }
  return "240";
}

export type NadfunCandle = { time: number; open: number; high: number; low: number; close: number };

/**
 * Price candles for a coin, oldest first. Returns null when nad.fun does not know the coin (404), so
 * callers can fall back to reading the chain. Any other failure throws.
 */
export async function fetchNadfunCandles(
  token: Address,
  opts: { ageSeconds: number; nowSeconds?: number },
  fetchImpl: Fetch = fetch,
): Promise<NadfunCandle[] | null> {
  const now = Math.floor(opts.nowSeconds ?? Date.now() / 1000);
  const params = new URLSearchParams({
    resolution: chartResolution(opts.ageSeconds),
    from: String(Math.max(0, now - Math.ceil(opts.ageSeconds) - 3600)),
    to: String(now),
    countback: String(CHART_COUNTBACK),
    chart_type: "price",
  });
  let json: { s?: string; t?: number[]; o?: unknown[]; h?: unknown[]; l?: unknown[]; c?: unknown[] };
  try {
    json = await request(fetchImpl, `/trade/chart/${token}?${params}`);
  } catch (e) {
    if (e instanceof NadfunApiError && e.status === 404) return null;
    throw e;
  }
  if (json.s !== "ok" || !json.t) return [];
  const out: NadfunCandle[] = [];
  json.t.forEach((time, i) => {
    const candle = {
      time: Number(time),
      open: Number(json.o?.[i]),
      high: Number(json.h?.[i]),
      low: Number(json.l?.[i]),
      close: Number(json.c?.[i]),
    };
    if (Number.isFinite(candle.time) && candle.close > 0) out.push(candle);
  });
  return out.sort((a, b) => a.time - b.time);
}

/** Name, symbol and image of a coin from the metadata JSON nad.fun stores. Unreadable parts are left out. */
export async function fetchNadfunMetadata(
  uri: string,
  fetchImpl: Fetch = fetch,
): Promise<{ name?: string; symbol?: string; description?: string; image?: string }> {
  if (!/^https:\/\/storage\.nadapp\.net\//.test(uri)) return {};
  const res = await fetchImpl(uri);
  if (!res.ok) throw new NadfunApiError(`metadata HTTP ${res.status}`, res.status);
  const raw = (await res.json()) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 500) : undefined);
  return { name: str(raw.name), symbol: str(raw.symbol), description: str(raw.description), image: str(raw.image_uri) };
}
