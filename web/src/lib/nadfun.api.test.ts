import { describe, expect, it, vi } from "vitest";
import {
  CHART_COUNTBACK,
  fetchNadfunCandles,
  fetchNadfunMetadata,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_MB,
  NADFUN_BASE,
  NadfunApiError,
  prepareLaunchAssets,
  validateImageFile,
} from "./nadfun";

// The base is an absolute URL on mainnet and "/api/nadfun" on testnet, so read paths relative to it.
const urlOfCall = (fn: ReturnType<typeof vi.fn>) => new URL((fn.mock.calls[0][0] as string).replace(NADFUN_BASE, ""), "http://nadfun.test");
const pathOf = (url: string) => new URL(url.replace(NADFUN_BASE, ""), "http://nadfun.test").pathname;

const VAULT = "0xB5C69fdd68B0531ce419b145feF30f942c352F35" as const;
const TOKEN = "0x8D08d61A54Fd93f91CA294d0bC7db8783b9c9547" as const;
const SALT = `0x${"ab".repeat(32)}` as const;
const png = () => new File(["x"], "a.png", { type: "image/png" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const asFetch = (fn: unknown) => fn as unknown as typeof fetch;
const input = { name: "Chog", symbol: "CHG", creator: VAULT } as const;

/** A fetch that answers the three launch endpoints and records what it was asked. */
function launchApi(overrides: Partial<Record<"/metadata/image" | "/metadata/metadata" | "/token/salt", () => Response>> = {}) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const path = pathOf(url) as "/metadata/image" | "/metadata/metadata" | "/token/salt";
    calls.push({ path, init });
    const override = overrides[path];
    if (override) return override();
    if (path === "/metadata/image") return json({ is_nsfw: false, image_uri: "https://storage.nadapp.net/coin/i" });
    if (path === "/metadata/metadata") return json({ metadata_uri: "https://storage.nadapp.net/metadata/m.json" });
    return json({ salt: SALT, address: TOKEN });
  });
  return { calls, fetchImpl: asFetch(impl), impl };
}

describe("validateImageFile limits", () => {
  it("accepts every listed type and the exact size limit, rejects one byte over", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]) {
      expect(validateImageFile({ type, size: 1 })).toBeNull();
    }
    expect(validateImageFile({ type: "image/png", size: IMAGE_MAX_BYTES })).toBeNull();
    expect(validateImageFile({ type: "image/png", size: IMAGE_MAX_BYTES + 1 })).toMatch(new RegExp(`${IMAGE_MAX_MB} MB`));
  });

  it("names the problem for each failure", () => {
    expect(validateImageFile(null)).toMatch(/picture/i);
    expect(validateImageFile({ type: "image/gif", size: 1 })).toMatch(/PNG, JPEG, WebP or SVG/);
  });
});

describe("prepareLaunchAssets request shape", () => {
  it("rejects an unusable image before calling the API", async () => {
    const { fetchImpl, impl } = launchApi();
    const gif = new File(["x"], "a.gif", { type: "image/gif" });
    await expect(prepareLaunchAssets({ ...input, image: gif }, fetchImpl)).rejects.toThrow(/PNG, JPEG, WebP or SVG/);
    expect(impl).not.toHaveBeenCalled();
  });

  it("posts the image with its own content type, to the configured base URL", async () => {
    const { fetchImpl, calls, impl } = launchApi();
    const image = png();
    await prepareLaunchAssets({ ...input, image }, fetchImpl);

    const upload = calls[0];
    expect(upload.init?.method).toBe("POST");
    expect(upload.init?.headers).toEqual({ "content-type": "image/png" });
    expect(upload.init?.body).toBe(image);
    expect(impl.mock.calls[0][0]).toBe(`${NADFUN_BASE}/metadata/image`);
  });

  it("sends the description only when there is one", async () => {
    const bodyOf = (calls: { path: string; init?: RequestInit }[]) =>
      JSON.parse(calls.find((c) => c.path === "/metadata/metadata")!.init!.body as string) as Record<string, unknown>;

    const without = launchApi();
    await prepareLaunchAssets({ ...input, image: png() }, without.fetchImpl);
    expect(bodyOf(without.calls)).not.toHaveProperty("description");

    const withText = launchApi();
    await prepareLaunchAssets({ ...input, image: png(), description: "feeds on floors" }, withText.fetchImpl);
    expect(bodyOf(withText.calls)).toMatchObject({ description: "feeds on floors" });
  });

  it("asks for a V2 salt using the metadata URI it was just given", async () => {
    const { fetchImpl, calls } = launchApi();
    await prepareLaunchAssets({ ...input, image: png() }, fetchImpl);
    const body = JSON.parse(calls[2].init!.body as string);
    expect(body).toEqual({
      creator: VAULT,
      name: "Chog",
      symbol: "CHG",
      metadata_uri: "https://storage.nadapp.net/metadata/m.json",
      version: "V2",
    });
  });
});

