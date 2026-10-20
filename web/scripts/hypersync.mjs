// Envio HyperSync as a viem transport, for the log scans only (server and keeper, never the browser).
// HyperSync is not JSON-RPC: it has its own `POST /query` with a bearer token, but it reads a whole history
// in a few calls where the public RPC needs a call per 100 blocks. This adapter answers the two methods the
// scans use, `eth_blockNumber` and `eth_getLogs`, so the scan code stays the same for every provider.
// The URL carries the token as its path, like HyperRPC's: https://monad-testnet.hypersync.xyz/<api-token>.
// Pure and dependency-free apart from viem's `custom`, so the keeper and the web app share it.
import { custom } from "viem";

const toHex = (n) => `0x${BigInt(n).toString(16)}`;
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** HyperSync's own host (`*.hypersync.xyz`), as opposed to HyperRPC (`*.rpc.hypersync.xyz`) which speaks JSON-RPC. */
export function isHyperSyncUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host.endsWith(".hypersync.xyz") && !host.endsWith(".rpc.hypersync.xyz");
  } catch {
    return false;
  }
}

/** Split `https://host/<token>` into the endpoint and the token. */
export function splitHyperSyncUrl(url) {
  const u = new URL(url);
  const token = u.pathname.replace(/^\/+|\/+$/g, "");
  return { base: u.origin, token };
}

/** One RPC filter as a HyperSync log selection. Topics are `[position0, position1, ...]`, each null, one hash or a list. */
export function toSelection(filter) {
  const selection = {};
  const address = asList(filter.address);
  if (address.length) selection.address = address;
  const topics = (filter.topics ?? []).map(asList);
  while (topics.length && topics[topics.length - 1].length === 0) topics.pop();
  if (topics.length) selection.topics = topics;
  return selection;
}

/** A HyperSync log in the shape of an `eth_getLogs` entry, which is what viem decodes. */
export function toRpcLog(l) {
  const topics = [l.topic0, l.topic1, l.topic2, l.topic3].filter((t) => typeof t === "string");
  return {
    address: l.address,
    blockHash: l.block_hash,
    blockNumber: toHex(l.block_number),
    data: l.data ?? "0x",
    logIndex: toHex(l.log_index),
    removed: false,
    topics,
    transactionHash: l.transaction_hash,
    transactionIndex: toHex(l.transaction_index),
  };
}

const LOG_FIELDS = [
  "block_number",
  "block_hash",
  "log_index",
  "transaction_index",
  "transaction_hash",
  "address",
  "data",
  "topic0",
  "topic1",
  "topic2",
  "topic3",
];

/**
 * A viem transport over HyperSync. `eth_getLogs` pages through `/query` until the range is covered. Errors
 * never carry the token: the URL is not part of any message built here, and response bodies are scrubbed.
 */
export function hypersyncTransport(url, { timeout = 120_000, fetchImpl = fetch } = {}) {
  const { base, token } = splitHyperSyncUrl(url);
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };

  async function call(path, init) {
    const res = await fetchImpl(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 200).split(token).join("<token>");
      throw new Error(`HyperSync ${path} answered ${res.status}${body ? `: ${body}` : ""}`);
    }
    return res.json();
  }

  async function getLogs(filter) {
    const from = BigInt(filter.fromBlock);
    const to = BigInt(filter.toBlock);
    const out = [];
    let cursor = from;
    while (cursor <= to) {
      const page = await call("/query", {
        method: "POST",
        body: JSON.stringify({
          from_block: Number(cursor),
          to_block: Number(to + 1n), // exclusive
          logs: [toSelection(filter)],
          field_selection: { log: LOG_FIELDS },
        }),
      });
      for (const batch of page.data ?? []) for (const l of batch.logs ?? []) out.push(toRpcLog(l));
      const next = BigInt(page.next_block);
      if (next > cursor) cursor = next;
      else if (BigInt(page.archive_height ?? 0) < to) break; // the range reaches past what is indexed: that is all there is
      else throw new Error("HyperSync made no progress");
    }
    return out;
  }

  return custom({
    async request({ method, params }) {
      if (method === "eth_blockNumber") return toHex((await call("/height", { method: "GET" })).height);
      if (method === "eth_getLogs") return getLogs(params[0]);
      throw new Error(`HyperSync transport does not serve ${method}`);
    },
  });
}
