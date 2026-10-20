import { OPENSEA_API_URL, OPENSEA_COLLECTION_SLUG, parseBestListing, type FloorResponse } from "@/lib/opensea";

// Mainnet floor price of the CHOG collection, proxied from OpenSea so the API key stays on the server.
// Route Handlers are dynamic by default, so the 60 s cache lives in module memory.
const TTL_MS = 60_000;
let cached: { at: number; body: FloorResponse } | null = null;

const headers = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" };

export async function GET() {
  const key = (process.env.OPENSEA_API_KEY ?? "").trim();
  if (!key) {
    const body: FloorResponse = { configured: false, floor: null, tokenId: null };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  }
  if (cached && Date.now() - cached.at < TTL_MS) return Response.json(cached.body, { headers });

  try {
    const res = await fetch(
      `${OPENSEA_API_URL}/api/v2/listings/collection/${OPENSEA_COLLECTION_SLUG}/best?limit=1`,
      { headers: { "X-API-KEY": key, accept: "application/json" }, signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) throw new Error(`OpenSea answered ${res.status}`);
    const best = parseBestListing(await res.json());
    const body: FloorResponse = { configured: true, floor: best?.floor ?? null, tokenId: best?.tokenId ?? null };
    cached = { at: Date.now(), body };
    return Response.json(body, { headers });
  } catch {
    // Serve the last good value rather than flickering to "n/a" on a rate limit or timeout.
    if (cached) return Response.json(cached.body, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ error: "Could not read the floor from OpenSea." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
