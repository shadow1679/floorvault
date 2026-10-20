import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, type Address, type Hash, type PublicClient } from "viem";
import { floorVaultAbi } from "@/abi/FloorVault";
import {
  advanceScan,
  clearScanCache,
  getCoinMeta,
  getCollectionInfo,
  getFloor,
  getOpenSeaFloor,
  getNftImage,
  getVaultData,
  scanVault,
  type LaunchedRec,
} from "./chain";
import type { AppConfig } from "./config";
import { buildTokenUri } from "./metadata";

const addr = (c: string) => `0x${c.repeat(40)}` as Address;
const A = addr("a");
const B = addr("b");
const C = addr("c");
const COLLECTION = addr("1");
const RECIPIENT = addr("2");
const CREATOR = addr("3");
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;

const cfg: AppConfig = {
  chainId: 10143,
  floorVault: addr("f"),
  raffle: addr("d"),
  marketplace: addr("e"),
  collection: COLLECTION,
  deployBlock: 1000n,
  rpcUrl: "https://rpc.example",
};

type FakeLog = { eventName: string; args: Record<string, unknown>; blockNumber: bigint; transactionHash: Hash; logIndex: number };

const launched = (token: Address, block: bigint, n: number): FakeLog => ({
  eventName: "Launched",
  args: { token, creator: CREATOR, collection: COLLECTION, nftRecipient: RECIPIENT },
  blockNumber: block,
  transactionHash: hash(n),
  logIndex: 0,
});
const harvested = (token: Address, block: bigint, n: number, claimed: bigint): FakeLog => ({
  eventName: "Harvested",
  args: { token, claimed, toTreasury: claimed / 10n, toCreator: claimed / 10n, toBudget: claimed - claimed / 5n },
  blockNumber: block,
  transactionHash: hash(n),
  logIndex: 0,
});
const bought = (token: Address, block: bigint, n: number, tokenId: bigint, price: bigint): FakeLog => ({
  eventName: "Bought",
  args: { token, collection: COLLECTION, tokenId, price, to: RECIPIENT },
  blockNumber: block,
  transactionHash: hash(n),
  logIndex: 0,
});

function launchInput(name: string, symbol: string, imageUrl?: string) {
  return encodeFunctionData({
    abi: floorVaultAbi,
    functionName: "launch",
    args: [
      {
        name,
        symbol,
        tokenURI: buildTokenUri({ name, symbol, imageUrl }),
        creatorFeeRate: 100,
        salt: `0x${"00".repeat(32)}`,
        deadline: 1n,
        collection: COLLECTION,
        nftRecipient: RECIPIENT,
        devBuy: 0n,
      },
    ],
  });
}

type RangeCall = { fromBlock: bigint; toBlock: bigint };

function makeClient(state: { head: bigint; logs: FakeLog[]; failFrom?: bigint }, extra: Record<string, unknown> = {}) {
  const calls: RangeCall[] = [];
  const client = {
    getBlockNumber: async () => state.head,
    getLogs: async ({ fromBlock, toBlock }: RangeCall) => {
      calls.push({ fromBlock, toBlock });
      if (state.failFrom !== undefined && fromBlock >= state.failFrom) throw new Error("rpc down");
      return state.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
    },
    ...extra,
  };
  return { client: client as unknown as PublicClient, calls };
}

beforeEach(() => clearScanCache());

describe("advanceScan with a wide-range log provider", () => {
  it("reads the whole history in one call when given a big chunk", async () => {
    const state = { head: 50_000n, logs: [launched(A, 1010n, 1), bought(A, 49_000n, 2, 7n, 10n)] };
    const { client, calls } = makeClient(state);
    const scan = await advanceScan(cfg, client, undefined, undefined, { chunk: 500_000n, concurrency: 1 });

    expect(calls).toEqual([{ fromBlock: 1000n, toBlock: 50_000n }]);
    expect(scan.launched.map((l) => l.token)).toEqual([A]);
    expect(scan.bought.map((b) => b.tokenId)).toEqual([7n]);
    expect(scan.scannedTo).toBe(50_000n);
  });

  it("keeps the 100-block default without options", async () => {
    const { client, calls } = makeClient({ head: 1250n, logs: [] });
    await advanceScan(cfg, client, undefined);
    expect(calls.length).toBe(3);
  });

  it("keeps progress when the wide provider fails, so a fallback resumes instead of restarting", async () => {
    const state = { head: 2_000n, logs: [launched(A, 1010n, 1)], failFrom: 1_200n };
    const { client } = makeClient(state);
    let kept: bigint | undefined;
    await expect(
      advanceScan(cfg, client, undefined, (s) => (kept = s.scannedTo), { chunk: 100n, concurrency: 1 }),
    ).rejects.toThrow("rpc down");
    expect(kept).toBe(1_199n);
  });
});