describe("prepareLaunchAssets failures", () => {
  it("stops after a failed metadata upload and never mines a salt", async () => {
    const { fetchImpl, calls } = launchApi({ "/metadata/metadata": () => json({ error: "metadata rejected" }, 400) });
    const err = await prepareLaunchAssets({ ...input, image: png() }, fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(NadfunApiError);
    expect(err).toMatchObject({ message: "metadata rejected", status: 400, name: "NadfunApiError" });
    expect(calls.map((c) => c.path)).toEqual(["/metadata/image", "/metadata/metadata"]);
  });

  it("turns a network failure into a friendly error with status 0", async () => {
    const down = asFetch(
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const err = await prepareLaunchAssets({ ...input, image: png() }, down).catch((e) => e);
    expect(err).toBeInstanceOf(NadfunApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/Could not reach the nad\.fun API/);
  });

  it("reads plain-text, empty and oversized error bodies", async () => {
    const failWith = (res: () => Response) => launchApi({ "/metadata/image": res }).fetchImpl;
    const run = async (fetchImpl: typeof fetch) => {
      const error = await prepareLaunchAssets({ ...input, image: png() }, fetchImpl).then(
        () => null,
        (e: unknown) => e as NadfunApiError,
      );
      if (!error) throw new Error("expected the upload to fail");
      return error;
    };

    expect((await run(failWith(() => new Response("upstream timeout", { status: 504 })))).message).toBe("upstream timeout");
    expect((await run(failWith(() => new Response("", { status: 502 })))).message).toBe("HTTP 502");
    expect((await run(failWith(() => json({ detail: "no error key" }, 422)))).message).toBe('{"detail":"no error key"}');
    expect((await run(failWith(() => new Response("x".repeat(500), { status: 500 })))).message).toHaveLength(200);
  });

  it("fails when the salt miner is rate limited", async () => {
    const { fetchImpl } = launchApi({ "/token/salt": () => json({ error: "Rate limit exceeded" }, 429) });
    await expect(prepareLaunchAssets({ ...input, image: png() }, fetchImpl)).rejects.toMatchObject({
      status: 429,
      message: "Rate limit exceeded",
    });
  });
});

describe("fetchNadfunCandles request and parsing", () => {
  const chart = (extra: object = {}) => ({ s: "ok", t: [100], o: ["1"], h: ["2"], l: ["1"], c: ["1.5"], v: ["1"], ...extra });
  const urlOf = (fn: ReturnType<typeof vi.fn>) => urlOfCall(fn);

  it("asks for a price chart window that ends now and starts an hour before the coin", async () => {
    const impl = vi.fn(async () => json(chart()));
    await fetchNadfunCandles(TOKEN, { ageSeconds: 600, nowSeconds: 10_000.9 }, asFetch(impl));
    const url = urlOf(impl);
    expect(url.pathname).toBe(`/trade/chart/${TOKEN}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      resolution: "1",
      from: String(10_000 - 600 - 3600),
      to: "10000",
      countback: String(CHART_COUNTBACK),
      chart_type: "price",
    });
  });

  it("never asks for a negative start time", async () => {
    const impl = vi.fn(async () => json(chart()));
    await fetchNadfunCandles(TOKEN, { ageSeconds: 86_400, nowSeconds: 500 }, asFetch(impl));
    expect(urlOf(impl).searchParams.get("from")).toBe("0");
  });

  it("returns an empty list when the API has no usable data", async () => {
    const f = (body: unknown) => asFetch(vi.fn(async () => json(body)));
    const opts = { ageSeconds: 60, nowSeconds: 1000 };
    expect(await fetchNadfunCandles(TOKEN, opts, f({ s: "no_data" }))).toEqual([]);
    expect(await fetchNadfunCandles(TOKEN, opts, f({ s: "ok" }))).toEqual([]);
    expect(await fetchNadfunCandles(TOKEN, opts, f(chart({ t: [] })))).toEqual([]);
  });

  it("skips candles with a non-numeric time or a missing close", async () => {
    const body = chart({ t: ["bad", 200, 300], o: [1, 1, 1], h: [1, 1, 1], l: [1, 1, 1], c: [1, 2] });
    const out = await fetchNadfunCandles(TOKEN, { ageSeconds: 60, nowSeconds: 1000 }, asFetch(vi.fn(async () => json(body))));
    expect(out).toEqual([{ time: 200, open: 1, high: 1, low: 1, close: 2 }]);
  });

  it("only treats 404 as 'unknown coin'; other failures surface to the caller", async () => {
    const opts = { ageSeconds: 60, nowSeconds: 1000 };
    await expect(fetchNadfunCandles(TOKEN, opts, asFetch(vi.fn(async () => json({ error: "boom" }, 500))))).rejects.toMatchObject({
      status: 500,
    });
    const offline = asFetch(
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    await expect(fetchNadfunCandles(TOKEN, opts, offline)).rejects.toMatchObject({ status: 0 });
  });
});

describe("fetchNadfunMetadata edge cases", () => {
  const URI = "https://storage.nadapp.net/metadata/m.json";

  it("trusts only https URLs on the storage host itself", async () => {
    const impl = vi.fn(async () => json({ name: "Chog" }));
    for (const uri of [
      "http://storage.nadapp.net/m.json",
      "https://storage.nadapp.net.evil.example/m.json",
      "https://evil.example/https://storage.nadapp.net/m.json",
      "data:application/json;base64,e30=",
      "",
    ]) {
      expect(await fetchNadfunMetadata(uri, asFetch(impl))).toEqual({});
    }
    expect(impl).not.toHaveBeenCalled();
  });

  it("throws a NadfunApiError carrying the status when storage answers with an error", async () => {
    const err = await fetchNadfunMetadata(URI, asFetch(vi.fn(async () => new Response("", { status: 503 })))).catch((e) => e);
    expect(err).toBeInstanceOf(NadfunApiError);
    expect(err).toMatchObject({ status: 503, message: "metadata HTTP 503" });
  });

  it("trims text, drops blanks and non-strings, and caps long values at 500 characters", async () => {
    const body = { name: "  Chog  ", symbol: "   ", description: "d".repeat(900), image_uri: 42 };
    const out = await fetchNadfunMetadata(URI, asFetch(vi.fn(async () => json(body))));
    expect(out.name).toBe("Chog");
    expect(out.symbol).toBeUndefined();
    expect(out.description).toHaveLength(500);
    expect(out.image).toBeUndefined();
  });
});
