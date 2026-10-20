import { after } from "next/server";
import { configResult } from "@/lib/config";
import { stringifyBig } from "@/lib/serialize";
import { getServerScan, scanSettled } from "@/lib/serverScan";

// The vault's event scan, kept and advanced on the server so browsers do not each walk the chain in
// 100-block chunks. Route Handlers are dynamic by default; the scan state lives in module memory.
const headers = { "content-type": "application/json", "Cache-Control": "no-store" };

// On a serverless host the catch-up only runs while the function is alive: `after` keeps it going past the
// response, up to this many seconds.
export const maxDuration = 300;

export async function GET() {
  if (!configResult.ok) {
    return Response.json({ error: "The app is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const { config } = configResult;
  const scan = await getServerScan(config);
  after(() => scanSettled(config));
  return new Response(stringifyBig(scan), { headers });
}
