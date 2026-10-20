// Coin holders and raffle scores. The chain cannot list a coin's holders, so the browser folds the
// coin's ERC-20 Transfer logs into balances, then ranks them with the same score the Raffle
// contract uses: hash(seed, holder) / balance, lowest wins.
import { encodeAbiParameters, keccak256, zeroAddress, type Address, type Hex } from "viem";

/** Lowercase address -> balance. Zero balances are dropped. */
export type Balances = Record<string, bigint>;

export type TransferRec = { from: Address; to: Address; value: bigint };

/** Same arithmetic as `Raffle.scoreOf`: keccak256(abi.encode(seed, holder)) / balance. */
export function scoreOf(seed: Hex, holder: Address, balance: bigint): bigint {
  if (balance <= 0n) throw new Error("balance must be positive");
  const hash = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [seed, holder]));
  return BigInt(hash) / balance;
}

/** Fold transfers into balances. Pure: returns a new object. Mints and burns touch the zero address only. */
export function applyTransfers(balances: Balances, transfers: TransferRec[]): Balances {
  const next: Balances = { ...balances };
  for (const t of transfers) {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    next[from] = (next[from] ?? 0n) - t.value;
    next[to] = (next[to] ?? 0n) + t.value;
  }
  for (const k of Object.keys(next)) if (next[k] === 0n) delete next[k];
  return next;
}

export type RankedHolder = { holder: Address; balance: bigint; score: bigint };

/**
 * Holders with a positive balance that are not excluded, best (lowest) score first.
 * Ties break by address so the order is deterministic.
 */
export function rankHolders(balances: Balances, seed: Hex, exclude: Iterable<string> = []): RankedHolder[] {
  const skip = new Set<string>([zeroAddress, ...Array.from(exclude, (a) => a.toLowerCase())]);
  const ranked: RankedHolder[] = [];
  for (const [holder, balance] of Object.entries(balances)) {
    if (balance <= 0n || skip.has(holder)) continue;
    ranked.push({ holder: holder as Address, balance, score: scoreOf(seed, holder as Address, balance) });
  }
  return ranked.sort((a, b) => (a.score === b.score ? (a.holder < b.holder ? -1 : 1) : a.score < b.score ? -1 : 1));
}

/**
 * Each holder's chance of winning, given the contract's rule (lowest hash/balance wins). The hash is
 * uniform, so a holder's score is uniform on [0, M/balance]; the chance that holder i has the lowest
 * score is, with w_j = balance_j / max balance:  P_i = integral over u in [0,1] of w_i * prod_{j != i}(1 - u * w_j).
 * That is close to the plain share of the balances but favours bigger holders slightly. Balances must be
 * positive; the result lines up with the input and sums to 1.
 */
export function winChances(balances: bigint[]): number[] {
  if (balances.length === 0) return [];
  if (balances.some((b) => b <= 0n)) throw new Error("balances must be positive");
  const max = balances.reduce((m, b) => (b > m ? b : m));
  const w = balances.map((b) => Number((b * 1_000_000_000_000n) / max) / 1e12);
  const sum = w.reduce((s, x) => s + x, 0);
  // The integrand dies off on a scale of 1/sum, so sample u = x^p with p growing with the crowd.
  const p = Math.max(1, Math.log10(sum) + 1);
  const steps = 800;
  const out = new Array<number>(w.length).fill(0);
  for (let k = 0; k < steps; k++) {
    const x = (k + 0.5) / steps;
    const u = x ** p;
    const weight = (p * x ** (p - 1)) / steps; // du = p x^(p-1) dx
    const terms = w.map((wj) => Math.log1p(-u * wj));
    const total = terms.reduce((s, t) => s + t, 0);
    for (let i = 0; i < w.length; i++) out[i] += weight * w[i] * Math.exp(total - terms[i]);
  }
  const norm = out.reduce((s, x) => s + x, 0);
  return out.map((x) => x / norm);
}

/** Every nad.fun coin has 1,000,000,000 tokens with 18 decimals. */
export const SUPPLY_WEI = 1_000_000_000n * 10n ** 18n;

export type HolderRow = {
  holder: Address;
  balance: bigint;
  /** Share of the fixed supply, 0-100, two decimals. */
  percent: number;
  /** Set for protocol addresses (the bonding curve, the vault, the raffle). They hold coins but cannot win. */
  label?: string;
  /** 1-based place in the current draw, best first. Only set for eligible holders when a `seed` is given. */
  raffleRank?: number;
};

/**
 * The holder board: every address with a positive balance, biggest first (ties by address). Labelled
 * addresses are shown but never ranked for the raffle. With a `seed` (a raffle in its settle window)
 * each eligible holder also gets their place in the draw, using the same score as the contract.
 */
export function buildHolderRows(
  balances: Balances,
  opts: { labels?: Record<string, string>; seed?: Hex | null; supply?: bigint } = {},
): HolderRow[] {
  const supply = opts.supply ?? SUPPLY_WEI;
  const labels: Record<string, string> = {};
  for (const [a, l] of Object.entries(opts.labels ?? {})) labels[a.toLowerCase()] = l;

  const place = new Map<string, number>();
  if (opts.seed) rankHolders(balances, opts.seed, Object.keys(labels)).forEach((r, i) => place.set(r.holder, i + 1));

  const rows: HolderRow[] = [];
  for (const [holder, balance] of Object.entries(balances)) {
    if (balance <= 0n || holder === zeroAddress) continue;
    rows.push({
      holder: holder as Address,
      balance,
      percent: Number((balance * 10_000n) / supply) / 100,
      label: labels[holder],
      raffleRank: place.get(holder),
    });
  }
  return rows.sort((a, b) => (a.balance === b.balance ? (a.holder < b.holder ? -1 : 1) : a.balance > b.balance ? -1 : 1));
}