describe("scanVault", () => {
  it("sorts Launched/Harvested/Bought into the right arrays and reads in 100-block chunks", async () => {
    const state = { head: 1250n, logs: [launched(A, 1010n, 1), harvested(A, 1120n, 2, 100n), bought(A, 1230n, 3, 7n, 10n)] };
    const { client, calls } = makeClient(state);
    const scan = await scanVault(cfg, client);

    expect(scan.launched.map((l) => l.token)).toEqual([A]);
    expect(scan.harvested.map((h) => h.claimed)).toEqual([100n]);
    expect(scan.bought.map((b) => b.tokenId)).toEqual([7n]);
    expect(scan.scannedTo).toBe(1250n);
    expect(calls[0].fromBlock).toBe(1000n);
    for (const c of calls) expect(c.toBlock - c.fromBlock + 1n).toBeLessThanOrEqual(100n);
  });

  it("keeps Raffle events in their own list", async () => {
    const state = {
      head: 1250n,
      logs: [
        launched(A, 1010n, 1),
        {
          eventName: "Opened",
          args: { id: 1n, token: A, collection: COLLECTION, tokenId: 7n, fallbackTo: RECIPIENT, drawAt: 99n },
          blockNumber: 1230n,
          transactionHash: hash(9),
          logIndex: 0,
        },
        {
          eventName: "Claimed",
          args: { id: 1n, winner: B },
          blockNumber: 1240n,
          transactionHash: hash(10),
          logIndex: 0,
        },
      ],
    };
    const { client } = makeClient(state);
    const scan = await scanVault(cfg, client);
    expect(scan.launched).toHaveLength(1);
    expect(scan.bought).toHaveLength(0);
    expect(scan.raffle.map((r) => r.kind)).toEqual(["Opened", "Claimed"]);
  });

  it("rescans from scannedTo minus the overlap and does not duplicate overlapped logs", async () => {
    const state = { head: 1250n, logs: [bought(A, 1230n, 3, 7n, 10n), bought(A, 1248n, 4, 8n, 10n)] };
    const { client, calls } = makeClient(state);
    await scanVault(cfg, client);

    state.head = 1260n;
    state.logs.push(bought(A, 1255n, 5, 9n, 10n));
    calls.length = 0;
    const second = await scanVault(cfg, client);

    expect(calls[0].fromBlock).toBe(1247n); // 1250 - RESCAN_OVERLAP (3)
    expect(second.bought.map((b) => b.tokenId)).toEqual([7n, 8n, 9n]); // 8n was re-read but not duplicated
    expect(second.scannedTo).toBe(1260n);
  });

  it("keeps progress only up to the last completed wave when a chunk fails, and still throws", async () => {
    // 14 chunks of 100 blocks with 12 per wave: wave 1 = 1000..2199 completes, wave 2 (2200..2399) fails.
    const state: { head: bigint; logs: FakeLog[]; failFrom?: bigint } = {
      head: 2399n,
      logs: [launched(A, 1010n, 1), launched(B, 2300n, 2)],
      failFrom: 2200n,
    };
    const { client, calls } = makeClient(state);
    await expect(scanVault(cfg, client)).rejects.toThrow("rpc down");

    state.failFrom = undefined;
    calls.length = 0;
    const retry = await scanVault(cfg, client);
    expect(calls[0].fromBlock).toBe(2196n); // 2199 (last completed block) - 3
    expect(retry.launched.map((l) => l.token)).toEqual([A, B]);
    expect(retry.scannedTo).toBe(2399n);
  }, 15_000);
});

