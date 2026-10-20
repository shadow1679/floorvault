// Keeper: runs harvest and buy for every launched coin so nobody has to press the buttons.
//
//   npm run keeper            # loop forever
//   npm run keeper -- --once  # a single pass, then exit
//
// harvest is permissionless and its destinations are fixed at launch, so any wallet could call it. buy is
// restricted to the vault's keeper address (FloorVault.keeper()), because the keeper picks the listing and
// its price off-chain: KEEPER_ACCOUNT must be that address, otherwise buys are skipped with a warning. The
// keeper still cannot redirect funds: purchases are limited to the paired collection and the coin's budget,
// and the NFT always goes to the Raffle. Each call is simulated first and skipped when it would revert
// (nothing to claim, nothing affordable, no listings), so a pass is cheap when idle.
//
// With NEXT_PUBLIC_RAFFLE_ADDRESS set (required on mainnet) it also runs every raffle step except the claim:
// draw once the draw time has passed, submit the best holder during the settle window, finalize when it
// closes, and re-raffle after an unclaimed claim window. All four are permissionless on the contract, so the
// keeper account needs no special role. The coin page has no buttons for these steps, so the raffle only
// advances while the keeper runs. Only the winner can claim. Holder balances are folded from the coin's Transfer logs ahead of the draw and kept in
// the state file, so the settle window only needs a small catch-up scan.
//
// Testnet (NEXT_PUBLIC_CHAIN_ID=10143): buy(token, floor, 0x) against MockMarketplace.floor().
// Mainnet (NEXT_PUBLIC_CHAIN_ID=143 or unset): the cheapest affordable Chog Genesis listing is found with OpenSea's
// API, its signed Seaport order is fetched with the SeaportAdapter as fulfiller (the zone signature commits
// to the fulfiller), validated (one ERC-721 of the collection, native consideration only) and ABI-encoded
// into buy's `data` (scripts/seaport.mjs).
//
// Config (web/.env.local is loaded by the npm script):
//   NEXT_PUBLIC_CHAIN_ID  143 (default) or 10143
//   NEXT_PUBLIC_FLOORVAULT_ADDRESS, NEXT_PUBLIC_DEPLOY_BLOCK, NEXT_PUBLIC_RPC_URL (optional)
//   NEXT_PUBLIC_MOCK_MARKETPLACE_ADDRESS  testnet only: where floor() is read
//   NEXT_PUBLIC_RAFFLE_ADDRESS            mainnet: listings offered by it are ignored; optional on testnet,
//                                         where setting it turns on raffle automation
//   NEXT_PUBLIC_COLLECTION_ADDRESS        mainnet: defaults to Chog Genesis
//   OPENSEA_API_KEY                       mainnet, required: secret, never a NEXT_PUBLIC_ variable
//   SEAPORT_ADAPTER_ADDRESS               mainnet, required: the SeaportAdapter that FloorVault.market() points to
//   KEEPER_ACCOUNT        Foundry keystore name, e.g. launcher-deployer
//   KEEPER_PASSWORD_FILE  file holding that keystore's password (never pass the password itself)
//   KEEPER_INTERVAL_SEC   seconds between passes, default 30
//   KEEPER_STATE_FILE     where the scan cursor is kept, default web/.keeper-state.json (point it at a volume when hosted)
// Signing goes through `cast send`, so the key never enters this process.

import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPublicClient, getAddress, http, parseAbi, parseAbiItem, zeroAddress } from "viem";
import { hypersyncTransport, isHyperSyncUrl } from "./hypersync.mjs";
import {
  Stage,
  applyTransfers,
  balancesFromJson,
  balancesToJson,
  raffleAction,
  rankHolders,
} from "./raffle-keeper.mjs";
import {
  OPENSEA_COLLECTION_SLUG,
  advancedOrderFromFulfillment,
  checkOrder,
  createOpenSeaClient,
  encodeAdvancedOrder,
  selectCheapest,
} from "./seaport.mjs";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = (process.env.KEEPER_STATE_FILE ?? "").trim() || join(here, "..", ".keeper-state.json");
const CHUNK = 100n; // the public RPCs (testnet and mainnet) reject eth_getLogs ranges above 100 blocks
const CHOG_MAINNET = "0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763";
const CONCURRENCY = 3;

