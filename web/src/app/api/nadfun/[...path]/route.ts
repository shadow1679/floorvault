import { NADFUN_API_URL } from "@/lib/constants";

// Forwards the browser's nad.fun API calls (image and metadata upload, salt mining, chart) to NADFUN_API_URL.
// The testnet dev API only allows `localhost` origins, so a deployed site cannot call it from the browser.
// Only the paths the app uses are forwarded. Route Handlers are dynamic by default.
const ALLOWED: { method: string; path: RegExp }[] = [
  { method: "POST", path: /^metadata\/(image|metadata)$/ },
  { method: "POST", path: /^token\/salt$/ },
  { method: "GET", path: /^trade\/chart\/0x[0-9a-fA-F]{40}$/ },
];
const TIMEOUT_MS = 30_000;

async function forward(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join("/");
  if (!ALLOWED.some((a) => a.method === req.method && a.path.test(path))) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const search = new URL(req.url).search;
  const contentType = req.headers.get("content-type");
  let upstream: Response;
  try {
    upstream = await fetch(`${NADFUN_API_URL}/${path}${search}`, {
      method: req.method,
      headers: contentType ? { "content-type": contentType } : undefined,
      body: req.method === "GET" ? undefined : await req.arrayBuffer(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return Response.json({ error: "Could not reach the nad.fun API." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
  });
}

export const GET = forward;
export const POST = forward;