describe("getVaultData", () => {
  function setup() {
    const inputs: Record<string, string> = {
      [hash(1)]: launchInput("Coin A", "AAA"),
      [hash(2)]: launchInput("Coin B", "BBB"),
      [hash(3)]: launchInput("Coin C", "CCC", "https://img.example/c.png"),
    };
    const state = {
      head: 1250n,
      logs: [
        launched(A, 1010n, 1),
        launched(B, 1020n, 2),
        launched(C, 1030n, 3),
        harvested(A, 1100n, 10, 100n),
        harvested(A, 1110n, 11, 50n),
        harvested(C, 1120n, 12, 1000n),
        bought(A, 1200n, 20, 1n, 10n),
        bought(C, 1210n, 21, 9n, 3n),
        bought(A, 1220n, 22, 2n, 20n),
      ],
    };
    const multicall = vi.fn(async ({ contracts }: { contracts: { args: [Address] }[] }) => {
      // Budgets are looked up in launch order: A, B, C.
      expect(contracts.map((c) => c.args[0])).toEqual([A, B, C]);
      return [
        { status: "success", result: [COLLECTION, RECIPIENT, 5n] },
        { status: "failure", error: new Error("call failed") },
        { status: "success", result: [COLLECTION, RECIPIENT, 7n] },
      ];
    });
    const getTransaction = vi.fn(async ({ hash: h }: { hash: Hash }) => ({ input: inputs[h] }));
    return makeClient(state, { multicall, getTransaction });
  }

  it("maps budgets to the right coin, gives a failed pairing 0n, and orders coins newest first", async () => {
    const { client } = setup();
    const data = await getVaultData(cfg, client);
    expect(data.coins.map((c) => c.token)).toEqual([C, B, A]);
    const byToken = Object.fromEntries(data.coins.map((c) => [c.token, c]));
    expect(byToken[A].budget).toBe(5n);
    expect(byToken[B].budget).toBe(0n);
    expect(byToken[C].budget).toBe(7n);
    expect(byToken[A].name).toBe("Coin A");
    expect(byToken[C].image).toBe("https://img.example/c.png");
  });

  it("totals harvests and buys per token only", async () => {
    const { client } = setup();
    const data = await getVaultData(cfg, client);
    const byToken = Object.fromEntries(data.coins.map((c) => [c.token, c]));
    expect(byToken[A]).toMatchObject({ claimedTotal: 150n, treasuryTotal: 15n, boughtCount: 2, spentTotal: 30n });
    expect(byToken[B]).toMatchObject({ claimedTotal: 0n, treasuryTotal: 0n, boughtCount: 0, spentTotal: 0n });
    expect(byToken[C]).toMatchObject({ claimedTotal: 1000n, boughtCount: 1, spentTotal: 3n });
  });

  it("lists bought NFTs newest first with their coin's symbol", async () => {
    const { client } = setup();
    const data = await getVaultData(cfg, client);
    expect(data.bought.map((b) => [b.tokenId, b.coinSymbol])).toEqual([
      [2n, "AAA"],
      [9n, "CCC"],
      [1n, "AAA"],
    ]);
  });
});

describe("getCoinMeta", () => {
  const rec = (token: Address, n: number): LaunchedRec => ({
    token,
    creator: CREATOR,
    collection: COLLECTION,
    nftRecipient: RECIPIENT,
    blockNumber: 1010n,
    transactionHash: hash(n),
    logIndex: 0,
  });

  it("decodes launch calldata into name, symbol and image, then caches it", async () => {
    const getTransaction = vi.fn(async () => ({ input: launchInput("Chog Fund", "CHG", "https://img.example/x.png") }));
    const client = { getTransaction } as unknown as PublicClient;
    const meta = await getCoinMeta(rec(A, 1), client);
    expect(meta).toMatchObject({ name: "Chog Fund", symbol: "CHG", image: "https://img.example/x.png" });
    await getCoinMeta(rec(A, 1), client);
    expect(getTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not cache fallbacks, so a transient failure heals on the next call", async () => {
    const down = {
      getTransaction: vi.fn(async () => {
        throw new Error("rpc down");
      }),
      readContract: vi.fn(async () => {
        throw new Error("rpc down");
      }),
    } as unknown as PublicClient;
    expect(await getCoinMeta(rec(B, 2), down)).toEqual({ name: "Unnamed coin", symbol: "?" });

    const tokenReadsOnly = {
      getTransaction: vi.fn(async () => {
        throw new Error("rpc down");
      }),
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => (functionName === "name" ? "Tok" : "TK")),
    } as unknown as PublicClient;
    expect(await getCoinMeta(rec(B, 2), tokenReadsOnly)).toEqual({ name: "Tok", symbol: "TK" });

    const healthy = {
      getTransaction: vi.fn(async () => ({ input: launchInput("Real Name", "REAL", "https://img.example/r.png") })),
    } as unknown as PublicClient;
    expect(await getCoinMeta(rec(B, 2), healthy)).toMatchObject({
      name: "Real Name",
      symbol: "REAL",
      image: "https://img.example/r.png",
    });
  }, 15_000);
});

describe("getFloor", () => {
  const revert = (reason: string) => ({
    name: "ContractFunctionExecutionError",
    cause: { name: "ContractFunctionRevertedError", reason },
  });
  const clientWith = (readContract: () => Promise<unknown>) => ({ readContract }) as unknown as PublicClient;

  it("returns the floor listing", async () => {
    expect(await getFloor(cfg, COLLECTION, clientWith(async () => [3n, 100n]))).toEqual({ tokenId: 3n, price: 100n });
  });
  it("returns null only for the 'no listings' revert", async () => {
    expect(
      await getFloor(
        cfg,
        COLLECTION,
        clientWith(async () => {
          throw revert("no listings");
        }),
      ),
    ).toBeNull();
  });
  it("rethrows other failures so the UI can tell an RPC error from an empty market", async () => {
    await expect(
      getFloor(
        cfg,
        COLLECTION,
        clientWith(async () => {
          throw new Error("HTTP request failed");
        }),
      ),
    ).rejects.toThrow("HTTP request failed");
    await expect(
      getFloor(
        cfg,
        COLLECTION,
        clientWith(async () => {
          throw revert("something else");
        }),
      ),
    ).rejects.toBeDefined();
  });
});

