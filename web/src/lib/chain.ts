import {
  createPublicClient,
  decodeFunctionData,
  defineChain,
  http,
  parseAbiItem,
  type Address,
  type Hash,
  zeroAddress,
  type PublicClient,
} from "viem";
import { floorVaultDemoAbi } from "@/abi/DemoFeePot";
import { floorVaultAbi } from "@/abi/FloorVault";
import { raffleAbi } from "@/abi/Raffle";
import { mockMarketplaceAbi } from "@/abi/MockMarketplace";
import { bondingCurveAbi, nadRouterAbi } from "@/abi/nad";
import { erc20Abi, erc721MetadataAbi } from "@/abi/erc20";
import { configResult, rpcUrl, type AppConfig } from "./config";
import { isContractCallFailure, revertReason } from "./errors";
import { fetchNftImage, parseTokenUri, safeImageUrl, type CoinMetadata } from "./metadata";
import { fetchNadfunMetadata } from "./nadfun";
import { parseBig, stringifyBig } from "./serialize";
import { chunkRanges, fetchRanges, fetchRangesBackward, mergeLogs, withRetry } from "./scan";
import { priceFromReserves, secondsPerBlock, type PricePoint } from "./trades";
import { applyTransfers, rankHolders, type Balances, type RankedHolder, type TransferRec } from "./holders";
import { parseRaffleLog, RAFFLE_EVENTS, type LogMeta, type RaffleLog, type RaffleState } from "./raffle";

import { EXPLORER_URL, MONAD_TESTNET_ID, NAD_BONDING_CURVE, NAD_ROUTER, NETWORK } from "./constants";
import type { FloorResponse } from "./opensea";

/** The chain this build talks to: Monad mainnet or testnet, picked by NEXT_PUBLIC_CHAIN_ID. */
export const monadChain = defineChain({
  id: NETWORK.id as number, // widened: wagmi keys its transports by the literal id type
  name: NETWORK.name,
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: "MonadVision", url: EXPLORER_URL } },
  contracts: {
    multicall3:
      NETWORK.id === MONAD_TESTNET_ID
        ? { address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 251449 }
        : { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: !NETWORK.isMainnet,
});

export const publicClient: PublicClient = createPublicClient({
  chain: monadChain,
  transport: http(rpcUrl, { retryCount: 2 }),
  batch: { multicall: true },
});

// ---- Types ---------------------------------------------------------------------------------

export type LaunchedRec = LogMeta & {
  token: Address;
  creator: Address;
  collection: Address;
  nftRecipient: Address;
};
export type HarvestedRec = LogMeta & { token: Address; claimed: bigint; toTreasury: bigint; toCreator: bigint; toBudget: bigint };
export type BoughtRec = LogMeta & {
  token: Address;
  collection: Address;
  tokenId: bigint;
  price: bigint;
  to: Address;
};

export type ScanState = {
  scannedTo: bigint;
  launched: LaunchedRec[];
  harvested: HarvestedRec[];
  bought: BoughtRec[];
  /** Events from the Raffle contract, in chain order. */
  raffle: RaffleLog[];
};

export type Coin = {
  token: Address;
  creator: Address;
  collection: Address;
  nftRecipient: Address;
  launchBlock: bigint;
  launchTx: Hash;
  name: string;
  symbol: string;
  image?: string;
  description?: string;
  /** WMON available for buying, in wei. */
  budget: bigint;
  claimedTotal: bigint;
  treasuryTotal: bigint;
  boughtCount: number;
  spentTotal: bigint;
};

export type BoughtNft = BoughtRec & { coinSymbol?: string; coinName?: string };

export type VaultData = {
  coins: Coin[];
  bought: BoughtNft[];
  raffleLogs: RaffleLog[];
  scannedTo: bigint;
  /** True while the server is still reading old history: the lists are complete up to `scannedTo` only. */
  indexing: boolean;
};

export type Floor = { tokenId: bigint; price: bigint };

// ---- Log scan ------------------------------------------------------------------------------

const launchedEvent = parseAbiItem(
  "event Launched(address indexed token, address indexed creator, address indexed collection, address nftRecipient)",
);
const harvestedEvent = parseAbiItem(
  "event Harvested(address indexed token, uint256 claimed, uint256 toTreasury, uint256 toCreator, uint256 toBudget)",
);
const boughtEvent = parseAbiItem(
  "event Bought(address indexed token, address indexed collection, uint256 tokenId, uint256 price, address to)",
);
const raffleEvents = RAFFLE_EVENTS.map((e) => parseAbiItem(e));

const SCAN_CONCURRENCY = 12; // the public RPC starts returning 429 at roughly 25 parallel calls
const SAVE_EVERY_CHUNKS = 120; // persist scan progress after this many 100-block chunks
const RESCAN_OVERLAP = 3n; // blocks re-read on each incremental scan; duplicates are dropped
const CACHE_VERSION = "v2"; // v2 added Raffle events and the raffle address to the key

