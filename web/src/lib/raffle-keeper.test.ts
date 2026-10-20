import { describe, expect, it } from "vitest";
import {
  Stage,
  applyTransfers,
  balancesFromJson,
  balancesToJson,
  raffleAction,
  rankHolders,
  scoreOf,
} from "../../scripts/raffle-keeper.mjs";
import { rankHolders as browserRank, scoreOf as browserScore } from "./holders";

const A = "0x000000000000000000000000000000000000000a";
const B = "0x000000000000000000000000000000000000000b";
const C = "0x000000000000000000000000000000000000000c";
const ZERO = "0x0000000000000000000000000000000000000000";
const SEED = "0x0000000000000000000000000000000000000000000000000000000000000007";

const raffle = (over: Record<string, unknown>) => ({
  stage: Stage.Waiting,
  drawAt: 100n,
  settleEnd: 0n,
  claimDeadline: 0n,
  ...over,
});

describe("raffleAction", () => {
  it("waits for the draw time, then draws", () => {
    expect(raffleAction(raffle({}), 99)).toBe("wait");
    expect(raffleAction(raffle({}), 100)).toBe("draw");
  });

  it("settles while the window is open and finalizes once it closes", () => {
    const r = raffle({ stage: Stage.Settling, settleEnd: 200n });
    expect(raffleAction(r, 199)).toBe("settle");
    expect(raffleAction(r, 200)).toBe("finalize");
  });

  it("leaves a won raffle to its winner until the claim window runs out", () => {
    const r = raffle({ stage: Stage.Won, claimDeadline: 500n });
    expect(raffleAction(r, 500)).toBe("wait"); // the winner can still claim at the deadline
    expect(raffleAction(r, 501)).toBe("reRaffle");
  });

  it("never offers a step once the NFT has left the raffle", () => {
    expect(raffleAction(raffle({ stage: Stage.Claimed }), 10_000)).toBe("done");
    expect(raffleAction(raffle({ stage: Stage.Fallback }), 10_000)).toBe("done");
  });

  it("accepts the stage as a plain number, as viem returns uint8", () => {
    expect(raffleAction(raffle({ stage: 1, settleEnd: 5n }), 4)).toBe("settle");
  });
});

describe("holder maths", () => {
  it("scores the same as the browser", () => {
    expect(scoreOf(SEED, A, 10n)).toBe(browserScore(SEED, A, 10n));
    expect(scoreOf(SEED, A, 10n)).toBe(scoreOf(SEED, A, 1n) / 10n);
  });

  it("rejects a zero balance", () => {
    expect(() => scoreOf(SEED, A, 0n)).toThrow("balance must be positive");
  });

  it("folds transfers into balances and drops empty ones", () => {
    const first = applyTransfers({}, [{ from: ZERO, to: A, value: 100n }]);
    const next = applyTransfers(first, [
      { from: A, to: B, value: 40n },
      { from: A, to: C, value: 60n },
    ]);
    // The mint leaves the zero address negative, as in the browser; ranking skips it.
    expect(next).toEqual({ [ZERO]: -100n, [B]: 40n, [C]: 60n });
    expect(first).toEqual({ [ZERO]: -100n, [A]: 100n }); // input untouched
    expect(rankHolders(next, SEED).map((h: { holder: string }) => h.holder).sort()).toEqual([B, C]);
  });

  it("ranks like the browser and honours the exclude list", () => {
    const balances = { [A]: 100n, [B]: 50n, [C]: 1n };
    const ranked = rankHolders(balances, SEED, [C]);
    expect(ranked.map((h: { holder: string }) => h.holder)).toEqual(
      browserRank(balances, SEED, [C]).map((h) => h.holder),
    );
    expect(ranked.every((h: { holder: string }) => h.holder !== C)).toBe(true);
  });
});

describe("state file balances", () => {
  it("round-trips bigint balances through JSON", () => {
    const b = { [A]: 123456789012345678901234567890n };
    expect(balancesFromJson(JSON.parse(JSON.stringify(balancesToJson(b))))).toEqual(b);
  });

  it("treats a missing holders entry as empty", () => {
    expect(balancesFromJson(undefined)).toEqual({});
  });
});
