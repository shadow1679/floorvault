// Pure helpers for the per-coin NFT raffle: event records, grouping them per coin, and deciding
// which step a raffle is on. No network access here, so it is all unit-testable.
import type { Address, Hash, Hex } from "viem";

export type LogMeta = { blockNumber: bigint; transactionHash: Hash; logIndex: number };

/** Contract constant: how long the winner has to claim. */
export const CLAIM_WINDOW_SECONDS = 7n * 24n * 60n * 60n;

export type RaffleLog = LogMeta &
  (
    | { kind: "Opened"; id: bigint; token: Address; collection: Address; tokenId: bigint; fallbackTo: Address; drawAt: bigint }
    | { kind: "Drawn"; id: bigint; round: number; seed: Hex; settleEnd: bigint }
    | { kind: "Settled"; id: bigint; round: number; holder: Address; score: bigint; leading: boolean }
    | { kind: "Finalized"; id: bigint; round: number; winner: Address; claimDeadline: bigint }
    | { kind: "FellBack"; id: bigint; round: number; to: Address }
    | { kind: "Claimed"; id: bigint; winner: Address }
    | { kind: "ReRaffled"; id: bigint; round: number; drawAt: bigint; excludedWinner: Address }
  );

export type RaffleLogKind = RaffleLog["kind"];

export const RAFFLE_EVENTS = [
  "event Opened(uint256 indexed id, address indexed token, address indexed collection, uint256 tokenId, address fallbackTo, uint64 drawAt)",
  "event Drawn(uint256 indexed id, uint32 round, bytes32 seed, uint64 settleEnd)",
  "event Settled(uint256 indexed id, uint32 round, address indexed holder, uint256 score, bool leading)",
  "event Finalized(uint256 indexed id, uint32 round, address indexed winner, uint64 claimDeadline)",
  "event FellBack(uint256 indexed id, uint32 round, address indexed to)",
  "event Claimed(uint256 indexed id, address indexed winner)",
  "event ReRaffled(uint256 indexed id, uint32 round, uint64 drawAt, address indexed excludedWinner)",
] as const;

export type RawLog = {
  eventName?: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hash;
  logIndex: number;
};

/** Turn a decoded log from the Raffle contract into a record, or null for any other event. */
export function parseRaffleLog(l: RawLog): RaffleLog | null {
  const meta: LogMeta = { blockNumber: l.blockNumber, transactionHash: l.transactionHash, logIndex: l.logIndex };
  const a = l.args;
  switch (l.eventName) {
    case "Opened":
      return {
        ...meta,
        kind: "Opened",
        id: a.id as bigint,
        token: a.token as Address,
        collection: a.collection as Address,
        tokenId: a.tokenId as bigint,
        fallbackTo: a.fallbackTo as Address,
        drawAt: BigInt(a.drawAt as bigint),
      };
    case "Drawn":
      return { ...meta, kind: "Drawn", id: a.id as bigint, round: Number(a.round), seed: a.seed as Hex, settleEnd: BigInt(a.settleEnd as bigint) };
    case "Settled":
      return {
        ...meta,
        kind: "Settled",
        id: a.id as bigint,
        round: Number(a.round),
        holder: a.holder as Address,
        score: a.score as bigint,
        leading: Boolean(a.leading),
      };
    case "Finalized":
      return {
        ...meta,
        kind: "Finalized",
        id: a.id as bigint,
        round: Number(a.round),
        winner: a.winner as Address,
        claimDeadline: BigInt(a.claimDeadline as bigint),
      };
    case "FellBack":
      return { ...meta, kind: "FellBack", id: a.id as bigint, round: Number(a.round), to: a.to as Address };
    case "Claimed":
      return { ...meta, kind: "Claimed", id: a.id as bigint, winner: a.winner as Address };
    case "ReRaffled":
      return {
        ...meta,
        kind: "ReRaffled",
        id: a.id as bigint,
        round: Number(a.round),
        drawAt: BigInt(a.drawAt as bigint),
        excludedWinner: a.excludedWinner as Address,
      };
    default:
      return null;
  }
}

