// Pure helpers the keeper uses to buy a CHOG listing through OpenSea / Seaport 1.6 (mainnet).
// Nothing here touches the chain or the keystore; the OpenSea client takes an injectable fetch so it is
// unit tested with fixtures (src/lib/seaport.test.ts). The response shapes follow OpenSea's API v2 reference:
//   GET  /api/v2/listings/collection/{slug}/best  -> { listings: [{ order_hash, chain, protocol_address,
//        price: { current: { currency, decimals, value } }, protocol_data: { parameters, signature: null },
//        status, remaining_quantity, asset }], next }
//        The signature is null here, so a listing alone cannot be fulfilled.
//   POST /api/v2/listings/fulfillment_data { listing: { hash, chain, protocol_address }, fulfiller: { address } }
//        -> { protocol, fulfillment_data: { orders: [{ parameters, signature }],
//             transaction: { function, chain, to, value, input_data } } }
//        Verified against live chog-genesis: for the open basic orders OpenSea lists today, `input_data` is
//        fulfillBasicOrder calldata, which we ignore; the AdvancedOrder is built from `orders[0]`
//        (parameters minus `counter`, plus the signature). For restricted (signed-zone) orders OpenSea would
//        send FulfillAdvancedOrder, whose `advancedOrder.extraData` carries the zone signature; that signature
//        commits to the fulfiller, so the fulfiller sent to OpenSea must be the SeaportAdapter (the address
//        that calls Seaport), not the keeper wallet.
// Real listings are short-lived (about 11 minutes) and rate limits are tight, so fetch the fulfillment,
// simulate and send in the same pass.

import { encodeAbiParameters, getAddress } from "viem";

export const SEAPORT_ADDRESS = "0x0000000000000068F116a894984e2DB1123eB395";
export const OPENSEA_API_URL = "https://api.opensea.io";
export const OPENSEA_COLLECTION_SLUG = "chog-genesis";
export const OPENSEA_CHAIN = "monad";

export const ITEM_NATIVE = 0;
export const ITEM_ERC721 = 2;
// Seaport OrderType: 0 FULL_OPEN, 1 PARTIAL_OPEN, 2 FULL_RESTRICTED, 3 PARTIAL_RESTRICTED, 4 CONTRACT.
const ORDER_TYPES_OK = new Set([0, 1, 2, 3]);

const offerItem = [
  { name: "itemType", type: "uint8" },
  { name: "token", type: "address" },
  { name: "identifierOrCriteria", type: "uint256" },
  { name: "startAmount", type: "uint256" },
  { name: "endAmount", type: "uint256" },
];
const considerationItem = [...offerItem, { name: "recipient", type: "address" }];

/** ABI of `SeaportAdvancedOrder` exactly as declared in contracts/src/SeaportAdapter.sol. */
export const ADVANCED_ORDER_PARAM = {
  type: "tuple",
  name: "order",
  components: [
    {
      type: "tuple",
      name: "parameters",
      components: [
        { name: "offerer", type: "address" },
        { name: "zone", type: "address" },
        { name: "offer", type: "tuple[]", components: offerItem },
        { name: "consideration", type: "tuple[]", components: considerationItem },
        { name: "orderType", type: "uint8" },
        { name: "startTime", type: "uint256" },
        { name: "endTime", type: "uint256" },
        { name: "zoneHash", type: "bytes32" },
        { name: "salt", type: "uint256" },
        { name: "conduitKey", type: "bytes32" },
        { name: "totalOriginalConsiderationItems", type: "uint256" },
      ],
    },
    { name: "numerator", type: "uint120" },
    { name: "denominator", type: "uint120" },
    { name: "signature", type: "bytes" },
    { name: "extraData", type: "bytes" },
  ],
};

const big = (v, what) => {
  try {
    return BigInt(v);
  } catch {
    throw new Error(`bad number for ${what}: ${String(v)}`);
  }
};
const num = (v, what) => Number(big(v, what));

