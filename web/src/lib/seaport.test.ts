import { execFileSync } from "node:child_process";
import { decodeAbiParameters } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  ADVANCED_ORDER_PARAM,
  SEAPORT_ADDRESS,
  advancedOrderFromFulfillment,
  checkOrder,
  createOpenSeaClient,
  encodeAdvancedOrder,
  fulfillmentRequestBody,
  normalizeParameters,
  selectCheapest,
} from "../../scripts/seaport.mjs";

// Shapes follow a live chog-genesis capture (addresses lowercase, numbers as decimal strings, itemType/orderType
// as numbers, signature null on listings, a non-zero conduitKey); hashes, salts and signatures are synthetic.
const CHOG = "0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763";
const OTHER = "0x00000000000000000000000000000000000000aa";
const SELLER = "0x445566795544c9bc72fa6175d2f1ddb3fb378159";
const ROYALTY = "0x84113421A8a564b594ee9Ae78c875310332d7023";
const FEE = "0x0000a26b00c1f0df003000390027140000faa719";
const ADAPTER = "0x2222222222222222222222222222222222222222";
const VAULT = "0x3333333333333333333333333333333333333333";
const ZERO = "0x0000000000000000000000000000000000000000";
const SIGNED_ZONE = "0x000056f7000000ece9003ca63978907a00ffd100";
const OPENSEA_CONDUIT_KEY = "0x61159fefdfada89302ed55f8b9e89e2d67d8258712b3a3f89aa88525877f1d5e";
const ZONE_HASH = "0x" + "00".repeat(32);
const NOW = 1_800_000_000;

type RawItem = { itemType: number; token: string; identifierOrCriteria: string; startAmount: string; endAmount: string; recipient?: string };

/**
 * An OpenSea-shaped Seaport order like today's chog-genesis listings: FULL_OPEN, no zone, OpenSea's conduit,
 * short-lived, and consideration of [seller, 1% OpenSea fee]. `royalty` adds a 5% creator-royalty item and
 * `restricted` makes it a signed-zone (FULL_RESTRICTED) order.
 */
function rawParameters(
  opts: { tokenId?: string; price?: bigint; collection?: string; offerer?: string; endTime?: number; orderType?: number; nativeOnly?: boolean; royalty?: boolean; restricted?: boolean } = {},
) {
  const price = opts.price ?? 100n * 10n ** 18n;
  const royalty = opts.royalty ? (price * 5n) / 100n : 0n;
  const fee = price / 100n;
  const net = price - royalty - fee;
  const native = (amount: bigint, recipient: string): RawItem => ({
    itemType: 0,
    token: ZERO,
    identifierOrCriteria: "0",
    startAmount: amount.toString(),
    endAmount: amount.toString(),
    recipient,
  });
  const consideration = [native(net, opts.offerer ?? SELLER)];
  if (opts.royalty) consideration.push(native(royalty, ROYALTY));
  consideration.push(native(fee, FEE));
  if (opts.nativeOnly === false) consideration[consideration.length - 1] = { ...consideration[consideration.length - 1], itemType: 1, token: OTHER };
  return {
    offerer: opts.offerer ?? SELLER,
    offer: [
      { itemType: 2, token: opts.collection ?? CHOG.toLowerCase(), identifierOrCriteria: opts.tokenId ?? "1931", startAmount: "1", endAmount: "1" },
    ],
    consideration,
    startTime: String(NOW - 1000),
    endTime: String(opts.endTime ?? NOW + 660),
    orderType: opts.orderType ?? (opts.restricted ? 2 : 0),
    zone: opts.restricted ? SIGNED_ZONE : ZERO,
    zoneHash: ZONE_HASH,
    salt: "0x3d958fe20000000000000000000000000000000000000000e8d0e092da686597",
    conduitKey: OPENSEA_CONDUIT_KEY,
    totalOriginalConsiderationItems: consideration.length,
    counter: "326935101837512439602452752092108937891",
  };
}

const SIG = "0x" + "ab".repeat(65);

