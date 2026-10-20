import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex, PublicClient } from "viem";
import { advanceHolders, clearHolderCache, findBestCandidate, getAllRaffleStates, getRaffleStates, scanHolders } from "./chain";
import type { AppConfig } from "./config";
import { rankHolders, scoreOf, type Balances } from "./holders";

const addr = (c: string) => `0x${c.repeat(40)}` as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const TOKEN = addr("a");
const A = addr("1");
const B = addr("2");
const C = addr("3");
const CURVE = addr("4");
const SEED = "0x0000000000000000000000000000000000000000000000000000000000000009" as Hex;

const cfg: AppConfig = {
  chainId: 10143,
  floorVault: addr("f"),
  raffle: addr("d"),
  marketplace: addr("e"),
  collection: addr("5"),
  deployBlock: 1000n,
  rpcUrl: "https://rpc.example",
};

type Tx = { blockNumber: bigint; args: { from: Address; to: Address; value: bigint } };
const tx = (blockNumber: bigint, from: Address, to: Address, value: bigint): Tx => ({ blockNumber, args: { from, to, value } });

function holderClient(state: { head: bigint; logs: Tx[] }) {
  const calls: { fromBlock: bigint; toBlock: bigint }[] = [];
  const client = {
    getBlockNumber: async () => state.head,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      calls.push({ fromBlock, toBlock });
      return state.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
    },
  };
  return { client: client as unknown as PublicClient, calls };
}

beforeEach(() => clearHolderCache());

describe("advanceHolders with a wide-range log provider", () => {
  it("reads the whole history in one call and folds it into balances", async () => {
    const state = { head: 5_999n, logs: [tx(1010n, ZERO, A, 100n), tx(3_000n, A, B, 40n)] };
    const { client, calls } = holderClient(state);
    const { scan, error } = await advanceHolders(TOKEN, 1000n, client, undefined, { chunk: 500_000n, concurrency: 1 });
    expect(error).toBeUndefined();
    expect(calls).toEqual([{ fromBlock: 1000n, toBlock: 5_999n }]);
    expect(scan.balances[A.toLowerCase()]).toBe(60n);
    expect(scan.balances[B.toLowerCase()]).toBe(40n);
    expect(scan.scannedTo).toBe(5_999n);
  });

  it("continues from a snapshot without double counting, and keeps it when the first call fails", async () => {
    const snapshot = { scannedTo: 1_099n, balances: { [A.toLowerCase()]: 100n } as Balances };
    const state = { head: 1_199n, logs: [tx(1_010n, ZERO, A, 100n), tx(1_150n, A, B, 30n)] };
    const ok = holderClient(state);
    const next = await advanceHolders(TOKEN, 1000n, ok.client, snapshot);
    expect(ok.calls[0].fromBlock).toBe(1_100n);
    expect(next.scan.balances[A.toLowerCase()]).toBe(70n);
    expect(next.scan.balances[B.toLowerCase()]).toBe(30n);

    const broken = {
      getBlockNumber: async () => 1_199n,
      getLogs: async () => {
        throw new Error("rpc down");
      },
    } as unknown as PublicClient;
    const failed = await advanceHolders(TOKEN, 1000n, broken, snapshot, { chunk: 500_000n, concurrency: 1 });
    expect(failed.scan).toBe(snapshot);
    expect(failed.error).toBeInstanceOf(Error);
  });
});

describe("scanHolders", () => {
  it("derives balances from Transfer logs in chunks of at most 100 blocks", async () => {
    const state = { head: 1349n, logs: [tx(1010n, ZERO, A, 100n), tx(1150n, A, B, 40n), tx(1340n, B, C, 15n)] };
    const { client, calls } = holderClient(state);
    const scan = await scanHolders(addr("9"), 1000n, client);
    expect(scan.balances[A.toLowerCase()]).toBe(60n);
    expect(scan.balances[B.toLowerCase()]).toBe(25n);
    expect(scan.balances[C.toLowerCase()]).toBe(15n);
    expect(scan.scannedTo).toBe(1349n);
    expect(calls[0].fromBlock).toBe(1000n);
    for (const c of calls) expect(c.toBlock - c.fromBlock + 1n).toBeLessThanOrEqual(100n);
  });

  it("only reads new blocks on the next scan and never double counts", async () => {
    const token = addr("8");
    const state = { head: 1199n, logs: [tx(1010n, ZERO, A, 100n)] };
    const { client, calls } = holderClient(state);
    await scanHolders(token, 1000n, client);

    state.head = 1299n;
    state.logs.push(tx(1250n, A, B, 30n));
    calls.length = 0;
    const second = await scanHolders(token, 1000n, client);
    expect(calls[0].fromBlock).toBe(1200n);
    expect(second.balances[A.toLowerCase()]).toBe(70n);
    expect(second.balances[B.toLowerCase()]).toBe(30n);
    expect(second.scannedTo).toBe(1299n);
  });

  it("keeps whole completed waves and resumes after a failure", async () => {
    const token = addr("7");
    // 8 chunks, 6 per wave: wave 1 (1000..1599) completes, wave 2 fails.
    const state = { head: 1799n, logs: [tx(1010n, ZERO, A, 100n), tx(1700n, A, B, 10n)] };
    let fail = true;
    const calls: bigint[] = [];
    const client = {
      getBlockNumber: async () => state.head,
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        calls.push(fromBlock);
        if (fail && fromBlock >= 1600n) throw new Error("rpc down");
        return state.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
      },
    } as unknown as PublicClient;

    await expect(scanHolders(token, 1000n, client)).rejects.toThrow("rpc down");
    fail = false;
    calls.length = 0;
    const retry = await scanHolders(token, 1000n, client);
    expect(calls[0]).toBe(1600n);
    expect(retry.balances[A.toLowerCase()]).toBe(90n);
    expect(retry.balances[B.toLowerCase()]).toBe(10n);
  }, 15_000);
});

