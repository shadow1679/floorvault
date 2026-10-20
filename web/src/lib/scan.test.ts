import { describe, expect, it, vi } from "vitest";
import { CHUNK_SIZE, chunkRanges, fetchRanges, fetchRangesBackward, mergeLogs, withRetry } from "./scan";

describe("chunkRanges", () => {
  it("splits an inclusive range into 100-block chunks", () => {
    const r = chunkRanges(1000n, 1249n);
    expect(r).toEqual([
      { from: 1000n, to: 1099n },
      { from: 1100n, to: 1199n },
      { from: 1200n, to: 1249n },
    ]);
  });

  it("never exceeds the RPC's 100-block limit", () => {
    for (const r of chunkRanges(0n, 12_345n)) expect(r.to - r.from + 1n).toBeLessThanOrEqual(CHUNK_SIZE);
  });

  it("covers every block exactly once", () => {
    const ranges = chunkRanges(70_307_798n, 70_308_321n);
    expect(ranges[0].from).toBe(70_307_798n);
    expect(ranges[ranges.length - 1].to).toBe(70_308_321n);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i].from).toBe(ranges[i - 1].to + 1n);
  });

  it("handles a single block and an exact multiple", () => {
    expect(chunkRanges(5n, 5n)).toEqual([{ from: 5n, to: 5n }]);
    expect(chunkRanges(0n, 199n)).toHaveLength(2);
  });

  it("returns nothing when from is past to", () => {
    expect(chunkRanges(10n, 9n)).toEqual([]);
  });

  it("rejects a non-positive size", () => {
    expect(() => chunkRanges(0n, 10n, 0n)).toThrow();
  });
});

describe("mergeLogs", () => {
  const log = (block: bigint, idx: number, hash = "0xa") => ({ blockNumber: block, logIndex: idx, transactionHash: hash });

  it("drops duplicates from overlapping rescans and sorts by block", () => {
    const merged = mergeLogs([log(5n, 0), log(7n, 1)], [log(7n, 1), log(6n, 0, "0xb")]);
    expect(merged.map((l) => [l.blockNumber, l.logIndex])).toEqual([
      [5n, 0],
      [6n, 0],
      [7n, 1],
    ]);
  });
});

describe("fetchRanges", () => {
  it("returns all items in order", async () => {
    const out = await fetchRanges(chunkRanges(0n, 299n), async (r) => [r.from], 2);
    expect(out.items).toEqual([0n, 100n, 200n]);
    expect(out.completedTo).toBe(299n);
    expect(out.error).toBeUndefined();
  });

  it("keeps completed waves and reports where it stopped when a chunk fails", async () => {
    const ranges = chunkRanges(0n, 499n); // 5 chunks, concurrency 2 -> waves of 2,2,1
    const out = await fetchRanges(
      ranges,
      async (r) => {
        if (r.from === 200n) throw new Error("boom");
        return [r.from];
      },
      2,
    );
    expect(out.items).toEqual([0n, 100n]);
    expect(out.completedTo).toBe(199n);
    expect(out.error).toBeInstanceOf(Error);
  });
});

describe("withRetry", () => {
  it("retries then succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("a")).mockResolvedValue("ok");
    await expect(withRetry(fn, 3, 1)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws the last error after exhausting attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("nope"));
    await expect(withRetry(fn, 2, 1)).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("fetchRangesBackward", () => {
  const ranges = chunkRanges(0n, 499n); // 5 chunks

  it("reads the newest range first and reports the lowest block reached", async () => {
    const order: bigint[] = [];
    const out = await fetchRangesBackward(
      ranges,
      async (r) => {
        order.push(r.from);
        return [r.from];
      },
      2,
    );
    expect(order).toEqual([400n, 300n, 200n, 100n, 0n]);
    expect(out.completedFrom).toBe(0n);
    expect(out.error).toBeUndefined();
  });

  it("keeps only fully fetched waves when a later one fails, with no hole above completedFrom", async () => {
    const out = await fetchRangesBackward(
      ranges,
      async (r) => {
        if (r.from === 100n) throw new Error("boom");
        return [r.from];
      },
      2,
    );
    expect(out.items.sort()).toEqual([300n, 400n]);
    expect(out.completedFrom).toBe(300n);
    expect(out.error).toBeInstanceOf(Error);
  });

  it("reports null when the very first wave fails", async () => {
    const out = await fetchRangesBackward(ranges, async () => {
      throw new Error("down");
    });
    expect(out.completedFrom).toBeNull();
    expect(out.items).toEqual([]);
  });
});
