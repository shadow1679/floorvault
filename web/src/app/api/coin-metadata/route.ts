// Reads a coin's metadata JSON from nad.fun storage on the server. The storage host only sends CORS headers
// to `localhost`, so a deployed site cannot fetch it from the browser. Only nad.fun metadata URIs are fetched.
const METADATA_URI = /^https:\/\/storage\.nadapp\.net\/metadata\/[0-9a-zA-Z-]+\.json$/;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 64 * 1024;

export async function GET(req: Request) {
  const uri = new URL(req.url).searchParams.get("uri") ?? "";
  if (!METADATA_URI.test(uri)) return Response.json({ error: "Not found." }, { status: 404 });
  let upstream: Response;
  try {
    upstream = await fetch(uri, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return Response.json({ error: "Could not reach nad.fun storage." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  if (!upstream.ok) {
    return Response.json({ error: `metadata HTTP ${upstream.status}` }, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
  }
  const text = await upstream.text();
  if (text.length > MAX_BYTES) return Response.json({ error: "Metadata too large." }, { status: 502 });
  // Stored metadata never changes for a given URI.
  return new Response(text, {
    headers: { "content-type": "application/json", "Cache-Control": "public, max-age=86400" },
  });
}