const need = (k) => {
  const v = (process.env[k] ?? "").trim();
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};
const expand = (p) => p.replace(/^~(?=\/|$)/, homedir());

const chainIdRaw = (process.env.NEXT_PUBLIC_CHAIN_ID ?? "").trim() || "143";
if (chainIdRaw !== "10143" && chainIdRaw !== "143") throw new Error(`NEXT_PUBLIC_CHAIN_ID must be 143 or 10143, got ${chainIdRaw}`);
const mainnet = chainIdRaw === "143";
const rpcUrl =
  (process.env.NEXT_PUBLIC_RPC_URL ?? "").trim() || (mainnet ? "https://rpc.monad.xyz" : "https://testnet-rpc.monad.xyz");
const vault = getAddress(need("NEXT_PUBLIC_FLOORVAULT_ADDRESS").toLowerCase());
const deployBlock = BigInt(need("NEXT_PUBLIC_DEPLOY_BLOCK"));
const account = need("KEEPER_ACCOUNT");
const passwordFile = expand(need("KEEPER_PASSWORD_FILE"));
const intervalMs = Number(process.env.KEEPER_INTERVAL_SEC ?? 30) * 1000;
const once = process.argv.includes("--once");

const addr = (k) => getAddress(need(k).toLowerCase());
// Mainnet buys need OpenSea and the adapter; testnet buys need the mock marketplace.
const mainnetCfg = mainnet
  ? {
      adapter: addr("SEAPORT_ADAPTER_ADDRESS"),
      raffle: addr("NEXT_PUBLIC_RAFFLE_ADDRESS"),
      collection: getAddress(((process.env.NEXT_PUBLIC_COLLECTION_ADDRESS ?? "").trim() || CHOG_MAINNET).toLowerCase()),
      opensea: createOpenSeaClient({ apiKey: need("OPENSEA_API_KEY") }),
    }
  : null;
if (mainnetCfg && mainnetCfg.collection.toLowerCase() !== CHOG_MAINNET.toLowerCase()) {
  throw new Error("Mainnet supports Chog Genesis only; NEXT_PUBLIC_COLLECTION_ADDRESS must be " + CHOG_MAINNET);
}
const testnetMarket = mainnet ? null : addr("NEXT_PUBLIC_MOCK_MARKETPLACE_ADDRESS");
// Raffle automation is on whenever the Raffle address is known (always on mainnet, where it is required above).
const raffleRaw = (process.env.NEXT_PUBLIC_RAFFLE_ADDRESS ?? "").trim();
const raffleAddress = raffleRaw ? getAddress(raffleRaw.toLowerCase()) : null;

const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 2 }) });
const vaultAbi = parseAbi([
  "function harvest(address token) returns (uint256 claimed)",
  "function buy(address token, uint256 maxPrice, bytes data) returns (uint256 tokenId, uint256 price)",
  "function pairings(address token) view returns (address collection, address nftRecipient, uint256 budget)",
  "function keeper() view returns (address)",
]);
const marketAbi = parseAbi(["function floor(address collection) view returns (uint256 tokenId, uint256 price)"]);
const raffleAbi = parseAbi([
  "function raffleCount() view returns (uint256)",
  "function getRaffle(uint256 id) view returns ((address token, address collection, uint256 tokenId, address fallbackTo, uint8 stage, uint32 round, uint64 drawAt, uint64 settleEnd, uint64 claimDeadline, bytes32 seed, address leader, uint256 leaderScore, address winner))",
  "function candidate(uint256 id, address holder) view returns (bool ok, uint256 score, uint256 balance)",
  "function draw(uint256 id)",
  "function settle(uint256 id, address holder)",
  "function finalize(uint256 id)",
  "function reRaffle(uint256 id)",
]);
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const launchedEvent = parseAbiItem(
  "event Launched(address indexed token, address indexed creator, address indexed collection, address nftRecipient)",
);

const log = (...a) => console.log(new Date().toISOString(), ...a);
const castAuth = ["--account", account, "--password-file", passwordFile, "--rpc-url", rpcUrl];

// ---- coin discovery (incremental, persisted) -------------------------------------------------

