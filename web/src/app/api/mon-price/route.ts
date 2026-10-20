// MON in US dollars for market-cap display, proxied from CoinGecko so the browser makes no third-party call.
// Route Handlers are dynamic by default, so the cache lives in module memory.
const TTL_MS = 300_000;
let cached: { at: number; usd: number } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) return Response.json({ usd: cached.usd });
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd", {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`CoinGecko answered ${res.status}`);
    const usd = ((await res.json()) as { monad?: { usd?: number } }).monad?.usd;
    if (typeof usd !== "number" || !(usd > 0)) throw new Error("no rate");
    cached = { at: Date.now(), usd };
    return Response.json({ usd });
  } catch {
    // Serve the last good rate rather than dropping to MON on a rate limit.
    if (cached) return Response.json({ usd: cached.usd });
    return Response.json({ error: "No MON price available." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