// The public RPC caps eth_getLogs at 100 blocks and rate-limits hard, so scanning from the deploy
// block takes thousands of calls (minutes). The server (`/api/scan`, see `serverScan.ts`) does that
// walk once and keeps the result, so a browser with an empty cache fetches that snapshot and scans
// only the short tail after it. Without the server it falls back to scanning everything itself.

/** Blocks the server may trail the head by before the browser stops waiting and scans the tail itself. */
export const SERVER_TAIL_BLOCKS = 1_000n;

const memory = new Map<string, ScanState>();
const inflight = new Map<string, Promise<ScanState>>();

export function cacheKey(cfg: AppConfig) {
  return `floorvault:scan:${CACHE_VERSION}:${monadChain.id}:${cfg.floorVault.toLowerCase()}:${cfg.raffle.toLowerCase()}:${cfg.deployBlock}`;
}

function loadCache(key: string): ScanState | undefined {
  const mem = memory.get(key);
  if (mem) return mem;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    if (!raw) return undefined;
    const parsed = parseBig<ScanState>(raw);
    memory.set(key, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

function saveCache(key: string, state: ScanState) {
  memory.set(key, state);
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, stringifyBig(state));
  } catch {
    // Storage may be full or blocked; the in-memory cache still works.
  }
}

/** Test hook: forget cached scans. */
export function clearScanCache() {
  memory.clear();
  inflight.clear();
  metaMemory.clear();
}

type LogLike = { args: Record<string, unknown>; blockNumber: bigint; transactionHash: Hash; logIndex: number };

/**
 * Read FloorVault and Raffle events from `cached.scannedTo` (or the deploy block) to the chain head in
 * 100-block chunks, calling `onBatch` with the progress after every batch. A failure throws after the
 * last good batch was reported, so the caller keeps that progress and the next call resumes from it.
 * Shared by the browser (`scanVault`) and the server (`serverScan.ts`). `opts` is for a log provider that
 * accepts wide ranges (the server's `LOGS_RPC_URL`): it replaces the 100-block chunk and 12-way concurrency.
 */
export async function advanceScan(
  cfg: AppConfig,
  client: PublicClient,
  cached: ScanState | undefined,
  onBatch?: (state: ScanState, head: bigint) => void,
  opts: { chunk?: bigint; concurrency?: number } = {},
): Promise<ScanState> {
  const head = await withRetry(() => client.getBlockNumber());
  const start = cached ? (cached.scannedTo - RESCAN_OVERLAP > cfg.deployBlock ? cached.scannedTo - RESCAN_OVERLAP : cfg.deployBlock) : cfg.deployBlock;
  const ranges = chunkRanges(start, head, opts.chunk);

  let next: ScanState = cached ?? { scannedTo: cfg.deployBlock - 1n, launched: [], harvested: [], bought: [], raffle: [] };
  let scanError: unknown;

  // Scan in batches and report after each one: a first scan covers thousands of chunks, and
  // progress must survive a reload or navigation instead of restarting from the deploy block.
  for (let i = 0; i < ranges.length; i += SAVE_EVERY_CHUNKS) {
    const { items, completedTo, error } = await fetchRanges<LogLike>(
      ranges.slice(i, i + SAVE_EVERY_CHUNKS),
      (r) =>
        withRetry(async () => {
          const logs = await client.getLogs({
            address: [cfg.floorVault, cfg.raffle],
            events: [launchedEvent, harvestedEvent, boughtEvent, ...raffleEvents],
            fromBlock: r.from,
            toBlock: r.to,
          });
          return logs as unknown as LogLike[];
        }),
      opts.concurrency ?? SCAN_CONCURRENCY,
    );
    next = applyScanItems(next, items, completedTo);
    if (completedTo !== null) onBatch?.(next, head);
    if (error) {
      scanError = error;
      break;
    }
  }
  if (!cached && ranges.length === 0) onBatch?.(next, head);
  if (scanError) throw scanError;
  return next;
}

/** What `/api/scan` answers: the server's scan so far, and whether it is still far behind the head. */
export type ServerScan = { state: ScanState; indexing: boolean };