// State file: scannedTo/tokens are the vault's Launched scan. launchBlocks (token -> block) says where a
// coin's Transfer scan starts, and holders (token -> { scannedTo, balances }) is the raffle automation's
// running fold of those transfers. Numbers are decimal strings; both keys are optional in older files.
function loadState() {
  if (existsSync(STATE_FILE)) {
    const s = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    if (s.vault === vault && (s.chainId ?? "10143") === chainIdRaw) {
      return {
        scannedTo: BigInt(s.scannedTo),
        tokens: s.tokens,
        launchBlocks: Object.fromEntries(Object.entries(s.launchBlocks ?? {}).map(([t, b]) => [t, BigInt(b)])),
        holders: Object.fromEntries(
          Object.entries(s.holders ?? {}).map(([t, h]) => [t, { scannedTo: BigInt(h.scannedTo), balances: balancesFromJson(h.balances) }]),
        ),
      };
    }
  }
  return { scannedTo: deployBlock - 1n, tokens: [], launchBlocks: {}, holders: {} };
}

function saveState(s) {
  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        vault,
        chainId: chainIdRaw,
        scannedTo: s.scannedTo.toString(),
        tokens: s.tokens,
        launchBlocks: Object.fromEntries(Object.entries(s.launchBlocks).map(([t, b]) => [t, b.toString()])),
        holders: Object.fromEntries(
          Object.entries(s.holders).map(([t, h]) => [t, { scannedTo: h.scannedTo.toString(), balances: balancesToJson(h.balances) }]),
        ),
      },
      null,
      2,
    ),
  );
}

// A public RPC that accepts 10,000-block log ranges; only a scan accelerator, falls back to the
// official RPC. Contract reads and sends never use it.
// The accelerator is testnet-only; mainnet scans use the official RPC in 100-block chunks, from
// NEXT_PUBLIC_DEPLOY_BLOCK (the first run is slow, later runs resume from the state file).
const TIERS = [{ client, chunk: CHUNK, concurrency: CONCURRENCY }];
if (!mainnet) {
  const wideClient = createPublicClient({
    transport: http("https://monad-testnet.api.onfinality.io/public", { retryCount: 1 }),
  });
  TIERS.unshift({ client: wideClient, chunk: 10_000n, concurrency: 2 });
}
// Optional provider with unlimited log ranges (e.g. HyperRPC, whose URL carries an API token): tried first, one
// 500k-block call at a time with a long timeout, since such calls can take tens of seconds. Works on mainnet too.
const logsRpcUrl = (process.env.LOGS_RPC_URL ?? "").trim();
if (logsRpcUrl) {
  TIERS.unshift({
    client: createPublicClient({
      transport: isHyperSyncUrl(logsRpcUrl) ? hypersyncTransport(logsRpcUrl) : http(logsRpcUrl, { timeout: 120_000, retryCount: 1 }),
    }),
    chunk: 500_000n,
    concurrency: 1,
  });
}

/** Retry with exponential backoff; the public RPCs rate-limit (the official one at 25 req/s). */
async function withRetry(fn, attempts = 5, baseMs = 400) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastError;
}

/**
 * Fetch logs for [from, head] in tier-sized ranges, a wave of ranges at a time. `onWave(results, to)` runs
 * only after a whole wave succeeded, so callers advance their cursor without ever leaving a hole.
 */
async function scanRanges(tier, from, head, fetchRange, onWave) {
  const ranges = [];
  for (let f = from; f <= head; f += tier.chunk) {
    ranges.push({ from: f, to: f + tier.chunk - 1n > head ? head : f + tier.chunk - 1n });
  }
  for (let i = 0; i < ranges.length; i += tier.concurrency) {
    const wave = ranges.slice(i, i + tier.concurrency);
    const results = await Promise.all(wave.map((r) => withRetry(() => fetchRange(tier.client, r))));
    onWave(results, wave[wave.length - 1].to);
  }
}

/** Run `scan(tier)` on each tier in turn until one finishes; a failed tier's cursor progress is kept, so the next resumes. */
async function withTiers(scan) {
  let lastError;
  for (const tier of TIERS) {
    try {
      return await scan(tier);
    } catch (e) {
      lastError = e;
      log(`log scan tier (chunk ${tier.chunk}) failed:`, e?.details ?? e?.shortMessage ?? e?.message);
    }
  }
  throw lastError;
}

