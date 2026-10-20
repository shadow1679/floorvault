// Shared OpenSea bits for the mainnet floor price. The API key is a server-side secret: only the
// route handler at /api/floor talks to OpenSea, the browser talks to that route.

export const OPENSEA_API_URL = "https://api.opensea.io";
/** OpenSea collection slug of Chog Genesis (the only mainnet collection). */
export const OPENSEA_COLLECTION_SLUG = "chog-genesis";

/** What /api/floor returns. `floor` is wei as a decimal string, null when nothing is listed. */
export type FloorResponse = { configured: boolean; floor: string | null; tokenId: string | null };

type BestListing = {
  price?: { current?: { value?: unknown; decimals?: unknown } };
  asset?: { identifier?: unknown } | null;
  protocol_data?: { parameters?: { offer?: Array<{ itemType?: unknown; identifierOrCriteria?: unknown }> } };
};

/**
 * Cheapest listing out of a `GET /api/v2/listings/collection/{slug}/best?limit=1` body
 * (`{ listings: [{ price: { current: { currency, decimals, value } }, asset, protocol_data }], next }`).
 * Returns null when there are no listings; throws when the body is not in the expected shape or the
 * price is not an 18-decimal amount (a non-MON listing would be mispriced).
 */
export function parseBestListing(body: unknown): { floor: string; tokenId: string | null } | null {
  const listings = (body as { listings?: unknown } | null)?.listings;
  if (!Array.isArray(listings)) throw new Error("Unexpected OpenSea response: no listings array.");
  const first = listings[0] as BestListing | undefined;
  if (!first) return null;

  const value = first.price?.current?.value;
  const decimals = first.price?.current?.decimals;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error("Unexpected OpenSea response: bad price.");
  if (decimals !== 18) throw new Error("Unexpected OpenSea response: price is not in an 18-decimal currency.");

  const identifier = first.asset?.identifier ?? first.protocol_data?.parameters?.offer?.[0]?.identifierOrCriteria;
  const tokenId = typeof identifier === "string" && /^\d+$/.test(identifier) ? identifier : null;
  return { floor: value, tokenId };
}
