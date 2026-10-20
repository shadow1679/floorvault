// A fake Monad testnet JSON-RPC endpoint. The app reads the chain from the browser (viem over http), so
// answering those requests with page.route() lets the real UI run against a chain we fully control.
import type { Page, Route } from "@playwright/test";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  multicall3Abi,
  parseAbiItem,
  toHex,
  zeroHash,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";
import { erc721MetadataAbi } from "../../src/abi/erc20";
import { floorVaultAbi } from "../../src/abi/FloorVault";
import { buildTokenUri } from "../../src/lib/metadata";
import { ADDR, HEAD_BLOCK, RPC_URL, TX } from "./env";

export type CoinFixture = {
  token: Address;
  creator: Address;
  collection: Address;
  recipient: Address;
  name: string;
  symbol: string;
  /** WMON budget in wei. */
  budget: bigint;
  block: bigint;
  txHash: Hex;
};

export type BoughtFixture = {
  token: Address;
  collection: Address;
  tokenId: bigint;
  price: bigint;
  to: Address;
  block: bigint;
  txHash: Hex;
};

export type ChainFixture = {
  head: bigint;
  coins: CoinFixture[];
  bought: BoughtFixture[];
  collectionName: string;
  /** Addresses that are not NFT contracts: every call to them reverts. */
  plainAddresses: Address[];
  /** While true every RPC call fails with HTTP 500, like a busy public node. */
  down: boolean;
  /** The launch transaction the stub wallet "sends": its receipt appears once the app asks for it. */
  pendingLaunch?: CoinFixture;
  /** Every JSON-RPC method the app called, in order. */
  calls: string[];
};

export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

export function emptyChain(): ChainFixture {
  return {
    head: HEAD_BLOCK,
    coins: [],
    bought: [],
    collectionName: "Test CHOG",
    plainAddresses: [ADDR.stranger],
    down: false,
    calls: [],
  };
}

export const demoCoin: CoinFixture = {
  token: ADDR.coin,
  creator: ADDR.wallet,
  collection: ADDR.testChog,
  recipient: ADDR.wallet,
  name: "Chog Floor Fund",
  symbol: "CFF",
  budget: 2_500_000_000_000_000_000n,
  block: 1010n,
  txHash: TX.launchedCoin,
};

export const demoBought: BoughtFixture = {
  token: ADDR.coin,
  collection: ADDR.testChog,
  tokenId: 7n,
  price: 1_250_000_000_000_000_000n,
  to: ADDR.wallet,
  block: 1020n,
  txHash: TX.bought,
};

/** A chain with one launched coin that has bought one NFT. */
export function demoChain(): ChainFixture {
  return { ...emptyChain(), coins: [{ ...demoCoin }], bought: [{ ...demoBought }] };
}

// ---- Encoding helpers -----------------------------------------------------------------------

const launchedEvent = parseAbiItem(
  "event Launched(address indexed token, address indexed creator, address indexed collection, address nftRecipient)",
);
const boughtEvent = parseAbiItem(
  "event Bought(address indexed token, address indexed collection, uint256 tokenId, uint256 price, address to)",
);

