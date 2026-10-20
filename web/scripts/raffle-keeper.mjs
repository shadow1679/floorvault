// Pure helpers for the keeper's raffle automation: which step a raffle is on, and how to rank a coin's
// holders. No network access, so it is unit-tested (src/lib/raffle-keeper.test.ts). The score arithmetic
// mirrors Raffle.scoreOf and src/lib/holders.ts, which the browser uses for the same job.
//
// The keeper drives every step up to the winner's claim: draw, settle, finalize and reRaffle. It never
// claims: Raffle.claim only accepts the winner.
import { encodeAbiParameters, keccak256, zeroAddress } from "viem";

/** Raffle.Stage. */
export const Stage = { Waiting: 0, Settling: 1, Won: 2, Claimed: 3, Fallback: 4 };

/**
 * The next step the keeper may take for a raffle (`getRaffle` fields), given chain time in seconds.
 * "wait" means a step is coming but not yet possible; "done" means nothing is left for anyone to call
 * except the winner's claim.
 */
export function raffleAction(r, nowSec) {
  const now = BigInt(nowSec);
  switch (Number(r.stage)) {
    case Stage.Waiting:
      return now >= r.drawAt ? "draw" : "wait";
    case Stage.Settling:
      return now >= r.settleEnd ? "finalize" : "settle";
    case Stage.Won:
      return now > r.claimDeadline ? "reRaffle" : "wait";
    default:
      return "done";
  }
}

/** Same arithmetic as `Raffle.scoreOf`: keccak256(abi.encode(seed, holder)) / balance. */
export function scoreOf(seed, holder, balance) {
  if (balance <= 0n) throw new Error("balance must be positive");
  const hash = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [seed, holder]));
  return BigInt(hash) / balance;
}

/** Fold ERC-20 transfers ({ from, to, value }) into lowercase address -> balance. Pure; zero balances are dropped. */
export function applyTransfers(balances, transfers) {
  const next = { ...balances };
  for (const t of transfers) {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    next[from] = (next[from] ?? 0n) - t.value;
    next[to] = (next[to] ?? 0n) + t.value;
  }
  for (const k of Object.keys(next)) if (next[k] === 0n) delete next[k];
  return next;
}

/** Holders with a positive balance that are not excluded, lowest (best) score first; ties break by address. */
export function rankHolders(balances, seed, exclude = []) {
  const skip = new Set([zeroAddress, ...Array.from(exclude, (a) => a.toLowerCase())]);
  const ranked = [];
  for (const [holder, balance] of Object.entries(balances)) {
    if (balance <= 0n || skip.has(holder)) continue;
    ranked.push({ holder, balance, score: scoreOf(seed, holder, balance) });
  }
  return ranked.sort((a, b) => (a.score === b.score ? (a.holder < b.holder ? -1 : 1) : a.score < b.score ? -1 : 1));
}

/** Balances <-> JSON for the keeper's state file (bigint is not JSON). */
export const balancesToJson = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.toString()]));
export const balancesFromJson = (j) => Object.fromEntries(Object.entries(j ?? {}).map(([k, v]) => [k, BigInt(v)]));