async function discover(state) {
  const head = await client.getBlockNumber();
  return withTiers((tier) => {
    const found = new Set(state.tokens);
    return scanRanges(
      tier,
      state.scannedTo + 1n,
      head,
      (c, r) => c.getLogs({ address: vault, event: launchedEvent, fromBlock: r.from, toBlock: r.to }),
      (results, to) => {
        for (const logs of results) {
          for (const l of logs) {
            const token = getAddress(l.args.token);
            found.add(token);
            state.launchBlocks[token] = l.blockNumber;
          }
        }
        state.scannedTo = to;
        state.tokens = [...found];
        saveState(state);
      },
    );
  });
}

/** Fold a coin's Transfer logs into balances up to the chain head. Starts at the coin's launch block, and resumes from the state file. */
async function refreshHolders(state, token) {
  const h = (state.holders[token] ??= { scannedTo: (state.launchBlocks[token] ?? deployBlock) - 1n, balances: {} });
  const head = await client.getBlockNumber();
  if (h.scannedTo >= head) return h.balances;
  await withTiers((tier) =>
    scanRanges(
      tier,
      h.scannedTo + 1n,
      head,
      (c, r) => c.getLogs({ address: token, event: transferEvent, fromBlock: r.from, toBlock: r.to }),
      (results, to) => {
        const transfers = results.flat().map((l) => ({ from: l.args.from, to: l.args.to, value: l.args.value }));
        h.balances = applyTransfers(h.balances, transfers);
        h.scannedTo = to;
        saveState(state);
      },
    ),
  );
  return h.balances;
}

// ---- actions ---------------------------------------------------------------------------------

async function keeperAddress() {
  const { stdout } = await run("cast", ["wallet", "address", "--account", account, "--password-file", passwordFile]);
  return getAddress(stdout.trim());
}

/**
 * Simulate first; send only when the call would succeed. `skipIf` gets the simulated return value, for calls that
 * succeed without doing anything. Returns the tx hash or null.
 */
