"use client";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  type AutoscaleInfo,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Coin, CurveInfo } from "@/lib/chain";
import { IS_MAINNET } from "@/lib/constants";
import { useBlockClock, useGeckoCandles, useMonUsd, useNadfunCandles, useTradeHistory } from "@/lib/hooks";
import { formatCountdown } from "@/lib/raffle";
import {
  TOTAL_SUPPLY,
  buildSeries,
  formatChange,
  formatPrice,
  formatUsd,
  secondsAgo,
  toCandles,
  toChartData,
  type Candle,
} from "@/lib/trades";
import { Badge, Card } from "./ui";

const HEIGHT = 260;

/** A theme colour from the page's CSS variables, with a fallback for when they are not readable. */
function cssColor(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Market cap of the coin on its nad.fun bonding curve, as candlesticks. nad.fun's API supplies the candles;
 * for a coin it does not know, history is read from the chain newest first, so the chart is useful straight
 * away and fills in leftwards. The curve prices in MON, so market cap is price x the fixed supply x the
 * MON/USD rate (plain MON while no rate is known). Drawing is done by TradingView's lightweight-charts.
 */
export function PriceChart({ coin, curve, curveLoading }: { coin: Coin; curve?: CurveInfo | null; curveLoading: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fmtRef = useRef<(v: number) => string>(formatUsd);
  const fittedRef = useRef<string>("");
  const [hover, setHover] = useState<{ time: number; price: number } | null>(null);

  const monUsd = useMonUsd().data ?? null;

  const clock = useBlockClock();
  // Sources, in order: GeckoTerminal (mainnet DEX pools, so graduated coins), then nad.fun's API, then
  // reading Sync events off the chain, which is slow. A source that has no data for the coin (empty, 404) or
  // fails before ever answering sends us to the next one.
  const ageSeconds =
    clock.data && coin.launchBlock > 0n
      ? secondsAgo(Number(coin.launchBlock), clock.data.headBlock, clock.data.secPerBlock)
      : null;
  const gt = useGeckoCandles(coin.token, ageSeconds);
  const gtCandles = gt.data && gt.data.length > 0 ? gt.data : null;
  const gtPending = IS_MAINNET && gt.data === undefined && !gt.isError && ageSeconds !== null;
  const skipApi = gtCandles !== null || gtPending;
  const api = useNadfunCandles(coin.token, skipApi ? null : ageSeconds);
  const apiCandles = skipApi ? null : (api.data ?? null);
  // Until the block clock answers there is no age, so the API query is disabled: wait for it rather than start
  // a chain scan that the API's answer would make pointless.
  const apiPending = !skipApi && api.data === undefined && !api.isError && (ageSeconds !== null || clock.isPending);
  const readChain = !skipApi && !apiPending && apiCandles === null;

  // GeckoTerminal candles are US dollars per token; the others are MON per token. One multiplier turns either
  // into market cap, in dollars when the MON rate is known and in MON otherwise.
  const mult = TOTAL_SUPPLY * (gtCandles ? 1 : (monUsd ?? 1));
  const inUsd = gtCandles !== null || monUsd !== null;
  const fmt = useMemo(() => (inUsd ? formatUsd : (v: number) => `${formatUsd(v).slice(1)} MON`), [inUsd]);
  const { scan, status, lowerBound } = useTradeHistory(
    readChain ? coin.token : undefined,
    coin.launchBlock,
    curve ? curve.virtualQuote.toString() : "",
  );
  const complete = gtCandles !== null || apiCandles !== null || (!!scan && scan.from <= lowerBound);
  const headBlock = Math.max(clock.data?.headBlock ?? 0, scan ? Number(scan.to) : 0) || null;

  const series = useMemo(
    () =>
      buildSeries({
        points: scan?.points ?? [],
        launchBlock: complete && coin.launchBlock > 0n ? Number(coin.launchBlock) : null,
        launchPrice: curve?.launchPrice ?? null,
        headBlock,
        livePrice: curve?.price ?? null,
        windowStart: scan ? Number(scan.from) : null,
      }),
    [scan, complete, coin.launchBlock, curve, headBlock],
  );
  // Candles in the source's own price unit; scaled to market cap only when drawn.
  const candles = useMemo((): Candle[] => {
    if (gtCandles !== null) return gtCandles;
    if (apiCandles !== null) {
      const out = apiCandles.map((c) => ({ ...c }));
      // Anchor the right edge on the live curve price, and the left edge on the launch price when the
      // first candle is later than launch (candles only exist for periods with trades).
      if (clock.data) {
        const flat = (time: number, v: number): Candle => ({ time, open: v, high: v, low: v, close: v });
        const launchTime = clock.data.headTimestamp - (ageSeconds ?? 0);
        if (curve?.launchPrice && curve.launchPrice > 0 && (out.length === 0 || out[0].time > launchTime)) {
          out.unshift(flat(launchTime, curve.launchPrice));
        }
        const last = out[out.length - 1];
        if (curve?.price && curve.price > 0 && (!last || last.time < clock.data.headTimestamp)) {
          out.push(flat(clock.data.headTimestamp, curve.price));
        }
      }
      return out.filter((p, i) => i === 0 || p.time > out[i - 1].time);
    }
    return clock.data && headBlock !== null ? toCandles(toChartData(series, { ...clock.data, headBlock })) : [];
  }, [gtCandles, apiCandles, series, clock.data, headBlock, curve, ageSeconds]);

  // Create the chart once, and tear it down with the component.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const muted = cssColor("--muted", "#aaa4c8");
    const line = cssColor("--line", "#2f2a45");
    const up = cssColor("--mint", "#6ee7b7");
    const down = cssColor("--pink", "#ff9ecb");
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: muted, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: { borderColor: line, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderColor: line, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: muted, labelBackgroundColor: line }, horzLine: { color: muted, labelBackgroundColor: line } },
      localization: { priceFormatter: (v: number) => fmtRef.current(v) },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      borderUpColor: up,
      borderDownColor: down,
      wickUpColor: up,
      wickDownColor: down,
      priceFormat: { type: "custom", formatter: (v: number) => fmtRef.current(v), minMove: 1e-12 },
      lastValueVisible: true,
      priceLineVisible: false,
      // A flat price would otherwise zoom into a hair-thin range and label every tick the same.
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const info = original();
        if (!info?.priceRange) return info;
        const { minValue, maxValue } = info.priceRange;
        const mid = (minValue + maxValue) / 2;
        const minSpan = mid * 0.1;
        return maxValue - minValue < minSpan
          ? { ...info, priceRange: { minValue: mid - minSpan / 2, maxValue: mid + minSpan / 2 } }
          : info;
      },
    });
    chart.subscribeCrosshairMove((param) => {
      const point = param.seriesData.get(candle);
      if (param.time === undefined || !point || !("close" in point)) setHover(null);
      else setHover({ time: Number(param.time), price: point.close });
    });
    chartRef.current = chart;
    candleRef.current = candle;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      fittedRef.current = "";
    };
  }, []);

  // Declared before the data effect so the new formatter is in place when it redraws.
  useEffect(() => {
    fmtRef.current = fmt;
  }, [fmt]);

  // Feed it data. Fit the view when the coin or the completeness of history changes, but never while
  // the reader is panning around in a half-loaded history that merely grew by a few trades.
  useEffect(() => {
    const candle = candleRef.current;
    const chart = chartRef.current;
    if (!candle || !chart) return;
    candle.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open * mult,
        high: c.high * mult,
        low: c.low * mult,
        close: c.close * mult,
      })),
    );
    const key = `${coin.token}:${complete}:${candles.length > 0}`;
    if (candles.length > 0 && fittedRef.current !== key) {
      chart.timeScale().fitContent();
      fittedRef.current = key;
    }
  }, [candles, mult, coin.token, complete]);

  const agoLabel = (time: number) => {
    if (!clock.data) return "";
    const secs = Math.max(0, clock.data.headTimestamp - time);
    return secs < 5 ? "now" : `${formatCountdown(BigInt(secs))} ago`;
  };

  // Price per token (in the source's unit) at the hovered candle's close, else live. Market cap follows it.
  const lastClose = candles[candles.length - 1]?.close ?? null;
  const current = hover ? hover.price / mult : gtCandles ? lastClose : (curve?.price ?? lastClose);
  const first = candles[0]?.open ?? null;
  const change =
    first !== null && (gtCandles || curve) && candles.length >= 2 && (candles.length > 2 || candles[0].open !== candles[1].close)
      ? formatChange(first, gtCandles || !curve ? (lastClose ?? first) : curve.price)
      : null;

  let progress: string | null = null;
  if (gtPending) {
    progress = "Loading from GeckoTerminal…";
  } else if (apiPending) {
    progress = "Loading from nad.fun…";
  } else if (gtCandles !== null || apiCandles !== null) {
    progress = null;
  } else if (!scan) {
    progress = "Reading the chain…";
  } else if (!complete) {
    const total = Number(scan.to - lowerBound + 1n);
    const done = Number(scan.to - scan.from + 1n);
    progress = `Loading older trades… ${Math.min(99, Math.floor((done / Math.max(1, total)) * 100))}%`;
  }

  const empty = candles.length === 0;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold">Market cap</h2>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums">{current !== null ? fmt(current * mult) : "…"}</p>
          <p className="text-sm text-muted" aria-live="polite">
            {hover ? agoLabel(hover.time) : "now"}
            {current !== null ? ` · ${gtCandles ? "$" : ""}${formatPrice(current)}${gtCandles ? "" : " MON"} per $${coin.symbol}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {curve?.graduated ? <Badge tone="lemon">Graduated</Badge> : null}
          {change ? (
            <Badge tone={change.startsWith("+") ? "mint" : change.startsWith("-") ? "pink" : "muted"}>
              {change} {complete ? "since launch" : "in loaded history"}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="relative mt-4" style={{ height: HEIGHT }}>
        <div
          ref={boxRef}
          role="img"
          aria-label={`Market cap chart for $${coin.symbol}. Now ${current !== null ? fmt(current * mult) : "unknown"}.`}
          className={empty ? "invisible h-full" : "h-full"}
        />
        {empty ? (
          <div className="absolute inset-0 flex items-center justify-center">
            {curveLoading || clock.isLoading ? (
              <div className="fv-pulse h-full w-full rounded-2xl bg-ink" />
            ) : (
              <p className="text-center text-muted">No price data yet for this coin.</p>
            )}
          </div>
        ) : null}
      </div>

      <p className="mt-2 min-h-5 text-xs text-muted" aria-live="polite">
        {gtCandles !== null ? (
          "Price history from GeckoTerminal, for the DEX pool since the coin graduated."
        ) : apiCandles !== null ? (
          "Price history from nad.fun. The price moves only when someone trades."
        ) : status === "error" && !complete ? (
          <span className="text-lemon">Could not read all older trades (the RPC is busy). Retrying…</span>
        ) : progress ? (
          <span className="fv-pulse font-semibold text-brand-soft">{progress}</span>
        ) : scan ? (
          `${scan.points.length} trade${scan.points.length === 1 ? "" : "s"} since launch. The price moves only when someone trades.`
        ) : null}
      </p>
    </Card>
  );
}
