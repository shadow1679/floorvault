import { formatEther, parseEther, type Address } from "viem";

export const TREASURY_BPS = 1_000n;
export const CREATOR_BPS = 1_000n;
export const BPS = 10_000n;

/** Format wei as a MON amount: trimmed trailing zeros, at most `maxDecimals` decimals. */
export function formatMon(wei: bigint, maxDecimals = 4): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const [whole, frac = ""] = formatEther(abs).split(".");
  let trimmed = frac.slice(0, maxDecimals).replace(/0+$/, "");
  // Tiny non-zero amounts must not display as "0".
  if (whole === "0" && trimmed === "" && abs > 0n) {
    return `${negative ? "-" : ""}<${(10 ** -maxDecimals).toFixed(maxDecimals)}`;
  }
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (trimmed !== "") trimmed = `.${trimmed}`;
  return `${negative ? "-" : ""}${withCommas}${trimmed}`;
}

/** "1.5 MON" style label. */
export function monLabel(wei: bigint, maxDecimals = 4): string {
  return `${formatMon(wei, maxDecimals)} MON`;
}

/** Parse a user-entered decimal MON string. Returns null when it is not a valid non-negative amount. */
export function parseMonInput(value: string): bigint | null {
  const v = value.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(v)) return null;
  try {
    return parseEther(v);
  } catch {
    return null;
  }
}

export function shortAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** Mirrors FloorVault.harvest: 10% to treasury, 10% to the creator, the rest to the NFT budget. */
export function splitFee(claimed: bigint): { toTreasury: bigint; toCreator: bigint; toBudget: bigint } {
  const toTreasury = (claimed * TREASURY_BPS) / BPS;
  const toCreator = (claimed * CREATOR_BPS) / BPS;
  return { toTreasury, toCreator, toBudget: claimed - toTreasury - toCreator };
}

/** How much more budget a coin needs before it can buy the floor NFT (0 when it can already buy). */
export function budgetGap(floorPrice: bigint, budget: bigint): bigint {
  return floorPrice > budget ? floorPrice - budget : 0n;
}

export function bpsToPercent(bps: number): string {
  return `${bps / 100}%`;
}

export function isSameAddress(a?: string, b?: string): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export function explorerAddressUrl(base: string, address: Address | string): string {
  return `${base}/address/${address}`;
}

export function explorerTxUrl(base: string, hash: string): string {
  return `${base}/tx/${hash}`;
}

export type NextBuyProgress = {
  /** Whole percent of the floor price the budget covers, 0 to 100. Only 100 when the budget really covers it. */
  percent: number;
  /** Budget still missing before the vault can buy the floor, in wei. */
  gap: bigint;
  ready: boolean;
};

/** How close a coin is to buying its next NFT: budget against the cheapest listing. */
export function nextBuyProgress(budget: bigint, floorPrice: bigint): NextBuyProgress {
  if (floorPrice <= 0n) return { percent: 0, gap: 0n, ready: false };
  if (budget >= floorPrice) return { percent: 100, gap: 0n, ready: true };
  // Rounded down so 99.9% never reads as done.
  return { percent: Number((budget * 100n) / floorPrice), gap: floorPrice - budget, ready: false };
}

/**
 * Rough trading volume (wei) that would still have to happen to close `gap` of budget: the creator fee
 * rate applies to volume, and 80% of what the vault claims becomes budget. An estimate, not a promise.
 */
export function volumeToCloseGap(gap: bigint, creatorFeeBps: number): bigint {
  if (gap <= 0n || creatorFeeBps <= 0) return 0n;
  const budgetShareBps = BPS - TREASURY_BPS - CREATOR_BPS;
  const num = gap * BPS * BPS;
  const den = budgetShareBps * BigInt(creatorFeeBps);
  return (num + den - 1n) / den;
}

/** "1.23M", "45.6K", "812": a token amount in wei as a compact whole-token number. */
export function formatTokens(wei: bigint): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(Number(formatEther(wei)));
}
