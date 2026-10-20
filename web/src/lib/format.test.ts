import { describe, expect, it } from "vitest";
import {
  budgetGap,
  formatMon,
  isSameAddress,
  monLabel,
  nextBuyProgress,
  parseMonInput,
  shortAddress,
  splitFee,
  volumeToCloseGap,
} from "./format";

const E18 = 10n ** 18n;

describe("formatMon", () => {
  it("never shows raw wei", () => {
    expect(formatMon(E18)).toBe("1");
    expect(formatMon(E18 / 10n)).toBe("0.1");
    expect(formatMon(0n)).toBe("0");
  });
  it("trims zeros and caps decimals", () => {
    expect(formatMon(1_234_567_890_000_000_000n)).toBe("1.2345");
    expect(formatMon(1_500_000_000_000_000_000n)).toBe("1.5");
  });
  it("groups thousands", () => {
    expect(formatMon(1_234_567n * E18)).toBe("1,234,567");
  });
  it("does not show tiny amounts as zero", () => {
    expect(formatMon(1n)).toBe("<0.0001");
  });
  it("labels with the unit", () => {
    expect(monLabel(5n * E18)).toBe("5 MON");
  });
});

describe("parseMonInput", () => {
  it("parses valid decimals", () => {
    expect(parseMonInput("10")).toBe(10n * E18);
    expect(parseMonInput(" 0.5 ")).toBe(E18 / 2n);
  });
  it("rejects bad input", () => {
    for (const bad of ["", "abc", "-1", "1e3", "1.", ".5", "1.0000000000000000001", "1,5"]) {
      expect(parseMonInput(bad), bad).toBeNull();
    }
  });
});

describe("splitFee", () => {
  it("splits 80/10/10 and loses nothing", () => {
    const { toTreasury, toCreator, toBudget } = splitFee(10n * E18);
    expect(toTreasury).toBe(1n * E18);
    expect(toCreator).toBe(1n * E18);
    expect(toBudget).toBe(8n * E18);
  });
  it("matches the contract's rounding (treasury rounds down, budget keeps the dust)", () => {
    const { toTreasury, toCreator, toBudget } = splitFee(7n);
    expect(toTreasury).toBe(0n);
    expect(toCreator).toBe(0n);
    expect(toBudget).toBe(7n);
    expect(toTreasury + toCreator + toBudget).toBe(7n);
  });
});

describe("budgetGap", () => {
  it("is zero when the budget covers the floor", () => {
    expect(budgetGap(E18, E18)).toBe(0n);
    expect(budgetGap(E18, 2n * E18)).toBe(0n);
  });
  it("is the shortfall otherwise", () => {
    expect(budgetGap(3n * E18, E18)).toBe(2n * E18);
  });
});

describe("addresses", () => {
  it("shortens", () => {
    expect(shortAddress("0x8b5459fad279f1beef9854d70167a79fc19411e1")).toBe("0x8b54…11e1");
  });
  it("compares case-insensitively", () => {
    expect(isSameAddress("0xAbC", "0xabc")).toBe(true);
    expect(isSameAddress(undefined, "0xabc")).toBe(false);
  });
});

describe("nextBuyProgress", () => {
  const e = (n: number) => BigInt(n) * 10n ** 17n; // tenths of a MON

  it("is a whole percent of the floor, rounded down", () => {
    expect(nextBuyProgress(e(5), e(20))).toEqual({ percent: 25, gap: e(15), ready: false });
    expect(nextBuyProgress(999n, 1000n)).toMatchObject({ percent: 99, ready: false });
  });

  it("is 100 and ready only when the budget covers the floor", () => {
    expect(nextBuyProgress(e(20), e(20))).toEqual({ percent: 100, gap: 0n, ready: true });
    expect(nextBuyProgress(e(30), e(20)).percent).toBe(100);
  });

  it("is 0 when there is no floor price", () => {
    expect(nextBuyProgress(e(5), 0n)).toEqual({ percent: 0, gap: 0n, ready: false });
  });
});

describe("volumeToCloseGap", () => {
  it("scales the gap by the 80% budget share and the creator fee rate", () => {
    // 1 MON gap, 3% creator fee, 80% of it becomes budget: 1 / (0.03 * 0.8) = 41.67 MON
    const v = volumeToCloseGap(10n ** 18n, 300);
    expect(Number(v) / 1e18).toBeCloseTo(41.667, 2);
  });

  it("is zero with no gap or no fee", () => {
    expect(volumeToCloseGap(0n, 300)).toBe(0n);
    expect(volumeToCloseGap(10n ** 18n, 0)).toBe(0n);
  });
});