/** The server's scan snapshot, or undefined when it cannot be reached (static hosting, offline, no route). */
async function fetchServerScan(): Promise<ServerScan | undefined> {
  try {
    const res = await fetch("/api/scan", { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return undefined;
    const body = parseBig<Partial<ServerScan>>(await res.text());
    if (!body.state || typeof body.state.scannedTo !== "bigint" || typeof body.indexing !== "boolean") return undefined;
    return { state: body.state, indexing: body.indexing };
  } catch {
    return undefined;
  }
}

/** A scan with a flag for "the server is still working through history; this is what it has so far". */
export type ScanResult = ScanState & { indexing?: boolean };

/**
 * Scan FloorVault and Raffle events from the deploy block to the chain head in 100-block chunks.
 * In the browser it starts from the server's snapshot when that is ahead of the local cache, and
 * while the server is still catching up it returns that partial snapshot (`indexing`) instead of
 * racing it for the same blocks. Results are cached (memory + localStorage), so later calls only
 * read new blocks.
 */
export async function scanVault(cfg: AppConfig, client: PublicClient = publicClient): Promise<ScanResult> {
  const key = cacheKey(cfg);
  const existing = inflight.get(key);
  if (existing) return existing;

  const run = (async (): Promise<ScanResult> => {
    let cached = loadCache(key);
    const remote = typeof window !== "undefined" ? await fetchServerScan() : undefined;
    if (remote && (!cached || remote.state.scannedTo > cached.scannedTo)) {
      cached = remote.state;
      saveCache(key, cached);
      if (remote.indexing) return { ...cached, indexing: true };
    }
    return advanceScan(cfg, client, cached, (state) => saveCache(key, state));
  })().finally(() => inflight.delete(key));

  inflight.set(key, run);
  return run;
}

function applyScanItems(base: ScanState, items: LogLike[], completedTo: bigint | null): ScanState {
  const next: ScanState = { ...base };
  const nameOf = (l: LogLike) => (l as unknown as { eventName: string }).eventName;
  const raffleKinds = new Set(raffleEvents.map((e) => e.name as string));
  const meta = (l: LogLike): LogMeta => ({
    blockNumber: l.blockNumber,
    transactionHash: l.transactionHash,
    logIndex: l.logIndex,
  });

  next.launched = mergeLogs(
    base.launched,
    items.filter((l) => nameOf(l) === "Launched").map((l): LaunchedRec => ({
      ...meta(l),
      token: l.args.token as Address,
      creator: l.args.creator as Address,
      collection: l.args.collection as Address,
      nftRecipient: l.args.nftRecipient as Address,
    })),
  );
  next.harvested = mergeLogs(
    base.harvested,
    items.filter((l) => nameOf(l) === "Harvested").map((l): HarvestedRec => ({
      ...meta(l),
      token: l.args.token as Address,
      claimed: l.args.claimed as bigint,
      toTreasury: l.args.toTreasury as bigint,
      toCreator: l.args.toCreator as bigint,
      toBudget: l.args.toBudget as bigint,
    })),
  );
  next.bought = mergeLogs(
    base.bought,
    items.filter((l) => nameOf(l) === "Bought").map((l): BoughtRec => ({
      ...meta(l),
      token: l.args.token as Address,
      collection: l.args.collection as Address,
      tokenId: l.args.tokenId as bigint,
      price: l.args.price as bigint,
      to: l.args.to as Address,
    })),
  );
  next.raffle = mergeLogs(
    base.raffle,
    items
      .filter((l) => raffleKinds.has(nameOf(l)))
      .map((l) => parseRaffleLog(l as unknown as Parameters<typeof parseRaffleLog>[0]))
      .filter((r): r is RaffleLog => r !== null),
  );
  if (completedTo !== null && completedTo > next.scannedTo) next.scannedTo = completedTo;
  return next;
}

// ---- Coin metadata -------------------------------------------------------------------------

const META_VERSION = "v1";
const metaMemory = new Map<string, CoinMetadata & { name: string; symbol: string }>();

/** Name, symbol and image for a coin: decoded from the launch transaction, else read from the token. */
export async function getCoinMeta(
  rec: LaunchedRec,
  client: PublicClient = publicClient,
): Promise<CoinMetadata & { name: string; symbol: string }> {
  const key = `floorvault:meta:${META_VERSION}:${rec.token.toLowerCase()}`;
  const mem = metaMemory.get(key);
  if (mem) return mem;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      metaMemory.set(key, parsed);
      return parsed;
    }
  } catch {
    // ignore storage problems
  }

  // Only metadata decoded from the launch transaction is complete and permanent. Fallbacks (token
  // reads, placeholders) may come from a transient RPC failure or lack the image, so they are
  // returned without being cached and get retried on the next load.
  try {
    if (rec.transactionHash === "0x") throw new Error("no launch tx");
    const tx = await withRetry(() => client.getTransaction({ hash: rec.transactionHash }), 3);
    const decoded = decodeFunctionData({ abi: floorVaultAbi, data: tx.input });
    if (decoded.functionName === "launch") {
      const args = decoded.args[0];
      // Coins launched through nad.fun point at metadata in its storage; older ones carry a data: URI.
      let parsed: CoinMetadata = parseTokenUri(args.tokenURI);
      if (!args.tokenURI.startsWith("data:")) {
        const stored = await fetchNadfunMetadata(args.tokenURI);
        parsed = { ...stored, image: safeImageUrl(stored.image) };
      }
      const result = { ...parsed, name: args.name, symbol: args.symbol };
      metaMemory.set(key, result);
      try {
        if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(result));
      } catch {
        // ignore
      }
      return result;
    }
  } catch {
    // fall through to token reads
  }
  try {
    const [name, symbol] = await Promise.all([
      client.readContract({ address: rec.token, abi: erc20Abi, functionName: "name" }),
      client.readContract({ address: rec.token, abi: erc20Abi, functionName: "symbol" }),
    ]);
    return { name, symbol };
  } catch {
    return { name: "Unnamed coin", symbol: "?" };
  }
}

