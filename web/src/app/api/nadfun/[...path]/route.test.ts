import { afterEach, describe, expect, it, vi } from "vitest";
import { NADFUN_API_URL } from "@/lib/constants";
import { GET, POST } from "./route";

const TOKEN = "0x8D08d61A54Fd93f91CA294d0bC7db8783b9c9547";
const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
const req = (path: string, init?: RequestInit) => new Request(`http://app.test/api/nadfun/${path}`, init);

afterEach(() => vi.unstubAllGlobals());

describe("/api/nadfun proxy", () => {
  it("forwards an upload with its content type and body, and relays the answer", async () => {
    const upstream = vi.fn(async () => new Response(JSON.stringify({ image_uri: "u" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", upstream);
    const res = await POST(req("metadata/image", { method: "POST", headers: { "content-type": "image/png" }, body: "png" }), ctx("metadata/image"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ image_uri: "u" });
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${NADFUN_API_URL}/metadata/image`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "image/png" });
  });

  it("forwards a chart read with its query string and relays a 404", async () => {
    const upstream = vi.fn(async () => new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", upstream);
    const res = await GET(req(`trade/chart/${TOKEN}?resolution=5`), ctx(`trade/chart/${TOKEN}`));
    expect(res.status).toBe(404);
    expect((upstream.mock.calls[0] as unknown as [string])[0]).toBe(`${NADFUN_API_URL}/trade/chart/${TOKEN}?resolution=5`);
  });

  it("refuses paths and methods the app does not use", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    expect((await GET(req("metadata/image"), ctx("metadata/image"))).status).toBe(404);
    expect((await POST(req("token/create", { method: "POST", body: "x" }), ctx("token/create"))).status).toBe(404);
    expect((await GET(req("trade/chart/../admin"), ctx("trade/chart/../admin"))).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("answers 502 when nad.fun cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    const res = await POST(req("token/salt", { method: "POST", body: "{}" }), ctx("token/salt"));
    expect(res.status).toBe(502);
  });
});
