import { GT_API_URL, GT_LIMIT, GT_NETWORK, parseOhlcv, parseTopPool } from "@/lib/geckoterminal";
import type { Candle } from "@/lib/trades";

// Proxies GeckoTerminal's pool lookup and OHLCV for one token, in USD, with module-memory caches so many
// readers share its ~30 calls a minute. Route Handlers are dynamic by default.
const POOL_TTL_MS = 600_000;
const NO_POOL_TTL_MS = 60_000;
const CANDLE_TTL_MS = 30_000;

const pools = new Map<string, { at: number; pool: string | null }>();
const candles = new Map<string, { at: number; candles: Candle[] }>();

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TIMEFRAMES = new Set(["minute", "hour", "day"]);

async function gt(path: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${GT_API_URL}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  if (res.status === 404) return { status: 404, json: null };
  if (!res.ok) throw new Error(`GeckoTerminal answered ${res.status}`);
  return { status: res.status, json: await res.json() };
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const token = (q.get("token") ?? "").toLowerCase();
  const timeframe = q.get("timeframe") ?? "";
  const aggregate = Number(q.get("aggregate"));
  if (!ADDRESS.test(token) || !TIMEFRAMES.has(timeframe) || !Number.isInteger(aggregate) || aggregate < 1 || aggregate > 12) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const key = `${token}:${timeframe}:${aggregate}`;
  const hit = candles.get(key);
  if (hit && Date.now() - hit.at < CANDLE_TTL_MS) return Response.json({ candles: hit.candles });

  try {
    let entry = pools.get(token);
    if (!entry || Date.now() - entry.at > (entry.pool ? POOL_TTL_MS : NO_POOL_TTL_MS)) {
      const r = await gt(`/networks/${GT_NETWORK}/tokens/${token}/pools?page=1`);
      entry = { at: Date.now(), pool: r.status === 404 ? null : parseTopPool(r.json) };
      pools.set(token, entry);
    }
    if (!entry.pool) return Response.json({ candles: [] });

    // USD price of the coin. Pools are mostly quoted in WMON or USDC, so USD is the one common unit.
    const r = await gt(
      `/networks/${GT_NETWORK}/pools/${entry.pool}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${GT_LIMIT}&currency=usd&token=base`,
    );
    const out = r.status === 404 ? [] : parseOhlcv(r.json);
    candles.set(key, { at: Date.now(), candles: out });
    return Response.json({ candles: out });
  } catch {
    // Serve the last good candles rather than dropping to another source on a rate limit.
    if (hit) return Response.json({ candles: hit.candles });
    return Response.json({ error: "Could not read GeckoTerminal." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
