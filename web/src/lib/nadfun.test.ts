import { describe, expect, it, vi } from "vitest";
import {
  chartResolution,
  fetchNadfunCandles,
  fetchNadfunMetadata,
  NADFUN_BASE,
  NadfunApiError,
  prepareLaunchAssets,
  validateImageFile,
} from "./nadfun";

// The base is an absolute URL on mainnet and "/api/nadfun" on testnet, so read paths relative to it.
const urlOfCall = (fn: ReturnType<typeof vi.fn>) => new URL((fn.mock.calls[0][0] as string).replace(NADFUN_BASE, ""), "http://nadfun.test");
const pathOf = (url: string) => new URL(url.replace(NADFUN_BASE, ""), "http://nadfun.test").pathname;

const VAULT = "0xB5C69fdd68B0531ce419b145feF30f942c352F35" as const;
const TOKEN = "0x8D08d61A54Fd93f91CA294d0bC7db8783b9c9547" as const;
const png = () => new File(["x"], "a.png", { type: "image/png" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("validateImageFile", () => {
  it("requires a supported type within the size limit", () => {
    expect(validateImageFile(null)).toBeTruthy();
    expect(validateImageFile({ type: "image/gif", size: 10 })).toBeTruthy();
    expect(validateImageFile({ type: "image/png", size: 6 * 1024 * 1024 })).toBeTruthy();
    expect(validateImageFile({ type: "image/webp", size: 10 })).toBeNull();
  });
});

describe("prepareLaunchAssets", () => {
  it("uploads the image, then the metadata, then mines the salt for the vault", async () => {
    const calls: { path: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const path = pathOf(url);
      calls.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body });
      if (path === "/metadata/image") return json({ is_nsfw: false, image_uri: "https://storage.nadapp.net/coin/i" });
      if (path === "/metadata/metadata") return json({ metadata_uri: "https://storage.nadapp.net/metadata/m.json" });
      return json({ salt: `0x${"12".repeat(32)}`, address: TOKEN });
    }) as unknown as typeof fetch;

    const out = await prepareLaunchAssets({ image: png(), name: "Chog", symbol: "CHG", creator: VAULT }, fetchImpl);

    expect(calls.map((c) => c.path)).toEqual(["/metadata/image", "/metadata/metadata", "/token/salt"]);
    expect(calls[1].body).toMatchObject({ image_uri: "https://storage.nadapp.net/coin/i", name: "Chog", symbol: "CHG" });
    expect(calls[2].body).toMatchObject({
      creator: VAULT,
      metadata_uri: "https://storage.nadapp.net/metadata/m.json",
      version: "V2",
    });
    expect(out).toEqual({
      tokenURI: "https://storage.nadapp.net/metadata/m.json",
      salt: `0x${"12".repeat(32)}`,
      predictedToken: TOKEN,
    });
  });

  it("stops on an NSFW image and surfaces API errors", async () => {
    const nsfw = vi.fn(async () => json({ is_nsfw: true, image_uri: "x" })) as unknown as typeof fetch;
    await expect(prepareLaunchAssets({ image: png(), name: "A", symbol: "B", creator: VAULT }, nsfw)).rejects.toThrow(/NSFW/);
    expect(nsfw).toHaveBeenCalledTimes(1);

    const down = vi.fn(async () => json({ error: "Rate limit exceeded" }, 429)) as unknown as typeof fetch;
    await expect(prepareLaunchAssets({ image: png(), name: "A", symbol: "B", creator: VAULT }, down)).rejects.toThrow(
      "Rate limit exceeded",
    );
  });
});

describe("chartResolution", () => {
  it("uses the finest candles that still cover the coin's age in 3000 candles", () => {
    expect(chartResolution(3600)).toBe("1");
    expect(chartResolution(3 * 86_400)).toBe("5");
    expect(chartResolution(30 * 86_400)).toBe("15");
    expect(chartResolution(10 * 365 * 86_400)).toBe("240");
  });
});

describe("fetchNadfunCandles", () => {
  const chart = { s: "ok", t: [200, 100], o: ["1", "1"], h: ["2", "2"], l: ["1", "1"], c: ["0.5", "0"], v: ["1", "1"] };

  it("returns candles oldest first and drops empty closes", async () => {
    const fetchImpl = vi.fn(async () => json(chart)) as unknown as typeof fetch;
    expect(await fetchNadfunCandles(TOKEN, { ageSeconds: 600, nowSeconds: 1000 }, fetchImpl)).toEqual([
      { time: 200, open: 1, high: 2, low: 1, close: 0.5 },
    ]);
    const url = urlOfCall(fetchImpl as unknown as ReturnType<typeof vi.fn>);
    expect(url.pathname).toBe(`/trade/chart/${TOKEN}`);
    expect(url.searchParams.get("resolution")).toBe("1");
    expect(url.searchParams.get("to")).toBe("1000");
  });

  it("returns null for a coin nad.fun does not know, [] for no data, and throws otherwise", async () => {
    const f = (res: Response) => vi.fn(async () => res) as unknown as typeof fetch;
    const opts = { ageSeconds: 60 };
    expect(await fetchNadfunCandles(TOKEN, opts, f(json({ error: "Token not found" }, 404)))).toBeNull();
    expect(await fetchNadfunCandles(TOKEN, opts, f(json({ s: "no_data" })))).toEqual([]);
    await expect(fetchNadfunCandles(TOKEN, opts, f(json({ error: "busy" }, 429)))).rejects.toBeInstanceOf(NadfunApiError);
  });
});

describe("fetchNadfunMetadata", () => {
  it("reads name, symbol and image_uri from nad.fun storage only", async () => {
    const fetchImpl = vi.fn(async () => json({ name: "Chog", symbol: "CHG", image_uri: "https://storage.nadapp.net/coin/i" })) as unknown as typeof fetch;
    expect(await fetchNadfunMetadata("https://storage.nadapp.net/metadata/m.json", fetchImpl)).toMatchObject({
      name: "Chog",
      image: "https://storage.nadapp.net/coin/i",
    });
    expect(await fetchNadfunMetadata("https://evil.example/m.json", fetchImpl)).toEqual({});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
