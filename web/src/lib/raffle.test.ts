import { describe, expect, it } from "vitest";
import type { Address, Hash, Hex } from "viem";
import {
  CLAIM_WINDOW_SECONDS,
  claimableWins,
  deriveRaffles,
  deriveWinners,
  formatCountdown,
  parseRaffleLog,
  raffleStep,
  Stage,
  winnerStatus,
  type RaffleLog,
  type RaffleState,
} from "./raffle";

const addr = (c: string) => `0x${c.repeat(40)}` as Address;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;
const TOKEN = addr("a");
const OTHER = addr("b");
const base = (n: number) => ({ blockNumber: BigInt(n), transactionHash: hash(n), logIndex: 0 });

const opened = (id: bigint, token: Address, n: number): RaffleLog => ({
  ...base(n),
  kind: "Opened",
  id,
  token,
  collection: addr("1"),
  tokenId: id,
  fallbackTo: addr("2"),
  drawAt: 100n,
});

describe("parseRaffleLog", () => {
  it("decodes an Opened log", () => {
    const rec = parseRaffleLog({
      eventName: "Opened",
      args: { id: 1n, token: TOKEN, collection: addr("1"), tokenId: 7n, fallbackTo: addr("2"), drawAt: 123n },
      ...base(5),
    });
    expect(rec).toMatchObject({ kind: "Opened", id: 1n, token: TOKEN, tokenId: 7n, drawAt: 123n });
  });

  it("decodes the round events", () => {
    expect(parseRaffleLog({ eventName: "Drawn", args: { id: 1n, round: 2, seed: "0x01" as Hex, settleEnd: 9n }, ...base(1) })).toMatchObject({
      kind: "Drawn",
      round: 2,
      settleEnd: 9n,
    });
    expect(
      parseRaffleLog({ eventName: "ReRaffled", args: { id: 1n, round: 2, drawAt: 9n, excludedWinner: OTHER }, ...base(1) }),
    ).toMatchObject({ kind: "ReRaffled", excludedWinner: OTHER });
  });

  it("ignores events it does not know", () => {
    expect(parseRaffleLog({ eventName: "Transfer", args: {}, ...base(1) })).toBeNull();
    expect(parseRaffleLog({ args: {}, ...base(1) })).toBeNull();
  });
});

describe("deriveRaffles", () => {
  const logs: RaffleLog[] = [
    opened(1n, TOKEN, 1),
    opened(2n, OTHER, 2),
    opened(3n, TOKEN, 3),
    { ...base(4), kind: "ReRaffled", id: 1n, round: 2, drawAt: 5n, excludedWinner: addr("c") },
    { ...base(5), kind: "ReRaffled", id: 1n, round: 3, drawAt: 6n, excludedWinner: addr("d") },
    { ...base(6), kind: "ReRaffled", id: 2n, round: 2, drawAt: 6n, excludedWinner: addr("e") },
  ];

  it("keeps only the coin's own raffles, newest first", () => {
    expect(deriveRaffles(logs, TOKEN).map((r) => r.id)).toEqual([3n, 1n]);
    expect(deriveRaffles(logs, OTHER).map((r) => r.id)).toEqual([2n]);
  });

  it("matches the coin address case-insensitively", () => {
    expect(deriveRaffles(logs, TOKEN.toUpperCase().replace("0X", "0x") as Address)).toHaveLength(2);
  });

  it("collects past winners per raffle only", () => {
    const [, first] = deriveRaffles(logs, TOKEN);
    expect(first.pastWinners).toEqual([addr("c"), addr("d")]);
    expect(deriveRaffles(logs, OTHER)[0].pastWinners).toEqual([addr("e")]);
  });

  it("returns nothing for a coin with no raffle", () => {
    expect(deriveRaffles(logs, addr("9"))).toEqual([]);
  });
});

describe("raffleStep (boundaries match the contract)", () => {
  const s = { drawAt: 1000n, settleEnd: 2000n, claimDeadline: 3000n };

  it("waits for the draw time, then allows the draw at exactly drawAt", () => {
    expect(raffleStep({ ...s, stage: Stage.Waiting }, 999n)).toEqual({ kind: "wait-draw", until: 1000n });
    expect(raffleStep({ ...s, stage: Stage.Waiting }, 1000n)).toEqual({ kind: "can-draw" });
  });

  it("settles strictly before settleEnd and finalizes at it", () => {
    expect(raffleStep({ ...s, stage: Stage.Settling }, 1999n)).toEqual({ kind: "settling", until: 2000n });
    expect(raffleStep({ ...s, stage: Stage.Settling }, 2000n)).toEqual({ kind: "can-finalize" });
  });

  it("allows the claim through the deadline second and re-raffle only after it", () => {
    expect(raffleStep({ ...s, stage: Stage.Won }, 3000n)).toEqual({ kind: "claimable", until: 3000n });
    expect(raffleStep({ ...s, stage: Stage.Won }, 3001n)).toEqual({ kind: "expired" });
  });

  it("is terminal once claimed or fallen back", () => {
    expect(raffleStep({ ...s, stage: Stage.Claimed }, 9999n)).toEqual({ kind: "claimed" });
    expect(raffleStep({ ...s, stage: Stage.Fallback }, 9999n)).toEqual({ kind: "fallback" });
  });

  it("uses a 7 day claim window", () => {
    expect(CLAIM_WINDOW_SECONDS).toBe(604_800n);
  });
});