// ---- Reads ---------------------------------------------------------------------------------

export async function getVaultData(cfg: AppConfig, client: PublicClient = publicClient): Promise<VaultData> {
  const scan = await scanVault(cfg, client);

  const metas = await Promise.all(scan.launched.map((l) => getCoinMeta(l, client)));

  const budgets = scan.launched.length
    ? await client.multicall({
        allowFailure: true,
        contracts: scan.launched.map((l) => ({
          address: cfg.floorVault,
          abi: floorVaultAbi,
          functionName: "pairings",
          args: [l.token],
        })),
      })
    : [];

  const coins: Coin[] = scan.launched.map((l, i) => {
    const res = budgets[i];
    const budget = res && res.status === "success" ? (res.result as unknown as readonly [Address, Address, bigint])[2] : 0n;
    const harvests = scan.harvested.filter((h) => h.token.toLowerCase() === l.token.toLowerCase());
    const buys = scan.bought.filter((b) => b.token.toLowerCase() === l.token.toLowerCase());
    return {
      token: l.token,
      creator: l.creator,
      collection: l.collection,
      nftRecipient: l.nftRecipient,
      launchBlock: l.blockNumber,
      launchTx: l.transactionHash,
      name: metas[i].name,
      symbol: metas[i].symbol,
      image: metas[i].image,
      description: metas[i].description,
      budget,
      claimedTotal: harvests.reduce((s, h) => s + h.claimed, 0n),
      treasuryTotal: harvests.reduce((s, h) => s + h.toTreasury, 0n),
      boughtCount: buys.length,
      spentTotal: buys.reduce((s, b) => s + b.price, 0n),
    };
  });

  const byToken = new Map(coins.map((c) => [c.token.toLowerCase(), c]));
  const bought: BoughtNft[] = [...scan.bought]
    .reverse()
    .map((b) => ({
      ...b,
      coinSymbol: byToken.get(b.token.toLowerCase())?.symbol,
      coinName: byToken.get(b.token.toLowerCase())?.name,
    }));

  // Newest coins first.
  coins.sort((a, b) => (a.launchBlock === b.launchBlock ? 0 : a.launchBlock < b.launchBlock ? 1 : -1));
  return { coins, bought, raffleLogs: scan.raffle, scannedTo: scan.scannedTo, indexing: scan.indexing === true };
}

/**
 * Read a coin straight from the contract when the log scan has not seen its Launched event yet
 * (for example right after launching). Returns null when FloorVault does not know the token.
 */
export async function getCoinDirect(
  cfg: AppConfig,
  token: Address,
  client: PublicClient = publicClient,
): Promise<Coin | null> {
  const [collection, nftRecipient, budget] = await client.readContract({
    address: cfg.floorVault,
    abi: floorVaultAbi,
    functionName: "pairings",
    args: [token],
  });
  if (collection === zeroAddress) return null;
  const meta = await getCoinMeta(
    { token, creator: zeroAddress, collection, nftRecipient, blockNumber: 0n, transactionHash: "0x", logIndex: 0 } as LaunchedRec,
    client,
  ).catch(() => ({ name: "Unnamed coin", symbol: "?" }) as { name: string; symbol: string; image?: string; description?: string });
  return {
    token,
    creator: zeroAddress,
    collection,
    nftRecipient,
    launchBlock: 0n,
    launchTx: "0x",
    name: meta.name,
    symbol: meta.symbol,
    image: meta.image,
    description: meta.description,
    budget,
    claimedTotal: 0n,
    treasuryTotal: 0n,
    boughtCount: 0,
    spentTotal: 0n,
  };
}

/**
 * Mainnet floor: the cheapest OpenSea listing of the CHOG collection, read through our own /api/floor
 * route (it holds the OpenSea API key). Throws when the route is unconfigured or fails, so the UI shows
 * "n/a" rather than "no listings".
 */
export async function getOpenSeaFloor(fetchImpl: typeof fetch = fetch): Promise<Floor | null> {
  const res = await fetchImpl("/api/floor");
  if (!res.ok) throw new Error(`Floor lookup failed (${res.status}).`);
  const body = (await res.json()) as FloorResponse;
  if (!body.configured) throw new Error("The OpenSea API key is not set on the server, so the floor is unavailable.");
  if (body.floor === null) return null;
  return { tokenId: body.tokenId ? BigInt(body.tokenId) : 0n, price: BigInt(body.floor) };
}