const blockHash = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`;

function eventLog(event: AbiEvent, args: Record<string, unknown>, meta: { block: bigint; txHash: Hex; logIndex: number }) {
  const topics = encodeEventTopics({ abi: [event], eventName: event.name, args } as never);
  const plain = event.inputs.filter((i) => !i.indexed);
  const data = plain.length ? encodeAbiParameters(plain, plain.map((i) => args[i.name as string]) as never) : "0x";
  return {
    address: ADDR.floorVault,
    topics,
    data,
    blockNumber: toHex(meta.block),
    blockHash: blockHash(meta.block),
    transactionHash: meta.txHash,
    transactionIndex: "0x0",
    logIndex: toHex(meta.logIndex),
    removed: false,
  };
}

function launchedLog(c: CoinFixture) {
  const args = { token: c.token, creator: c.creator, collection: c.collection, nftRecipient: c.recipient };
  return eventLog(launchedEvent, args, { block: c.block, txHash: c.txHash, logIndex: 0 });
}

function boughtLog(b: BoughtFixture) {
  const args = { token: b.token, collection: b.collection, tokenId: b.tokenId, price: b.price, to: b.to };
  return eventLog(boughtEvent, args, { block: b.block, txHash: b.txHash, logIndex: 1 });
}

function launchInput(c: CoinFixture): Hex {
  return encodeFunctionData({
    abi: floorVaultAbi,
    functionName: "launch",
    args: [
      {
        name: c.name,
        symbol: c.symbol,
        tokenURI: buildTokenUri({ name: c.name, symbol: c.symbol }),
        creatorFeeRate: 100,
        salt: zeroHash,
        deadline: 0n,
        collection: c.collection,
        nftRecipient: c.recipient,
        devBuy: 0n,
      },
    ],
  });
}

function transaction(c: CoinFixture) {
  return {
    hash: c.txHash,
    nonce: "0x1",
    blockHash: blockHash(c.block),
    blockNumber: toHex(c.block),
    transactionIndex: "0x0",
    from: c.creator,
    to: ADDR.floorVault,
    value: "0x0",
    gas: "0x30d40",
    gasPrice: "0x1",
    input: launchInput(c),
    type: "0x0",
    chainId: "0x27a7",
    v: "0x1b",
    r: "0x1",
    s: "0x1",
  };
}

// ---- Contract calls -------------------------------------------------------------------------

class Revert extends Error {}

function ethCall(fx: ChainFixture, to: Address, data: Hex): Hex {
  const target = to.toLowerCase();

  if (target === MULTICALL3.toLowerCase()) {
    const { args } = decodeFunctionData({ abi: multicall3Abi, data });
    const calls = args[0] as readonly { target: Address; callData: Hex }[];
    const result = calls.map((c) => {
      try {
        return { success: true, returnData: ethCall(fx, c.target, c.callData) };
      } catch {
        return { success: false, returnData: "0x" as Hex };
      }
    });
    return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result });
  }

  if (target === ADDR.floorVault.toLowerCase()) {
    const call = decodeFunctionData({ abi: floorVaultAbi, data });
    const known = [...fx.coins, ...(fx.pendingLaunch ? [fx.pendingLaunch] : [])];
    if (call.functionName === "pairings") {
      const coin = known.find((c) => c.token.toLowerCase() === (call.args[0] as string).toLowerCase());
      if (!coin) throw new Revert();
      return encodeFunctionResult({
        abi: floorVaultAbi,
        functionName: "pairings",
        result: [coin.collection, coin.recipient, coin.budget],
      } as never);
    }
    if (call.functionName === "launch" && fx.pendingLaunch) {
      return encodeFunctionResult({ abi: floorVaultAbi, functionName: "launch", result: fx.pendingLaunch.token });
    }
    throw new Revert();
  }

  if (fx.plainAddresses.some((a) => a.toLowerCase() === target)) throw new Revert();

  // Any other address is treated as an ERC-721 collection that only knows its name.
  const call = decodeFunctionData({ abi: erc721MetadataAbi, data });
  if (call.functionName === "name") {
    return encodeFunctionResult({ abi: erc721MetadataAbi, functionName: "name", result: fx.collectionName });
  }
  throw new Revert();
}

function receipt(c: CoinFixture, head: bigint) {
  return {
    transactionHash: c.txHash,
    transactionIndex: "0x0",
    blockHash: blockHash(head),
    blockNumber: toHex(head),
    from: c.creator,
    to: ADDR.floorVault,
    cumulativeGasUsed: "0x30d40",
    gasUsed: "0x30d40",
    effectiveGasPrice: "0x1",
    contractAddress: null,
    logsBloom: `0x${"0".repeat(512)}`,
    status: "0x1",
    type: "0x0",
    logs: [launchedLog({ ...c, block: head })],
  };
}

function handle(fx: ChainFixture, method: string, params: unknown[]): unknown {
  fx.calls.push(method);
  switch (method) {
    case "eth_chainId":
      return "0x27a7";
    case "net_version":
      return "10143";
    case "eth_blockNumber":
      return toHex(fx.head);
    case "eth_gasPrice":
    case "eth_maxPriorityFeePerGas":
      return "0x1";
    case "eth_getBlockByNumber": {
      const tag = params[0] as string;
      const n = tag === "latest" || tag === "pending" || tag === "finalized" || tag === "safe" ? fx.head : BigInt(tag);
      return {
        number: toHex(n),
        hash: blockHash(n),
        parentHash: blockHash(n - 1n),
        timestamp: toHex(1_700_000_000n + n),
        nonce: "0x0000000000000000",
        miner: ADDR.stranger,
        gasLimit: "0x1c9c380",
        gasUsed: "0x0",
        transactions: [],
        baseFeePerGas: "0x1",
      };
    }
    case "eth_getLogs": {
      const filter = params[0] as { fromBlock: Hex; toBlock: Hex };
      const from = BigInt(filter.fromBlock);
      const to = BigInt(filter.toBlock);
      const inRange = (n: bigint) => n >= from && n <= to;
      return [
        ...fx.coins.filter((c) => inRange(c.block)).map(launchedLog),
        ...fx.bought.filter((b) => inRange(b.block)).map(boughtLog),
      ];
    }
    case "eth_getTransactionByHash": {
      const hash = (params[0] as string).toLowerCase();
      const coin = [...fx.coins, ...(fx.pendingLaunch ? [fx.pendingLaunch] : [])].find((c) => c.txHash.toLowerCase() === hash);
      return coin ? transaction(coin) : null;
    }
    case "eth_getTransactionReceipt": {
      const hash = (params[0] as string).toLowerCase();
      const pending = fx.pendingLaunch;
      return pending && pending.txHash.toLowerCase() === hash ? receipt(pending, fx.head) : null;
    }
    case "eth_call": {
      const tx = params[0] as { to: Address; data?: Hex; input?: Hex };
      return ethCall(fx, tx.to, (tx.data ?? tx.input ?? "0x") as Hex);
    }
    default:
      throw Object.assign(new Error(`Method ${method} is not mocked`), { code: -32601 });
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "POST, OPTIONS",
};

async function fulfillRpc(route: Route, fx: ChainFixture) {
  const request = route.request();
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
  if (fx.down) return route.fulfill({ status: 500, headers: CORS, body: "node is busy" });

  const answer = (msg: { id: number; method: string; params?: unknown[] }) => {
    try {
      return { jsonrpc: "2.0", id: msg.id, result: handle(fx, msg.method, msg.params ?? []) };
    } catch (e) {
      if (e instanceof Revert) return { jsonrpc: "2.0", id: msg.id, error: { code: 3, message: "execution reverted", data: "0x" } };
      const code = (e as { code?: number }).code ?? -32603;
      return { jsonrpc: "2.0", id: msg.id, error: { code, message: (e as Error).message } };
    }
  };
  const body = request.postDataJSON();
  const payload = Array.isArray(body) ? body.map(answer) : answer(body);
  return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(payload) });
}

/** Serve the fixture as the app's RPC endpoint. The fixture can be changed while the page is open. */
export async function mockChain(page: Page, fx: ChainFixture) {
  await page.route(new RegExp(`^${RPC_URL.replace(/[.]/g, "\\.")}/?(\\?.*)?$`), (route) => fulfillRpc(route, fx));
}