describe("getFloor on mainnet", () => {
  const body = (b: unknown, ok = true) => (async () => ({ ok, status: ok ? 200 : 502, json: async () => b })) as unknown as typeof fetch;

  it("reads the floor from /api/floor", async () => {
    expect(await getOpenSeaFloor(body({ configured: true, floor: "100", tokenId: "7" }))).toEqual({ tokenId: 7n, price: 100n });
    expect(await getOpenSeaFloor(body({ configured: true, floor: "100", tokenId: null }))).toEqual({ tokenId: 0n, price: 100n });
  });
  it("is null only when OpenSea reports no listings", async () => {
    expect(await getOpenSeaFloor(body({ configured: true, floor: null, tokenId: null }))).toBeNull();
  });
  it("throws (so the UI shows n/a) when the key is missing or the route fails", async () => {
    await expect(getOpenSeaFloor(body({ configured: false, floor: null, tokenId: null }))).rejects.toThrow(/API key/);
    await expect(getOpenSeaFloor(body({ error: "x" }, false))).rejects.toThrow(/502/);
  });
  it("getFloor goes to OpenSea instead of the chain when there is no marketplace contract", async () => {
    const readContract = vi.fn();
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ configured: true, floor: "5", tokenId: "1" }) }));
    vi.stubGlobal("fetch", fetchStub);
    try {
      const floor = await getFloor({ ...cfg, chainId: 143, marketplace: null }, COLLECTION, { readContract } as unknown as PublicClient);
      expect(floor).toEqual({ tokenId: 1n, price: 5n });
      expect(readContract).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("getNftImage", () => {
  const clientWith = (readContract: () => Promise<unknown>) => ({ readContract }) as unknown as PublicClient;

  afterEach(() => vi.unstubAllGlobals());

  it("reads the image from an inline data: JSON tokenURI without touching the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const uri = buildTokenUri({ name: "n", symbol: "s", imageUrl: "https://i.example/a.png" });
    expect(await getNftImage(COLLECTION, 1n, clientWith(async () => uri))).toBe("https://i.example/a.png");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a data:image tokenURI in any case", async () => {
    const uri = " DATA:image/png;base64,AAAA";
    expect(await getNftImage(COLLECTION, 1n, clientWith(async () => uri))).toBe("DATA:image/png;base64,AAAA");
  });

  it("fetches an ipfs tokenURI and maps its image to the gateway", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ image: "ipfs://bafy/c.png" }), { headers: { "content-type": "application/json" } })),
    );
    expect(await getNftImage(COLLECTION, 7n, clientWith(async () => "ipfs://bafy/7.json"))).toBe(
      "https://ipfs.filebase.io/ipfs/bafy/c.png",
    );
  });

  it("returns null when tokenURI cannot be read, and rethrows a transient metadata failure", async () => {
    expect(
      await getNftImage(
        COLLECTION,
        1n,
        clientWith(async () => {
          throw new Error("revert");
        }),
      ),
    ).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));
    await expect(getNftImage(COLLECTION, 1n, clientWith(async () => "https://meta.example/1"))).rejects.toThrow();
  });
});

describe("getCollectionInfo", () => {
  const clientWith = (readContract: () => Promise<unknown>) => ({ readContract }) as unknown as PublicClient;

  it("returns the name", async () => {
    expect(await getCollectionInfo(COLLECTION, clientWith(async () => "Test CHOG"))).toEqual({
      address: COLLECTION,
      name: "Test CHOG",
    });
  });
  it("returns null for an address with no readable name (EOA / non-NFT)", async () => {
    const zero = {
      name: "ContractFunctionExecutionError",
      cause: { name: "ContractFunctionZeroDataError" },
    };
    expect(
      await getCollectionInfo(
        COLLECTION,
        clientWith(async () => {
          throw zero;
        }),
      ),
    ).toBeNull();
  });
  it("rethrows transport errors instead of caching 'not a collection'", async () => {
    await expect(
      getCollectionInfo(
        COLLECTION,
        clientWith(async () => {
          throw new Error("timeout");
        }),
      ),
    ).rejects.toThrow("timeout");
  });
});