/** Cheapest listing for a collection, or null when nothing is listed. */
export async function getFloor(
  cfg: AppConfig,
  collection: Address,
  client: PublicClient = publicClient,
): Promise<Floor | null> {
  // Mainnet has no on-chain floor: Seaport listings are signed off-chain orders, so ask OpenSea.
  if (cfg.marketplace === null) return getOpenSeaFloor();
  try {
    const [tokenId, price] = await client.readContract({
      address: cfg.marketplace,
      abi: mockMarketplaceAbi,
      functionName: "floor",
      args: [collection],
    });
    return { tokenId, price };
  } catch (e) {
    // MockMarketplace.floor reverts with "no listings" when nothing is listed. Anything else
    // (RPC failure, wrong address) is a real error and must not look like an empty market.
    if (revertReason(e) === "no listings") return null;
    throw e;
  }
}

/** FloorVault.keeper(): the only address that may call buy, or the zero address when anyone may. */
export async function getKeeper(cfg: AppConfig, client: PublicClient = publicClient): Promise<Address> {
  return client.readContract({ address: cfg.floorVault, abi: floorVaultAbi, functionName: "keeper" });
}

/** The testnet DemoFeePot of a `FloorVaultDemo`, or null when this is a regular FloorVault (or mainnet). */
export async function getDemoPot(cfg: AppConfig, client: PublicClient = publicClient): Promise<Address | null> {
  if (cfg.chainId !== MONAD_TESTNET_ID) return null;
  try {
    return await client.readContract({ address: cfg.floorVault, abi: floorVaultDemoAbi, functionName: "demoPot" });
  } catch {
    return null;
  }
}

export type CollectionInfo = { address: Address; name: string };

/** The collection's name, or null when the address has no readable name() (EOA, non-NFT contract). */
export async function getCollectionInfo(
  address: Address,
  client: PublicClient = publicClient,
): Promise<CollectionInfo | null> {
  try {
    const name = await client.readContract({ address, abi: erc721MetadataAbi, functionName: "name" });
    return { address, name };
  } catch (e) {
    if (isContractCallFailure(e)) return null;
    throw e;
  }
}

/** Image for an NFT from its tokenURI, when the collection exposes one we can read safely. */
export async function getNftImage(
  collection: Address,
  tokenId: bigint,
  client: PublicClient = publicClient,
): Promise<string | null> {
  let uri: string;
  try {
    uri = await client.readContract({
      address: collection,
      abi: erc721MetadataAbi,
      functionName: "tokenURI",
      args: [tokenId],
    });
  } catch {
    return null;
  }
  const meta = parseTokenUri(uri);
  if (meta.image) return meta.image;
  if (/^\s*data:/i.test(uri)) return safeImageUrl(uri) ?? null;
  // Throws on a transient failure (see fetchNftImage), so react-query retries rather than caching "no image".
  return fetchNftImage(uri);
}

