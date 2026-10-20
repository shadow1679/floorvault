import { after } from "next/server";
import { isAddress } from "viem";
import { configResult } from "@/lib/config";
import { stringifyBig } from "@/lib/serialize";
import { getServerHolders, holdersSettled } from "@/lib/serverHolders";
import { scanSettled } from "@/lib/serverScan";

// A coin's holder balances, kept and advanced on the server so browsers do not each walk the coin's
// Transfer logs in 100-block chunks. Route Handlers are dynamic by default; the state lives in module memory.
const headers = { "content-type": "application/json", "Cache-Control": "no-store" };

// On a serverless host the catch-up only runs while the function is alive: `after` keeps it going past the
// response, up to this many seconds.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!configResult.ok) {
    return Response.json({ error: "The app is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!isAddress(token, { strict: false })) {
    return Response.json({ error: "Pass ?token=<address>." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const holders = await getServerHolders(configResult.config, token);
  if (!holders) {
    return Response.json({ error: "Not a coin this vault launched." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const { config } = configResult;
  after(() => Promise.all([scanSettled(config), holdersSettled(token)]));
  return new Response(stringifyBig(holders), { headers });
}