async function trySend(from, fn, sig, args, castArgs, target = { address: vault, abi: vaultAbi }, skipIf = null) {
  let request;
  try {
    let result;
    ({ request, result } = await client.simulateContract({ address: target.address, abi: target.abi, functionName: fn, args, account: from }));
    if (skipIf?.(result)) return null;
  } catch {
    return null; // nothing to do right now
  }
  // Gas on Monad is charged on the gas limit, so use a simulated estimate rather than a block-sized cap.
  const gas = await client.estimateContractGas(request).catch(() => null);
  const cast = ["send", target.address, sig, ...castArgs, ...castAuth, "--async"];
  if (gas) cast.push("--gas-limit", ((gas * 12n) / 10n).toString());
  const { stdout } = await run("cast", cast);
  const hash = stdout.trim();
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${fn}(${args[0]}) reverted: ${hash}`);
  return hash;
}

// The real Creator Fee vault reverts when nothing is settled, but the testnet demo vault's harvest succeeds with
// 0 (its fee pot is empty), so skip a harvest that would claim nothing instead of paying gas for it every pass.
const harvest = (from, token) => trySend(from, "harvest", "harvest(address)", [token], [token], undefined, (claimed) => claimed === 0n);

/** WMON budget the vault holds for a coin. */
async function budgetOf(token) {
  const [, , budget] = await client.readContract({ address: vault, abi: vaultAbi, functionName: "pairings", args: [token] });
  return budget;
}

// ---- buying ----------------------------------------------------------------------------------

/** Testnet: buy the mock marketplace's floor when the budget covers it. */
async function buyTestnet(from, token, budget) {
  const [collection] = await client.readContract({ address: vault, abi: vaultAbi, functionName: "pairings", args: [token] });
  let price;
  try {
    [, price] = await client.readContract({ address: testnetMarket, abi: marketAbi, functionName: "floor", args: [collection] });
  } catch {
    return null; // no listings
  }
  if (price > budget) return null;
  return trySend(from, "buy", "buy(address,uint256,bytes)", [token, price, "0x"], [token, price.toString(), "0x"]);
}

// One listing snapshot per pass: every coin buys the same collection, so a single OpenSea call serves them all.
let listingCache = { at: 0, listings: [] };
const LISTING_TTL_MS = 20_000;
async function listings() {
  if (Date.now() - listingCache.at > LISTING_TTL_MS) {
    listingCache = { at: Date.now(), listings: await mainnetCfg.opensea.bestListings(OPENSEA_COLLECTION_SLUG, 20) };
  }
  return listingCache.listings;
}
const spentHashes = new Set(); // listings already bought or rejected; reset every pass

/** Mainnet: cheapest affordable CHOG listing from OpenSea, fulfilled through the SeaportAdapter. */
async function buyMainnet(from, token, budget) {
  const { adapter, raffle, collection, opensea } = mainnetCfg;
  const nowSec = Math.floor(Date.now() / 1000);
  const pick = selectCheapest(await listings(), {
    collection,
    budget,
    nowSec,
    exclude: [vault, raffle, adapter, from],
    skip: spentHashes,
  });
  if (!pick) return null;

  let order;
  try {
    const response = await opensea.fulfillmentData(pick, adapter);
    order = advancedOrderFromFulfillment(response, pick);
    // Re-check the order OpenSea actually returned, not just the listing we asked about.
    const check = checkOrder(order.parameters, { collection, nowSec, exclude: [vault, raffle, adapter, from] });
    if (!check.ok) throw new Error(check.reason);
    if (check.total > budget) throw new Error("fulfillment price is above the budget");
    pick.total = check.total;
  } catch (e) {
    spentHashes.add(pick.hash);
    log(`skipping listing ${pick.hash}: ${e instanceof Error ? e.message : e}`);
    return null;
  }

  const data = encodeAdvancedOrder(order);
  const hash = await trySend(from, "buy", "buy(address,uint256,bytes)", [token, pick.total, data], [token, pick.total.toString(), data]);
  spentHashes.add(pick.hash); // bought, or the simulation says it cannot be: do not retry this pass
  // A failed simulation usually means the short-lived listing expired or was sold: take a fresh snapshot.
  if (!hash) listingCache.at = 0;
  if (hash) log(`bought CHOG #${pick.tokenId} for ${pick.total} wei (order ${pick.hash})`);
  return hash;
}

// ---- raffles ---------------------------------------------------------------------------------
// Everything up to the winner's claim. All four calls are permissionless; Raffle.claim only accepts the winner.

const RAFFLE_SIGS = { draw: "draw(uint256)", settle: "settle(uint256,address)", finalize: "finalize(uint256)", reRaffle: "reRaffle(uint256)" };
const raffleSend = (from, fn, args) =>
  trySend(from, fn, RAFFLE_SIGS[fn], args, args.map(String), { address: raffleAddress, abi: raffleAbi });

const CANDIDATE_BATCH = 12;
const CANDIDATE_BATCHES = 10;
const finishedRaffles = new Set(); // claimed or fell back: nothing left to do

const readRaffle = (id) => client.readContract({ address: raffleAddress, abi: raffleAbi, functionName: "getRaffle", args: [id] });
const chainNow = async () => Number((await client.getBlock()).timestamp);

/**
 * The best holder the contract will accept right now. Holders are ranked locally with the contract's score,
 * then the best are confirmed on-chain with Raffle.candidate, which also drops the bonding curve, past
 * winners and stale balances. Null when nobody qualifies.
 */
async function bestCandidate(id, r, balances) {
  const ranked = rankHolders(balances, r.seed, [r.token, raffleAddress, vault]);
  for (let b = 0; b < CANDIDATE_BATCHES && b * CANDIDATE_BATCH < ranked.length; b++) {
    const batch = ranked.slice(b * CANDIDATE_BATCH, (b + 1) * CANDIDATE_BATCH);
    const results = await Promise.all(
      batch.map((h) =>
        client
          .readContract({ address: raffleAddress, abi: raffleAbi, functionName: "candidate", args: [id, h.holder] })
          .catch(() => null),
      ),
    );
    let best = null;
    results.forEach((res, i) => {
      if (!res) return;
      const [ok, score] = res;
      if (ok && (best === null || score < best.score)) best = { holder: getAddress(batch[i].holder), score };
    });
    if (best) return best;
  }
  return null;
}

