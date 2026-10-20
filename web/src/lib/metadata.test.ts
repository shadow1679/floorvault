import { describe, expect, it, vi } from "vitest";
import { buildTokenUri, fetchNftImage, metadataFetchUrl, parseTokenUri, safeImageUrl } from "./metadata";

const reply = (body: string, init: { status?: number; type?: string; length?: string } = {}) =>
  (async () =>
    new Response(body, {
      status: init.status ?? 200,
      headers: {
        "content-type": init.type ?? "application/json",
        ...(init.length ? { "content-length": init.length } : {}),
      },
    })) as unknown as typeof fetch;

describe("metadataFetchUrl", () => {
  it("maps ipfs to the gateway, keeps http(s), rejects the rest", () => {
    expect(metadataFetchUrl("ipfs://bafy/1.json")).toBe("https://ipfs.filebase.io/ipfs/bafy/1.json");
    expect(metadataFetchUrl("ipfs://ipfs/bafy/1.json")).toBe("https://ipfs.filebase.io/ipfs/bafy/1.json");
    expect(metadataFetchUrl("https://a.com/1.json")).toBe("https://a.com/1.json");
    for (const bad of ["ipfs://", "javascript:alert(1)", "file:///etc/passwd", "data:application/json,{}", ""]) {
      expect(metadataFetchUrl(bad)).toBeUndefined();
    }
  });
});

describe("fetchNftImage", () => {
  it("reads image from the JSON and maps an ipfs image to the gateway", async () => {
    const f = reply(JSON.stringify({ name: "Chog #1", image: "ipfs://bafy/chog.png" }));
    expect(await fetchNftImage("https://meta.example/1", f)).toBe("https://ipfs.filebase.io/ipfs/bafy/chog.png");
  });

  it("falls back to image_url", async () => {
    const f = reply(JSON.stringify({ image_url: "https://i.example/x.png" }));
    expect(await fetchNftImage("ipfs://bafy/1.json", f)).toBe("https://i.example/x.png");
  });

  it("uses the URL itself when it serves an image", async () => {
    expect(await fetchNftImage("https://i.example/x.png", reply("", { type: "image/png" }))).toBe("https://i.example/x.png");
  });

  it("prefers image over image_url", async () => {
    const f = reply(JSON.stringify({ image: "https://i.example/a.png", image_url: "https://i.example/b.png" }));
    expect(await fetchNftImage("https://a.com/1", f)).toBe("https://i.example/a.png");
  });

  it("returns null when there is definitely no usable image", async () => {
    expect(await fetchNftImage("https://a.com/1", reply("{}", { status: 404 }))).toBeNull();
    expect(await fetchNftImage("https://a.com/1", reply("not json"))).toBeNull();
    expect(await fetchNftImage("https://a.com/1", reply("null"))).toBeNull();
    expect(await fetchNftImage("https://a.com/1", reply(JSON.stringify({ image: "javascript:alert(1)" })))).toBeNull();
    expect(await fetchNftImage("javascript:alert(1)", reply("{}"))).toBeNull();
  });

  it("ignores a body past the size cap even when it holds a valid image", async () => {
    const padded = JSON.stringify({ image: "https://i.example/x.png", pad: "x".repeat(300_000) });
    expect(await fetchNftImage("https://a.com/1", reply(padded))).toBeNull();
    const declared = JSON.stringify({ image: "https://i.example/x.png" });
    expect(await fetchNftImage("https://a.com/1", reply(declared, { length: "10000000" }))).toBeNull();
  });

  it("rejects ipfs paths that climb out of /ipfs/", async () => {
    expect(metadataFetchUrl("ipfs://bafy/../../x")).toBeUndefined();
    expect(await fetchNftImage("ipfs://bafy/../../x", reply("{}"))).toBeNull();
  });

  it("throws on transient failures so callers can retry", async () => {
    await expect(fetchNftImage("https://a.com/1", reply("{}", { status: 429 }))).rejects.toThrow();
    await expect(fetchNftImage("https://a.com/1", reply("{}", { status: 503 }))).rejects.toThrow();
    const down = (async () => {
      throw new Error("net");
    }) as unknown as typeof fetch;
    await expect(fetchNftImage("https://a.com/1", down)).rejects.toThrow("net");
  });

  it("aborts a request that outlives the timeout", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const hang = ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as unknown as typeof fetch;
      const pending = expect(fetchNftImage("https://a.com/1", hang)).rejects.toThrow("aborted");
      await vi.advanceTimersByTimeAsync(5_000);
      await pending;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("tokenURI", () => {
  it("round-trips through a JSON data URI", () => {
    const uri = buildTokenUri({ name: "Chog Floor Fund", symbol: "CFF", imageUrl: "https://x.com/a.png" });
    expect(uri.startsWith("data:application/json;base64,")).toBe(true);
    expect(parseTokenUri(uri)).toMatchObject({ name: "Chog Floor Fund", symbol: "CFF", image: "https://x.com/a.png" });
  });

  it("handles non-ASCII names", () => {
    const uri = buildTokenUri({ name: "Würm 🐛", symbol: "WRM" });
    expect(parseTokenUri(uri).name).toBe("Würm 🐛");
  });

  it("omits the image when none is given", () => {
    expect(parseTokenUri(buildTokenUri({ name: "A", symbol: "B" })).image).toBeUndefined();
  });

  it("returns an empty object for unreadable input", () => {
    expect(parseTokenUri("https://example.com/meta.json")).toEqual({});
    expect(parseTokenUri("data:application/json;base64,%%%")).toEqual({});
    expect(parseTokenUri("")).toEqual({});
  });

  it("parses percent-encoded JSON data URIs", () => {
    const uri = `data:application/json,${encodeURIComponent(JSON.stringify({ name: "N", image: "https://i.com/x.png" }))}`;
    expect(parseTokenUri(uri)).toMatchObject({ name: "N", image: "https://i.com/x.png" });
  });
});

describe("safeImageUrl", () => {
  it("accepts web and raster data images, maps ipfs to a gateway", () => {
    expect(safeImageUrl("https://a.com/x.png")).toBe("https://a.com/x.png");
    expect(safeImageUrl("ipfs://bafy/x.png")).toBe("https://ipfs.filebase.io/ipfs/bafy/x.png");
    expect(safeImageUrl("data:image/png;base64,AAAA")).toBeDefined();
  });
  it("rejects script-capable or unknown schemes", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html;base64,AAAA", "file:///etc/passwd", 42, "", undefined]) {
      expect(safeImageUrl(bad)).toBeUndefined();
    }
  });
});