function listing(hash: string, opts: Parameters<typeof rawParameters>[0] & { status?: string; chain?: string } = {}) {
  return {
    order_hash: hash,
    chain: opts.chain ?? "monad",
    protocol_address: SEAPORT_ADDRESS.toLowerCase(),
    price: { current: { currency: "MON", decimals: 18, value: String(opts.price ?? 100n * 10n ** 18n) } },
    // OpenSea sends signature: null in `best`; the signature only comes with the fulfillment data.
    protocol_data: { parameters: rawParameters(opts), signature: null },
    status: opts.status ?? "ACTIVE",
    remaining_quantity: 1,
    type: "basic",
  };
}

const ctx = { collection: CHOG, nowSec: NOW, exclude: [VAULT, ADAPTER] };
const norm = (opts?: Parameters<typeof rawParameters>[0]) => normalizeParameters(rawParameters(opts));

describe("checkOrder", () => {
  it("accepts one ERC-721 of the collection paid in native MON and totals every consideration item", () => {
    const r = checkOrder(norm(), ctx);
    expect(r).toEqual({ ok: true, total: 100n * 10n ** 18n, tokenId: 1931n });
  });

  it.each([
    ["another collection", { collection: OTHER }, "wrong collection"],
    ["a non-native consideration item", { nativeOnly: false }, "consideration is not all native MON"],
    ["an expired order", { endTime: NOW - 5 }, "expired or expiring"],
    ["an order about to expire", { endTime: NOW + 30 }, "expired or expiring"],
    ["a contract order", { orderType: 4 }, "unsupported order type"],
    ["our own contract as the seller", { offerer: VAULT }, "offerer is one of our own contracts"],
  ] as const)("rejects %s", (_name, opts, reason) => {
    const r = checkOrder(norm(opts), ctx);
    expect(r).toEqual({ ok: false, reason });
  });

  it("rejects an order that offers more than one item or an ERC-1155", () => {
    const two = norm();
    two.offer.push({ ...two.offer[0], identifierOrCriteria: 43n });
    expect(checkOrder(two, ctx).ok).toBe(false);
    const erc1155 = norm();
    erc1155.offer[0].itemType = 3;
    expect(checkOrder(erc1155, ctx)).toEqual({ ok: false, reason: "offer is not a plain ERC-721" });
  });

  it("uses the higher of start and end amount so a falling Dutch price is covered", () => {
    const p = norm();
    p.consideration[0].startAmount += 10n;
    expect(checkOrder(p, ctx)).toMatchObject({ ok: true, total: 100n * 10n ** 18n + 10n });
  });
});

