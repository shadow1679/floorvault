import { describe, expect, it, vi } from "vitest";
import { fetchGeckoCandles, gtResolution, parseOhlcv, parseTopPool } from "./geckoterminal";

const TOKEN = "0x3bd359c1119da7da1d913d1c4d2b7c461115433a";

describe("gtResolution", () => {
  it("uses the narrowest width whose 1000 candles cover the age", () => {
    expect(gtResolution(3600)).toEqual({ timeframe: "minute", aggregate: 1 });
    expect(gtResolution(3 * 86_400)).toEqual({ timeframe: "minute", aggregate: 5 });
    expect(gtResolution(30 * 86_400)).toEqual({ timeframe: "hour", aggregate: 1 });
    expect(gtResolution(200 * 86_400)).toEqual({ timeframe: "hour", aggregate: 12 });
  });
  it("falls back to daily candles for very old coins", () => {
    expect(gtResolution(10 * 365 * 86_400)).toEqual({ timeframe: "day", aggregate: 1 });
  });
});

describe("parseOhlcv", () => {
  it("returns candles oldest first and drops junk rows", () => {
    const json = { data: { attributes: { ohlcv_list: [[20, 2, 3, 1, 2.5, 9], [10, 1, 2, 1, 2, 5], [30, "x", 1, 1, 1, 1], [40, 1, 1, 1, 0, 1]] } } };
    expect(parseOhlcv(json)).toEqual([
      { time: 10, open: 1, high: 2, low: 1, close: 2 },
      { time: 20, open: 2, high: 3, low: 1, close: 2.5 },
    ]);
  });
  it("is empty for anything unexpected", () => {
    expect(parseOhlcv(null)).toEqual([]);
    expect(parseOhlcv({ data: {} })).toEqual([]);
  });
});

describe("parseTopPool", () => {
  it("takes the first pool's address", () => {
    expect(parseTopPool({ data: [{ attributes: { address: "0x63e48b725540a3db24acf6682a29f877808c53f2" } }] })).toBe(
      "0x63e48b725540a3db24acf6682a29f877808c53f2",
    );
  });
  it("is null with no pool or a malformed address", () => {
    expect(parseTopPool({ data: [] })).toBeNull();
    expect(parseTopPool({ data: [{ attributes: { address: "nope" } }] })).toBeNull();
  });
});

describe("fetchGeckoCandles", () => {
  it("asks our proxy and returns its candles", async () => {
    const f = vi.fn(async () => Response.json({ candles: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }] }));
    const out = await fetchGeckoCandles(TOKEN, { ageSeconds: 3600 }, f as unknown as typeof fetch);
    expect(out).toHaveLength(1);
    expect(String((f.mock.calls as unknown as string[][])[0][0])).toBe(`/api/gt-candles?token=${TOKEN}&timeframe=minute&aggregate=1`);
  });
  it("throws when the proxy fails, so the chart can fall back", async () => {
    const f = vi.fn(async () => new Response("", { status: 502 }));
    await expect(fetchGeckoCandles(TOKEN, { ageSeconds: 3600 }, f as unknown as typeof fetch)).rejects.toThrow();
  });
});