describe("formatCountdown", () => {
  it("formats by magnitude", () => {
    expect(formatCountdown(12n)).toBe("12s");
    expect(formatCountdown(187n)).toBe("3m 07s");
    expect(formatCountdown(4n * 3600n + 5n * 60n)).toBe("4h 05m");
    expect(formatCountdown(2n * 86400n + 3n * 3600n + 59n)).toBe("2d 3h");
  });

  it("never goes negative", () => {
    expect(formatCountdown(-5n)).toBe("0s");
  });
});

describe("deriveWinners", () => {
  const w1 = addr("c");
  const w2 = addr("d");
  const fin = (id: bigint, round: number, winner: Address, n: number): RaffleLog => ({
    ...base(n), kind: "Finalized", id, round, winner, claimDeadline: 1_000n,
  });

  it("marks a winner who claimed, newest result first", () => {
    const logs: RaffleLog[] = [
      opened(1n, TOKEN, 1),
      fin(1n, 1, w1, 5),
      { ...base(6), kind: "Claimed", id: 1n, winner: w1 },
      opened(2n, TOKEN, 7),
      fin(2n, 1, w2, 9),
    ];
    const out = deriveWinners(logs, TOKEN);
    expect(out.map((r) => [r.raffleId, r.winner, r.outcome])).toEqual([
      [2n, w2, "open"],
      [1n, w1, "claimed"],
    ]);
  });

  it("lists both the expired winner and the re-raffle winner of the same NFT", () => {
    const logs: RaffleLog[] = [
      opened(1n, TOKEN, 1),
      fin(1n, 1, w1, 5),
      { ...base(6), kind: "ReRaffled", id: 1n, round: 2, drawAt: 50n, excludedWinner: w1 },
      fin(1n, 2, w2, 8),
    ];
    const out = deriveWinners(logs, TOKEN);
    expect(out.map((r) => [r.round, r.winner, r.outcome])).toEqual([
      [2, w2, "open"],
      [1, w1, "expired"],
    ]);
  });

  it("records a fallback to the launch recipient", () => {
    const logs: RaffleLog[] = [opened(1n, TOKEN, 1), { ...base(5), kind: "FellBack", id: 1n, round: 1, to: addr("2") }];
    expect(deriveWinners(logs, TOKEN)).toMatchObject([{ outcome: "fallback", winner: addr("2") }]);
  });

  it("ignores other coins' raffles", () => {
    const logs: RaffleLog[] = [opened(1n, OTHER, 1), fin(1n, 1, w1, 5)];
    expect(deriveWinners(logs, TOKEN)).toEqual([]);
  });
});

describe("winnerStatus", () => {
  it("is claimable until the deadline, then expired, even without a ReRaffled event", () => {
    const rec = { outcome: "open" as const, claimDeadline: 1_000n };
    expect(winnerStatus(rec, 1_000n)).toBe("claimable");
    expect(winnerStatus(rec, 1_001n)).toBe("expired");
  });

  it("passes resolved outcomes through", () => {
    expect(winnerStatus({ outcome: "claimed", claimDeadline: 0n }, 9n)).toBe("claimed");
  });
});

describe("claimableWins", () => {
  const ME = addr("c");
  const state = (over: Partial<RaffleState>): RaffleState => ({
    token: TOKEN,
    collection: addr("1"),
    tokenId: 7n,
    fallbackTo: addr("2"),
    stage: Stage.Won,
    round: 1,
    drawAt: 0n,
    settleEnd: 0n,
    claimDeadline: 1_000n,
    seed: "0x00" as Hex,
    leader: ME,
    leaderScore: 0n,
    winner: ME,
    ...over,
  });

  it("lists wins the wallet can still claim, soonest deadline first", () => {
    const states = new Map([
      ["1", state({ claimDeadline: 900n })],
      ["2", state({ claimDeadline: 500n })],
    ]);
    expect(claimableWins(states, ME.toUpperCase().replace("0X", "0x"), 100n).map((w) => w.id)).toEqual([2n, 1n]);
  });

  it("drops other winners, claimed and unresolved raffles, and wins past the deadline", () => {
    const states = new Map([
      ["1", state({ winner: OTHER })],
      ["2", state({ stage: Stage.Claimed })],
      ["3", state({ stage: Stage.Settling })],
      ["4", state({ claimDeadline: 99n })],
      ["5", state({ claimDeadline: 100n })], // still claimable at the deadline, like the contract
    ]);
    expect(claimableWins(states, ME, 100n).map((w) => w.id)).toEqual([5n]);
  });

  it("is empty without a wallet or any states", () => {
    expect(claimableWins(new Map([["1", state({})]]), undefined, 1n)).toEqual([]);
    expect(claimableWins(undefined, ME, 1n)).toEqual([]);
  });
});
