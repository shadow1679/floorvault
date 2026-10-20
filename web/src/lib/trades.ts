// Pure helpers for the price chart and the trade box: turning bonding-curve reserves into prices,
// building the plotted series, laying it out as SVG, and formatting. No network access here.
import type { LogMeta } from "./raffle";

/** One price after a trade (from the curve's `Sync` event). `price` is MON per whole token. */
export type PricePoint = LogMeta & { price: number };

/** MON per token from the curve's virtual reserves (both 18 decimals). 0 when the token reserve is empty. */
export function priceFromReserves(virtualQuote: bigint, virtualToken: bigint): number {
  if (virtualToken <= 0n) return 0;
  return Number(virtualQuote) / Number(virtualToken);
}

/** "0.0000660", "1.2345", "12.5": about four significant digits, never scientific notation. */
export function formatPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "0";
  const decimals = Math.min(14, Math.max(2, 3 - Math.floor(Math.log10(price))));
  const fixed = price.toFixed(decimals);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/** Every nad.fun coin has the same fixed supply, so market cap is price times this. */
export const TOTAL_SUPPLY = 1_000_000_000;

/** Market cap in the quote currency: MON per token (or $ per token) times the fixed supply. */
export function marketCap(price: number): number {
  return price * TOTAL_SUPPLY;
}

/** "$66.4K", "$1.23M", "$812": compact dollars for a market cap or a chart axis. */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  const units: [number, string][] = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [size, suffix] of units) {
    if (usd >= size) return `$${(usd / size).toFixed(usd / size >= 100 ? 0 : usd / size >= 10 ? 1 : 2)}${suffix}`;
  }
  return `$${usd >= 100 ? usd.toFixed(0) : usd.toFixed(2)}`;
}

/** Signed percent change, "+12.4%" / "-3.0%" / "0.0%". */
export function formatChange(from: number, to: number): string {
  if (!(from > 0)) return "0.0%";
  const pct = ((to - from) / from) * 100;
  const rounded = Math.abs(pct) < 0.05 ? 0 : pct;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

export type SeriesPoint = { block: number; price: number };

/**
 * The line to plot. Between trades the price does not move, so the series is only trade points plus
 * two anchors: the launch price at the left edge once the whole history is known, and the live
 * curve price at the head block on the right edge.
 */
export function buildSeries(opts: {
  points: PricePoint[];
  launchBlock: number | null;
  launchPrice: number | null;
  headBlock: number | null;
  livePrice: number | null;
  /** Oldest block already read. With no trades in that window the price is known to be flat across it. */
  windowStart?: number | null;
}): SeriesPoint[] {
  const out: SeriesPoint[] = opts.points
    .filter((p) => p.price > 0)
    .map((p) => ({ block: Number(p.blockNumber), price: p.price }))
    .sort((a, b) => a.block - b.block);
  if (opts.launchBlock !== null && opts.launchPrice && opts.launchPrice > 0 && (out.length === 0 || out[0].block > opts.launchBlock)) {
    out.unshift({ block: opts.launchBlock, price: opts.launchPrice });
  }
  if (opts.headBlock !== null && opts.livePrice && opts.livePrice > 0) {
    const last = out[out.length - 1];
    if (!last || last.block < opts.headBlock) out.push({ block: opts.headBlock, price: opts.livePrice });
  }
  // No trade in the part of history read so far: the price has not moved there, so it equals the live
  // price all the way back. (With trades in the window, the price before the first one is unknown.)
  if (out.length === 1 && opts.points.length === 0 && opts.windowStart != null && opts.windowStart < out[0].block) {
    out.unshift({ block: opts.windowStart, price: out[0].price });
  }
  return out;
}

export type ChartPoint = { time: number; value: number };

/**
 * The series as the chart library wants it: unix seconds, strictly ascending. Block time is measured
 * from the head block, so times are approximate. Several trades inside one second collapse to the
 * last price, since the library rejects duplicate times.
 */
export function toChartData(series: SeriesPoint[], clock: { headBlock: number; headTimestamp: number; secPerBlock: number }): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const p of series) {
    const time = clock.headTimestamp - secondsAgo(p.block, clock.headBlock, clock.secPerBlock);
    const last = out[out.length - 1];
    if (last && last.time === time) last.value = p.price;
    else if (!last || time > last.time) out.push({ time, value: p.price });
  }
  return out;
}

export type Candle = { time: number; open: number; high: number; low: number; close: number };

/** A step series as candles: each one opens where the previous closed, so a flat stretch is a flat candle. */
export function toCandles(points: ChartPoint[]): Candle[] {
  return points.map((p, i) => {
    const open = i === 0 ? p.value : points[i - 1].value;
    return { time: p.time, open, high: Math.max(open, p.value), low: Math.min(open, p.value), close: p.value };
  });
}

/** Seconds ago for a block, from the head block and the measured seconds per block. Never negative. */
export function secondsAgo(block: number, headBlock: number, secPerBlock: number): number {
  return Math.max(0, Math.round((headBlock - block) * secPerBlock));
}

/** Seconds per block from two (block, unix timestamp) samples; a sane default if they are unusable. */
export function secondsPerBlock(a: { block: bigint; timestamp: bigint }, b: { block: bigint; timestamp: bigint }): number {
  const blocks = Number(b.block - a.block);
  const secs = Number(b.timestamp - a.timestamp);
  return blocks > 0 && secs > 0 ? secs / blocks : 0.4;
}

/** Slippage choices for the trade box, in basis points. */
export const SLIPPAGE_OPTIONS_BPS = [100, 300, 1000] as const;

/** The least the trade may return before it reverts. */
export function minAfterSlippage(quote: bigint, slippageBps: number): bigint {
  return (quote * BigInt(10_000 - slippageBps)) / 10_000n;
}