export type RaffleSummary = {
  id: bigint;
  token: Address;
  collection: Address;
  tokenId: bigint;
  fallbackTo: Address;
  openedBlock: bigint;
  /** Winners who did not claim in time, oldest first. They cannot win this raffle again. */
  pastWinners: Address[];
};

/** The raffles that belong to one coin, newest first, built from the scanned events. */
export function deriveRaffles(logs: RaffleLog[], token: Address): RaffleSummary[] {
  const t = token.toLowerCase();
  const out: RaffleSummary[] = [];
  for (const l of logs) {
    if (l.kind !== "Opened" || l.token.toLowerCase() !== t) continue;
    const pastWinners = logs
      .filter((x): x is Extract<RaffleLog, { kind: "ReRaffled" }> => x.kind === "ReRaffled" && x.id === l.id)
      .map((x) => x.excludedWinner);
    out.push({
      id: l.id,
      token: l.token,
      collection: l.collection,
      tokenId: l.tokenId,
      fallbackTo: l.fallbackTo,
      openedBlock: l.blockNumber,
      pastWinners,
    });
  }
  return out.sort((a, b) => (a.id === b.id ? 0 : a.id < b.id ? 1 : -1));
}

// ---- On-chain state and the step it is on ------------------------------------------------

export const Stage = { Waiting: 0, Settling: 1, Won: 2, Claimed: 3, Fallback: 4 } as const;

/** Mirror of `Raffle.getRaffle(id)`. */
export type RaffleState = {
  token: Address;
  collection: Address;
  tokenId: bigint;
  fallbackTo: Address;
  stage: number;
  round: number;
  drawAt: bigint;
  settleEnd: bigint;
  claimDeadline: bigint;
  seed: Hex;
  leader: Address;
  leaderScore: bigint;
  winner: Address;
};

export type RaffleStep =
  | { kind: "wait-draw"; until: bigint }
  | { kind: "can-draw" }
  | { kind: "settling"; until: bigint }
  | { kind: "can-finalize" }
  | { kind: "claimable"; until: bigint }
  | { kind: "expired" }
  | { kind: "claimed" }
  | { kind: "fallback" };

/**
 * Which step a raffle is on at `nowSec` (unix seconds). The boundaries match the contract:
 * draw at or after `drawAt`, settle strictly before `settleEnd`, finalize at or after it,
 * claim up to and including `claimDeadline`, re-raffle strictly after it.
 */
export function raffleStep(state: Pick<RaffleState, "stage" | "drawAt" | "settleEnd" | "claimDeadline">, nowSec: bigint): RaffleStep {
  switch (state.stage) {
    case Stage.Waiting:
      return nowSec >= state.drawAt ? { kind: "can-draw" } : { kind: "wait-draw", until: state.drawAt };
    case Stage.Settling:
      return nowSec < state.settleEnd ? { kind: "settling", until: state.settleEnd } : { kind: "can-finalize" };
    case Stage.Won:
      return nowSec <= state.claimDeadline ? { kind: "claimable", until: state.claimDeadline } : { kind: "expired" };
    case Stage.Claimed:
      return { kind: "claimed" };
    default:
      return { kind: "fallback" };
  }
}

/** "2d 3h", "4h 05m", "3m 07s", "12s". Never negative. */
export function formatCountdown(seconds: bigint): string {
  const s = seconds < 0n ? 0n : seconds;
  const d = s / 86_400n;
  const h = (s % 86_400n) / 3_600n;
  const m = (s % 3_600n) / 60n;
  const sec = s % 60n;
  const pad = (n: bigint) => n.toString().padStart(2, "0");
  if (d > 0n) return `${d}d ${h}h`;
  if (h > 0n) return `${h}h ${pad(m)}m`;
  if (m > 0n) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}

