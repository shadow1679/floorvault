import { createPublicClient, parseAbiItem, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { hypersyncTransport, isHyperSyncUrl, splitHyperSyncUrl, toRpcLog, toSelection } from "../../scripts/hypersync.mjs";

const TOKEN = "11111111-2222-3333-4444-555555555555";
const URL_ = `https://monad-testnet.hypersync.xyz/${TOKEN}`;
const A = "0x1fb9c2a2de5d1c3822f849dcf6c3238940103b20";
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (a: string) => `0x${a.slice(2).padStart(64, "0")}`;

type Page = { data: { logs: Record<string, unknown>[] }[]; next_block: number; archive_height: number };
const transferLog = (block: number, from: string, to: string, value: bigint) => ({
  block_number: block,
  block_hash: `0x${"b".repeat(64)}`,
  log_index: 3,
  transaction_index: 1,
  transaction_hash: `0x${"c".repeat(64)}`,
  address: A,
  data: `0x${value.toString(16).padStart(64, "0")}`,
  topic0: TRANSFER_TOPIC,
  topic1: pad(from),
  topic2: pad(to),
});

function fakeFetch(pages: Page[], height = 500) {
  const calls: { url: string; auth: string | null; body: unknown }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ url, auth: headers.authorization ?? null, body: init.body ? JSON.parse(init.body as string) : undefined });
    if (url.endsWith("/height")) return Response.json({ height });
    return Response.json(pages.shift());
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const clientOver = (fetchImpl: typeof fetch) =>
  createPublicClient({ transport: hypersyncTransport(URL_, { fetchImpl }) }) as unknown as PublicClient;

describe("hypersync URL helpers", () => {
  it("tells HyperSync from HyperRPC and splits off the token", () => {
    expect(isHyperSyncUrl(URL_)).toBe(true);
    expect(isHyperSyncUrl(`https://monad-testnet.rpc.hypersync.xyz/${TOKEN}`)).toBe(false);
    expect(isHyperSyncUrl("https://rpc.example/abc")).toBe(false);
    expect(isHyperSyncUrl("not a url")).toBe(false);
    expect(splitHyperSyncUrl(URL_)).toEqual({ base: "https://monad-testnet.hypersync.xyz", token: TOKEN });
  });

  it("turns an RPC filter into a log selection, dropping trailing wildcards", () => {
    expect(toSelection({ address: [A], topics: [[TRANSFER_TOPIC, "0xaa"], null, null] })).toEqual({
      address: [A],
      topics: [[TRANSFER_TOPIC, "0xaa"]],
    });
    expect(toSelection({ address: A, topics: [TRANSFER_TOPIC, null, "0xbb"] })).toEqual({
      address: [A],
      topics: [[TRANSFER_TOPIC], [], ["0xbb"]],
    });
    expect(toSelection({})).toEqual({});
  });

  it("shapes a HyperSync log like an eth_getLogs entry", () => {
    const rpc = toRpcLog(transferLog(255, A, A, 1n));
    expect(rpc.blockNumber).toBe("0xff");
    expect(rpc.logIndex).toBe("0x3");
    expect(rpc.topics).toHaveLength(3);
  });
});

describe("hypersyncTransport", () => {
  it("answers getBlockNumber from /height with the bearer token", async () => {
    const { fetchImpl, calls } = fakeFetch([], 72_017_553);
    expect(await clientOver(fetchImpl).getBlockNumber()).toBe(72_017_553n);
    expect(calls[0].url).toBe("https://monad-testnet.hypersync.xyz/height");
    expect(calls[0].auth).toBe(`Bearer ${TOKEN}`);
  });

  it("pages through /query until the range is covered and decodes the logs", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { data: [{ logs: [transferLog(120, A, A, 5n)] }], next_block: 300, archive_height: 500 },
      { data: [{ logs: [transferLog(310, A, A, 7n)] }], next_block: 401, archive_height: 500 },
    ]);
    const logs = await clientOver(fetchImpl).getLogs({ address: A, event: TRANSFER, fromBlock: 100n, toBlock: 400n });
    expect(logs.map((l) => l.args.value)).toEqual([5n, 7n]);
    expect(logs.map((l) => l.blockNumber)).toEqual([120n, 310n]);
    const queries = calls.map((c) => c.body as { from_block: number; to_block: number });
    expect(queries.map((q) => [q.from_block, q.to_block])).toEqual([
      [100, 401], // to_block is exclusive
      [300, 401],
    ]);
  });

  it("stops at what is indexed when the range reaches past the archive height", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { data: [{ logs: [transferLog(120, A, A, 5n)] }], next_block: 451, archive_height: 450 },
      { data: [], next_block: 451, archive_height: 450 },
    ]);
    const logs = await clientOver(fetchImpl).getLogs({ address: A, event: TRANSFER, fromBlock: 100n, toBlock: 9_999n });
    expect(logs).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("fails with a message that does not contain the token", async () => {
    const fetchImpl = (async () => new Response(`bad token ${TOKEN}`, { status: 403 })) as unknown as typeof fetch;
    const err = await clientOver(fetchImpl).getBlockNumber().catch((e: Error) => e);
    expect(JSON.stringify([(err as Error).message, (err as Error).stack])).not.toContain(TOKEN);
    expect((err as Error).message).toContain("403");
  });
});
