import { describe, expect, it } from "vitest";
import type { Hash } from "viem";
import {
  buildSeries,
  formatChange,
  formatPrice,
  formatUsd,
  marketCap,
  minAfterSlippage,
  priceFromReserves,
  secondsAgo,
  secondsPerBlock,
  toCandles,
  toChartData,
  type PricePoint,
} from "./trades";

const pt = (block: number, price: number): PricePoint => ({
  blockNumber: BigInt(block),
  transactionHash: `0x${block.toString(16).padStart(64, "0")}` as Hash,
  logIndex: 0,
  price,
});

describe("priceFromReserves", () => {
  it("divides the virtual reserves", () => {
    expect(priceFromReserves(70_000n * 10n ** 18n, 1_060_000_000n * 10n ** 18n)).toBeCloseTo(6.6e-5, 7);
  });
  it("is 0 when the token reserve is empty", () => {
    expect(priceFromReserves(1n, 0n)).toBe(0);
  });
});

describe("formatPrice", () => {
  it("keeps about four significant digits without scientific notation", () => {
    expect(formatPrice(0.000066037)).toBe("0.00006604");
    expect(formatPrice(1.23456)).toBe("1.235");
    expect(formatPrice(12.5)).toBe("12.5");
  });
  it("trims trailing zeros and handles zero", () => {
    expect(formatPrice(0.5)).toBe("0.5");
    expect(formatPrice(0)).toBe("0");
  });
});

describe("formatChange", () => {
  it("signs the change", () => {
    expect(formatChange(1, 1.124)).toBe("+12.4%");
    expect(formatChange(1, 0.97)).toBe("-3.0%");
    expect(formatChange(1, 1.0001)).toBe("0.0%");
  });
  it("is flat when there is no starting price", () => {
    expect(formatChange(0, 5)).toBe("0.0%");
  });
});

describe("buildSeries", () => {
  const base = { launchBlock: 100, launchPrice: 1, headBlock: 500, livePrice: 3 };

  it("anchors the launch price and the live price around the trades", () => {
    const s = buildSeries({ ...base, points: [pt(300, 2), pt(200, 1.5)] });
    expect(s).toEqual([
      { block: 100, price: 1 },
      { block: 200, price: 1.5 },
      { block: 300, price: 2 },
      { block: 500, price: 3 },
    ]);
  });

  it("skips the launch anchor while the history is incomplete (launchBlock null)", () => {
    const s = buildSeries({ ...base, launchBlock: null, points: [pt(300, 2)] });
    expect(s[0]).toEqual({ block: 300, price: 2 });
  });

  it("draws a flat line from launch to now when nobody has traded", () => {
    expect(buildSeries({ ...base, livePrice: 1, points: [] })).toEqual([
      { block: 100, price: 1 },
      { block: 500, price: 1 },
    ]);
  });

  it("does not duplicate the head point when a trade landed on it", () => {
    const s = buildSeries({ ...base, points: [pt(500, 3)] });
    expect(s.filter((p) => p.block === 500)).toHaveLength(1);
  });

  it("extends a flat line back over the loaded window when it holds no trades", () => {
    const s = buildSeries({ points: [], launchBlock: null, launchPrice: 1, headBlock: 500, livePrice: 3, windowStart: 300 });
    expect(s).toEqual([
      { block: 300, price: 3 },
      { block: 500, price: 3 },
    ]);
  });

  it("does not invent a left edge when the loaded window holds trades", () => {
    const s = buildSeries({ points: [pt(400, 2)], launchBlock: null, launchPrice: 1, headBlock: 500, livePrice: 3, windowStart: 300 });
    expect(s[0]).toEqual({ block: 400, price: 2 });
  });

  it("is empty when there is nothing to plot", () => {
    expect(buildSeries({ points: [], launchBlock: null, launchPrice: null, headBlock: null, livePrice: null })).toEqual([]);
  });
});

describe("toChartData", () => {
  const clock = { headBlock: 1000, headTimestamp: 5000, secPerBlock: 0.4 };

  it("turns blocks into unix seconds counted back from the head", () => {
    expect(
      toChartData(
        [
          { block: 500, price: 1 },
          { block: 1000, price: 2 },
        ],
        clock,
      ),
    ).toEqual([
      { time: 4800, value: 1 },
      { time: 5000, value: 2 },
    ]);
  });

  it("keeps the last price when trades share a second", () => {
    const data = toChartData(
      [
        { block: 998, price: 1 },
        { block: 999, price: 2 },
        { block: 1000, price: 3 },
      ],
      clock,
    );
    expect(data).toEqual([
      { time: 4999, value: 1 },
      { time: 5000, value: 3 },
    ]);
  });

  it("is empty for an empty series", () => {
    expect(toChartData([], clock)).toEqual([]);
  });
});

describe("time helpers", () => {
  it("measures seconds per block from two samples", () => {
    expect(secondsPerBlock({ block: 0n, timestamp: 0n }, { block: 1000n, timestamp: 400n })).toBeCloseTo(0.4);
  });
  it("falls back to 0.4s for unusable samples", () => {
    expect(secondsPerBlock({ block: 5n, timestamp: 5n }, { block: 5n, timestamp: 5n })).toBe(0.4);
  });
  it("converts block distance to seconds and never goes negative", () => {
    expect(secondsAgo(900, 1000, 0.4)).toBe(40);
    expect(secondsAgo(1100, 1000, 0.4)).toBe(0);
  });
});

describe("minAfterSlippage", () => {
  it("takes the slippage off the quote", () => {
    expect(minAfterSlippage(10_000n, 100)).toBe(9_900n);
    expect(minAfterSlippage(10_000n, 1000)).toBe(9_000n);
  });
});

describe("marketCap and formatUsd", () => {
  it("multiplies by the fixed 1B supply", () => {
    expect(marketCap(6.6e-5)).toBeCloseTo(66_000, 3);
  });
  it("writes compact dollars", () => {
    expect(formatUsd(66_412)).toBe("$66.4K");
    expect(formatUsd(1_234_567)).toBe("$1.23M");
    expect(formatUsd(812)).toBe("$812");
    expect(formatUsd(12.5)).toBe("$12.50");
    expect(formatUsd(0)).toBe("$0");
  });
});

describe("toCandles", () => {
  it("opens each candle at the previous close", () => {
    const c = toCandles([
      { time: 1, value: 10 },
      { time: 2, value: 12 },
      { time: 3, value: 9 },
    ]);
    expect(c[0]).toEqual({ time: 1, open: 10, high: 10, low: 10, close: 10 });
    expect(c[1]).toEqual({ time: 2, open: 10, high: 12, low: 10, close: 12 });
    expect(c[2]).toEqual({ time: 3, open: 12, high: 12, low: 9, close: 9 });
  });
});