/** Order parameters as OpenSea returns them (decimal strings) -> values viem can ABI-encode. */
export function normalizeParameters(p) {
  const item = (i, withRecipient) => ({
    itemType: num(i.itemType, "itemType"),
    token: getAddress(i.token),
    identifierOrCriteria: big(i.identifierOrCriteria, "identifierOrCriteria"),
    startAmount: big(i.startAmount, "startAmount"),
    endAmount: big(i.endAmount, "endAmount"),
    ...(withRecipient ? { recipient: getAddress(i.recipient) } : {}),
  });
  return {
    offerer: getAddress(p.offerer),
    zone: getAddress(p.zone),
    offer: p.offer.map((i) => item(i, false)),
    consideration: p.consideration.map((i) => item(i, true)),
    orderType: num(p.orderType, "orderType"),
    startTime: big(p.startTime, "startTime"),
    endTime: big(p.endTime, "endTime"),
    zoneHash: p.zoneHash,
    salt: big(p.salt, "salt"),
    conduitKey: p.conduitKey,
    totalOriginalConsiderationItems: big(p.totalOriginalConsiderationItems, "totalOriginalConsiderationItems"),
  };
}

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/**
 * Checks that an order sells exactly one ERC-721 of `collection`, is payable in native MON only, and is
 * live at `nowSec`. Returns `{ ok: true, total, tokenId }` where `total` is the most the buyer can be charged
 * (sale price plus fee and royalty items; max of start/end amount so a falling Dutch price is covered), or
 * `{ ok: false, reason }`.
 */
export function checkOrder(p, { collection, nowSec, exclude = /** @type {string[]} */ ([]) }) {
  if (!p || !Array.isArray(p.offer) || !Array.isArray(p.consideration)) return { ok: false, reason: "malformed order" };
  if (p.offer.length !== 1) return { ok: false, reason: "offer is not exactly one item" };
  const o = p.offer[0];
  if (o.itemType !== ITEM_ERC721) return { ok: false, reason: "offer is not a plain ERC-721" };
  if (!same(o.token, collection)) return { ok: false, reason: "wrong collection" };
  if (o.startAmount !== 1n || o.endAmount !== 1n) return { ok: false, reason: "offer amount is not 1" };
  if (p.consideration.length === 0) return { ok: false, reason: "no consideration" };
  if (p.consideration.some((c) => c.itemType !== ITEM_NATIVE)) return { ok: false, reason: "consideration is not all native MON" };
  if (!ORDER_TYPES_OK.has(p.orderType)) return { ok: false, reason: "unsupported order type" };
  if (BigInt(nowSec) < p.startTime) return { ok: false, reason: "not started" };
  // 60 s of margin so a listing does not expire between simulation and inclusion.
  if (BigInt(nowSec) + 60n >= p.endTime) return { ok: false, reason: "expired or expiring" };
  if (exclude.some((a) => same(a, p.offerer))) return { ok: false, reason: "offerer is one of our own contracts" };

  let total = 0n;
  for (const c of p.consideration) total += c.startAmount > c.endAmount ? c.startAmount : c.endAmount;
  if (total === 0n) return { ok: false, reason: "zero price" };
  return { ok: true, total, tokenId: o.identifierOrCriteria };
}

/**
 * The cheapest usable listing out of a `best` response that fits `budget`, or null.
 * `skip` is a Set of order hashes already bought (or failed) in this pass.
 * Returns `{ hash, chain, protocolAddress, parameters, total, tokenId }`.
 */
export function selectCheapest(
  listings,
  { collection, budget, nowSec, exclude = /** @type {string[]} */ ([]), skip = /** @type {Set<string>} */ (new Set()) },
) {
  const usable = [];
  for (const l of listings ?? []) {
    if (!l?.order_hash || skip.has(l.order_hash)) continue;
    if (l.status && l.status !== "ACTIVE") continue;
    if (l.remaining_quantity !== undefined && Number(l.remaining_quantity) < 1) continue;
    // protocol_data.signature is null in `best` responses: the signature comes with the fulfillment data.
    const raw = l.protocol_data?.parameters;
    if (!raw) continue;
    let parameters;
    try {
      parameters = normalizeParameters(raw);
    } catch {
      continue;
    }
    const check = checkOrder(parameters, { collection, nowSec, exclude });
    if (!check.ok || check.total > budget) continue;
    usable.push({
      hash: l.order_hash,
      chain: l.chain || OPENSEA_CHAIN,
      protocolAddress: l.protocol_address || SEAPORT_ADDRESS,
      parameters,
      total: check.total,
      tokenId: check.tokenId,
    });
  }
  usable.sort((a, b) => (a.total < b.total ? -1 : a.total > b.total ? 1 : 0));
  return usable[0] ?? null;
}

/**
 * Turns OpenSea's fulfillment_data response into the AdvancedOrder the adapter expects.
 * Prefers `transaction.input_data.advancedOrder` (carries the signed-zone extraData). When OpenSea answers
 * with another Seaport entry point (fulfillBasicOrder, fulfillOrder, ...) it builds a full-fill
 * AdvancedOrder from `fulfillment_data.orders[0]` with empty extraData, which only works for open orders;
 * the keeper's simulation rejects anything else.
 * Throws if the response is not for the listing we chose, so we never sign off on a different NFT.
 */