export async function getCollectionSupply(
  address: Address,
  client: PublicClient = publicClient,
): Promise<bigint | null> {
  try {
    return (await client.readContract({
      address,
      abi: [
        { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
      ] as const,
      functionName: "totalSupply",
    })) as bigint;
  } catch {
    return null;
  }
}


// ---- Raffle reads --------------------------------------------------------------------------

/** Live on-chain state for raffles, keyed by raffle id (decimal string). Failed reads are left out. */
export async function getRaffleStates(
  cfg: AppConfig,
  ids: bigint[],
  client: PublicClient = publicClient,
): Promise<Map<string, RaffleState>> {
  const out = new Map<string, RaffleState>();
  if (ids.length === 0) return out;
  const results = await client.multicall({
    allowFailure: true,
    contracts: ids.map((id) => ({ address: cfg.raffle, abi: raffleAbi, functionName: "getRaffle", args: [id] }) as const),
  });
  results.forEach((res, i) => {
    if (res.status === "success") out.set(ids[i].toString(), res.result as unknown as RaffleState);
  });
  if (out.size === 0) throw new Error("Could not read any raffle from the chain.");
  return out;
}

/** Every raffle's live state, for views that are not tied to one coin (the "you won" banner). */
export async function getAllRaffleStates(cfg: AppConfig, client: PublicClient = publicClient): Promise<Map<string, RaffleState>> {
  const count = await client.readContract({ address: cfg.raffle, abi: raffleAbi, functionName: "raffleCount" });
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
  return getRaffleStates(cfg, ids, client);
}

// ---- Holders -------------------------------------------------------------------------------

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const HOLDERS_VERSION = "v1";

export type HolderScan = { scannedTo: bigint; balances: Balances };

const holdersMemory = new Map<string, HolderScan>();
const holdersInflight = new Map<string, Promise<HolderScan>>();

const holdersKey = (token: Address) => `floorvault:holders:${HOLDERS_VERSION}:${monadChain.id}:${token.toLowerCase()}`;

/** Test hook. */
export function clearHolderCache() {
  holdersMemory.clear();
  holdersInflight.clear();
}

/**
 * Read a coin's Transfer logs from `base.scannedTo` (or `fromBlock`) to the chain head and fold them into
 * balances. Only fully fetched waves are applied, so a failure never leaves a hole or double counts: the
 * returned scan keeps the progress made, and `error` says why it stopped short. Shared by the browser
 * (`scanHolders`) and the server (`serverHolders.ts`); `opts` is for a log provider that accepts wide ranges.
 */
export async function advanceHolders(
  token: Address,
  fromBlock: bigint,
  client: PublicClient,
  base: HolderScan | undefined,
  opts: { chunk?: bigint; concurrency?: number } = {},
  onProgress?: (done: number, total: number) => void,
): Promise<{ scan: HolderScan; error?: unknown }> {
  const start: HolderScan = base ?? { scannedTo: fromBlock - 1n, balances: {} };
  const head = await withRetry(() => client.getBlockNumber());
  const ranges = chunkRanges(start.scannedTo + 1n, head, opts.chunk);
  let done = 0;

  const { items, completedTo, error } = await fetchRanges<TransferRec>(
    ranges,
    (r) =>
      withRetry(async () => {
        const logs = await client.getLogs({ address: token, event: transferEvent, fromBlock: r.from, toBlock: r.to });
        done += 1;
        onProgress?.(done, ranges.length);
        return logs.map((l) => ({ from: l.args.from as Address, to: l.args.to as Address, value: l.args.value as bigint }));
      }),
    opts.concurrency,
  );
  const scan: HolderScan =
    completedTo !== null ? { scannedTo: completedTo, balances: applyTransfers(start.balances, items) } : start;
  return { scan, error };
}

/** What `/api/holders` answers: the server's balances for one coin, and whether it is still far behind the head. */
export type ServerHolders = { scan: HolderScan; indexing: boolean };

/** The server's holder snapshot for a coin, or undefined when it cannot be reached or does not know the coin. */
async function fetchServerHolders(token: Address): Promise<ServerHolders | undefined> {
  try {
    const res = await fetch(`/api/holders?token=${token}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return undefined;
    const body = parseBig<Partial<ServerHolders>>(await res.text());
    const s = body.scan;
    if (!s || typeof s.scannedTo !== "bigint" || typeof s.balances !== "object" || typeof body.indexing !== "boolean") return undefined;
    return { scan: s, indexing: body.indexing };
  } catch {
    return undefined;
  }
}

/**
 * Fold a coin's ERC-20 Transfer logs into balances, in 100-block chunks from `fromBlock` (the
 * coin's launch block). The result is cached; later calls only read blocks after `scannedTo`.
 * In the browser it starts from the server's snapshot when that is ahead of the local cache, so a cold
 * visit reads only the short tail instead of walking every block since launch.
 * Only fully fetched waves are applied, so a failure never leaves a hole or double counts.
 */
export async function scanHolders(
  token: Address,
  fromBlock: bigint,
  client: PublicClient = publicClient,
  onProgress?: (done: number, total: number) => void,
): Promise<HolderScan> {
  const key = holdersKey(token);
  const existing = holdersInflight.get(key);
  if (existing) return existing;

  const run = (async () => {
    let cached = holdersMemory.get(key);
    if (!cached) {
      try {
        const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
        if (raw) cached = parseBig<HolderScan>(raw);
      } catch {
        cached = undefined;
      }
    }
    const remote = typeof window !== "undefined" ? await fetchServerHolders(token) : undefined;
    if (remote && (!cached || remote.scan.scannedTo > cached.scannedTo)) cached = remote.scan;

    const { scan: next, error } = await advanceHolders(token, fromBlock, client, cached, {}, onProgress);
    holdersMemory.set(key, next);
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(key, stringifyBig(next));
    } catch {
      // Storage may be full or blocked; the in-memory cache still works.
    }
    if (error) throw error;
    return next;
  })().finally(() => holdersInflight.delete(key));

  holdersInflight.set(key, run);
  return run;
}

export type RaffleCandidate = RankedHolder;

const CANDIDATE_BATCH = 12;
const CANDIDATE_BATCHES = 10;

/**
 * The best holder the contract will accept for a raffle that is in its settle window.
 * Holders are ranked locally with the contract's score, then the best ones are checked on-chain
 * (`Raffle.candidate`), which also filters out the bonding curve, past winners and stale balances.
 * Returns null when nobody qualifies. The returned score is the contract's own.
 */
export async function findBestCandidate(
  cfg: AppConfig,
  raffleId: bigint,
  state: Pick<RaffleState, "token" | "seed">,
  balances: Balances,
  client: PublicClient = publicClient,
): Promise<RaffleCandidate | null> {
  const ranked = rankHolders(balances, state.seed, [state.token, cfg.raffle, cfg.floorVault]);
  for (let b = 0; b < CANDIDATE_BATCHES && b * CANDIDATE_BATCH < ranked.length; b++) {
    const batch = ranked.slice(b * CANDIDATE_BATCH, (b + 1) * CANDIDATE_BATCH);
    const results = await client.multicall({
      allowFailure: true,
      contracts: batch.map(
        (h) => ({ address: cfg.raffle, abi: raffleAbi, functionName: "candidate", args: [raffleId, h.holder] }) as const,
      ),
    });
    let best: RaffleCandidate | null = null;
    results.forEach((res, i) => {
      if (res.status !== "success") return;
      const [ok, score, balance] = res.result as unknown as readonly [boolean, bigint, bigint];
      if (ok && (best === null || score < best.score)) best = { holder: batch[i].holder, score, balance };
    });
    if (best) return best;
  }
  return null;
}

// ---- Bonding curve: live price, quotes, balances -------------------------------------------

export type CurveInfo = {
  virtualQuote: bigint;
  virtualToken: bigint;
  /** MON per token right now. */
  price: number;
  /** MON per token at launch. */
  launchPrice: number;
  graduated: boolean;
  /** Creator fee in basis points of trade volume. */
  creatorFeeBps: number;
};

/** The coin's nad.fun bonding-curve state, or null when the curve does not know the token. */
export async function getCurveInfo(token: Address, client: PublicClient = publicClient): Promise<CurveInfo | null> {
  const c = await client.readContract({ address: NAD_BONDING_CURVE, abi: bondingCurveAbi, functionName: "getCurve", args: [token] });
  if (c.token === zeroAddress) return null;
  return {
    virtualQuote: c.virtualQuoteReserve,
    virtualToken: c.virtualTokenReserve,
    price: priceFromReserves(c.virtualQuoteReserve, c.virtualTokenReserve),
    launchPrice: priceFromReserves(c.initialQuoteReserve, c.initialTokenReserve),
    graduated: c.graduated,
    creatorFeeBps: c.creatorFeeRate,
  };
}

/**
 * What the router would pay out for `amountIn`: tokens for a buy (MON in), MON for a sell (tokens in).
 * Null when the router cannot quote it (a graduated coin, or an amount the curve cannot absorb).
 */
export async function getTradeQuote(
  token: Address,
  side: "buy" | "sell",
  amountIn: bigint,
  client: PublicClient = publicClient,
): Promise<bigint | null> {
  try {
    return await client.readContract({
      address: NAD_ROUTER,
      abi: nadRouterAbi,
      functionName: "getAmountOut",
      args: [token, amountIn, side === "buy"],
    });
  } catch (e) {
    if (isContractCallFailure(e)) return null;
    throw e;
  }
}

/** The wallet's MON and coin balances, in wei. */
export async function getWalletBalances(
  token: Address,
  owner: Address,
  client: PublicClient = publicClient,
): Promise<{ mon: bigint; coin: bigint }> {
  const [mon, coin] = await Promise.all([
    client.getBalance({ address: owner }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
  ]);
  return { mon, coin };
}

export type BlockClock = { headBlock: number; headTimestamp: number; secPerBlock: number };

/** The head block and a measured seconds-per-block, to turn block numbers into rough times. */
export async function getBlockClock(client: PublicClient = publicClient): Promise<BlockClock> {
  const head = await withRetry(() => client.getBlock());
  const back = head.number > 20_000n ? head.number - 20_000n : 1n;
  const past = await withRetry(() => client.getBlock({ blockNumber: back }));
  return {
    headBlock: Number(head.number),
    headTimestamp: Number(head.timestamp),
    secPerBlock: secondsPerBlock(
      { block: past.number, timestamp: past.timestamp },
      { block: head.number, timestamp: head.timestamp },
    ),
  };
}

// ---- Price history -------------------------------------------------------------------------

const TRADES_VERSION = "v1";
const TRADE_CONCURRENCY = 12;
const TRADE_BATCH_CHUNKS = 40; // 100-block chunks per saved/shown step while reading history backwards

const syncEvent = parseAbiItem(
  "event Sync(address indexed token, uint256 realQuoteReserve, uint256 realTokenReserve, uint256 virtualQuoteReserve, uint256 virtualTokenReserve)",
);

/** Price points for every block in [from, to], and nothing missing in between. */
export type TradeScan = { from: bigint; to: bigint; points: PricePoint[] };
export type TradeScanStatus = "scanning" | "done" | "error";
type TradeListener = (scan: TradeScan, status: TradeScanStatus) => void;

const tradeMemory = new Map<string, TradeScan>();
const tradeRuns = new Map<string, Set<TradeListener>>();

const tradesKey = (token: Address) => `floorvault:trades:${TRADES_VERSION}:${monadChain.id}:${token.toLowerCase()}`;

/** Test hook. */
export function clearTradeCache() {
  tradeMemory.clear();
  tradeRuns.clear();
}

function loadTrades(key: string): TradeScan | undefined {
  const mem = tradeMemory.get(key);
  if (mem) return mem;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    if (!raw) return undefined;
    const parsed = parseBig<TradeScan>(raw);
    tradeMemory.set(key, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

function saveTrades(key: string, scan: TradeScan) {
  tradeMemory.set(key, scan);
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, stringifyBig(scan));
  } catch {
    // Storage may be full or blocked; the in-memory cache still works.
  }
}

/** What is already cached for a coin's price history, if anything. */
export function cachedTrades(token: Address): TradeScan | undefined {
  return loadTrades(tradesKey(token));
}

async function runTradeScan(
  key: string,
  token: Address,
  lowerBound: bigint,
  listeners: Set<TradeListener>,
  client: PublicClient,
) {
  const emit = (scan: TradeScan, status: TradeScanStatus) => listeners.forEach((l) => l(scan, status));
  const readRange = (r: { from: bigint; to: bigint }) =>
    withRetry(async () => {
      const logs = await client.getLogs({
        address: NAD_BONDING_CURVE,
        event: syncEvent,
        args: { token },
        fromBlock: r.from,
        toBlock: r.to,
      });
      return logs.map(
        (l): PricePoint => ({
          blockNumber: l.blockNumber,
          transactionHash: l.transactionHash,
          logIndex: l.logIndex,
          price: priceFromReserves(l.args.virtualQuoteReserve as bigint, l.args.virtualTokenReserve as bigint),
        }),
      );
    });

  const head = await withRetry(() => client.getBlockNumber());
  let scan = loadTrades(key) ?? { from: head + 1n, to: head, points: [] };
  emit(scan, "scanning");

  try {
    // Catch up to the head first: usually a few chunks, and it keeps the newest trades current.
    if (scan.to < head) {
      const fwd = await fetchRanges<PricePoint>(chunkRanges(scan.to + 1n, head), readRange, TRADE_CONCURRENCY);
      if (fwd.completedTo !== null) {
        scan = { ...scan, to: fwd.completedTo, points: mergeLogs(scan.points, fwd.items) };
        saveTrades(key, scan);
        emit(scan, "scanning");
      }
      if (fwd.error) throw fwd.error;
    }

    // Then read history newest to oldest, showing and saving each step, until the coin's launch.
    // Stops early if nobody is watching any more; what was read stays cached.
    while (scan.from > lowerBound && listeners.size > 0) {
      const stepFrom = scan.from - lowerBound > BigInt(TRADE_BATCH_CHUNKS) * 100n ? scan.from - BigInt(TRADE_BATCH_CHUNKS) * 100n : lowerBound;
      const back = await fetchRangesBackward<PricePoint>(chunkRanges(stepFrom, scan.from - 1n), readRange, TRADE_CONCURRENCY);
      if (back.completedFrom !== null) {
        scan = { ...scan, from: back.completedFrom, points: mergeLogs(scan.points, back.items) };
        saveTrades(key, scan);
        emit(scan, "scanning");
      }
      if (back.error) throw back.error;
    }
    emit(scan, "done");
  } catch {
    emit(scan, "error");
  }
}

/**
 * Follow a coin's price history. Reads the curve's `Sync` events (one per trade) newest first, so
 * recent trades show up within seconds while older ones keep loading. `onUpdate` fires with the
 * cache first, then after every step. Calling again while a run is active just joins it. Returns
 * an unsubscribe function; a run with no listeners left stops after its current step.
 */
export function watchTrades(
  token: Address,
  lowerBound: bigint,
  onUpdate: TradeListener,
  client: PublicClient = publicClient,
): () => void {
  const key = tradesKey(token);
  const cached = loadTrades(key);
  let listeners = tradeRuns.get(key);
  const starting = !listeners;
  if (!listeners) {
    listeners = new Set();
    tradeRuns.set(key, listeners);
  }
  listeners.add(onUpdate);
  // Deliver the cache asynchronously so callers can treat every update the same way.
  if (cached) queueMicrotask(() => onUpdate(cached, "scanning"));

  if (starting) {
    const set = listeners;
    void runTradeScan(key, token, lowerBound, set, client)
      .catch(() => set.forEach((l) => l(loadTrades(key) ?? { from: 1n, to: 0n, points: [] }, "error")))
      .finally(() => {
        if (tradeRuns.get(key) === set) tradeRuns.delete(key);
      });
  }
  const set = listeners;
  return () => {
    set.delete(onUpdate);
  };
}

export const isConfigured = configResult.ok;