// ---- Winners -----------------------------------------------------------------------------

/**
 * What became of one round's result. `open` means the winner was picked and the claim window has not
 * been resolved by an event yet: the UI decides between "can claim" and "ran out of time" from the clock.
 */
export type WinnerOutcome = "claimed" | "expired" | "open" | "fallback";

export type WinnerRecord = {
  raffleId: bigint;
  collection: Address;
  tokenId: bigint;
  round: number;
  /** The picked holder, or the launch recipient when nobody qualified (`fallback`). */
  winner: Address;
  outcome: WinnerOutcome;
  /** Unix seconds; only meaningful while the outcome is `open`. */
  claimDeadline: bigint;
  blockNumber: bigint;
};

/**
 * Every round result for one coin's raffles, newest first: who was picked, and whether they claimed,
 * ran out of time (and the NFT was re-raffled), or were skipped because nobody held the coin.
 */
export function deriveWinners(logs: RaffleLog[], token: Address): WinnerRecord[] {
  const t = token.toLowerCase();
  const opened = new Map<string, Extract<RaffleLog, { kind: "Opened" }>>();
  for (const l of logs) if (l.kind === "Opened" && l.token.toLowerCase() === t) opened.set(l.id.toString(), l);

  const records: WinnerRecord[] = [];
  const latestByRaffle = new Map<string, WinnerRecord>();
  // Chain order matters: a Finalized must be seen before the Claimed or ReRaffled that resolves it.
  const ordered = [...logs].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
  for (const l of ordered) {
    if (!("id" in l)) continue;
    const key = l.id.toString();
    const o = opened.get(key);
    if (!o) continue;
    const base = { raffleId: l.id, collection: o.collection, tokenId: o.tokenId, blockNumber: l.blockNumber };
    if (l.kind === "Finalized") {
      const rec: WinnerRecord = { ...base, round: l.round, winner: l.winner, outcome: "open", claimDeadline: l.claimDeadline };
      records.push(rec);
      latestByRaffle.set(key, rec);
    } else if (l.kind === "FellBack") {
      records.push({ ...base, round: l.round, winner: l.to, outcome: "fallback", claimDeadline: 0n });
    } else if (l.kind === "Claimed") {
      const rec = latestByRaffle.get(key);
      if (rec) rec.outcome = "claimed";
    } else if (l.kind === "ReRaffled") {
      const rec = latestByRaffle.get(key);
      if (rec && rec.outcome === "open") rec.outcome = "expired";
    }
  }
  return records.reverse();
}

/** An `open` result whose claim window has passed counts as expired even before anyone re-raffles. */
export function winnerStatus(rec: Pick<WinnerRecord, "outcome" | "claimDeadline">, nowSec: bigint): WinnerOutcome | "claimable" {
  if (rec.outcome !== "open") return rec.outcome;
  return nowSec <= rec.claimDeadline ? "claimable" : "expired";
}

// ---- Wins ---------------------------------------------------------------------------------

export type ClaimableWin = { id: bigint; state: RaffleState };

/**
 * The raffles `owner` has won and can still claim at `nowSec`, soonest deadline first. A win stops
 * being claimable after `claimDeadline` (the keeper then re-raffles it), and once it is claimed.
 */
export function claimableWins(states: Map<string, RaffleState> | undefined, owner: string | undefined, nowSec: bigint): ClaimableWin[] {
  if (!states || !owner) return [];
  const me = owner.toLowerCase();
  const wins: ClaimableWin[] = [];
  for (const [id, state] of states) {
    if (state.stage === Stage.Won && state.winner.toLowerCase() === me && nowSec <= state.claimDeadline) {
      wins.push({ id: BigInt(id), state });
    }
  }
  return wins.sort((a, b) => (a.state.claimDeadline === b.state.claimDeadline ? 0 : a.state.claimDeadline < b.state.claimDeadline ? -1 : 1));
}