describe("selectCheapest", () => {
  const budget = 150n * 10n ** 18n;
  const opts = { ...ctx, budget };

  it("returns the cheapest usable listing, whatever order the API lists them in", () => {
    const pick = selectCheapest(
      [listing("0xa", { price: 120n * 10n ** 18n, tokenId: "1" }), listing("0xb", { price: 90n * 10n ** 18n, tokenId: "2" }), listing("0xc", { price: 110n * 10n ** 18n, tokenId: "3" })],
      opts,
    );
    expect(pick).toMatchObject({ hash: "0xb", tokenId: 2n, total: 90n * 10n ** 18n, chain: "monad", protocolAddress: SEAPORT_ADDRESS.toLowerCase() });
  });

  it("skips listings that are over budget, inactive, for another collection, ours, non-native or already used", () => {
    const pick = selectCheapest(
      [
        listing("0x1", { price: 200n * 10n ** 18n }), // over budget
        listing("0x2", { price: 10n * 10n ** 18n, status: "CANCELLED" }),
        listing("0x3", { price: 11n * 10n ** 18n, collection: OTHER }),
        listing("0x4", { price: 12n * 10n ** 18n, offerer: VAULT }),
        listing("0x5", { price: 13n * 10n ** 18n, nativeOnly: false }),
        listing("0x6", { price: 14n * 10n ** 18n }), // used already
        listing("0x7", { price: 140n * 10n ** 18n }),
      ],
      { ...opts, skip: new Set(["0x6"]) },
    );
    expect(pick?.hash).toBe("0x7");
  });

  it("returns null when nothing is affordable or the list is empty", () => {
    expect(selectCheapest([listing("0x1", { price: 200n * 10n ** 18n })], opts)).toBeNull();
    expect(selectCheapest([], opts)).toBeNull();
    expect(selectCheapest(undefined, opts)).toBeNull();
  });

  it("ignores a listing without protocol data instead of throwing", () => {
    const bad = { ...listing("0x1"), protocol_data: undefined };
    expect(selectCheapest([bad], opts)).toBeNull();
  });

  it("selects listings whose signature is null, as every real `best` response has", () => {
    const l = listing("0x1");
    expect(l.protocol_data.signature).toBeNull();
    expect(selectCheapest([l], opts)?.hash).toBe("0x1");
  });

  it("accepts restricted (signed-zone) orders too; the zone data arrives with the fulfillment", () => {
    expect(selectCheapest([listing("0x1", { restricted: true })], opts)?.hash).toBe("0x1");
  });

  it("a three-item order with a creator royalty adds up to the full price", () => {
    const pick = selectCheapest([listing("0x1", { royalty: true })], opts)!;
    expect(pick.parameters.consideration).toHaveLength(3);
    expect(pick.total).toBe(100n * 10n ** 18n);
  });
});

const BASIC_FN = "fulfillBasicOrder_efficient_6GL6yc((address,uint256,uint256,address,address,address,uint256,uint256,uint8,uint256,uint256,bytes32,uint256,bytes32,bytes32,uint256,(uint256,address)[],bytes))";

/** OpenSea's fulfillment_data. Today's open orders come back as fulfillBasicOrder calldata (the default here). */
function fulfillment(listingParams: ReturnType<typeof rawParameters>, extraData = "0x" + "cd".repeat(100), fn = BASIC_FN) {
  return {
    protocol: "seaport",
    fulfillment_data: {
      orders: [{ parameters: listingParams, signature: SIG }],
      transaction: {
        function: fn,
        chain: 143,
        to: SEAPORT_ADDRESS.toLowerCase(),
        value: "100000000000000000000",
        value_hex: "0x56bc75e2d63100000",
        calldata_suffix: "0xcdb44011",
        input_data:
          fn.startsWith("fulfillAdvancedOrder")
            ? {
                advancedOrder: { parameters: listingParams, numerator: "1", denominator: "1", signature: SIG, extraData },
                criteriaResolvers: [],
                fulfillerConduitKey: "0x" + "00".repeat(32),
                recipient: ZERO,
              }
            : { parameters: {} },
      },
    },
  };
}

