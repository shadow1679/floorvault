import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { applyTransfers, buildHolderRows, rankHolders, scoreOf, winChances, type Balances } from "./holders";

const addr = (c: string) => `0x${c.repeat(40)}` as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const A = addr("a");
const B = addr("b");
const C = addr("c");
const SEED = "0x0000000000000000000000000000000000000000000000000000000000000007" as Hex;

describe("scoreOf", () => {
  it("matches the Raffle contract (keccak256(abi.encode(seed, holder)) / balance)", () => {
    // Vector from: cast keccak $(cast abi-encode "f(bytes32,address)" 0x..07 0x1111..1111)
    const hash = BigInt("0xbc2904ac11591170e46e75e1b6082c469d2f48b47235687e687e157e758728a0");
    const holder = addr("1");
    expect(scoreOf(SEED, holder, 1n)).toBe(hash);
    expect(scoreOf(SEED, holder, 1000n)).toBe(hash / 1000n);
  });

  it("gives a bigger balance a lower (better) score for the same hash", () => {
    expect(scoreOf(SEED, A, 100n)).toBeLessThan(scoreOf(SEED, A, 10n));
  });

  it("rejects a zero balance", () => {
    expect(() => scoreOf(SEED, A, 0n)).toThrow();
  });
});

describe("applyTransfers", () => {
  it("folds mints and transfers into balances and drops empty accounts", () => {
    const b = applyTransfers({}, [
      { from: ZERO, to: A, value: 100n },
      { from: A, to: B, value: 30n },
      { from: B, to: C, value: 30n },
    ]);
    expect(b[A.toLowerCase()]).toBe(70n);
    expect(b[B.toLowerCase()]).toBeUndefined();
    expect(b[C.toLowerCase()]).toBe(30n);
  });

  it("is incremental: scanning in two halves equals scanning once", () => {
    const t1 = [{ from: ZERO, to: A, value: 100n }, { from: A, to: B, value: 40n }];
    const t2 = [{ from: B, to: C, value: 15n }, { from: A, to: C, value: 10n }];
    expect(applyTransfers(applyTransfers({}, t1), t2)).toEqual(applyTransfers({}, [...t1, ...t2]));
  });

  it("does not mutate its input and is case-insensitive", () => {
    const start: Balances = { [A.toLowerCase()]: 5n };
    const next = applyTransfers(start, [{ from: A.toUpperCase().replace("0X", "0x") as Address, to: B, value: 5n }]);
    expect(start[A.toLowerCase()]).toBe(5n);
    expect(next[A.toLowerCase()]).toBeUndefined();
    expect(next[B.toLowerCase()]).toBe(5n);
  });
});

describe("rankHolders", () => {
  const balances: Balances = { [A.toLowerCase()]: 100n, [B.toLowerCase()]: 50n, [C.toLowerCase()]: 1n };

  it("orders by ascending score", () => {
    const ranked = rankHolders(balances, SEED);
    expect(ranked).toHaveLength(3);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].score).toBeLessThanOrEqual(ranked[i].score);
    for (const r of ranked) expect(r.score).toBe(scoreOf(SEED, r.holder, r.balance));
  });

  it("skips excluded addresses, the zero address and empty balances", () => {
    const ranked = rankHolders(
      { ...balances, [ZERO]: 999n, [addr("d")]: 0n },
      SEED,
      [B.toUpperCase().replace("0X", "0x")],
    );
    expect(ranked.map((r) => r.holder).sort()).toEqual([A.toLowerCase(), C.toLowerCase()].sort());
  });

  it("is deterministic and gives a different order for a different seed", () => {
    const many: Balances = {};
    for (let i = 1; i <= 20; i++) many[`0x${i.toString(16).padStart(40, "0")}`] = BigInt(i);
    const one = rankHolders(many, SEED).map((r) => r.holder);
    expect(rankHolders(many, SEED).map((r) => r.holder)).toEqual(one);
    const other = rankHolders(many, "0x00000000000000000000000000000000000000000000000000000000000000ff").map((r) => r.holder);
    expect(other).not.toEqual(one);
  });

  it("favours big holders: a whale wins far more often than a dust holder", () => {
    const pair: Balances = { [A.toLowerCase()]: 1_000n, [C.toLowerCase()]: 1n };
    let whaleWins = 0;
    for (let i = 0; i < 200; i++) {
      const seed = `0x${i.toString(16).padStart(64, "0")}` as Hex;
      if (rankHolders(pair, seed)[0].holder === A.toLowerCase()) whaleWins++;
    }
    expect(whaleWins).toBeGreaterThan(150);
  });

  it("returns nothing when there are no holders", () => {
    expect(rankHolders({}, SEED)).toEqual([]);
  });
});

