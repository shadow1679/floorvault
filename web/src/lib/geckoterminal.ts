// GeckoTerminal (CoinGecko's DEX data) as the chart's first source. It indexes DEX pools on Monad mainnet only,
// so it knows a coin once it has graduated; a coin still on nad.fun's bonding curve (and everything on
// testnet) answers "no pool" and the chart falls back to nad.fun's API. The browser calls our own
// /api/gt-candles, which talks to GeckoTerminal and caches, because its free tier allows ~30 calls a minute.
import type { Address } from "viem";
import type { Candle } from "./trades";

export const GT_API_URL = "https://api.geckoterminal.com/api/v2";
export const GT_NETWORK = "monad";
export const GT_LIMIT = 1000;

export type GtResolution = { timeframe: "minute" | "hour" | "day"; aggregate: number };

const GT_RESOLUTIONS: (GtResolution & { minutes: number })[] = [
  { timeframe: "minute", aggregate: 1, minutes: 1 },
  { timeframe: "minute", aggregate: 5, minutes: 5 },
  { timeframe: "minute", aggregate: 15, minutes: 15 },
  { timeframe: "hour", aggregate: 1, minutes: 60 },
  { timeframe: "hour", aggregate: 4, minutes: 240 },
  { timeframe: "hour", aggregate: 12, minutes: 720 },
  { timeframe: "day", aggregate: 1, minutes: 1440 },
];

/** The narrowest candle width for which `GT_LIMIT` candles still cover `ageSeconds`. */
export function gtResolution(ageSeconds: number): GtResolution {
  const minutes = Math.max(0, ageSeconds) / 60;
  const pick = GT_RESOLUTIONS.find((r) => minutes / r.minutes <= GT_LIMIT) ?? GT_RESOLUTIONS[GT_RESOLUTIONS.length - 1];
  return { timeframe: pick.timeframe, aggregate: pick.aggregate };
}

/** Candles from GeckoTerminal's `ohlcv_list` (newest first, `[time, o, h, l, c, volume]`), oldest first. */
export function parseOhlcv(json: unknown): Candle[] {
  const list = (json as { data?: { attributes?: { ohlcv_list?: unknown } } })?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];
  const out: Candle[] = [];
  for (const row of list) {
    if (!Array.isArray(row)) continue;
    const [time, open, high, low, close] = row.slice(0, 5).map(Number);
    if ([time, open, high, low, close].every(Number.isFinite) && close > 0) out.push({ time, open, high, low, close });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** The address of the most liquid pool GeckoTerminal lists for a token, or null when it has none. */
export function parseTopPool(json: unknown): Address | null {
  const first = (json as { data?: { attributes?: { address?: unknown } }[] })?.data?.[0]?.attributes?.address;
  return typeof first === "string" && /^0x[0-9a-fA-F]{40}$/.test(first) ? (first as Address) : null;
}

/**
 * Candles in US dollars per token, oldest first, via our proxy route. An empty array means GeckoTerminal has
 * no pool or no trades for the coin, so callers should use the next source. Other failures throw.
 */
export async function fetchGeckoCandles(token: Address, opts: { ageSeconds: number }, fetchImpl: typeof fetch = fetch): Promise<Candle[]> {
  const { timeframe, aggregate } = gtResolution(opts.ageSeconds);
  const params = new URLSearchParams({ token, timeframe, aggregate: String(aggregate) });
  const res = await fetchImpl(`/api/gt-candles?${params}`);
  if (!res.ok) throw new Error(`GeckoTerminal proxy HTTP ${res.status}`);
  const json = (await res.json()) as { candles?: Candle[] };
  return Array.isArray(json.candles) ? json.candles : [];
}