describe("findBestCandidate", () => {
  const balances: Balances = {
    [A.toLowerCase()]: 100n,
    [B.toLowerCase()]: 50n,
    [C.toLowerCase()]: 5n,
    [CURVE.toLowerCase()]: 800_000n,
  };

  function candidateClient(rejected: Address[]) {
    const multicall = vi.fn(async ({ contracts }: { contracts: { args: [bigint, Address] }[] }) =>
      contracts.map((c) => {
        const holder = c.args[1];
        const balance = balances[holder.toLowerCase()];
        const ok = !rejected.map((r) => r.toLowerCase()).includes(holder.toLowerCase());
        return { status: "success", result: [ok, ok ? scoreOf(SEED, holder, balance) : 0n, balance] };
      }),
    );
    return { client: { multicall } as unknown as PublicClient, multicall };
  }

  it("returns the lowest-scoring holder the contract accepts", async () => {
    const { client } = candidateClient([CURVE]);
    const best = await findBestCandidate(cfg, 1n, { token: TOKEN, seed: SEED }, balances, client);
    const expected = rankHolders(balances, SEED).filter((r) => r.holder !== CURVE.toLowerCase())[0];
    expect(best?.holder.toLowerCase()).toBe(expected.holder);
    expect(best?.score).toBe(expected.score);
  });

  it("skips holders the contract rejects (blocked, past winner)", async () => {
    const { client } = candidateClient([CURVE, A, B]);
    const best = await findBestCandidate(cfg, 1n, { token: TOKEN, seed: SEED }, balances, client);
    expect(best?.holder.toLowerCase()).toBe(C.toLowerCase());
  });

  it("returns null when nobody qualifies or there are no holders", async () => {
    const { client } = candidateClient([A, B, C, CURVE]);
    expect(await findBestCandidate(cfg, 1n, { token: TOKEN, seed: SEED }, balances, client)).toBeNull();
    expect(await findBestCandidate(cfg, 1n, { token: TOKEN, seed: SEED }, {}, client)).toBeNull();
  });

  it("never offers the coin, raffle or vault addresses to the contract", async () => {
    const { client, multicall } = candidateClient([]);
    await findBestCandidate(
      cfg,
      1n,
      { token: TOKEN, seed: SEED },
      { ...balances, [TOKEN.toLowerCase()]: 999n, [cfg.raffle.toLowerCase()]: 999n, [cfg.floorVault.toLowerCase()]: 999n },
      client,
    );
    const asked = multicall.mock.calls.flatMap(([a]) => a.contracts.map((c) => c.args[1].toLowerCase()));
    for (const x of [TOKEN, cfg.raffle, cfg.floorVault]) expect(asked).not.toContain(x.toLowerCase());
  });
});

describe("getRaffleStates", () => {
  it("maps results to ids and drops failed reads", async () => {
    const multicall = vi.fn(async () => [
      { status: "success", result: { stage: 1, round: 1 } },
      { status: "failure", error: new Error("x") },
    ]);
    const states = await getRaffleStates(cfg, [1n, 2n], { multicall } as unknown as PublicClient);
    expect(Array.from(states.keys())).toEqual(["1"]);
  });

  it("throws when every read fails, so the UI shows an error instead of an empty list", async () => {
    const multicall = vi.fn(async () => [{ status: "failure", error: new Error("x") }]);
    await expect(getRaffleStates(cfg, [1n], { multicall } as unknown as PublicClient)).rejects.toThrow();
  });

  it("does not call the chain for no ids", async () => {
    const multicall = vi.fn();
    expect((await getRaffleStates(cfg, [], { multicall } as unknown as PublicClient)).size).toBe(0);
    expect(multicall).not.toHaveBeenCalled();
  });
});

describe("getAllRaffleStates", () => {
  it("reads every raffle from 1 to raffleCount", async () => {
    const readContract = vi.fn(async () => 3n);
    const multicall = vi.fn(async ({ contracts }: { contracts: { args: [bigint] }[] }) =>
      contracts.map((c) => ({ status: "success", result: { stage: 2, round: Number(c.args[0]) } })),
    );
    const states = await getAllRaffleStates(cfg, { readContract, multicall } as unknown as PublicClient);
    expect(Array.from(states.keys())).toEqual(["1", "2", "3"]);
  });

  it("returns nothing, without a multicall, when no raffle exists", async () => {
    const readContract = vi.fn(async () => 0n);
    const multicall = vi.fn();
    expect((await getAllRaffleStates(cfg, { readContract, multicall } as unknown as PublicClient)).size).toBe(0);
    expect(multicall).not.toHaveBeenCalled();
  });
});