describe("advancedOrderFromFulfillment", () => {
  const pick = selectCheapest([listing("0xb")], { ...ctx, budget: 10n ** 21n })!;

  it("builds the AdvancedOrder from orders[0] when OpenSea answers with basic-order calldata (today's real case)", () => {
    const order = advancedOrderFromFulfillment(fulfillment(rawParameters()), pick);
    expect(order.numerator).toBe(1n);
    expect(order.denominator).toBe(1n);
    expect(order.signature).toBe(SIG);
    expect(order.extraData).toBe("0x");
    expect(order.parameters.offer[0].identifierOrCriteria).toBe(1931n);
    expect(order.parameters.conduitKey).toBe(OPENSEA_CONDUIT_KEY);
    expect(order.parameters.zone).toBe(ZERO);
    expect(order.parameters).not.toHaveProperty("counter"); // counter is not part of OrderParameters
  });

  it("takes the AdvancedOrder, including the signed-zone extraData, from input_data for restricted orders", () => {
    const restricted = fulfillment(rawParameters({ restricted: true }), "0x" + "cd".repeat(100), "fulfillAdvancedOrder((...))");
    const order = advancedOrderFromFulfillment(restricted, pick);
    expect(order.signature).toBe(SIG);
    expect(order.extraData).toBe("0x" + "cd".repeat(100));
    expect(order.parameters.zone.toLowerCase()).toBe(SIGNED_ZONE);
  });

  it("refuses a response for a different NFT than the listing we picked", () => {
    expect(() => advancedOrderFromFulfillment(fulfillment(rawParameters({ tokenId: "1932" })), pick)).toThrow(/different NFT/);
  });

  it("refuses a transaction that does not target Seaport 1.6 or has no order", () => {
    const wrongTo = fulfillment(rawParameters());
    wrongTo.fulfillment_data.transaction.to = OTHER;
    expect(() => advancedOrderFromFulfillment(wrongTo, pick)).toThrow(/not Seaport/);
    expect(() => advancedOrderFromFulfillment({ fulfillment_data: { transaction: { to: SEAPORT_ADDRESS, input_data: {} } } }, pick)).toThrow(/neither/);
    expect(() => advancedOrderFromFulfillment({}, pick)).toThrow(/no transaction/);
  });

  it("refuses a partial fill", () => {
    const partial = fulfillment(rawParameters({ restricted: true }), "0x", "fulfillAdvancedOrder((...))");
    partial.fulfillment_data.transaction.input_data.advancedOrder!.denominator = "2";
    expect(() => advancedOrderFromFulfillment(partial, pick)).toThrow(/partial/);
  });
});