async function raffleStep(state, from, id) {
  let r = await readRaffle(id);
  let action = raffleAction(r, await chainNow());
  if (action === "done") {
    finishedRaffles.add(id);
    return;
  }

  // Read the coin's holders ahead of the draw, so the settle window only needs a small catch-up scan.
  if (Number(r.stage) === Stage.Waiting) {
    await refreshHolders(state, r.token).catch((e) => log(`holder scan for ${r.token} failed:`, e?.message ?? e));
  }

  if (action === "draw") {
    const h = await raffleSend(from, "draw", [id]);
    if (!h) return;
    log(`drew raffle #${id} ${h}`);
    r = await readRaffle(id);
    action = raffleAction(r, await chainNow());
  }

  if (action === "settle") {
    const balances = await refreshHolders(state, r.token);
    const best = await bestCandidate(id, r, balances);
    if (best && best.score < r.leaderScore) {
      const h = await raffleSend(from, "settle", [id, best.holder]);
      if (h) log(`raffle #${id}: submitted ${best.holder} ${h}`);
    }
  } else if (action === "finalize") {
    const h = await raffleSend(from, "finalize", [id]);
    if (h) log(`finalized raffle #${id} ${h}`);
  } else if (action === "reRaffle") {
    const h = await raffleSend(from, "reRaffle", [id]);
    if (h) log(`re-raffled #${id}: winner ${r.winner} did not claim ${h}`);
  }
}

async function raffles(state, from) {
  const count = await client.readContract({ address: raffleAddress, abi: raffleAbi, functionName: "raffleCount" });
  for (let id = 1n; id <= count; id++) {
    if (finishedRaffles.has(id)) continue;
    try {
      await raffleStep(state, from, id);
    } catch (e) {
      log(`error on raffle #${id}:`, e instanceof Error ? e.message : e);
    }
  }
}

async function pass(state, from, canBuy) {
  await discover(state);
  log(`${state.tokens.length} coin(s), scanned to block ${state.scannedTo}`);
  spentHashes.clear();
  for (const token of state.tokens) {
    try {
      const h = await harvest(from, token);
      if (h) log(`harvested ${token} ${h}`);
      if (!canBuy) continue;
      // Keep buying while the budget covers a listing; mainnet is capped to stay gentle with OpenSea.
      for (let i = 0; i < (mainnet ? 3 : 20); i++) {
        const budget = await budgetOf(token);
        if (budget === 0n) break;
        const b = mainnet ? await buyMainnet(from, token, budget) : await buyTestnet(from, token, budget);
        if (!b) break;
        log(`bought NFT for ${token} ${b}`);
      }
    } catch (e) {
      log(`error on ${token}:`, e instanceof Error ? e.message : e);
    }
  }
  // After the coin loop, so an NFT bought in this pass already has its raffle.
  if (raffleAddress) await raffles(state, from);
}

async function main() {
  const from = await keeperAddress();
  log(`keeper ${from} -> vault ${vault} on chain ${chainIdRaw} via ${rpcUrl}`);
  const vaultKeeper = await client.readContract({ address: vault, abi: vaultAbi, functionName: "keeper" });
  const canBuy = vaultKeeper === zeroAddress || vaultKeeper.toLowerCase() === from.toLowerCase();
  if (!canBuy) log(`WARNING: FloorVault.keeper() is ${vaultKeeper}, not ${from}. Harvesting only; buys would revert.`);
  log(
    raffleAddress
      ? `raffle ${raffleAddress}: drawing, settling, finalizing and re-raffling automatically; winners still claim themselves`
      : "NEXT_PUBLIC_RAFFLE_ADDRESS not set: raffles will NOT be drawn (the coin page has no manual draw buttons)",
  );
  const state = loadState();
  do {
    try {
      await pass(state, from, canBuy);
    } catch (e) {
      log("pass failed:", e instanceof Error ? e.message : e);
    }
    if (!once) await new Promise((r) => setTimeout(r, intervalMs));
  } while (!once);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