export function advancedOrderFromFulfillment(response, listing) {
  const fd = response?.fulfillment_data;
  const tx = fd?.transaction;
  if (!fd || !tx) throw new Error("fulfillment_data response has no transaction");
  if (tx.to && !same(tx.to, SEAPORT_ADDRESS)) throw new Error(`fulfillment targets ${tx.to}, not Seaport 1.6`);

  const adv = tx.input_data?.advancedOrder;
  let order;
  if (adv?.parameters) {
    order = {
      parameters: normalizeParameters(adv.parameters),
      numerator: big(adv.numerator ?? 1, "numerator"),
      denominator: big(adv.denominator ?? 1, "denominator"),
      signature: adv.signature,
      extraData: adv.extraData || "0x",
    };
  } else if (fd.orders?.[0]?.parameters) {
    order = {
      parameters: normalizeParameters(fd.orders[0].parameters),
      numerator: 1n,
      denominator: 1n,
      signature: fd.orders[0].signature,
      extraData: "0x",
    };
  } else {
    throw new Error("fulfillment_data has neither an advancedOrder nor orders[0]");
  }

  if (order.numerator !== order.denominator) throw new Error("fulfillment is a partial fill");
  const a = order.parameters.offer[0];
  const b = listing.parameters.offer[0];
  if (order.parameters.offer.length !== 1 || !same(a.token, b.token) || a.identifierOrCriteria !== b.identifierOrCriteria) {
    throw new Error("fulfillment_data is for a different NFT than the listing we picked");
  }
  return order;
}

/** `abi.encode(SeaportAdvancedOrder)`: the `data` argument of FloorVault.buy. */
export function encodeAdvancedOrder(order) {
  return encodeAbiParameters([ADVANCED_ORDER_PARAM], [order]);
}

/** Request body for POST /api/v2/listings/fulfillment_data. `fulfiller` is the SeaportAdapter. */
export function fulfillmentRequestBody(listing, fulfiller) {
  return {
    listing: { hash: listing.hash, chain: listing.chain, protocol_address: listing.protocolAddress },
    fulfiller: { address: fulfiller },
  };
}

/**
 * Minimal OpenSea API client: one request at a time, at least `minIntervalMs` apart, retrying 429s and
 * 5xx responses with backoff (honouring Retry-After). The key goes in X-API-KEY and is never logged.
 */
export function createOpenSeaClient({
  apiKey,
  fetchImpl = fetch,
  baseUrl = OPENSEA_API_URL,
  minIntervalMs = 1100,
  // OpenSea allows 5 fulfillment_data calls a minute on this key (reads 600/h), so space those out.
  fulfillmentIntervalMs = 13_000,
  maxAttempts = 4,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
}) {
  if (!apiKey) throw new Error("OPENSEA_API_KEY is required");
  let last = 0;
  let lastFulfillment = 0;
  let chain = Promise.resolve();

  async function once(path, init) {
    const isFulfillment = path.startsWith("/api/v2/listings/fulfillment_data");
    const wait = Math.max(last + minIntervalMs - now(), isFulfillment ? lastFulfillment + fulfillmentIntervalMs - now() : 0);
    if (wait > 0) await sleep(wait);
    last = now();
    if (isFulfillment) lastFulfillment = last;
    return fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { accept: "application/json", "X-API-KEY": apiKey, ...(init?.headers ?? {}) },
    });
  }

  async function request(path, init) {
    let delay = 2000;
    for (let attempt = 1; ; attempt++) {
      const res = await once(path, init);
      if (res.ok) return res.json();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= maxAttempts) {
        const text = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(`OpenSea ${path.split("?")[0]} answered ${res.status}${text ? `: ${text}` : ""}`);
      }
      const retryAfter = Number(res.headers?.get?.("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay);
      delay *= 2;
    }
  }

  // Serialise calls so concurrent callers still respect the interval.
  const queued = (path, init) => {
    const run = chain.then(() => request(path, init));
    chain = run.catch(() => {});
    return run;
  };

  return {
    /** Cheapest active listings of the collection, ascending by price. */
    bestListings: (slug = OPENSEA_COLLECTION_SLUG, limit = 20) =>
      queued(`/api/v2/listings/collection/${slug}/best?limit=${limit}`).then((b) => b?.listings ?? []),
    fulfillmentData: (listing, fulfiller) =>
      queued("/api/v2/listings/fulfillment_data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fulfillmentRequestBody(listing, fulfiller)),
      }),
  };
}