describe("buildHolderRows", () => {
  const bal: Balances = { [A.toLowerCase()]: 600n, [B.toLowerCase()]: 300n, [C.toLowerCase()]: 100n, [ZERO]: 5n };

  it("sorts by balance, drops the zero address and computes the share of supply", () => {
    const rows = buildHolderRows(bal, { supply: 1000n });
    expect(rows.map((r) => r.holder)).toEqual([A.toLowerCase(), B.toLowerCase(), C.toLowerCase()]);
    expect(rows.map((r) => r.percent)).toEqual([60, 30, 10]);
    expect(rows.every((r) => r.raffleRank === undefined)).toBe(true);
  });

  it("keeps labelled addresses but never ranks them for the raffle", () => {
    const rows = buildHolderRows(bal, { supply: 1000n, seed: SEED, labels: { [A]: "Bonding curve" } });
    const curve = rows.find((r) => r.holder === A.toLowerCase())!;
    expect(curve.label).toBe("Bonding curve");
    expect(curve.raffleRank).toBeUndefined();
    expect(rows.filter((r) => r.raffleRank).map((r) => r.raffleRank).sort()).toEqual([1, 2]);
  });

  it("ranks eligible holders in the same order as rankHolders", () => {
    const rows = buildHolderRows(bal, { supply: 1000n, seed: SEED });
    const expected = rankHolders(bal, SEED).map((r) => r.holder);
    const got = rows.filter((r) => r.raffleRank).sort((x, y) => x.raffleRank! - y.raffleRank!).map((r) => r.holder);
    expect(got).toEqual(expected);
  });
});

describe("winChances", () => {
  it("gives a lone holder certainty and equal holders equal shares", () => {
    expect(winChances([5n])).toEqual([1]);
    const eq = winChances([7n, 7n, 7n, 7n]);
    for (const p of eq) expect(p).toBeCloseTo(0.25, 4);
  });

  it("matches the exact two-holder answer: balances 2:1 -> 3/4 and 1/4 (not 2/3 and 1/3)", () => {
    const [big, small] = winChances([2n * 10n ** 18n, 10n ** 18n]);
    expect(big).toBeCloseTo(0.75, 4);
    expect(small).toBeCloseTo(0.25, 4);
  });

  it("sums to 1, keeps the input order, and favours bigger balances", () => {
    const p = winChances([1n, 10n, 100n, 1000n, 3n]);
    expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    expect(p[3]).toBeGreaterThan(p[2]);
    expect(p[2]).toBeGreaterThan(p[1]);
    expect(p[1]).toBeGreaterThan(p[4]);
    expect(p[4]).toBeGreaterThan(p[0]);
  });

  it("stays stable with a crowd of tiny holders next to a whale", () => {
    const crowd = Array.from({ length: 2000 }, () => 10n ** 18n);
    const p = winChances([10n ** 24n, ...crowd]);
    expect(p.every((x) => Number.isFinite(x) && x > 0)).toBe(true);
    expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    expect(p[0]).toBeGreaterThan(0.99);
  });

  it("agrees with the real keccak score over many seeds", () => {
    const hs = [A, B, C];
    const bs = [100n, 50n, 10n];
    const wins = [0, 0, 0];
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      const seed = `0x${i.toString(16).padStart(64, "0")}` as Hex;
      const scores = hs.map((h, j) => scoreOf(seed, h, bs[j]));
      wins[scores.indexOf(scores.reduce((m, s) => (s < m ? s : m)))]++;
    }
    winChances(bs).forEach((p, j) => expect(wins[j] / runs).toBeCloseTo(p, 1));
  });

  it("rejects zero balances and handles an empty list", () => {
    expect(() => winChances([1n, 0n])).toThrow();
    expect(winChances([])).toEqual([]);
  });
});