describe("encodeAdvancedOrder", () => {
  const pick = selectCheapest([listing("0xb")], { ...ctx, budget: 10n ** 21n })!;
  const order = advancedOrderFromFulfillment(fulfillment(rawParameters()), pick);

  it("round-trips through the SeaportAdvancedOrder ABI the contract decodes", () => {
    const hex = encodeAdvancedOrder(order);
    type Item = { recipient: string; startAmount: bigint };
    const [decoded] = decodeAbiParameters([ADVANCED_ORDER_PARAM], hex) as unknown as [
      Omit<typeof order, "parameters"> & {
        parameters: Omit<typeof order.parameters, "consideration"> & { consideration: Item[] };
      },
    ];
    expect(decoded.parameters.offerer.toLowerCase()).toBe(SELLER);
    expect(decoded.parameters.offer[0].identifierOrCriteria).toBe(1931n);
    expect(decoded.parameters.offer[0].token).toBe(CHOG);
    expect(decoded.parameters.consideration.map((c) => c.recipient.toLowerCase())).toEqual([SELLER, FEE]);
    expect(decoded.parameters.consideration.reduce((s, c) => s + c.startAmount, 0n)).toBe(100n * 10n ** 18n);
    expect(decoded.parameters.totalOriginalConsiderationItems).toBe(2n);
    expect(decoded.numerator).toBe(1n);
    expect(decoded.signature).toBe(SIG);
    expect(decoded.extraData).toBe(order.extraData);
  });

  // The same bytes must decode with Solidity's layout for `abi.decode(data, (SeaportAdvancedOrder))`.
  // Skipped when Foundry's `cast` is not installed.
  const hasCast = (() => {
    try {
      execFileSync("cast", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!hasCast)("decodes with cast using the Solidity struct signature", () => {
    const sig =
      "f(((address,address,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[],uint8,uint256,uint256,bytes32,uint256,bytes32,uint256),uint120,uint120,bytes,bytes))";
    const out = execFileSync("cast", ["abi-decode", "--input", sig, encodeAdvancedOrder(order)], { encoding: "utf8" });
    expect(out.toLowerCase()).toContain(SELLER);
    expect(out.toLowerCase()).toContain(CHOG.toLowerCase());
    expect(out.toLowerCase()).toContain(order.extraData);
  });
});

describe("fulfillmentRequestBody", () => {
  it("asks for the adapter as fulfiller, because the zone signature commits to it", () => {
    const pick = selectCheapest([listing("0xb")], { ...ctx, budget: 10n ** 21n })!;
    expect(fulfillmentRequestBody(pick, ADAPTER)).toEqual({
      listing: { hash: "0xb", chain: "monad", protocol_address: SEAPORT_ADDRESS.toLowerCase() },
      fulfiller: { address: ADAPTER },
    });
  });
});

describe("createOpenSeaClient", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => "" }) as unknown as Response;
  const status = (code: number, headers: Record<string, string> = {}) =>
    ({ ok: false, status: code, text: async () => "slow down", headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } }) as unknown as Response;
  const fast = { sleep: async () => {}, minIntervalMs: 0 };

  it("requires an API key", () => {
    expect(() => createOpenSeaClient({ apiKey: "" })).toThrow(/OPENSEA_API_KEY/);
  });

  it("sends the key as X-API-KEY and unwraps the listings", async () => {
    const fetchImpl = vi.fn(async () => ok({ listings: [{ order_hash: "0x1" }], next: null }));
    const c = createOpenSeaClient({ apiKey: "secret", fetchImpl: fetchImpl as unknown as typeof fetch, ...fast });
    expect(await c.bestListings("chog-genesis", 5)).toEqual([{ order_hash: "0x1" }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.opensea.io/api/v2/listings/collection/chog-genesis/best?limit=5");
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("secret");
  });

  it("POSTs the fulfillment request as JSON", async () => {
    const fetchImpl = vi.fn(async () => ok({ fulfillment_data: {} }));
    const c = createOpenSeaClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch, ...fast });
    const pick = selectCheapest([listing("0xb")], { ...ctx, budget: 10n ** 21n })!;
    await c.fulfillmentData(pick, ADAPTER);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.opensea.io/api/v2/listings/fulfillment_data");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(fulfillmentRequestBody(pick, ADAPTER));
  });

  it("retries a 429 (honouring Retry-After) and gives up on 4xx with a message that omits the key", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi.fn().mockResolvedValueOnce(status(429, { "retry-after": "3" })).mockResolvedValueOnce(ok({ listings: [] }));
    const c = createOpenSeaClient({ apiKey: "secret", fetchImpl: fetchImpl as unknown as typeof fetch, minIntervalMs: 0, sleep: async (ms) => void sleeps.push(ms) });
    expect(await c.bestListings()).toEqual([]);
    expect(sleeps).toContain(3000);

    const denied = vi.fn(async () => status(401));
    const c2 = createOpenSeaClient({ apiKey: "secret", fetchImpl: denied as unknown as typeof fetch, ...fast });
    await expect(c2.bestListings()).rejects.toThrow(/answered 401/);
    await expect(c2.bestListings()).rejects.not.toThrow(/secret/);
    expect(denied).toHaveBeenCalledTimes(2); // not retried
  });

  it("spaces fulfillment_data calls by 13 s (OpenSea allows 5 a minute) but not reads", async () => {
    let t = 100_000;
    const waits: number[] = [];
    const c = createOpenSeaClient({
      apiKey: "k",
      fetchImpl: (async () => ok({ listings: [] })) as unknown as typeof fetch,
      minIntervalMs: 1000,
      now: () => t,
      sleep: async (ms) => {
        waits.push(ms);
        t += ms;
      },
    });
    const pick = selectCheapest([listing("0xb")], { ...ctx, budget: 10n ** 21n })!;
    await c.fulfillmentData(pick, ADAPTER);
    await c.bestListings(); // a read right after: only the 1 s read interval
    await c.fulfillmentData(pick, ADAPTER);
    expect(waits).toEqual([1000, 12_000]);
  });

  it("spaces requests by the minimum interval", async () => {
    let t = 10_000;
    const waits: number[] = [];
    const c = createOpenSeaClient({
      apiKey: "k",
      fetchImpl: (async () => ok({ listings: [] })) as unknown as typeof fetch,
      minIntervalMs: 1000,
      now: () => t,
      sleep: async (ms) => {
        waits.push(ms);
        t += ms;
      },
    });
    await c.bestListings();
    await c.bestListings();
    expect(waits).toEqual([1000]); // the first call ran immediately, the second waited out the interval
  });
});
