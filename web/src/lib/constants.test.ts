import { afterEach, describe, expect, it, vi } from "vitest";
import { MONAD_MAINNET_ID, MONAD_TESTNET_ID, resolveChainId } from "./constants";

// NADFUN_API_URL is read from the environment once, when the module loads.
async function loadBaseUrl(env: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_NADFUN_API_URL", env);
  return (await import("./constants")).NADFUN_API_URL;
}

describe("NADFUN_API_URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to the testnet dev API", async () => {
    expect(await loadBaseUrl("")).toBe("https://dev-api.nadapp.net");
  });

  it("treats a whitespace-only value as unset", async () => {
    expect(await loadBaseUrl("   ")).toBe("https://dev-api.nadapp.net");
  });

  it("uses the override and strips whitespace and trailing slashes so paths join cleanly", async () => {
    expect(await loadBaseUrl("  https://api.nad.fun// ")).toBe("https://api.nad.fun");
    expect(await loadBaseUrl("https://api.nad.fun")).toBe("https://api.nad.fun");
  });
});

describe("resolveChainId", () => {
  it("defaults to mainnet and accepts the two Monad chains", () => {
    expect(resolveChainId(undefined)).toBe(MONAD_MAINNET_ID);
    expect(resolveChainId("  ")).toBe(MONAD_MAINNET_ID);
    expect(resolveChainId("10143")).toBe(MONAD_TESTNET_ID);
    expect(resolveChainId(" 143 ")).toBe(MONAD_MAINNET_ID);
  });
  it("returns null for anything else so the config can report it", () => {
    expect(resolveChainId("1")).toBeNull();
    expect(resolveChainId("0x8f")).toBeNull();
  });
});

describe("network selection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("derives mainnet addresses, explorer, API and fee tiers from NEXT_PUBLIC_CHAIN_ID=143", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "143");
    vi.stubEnv("NEXT_PUBLIC_NADFUN_API_URL", "");
    const c = await import("./constants");
    expect(c.IS_MAINNET).toBe(true);
    expect(c.NETWORK.name).toBe("Monad");
    expect(c.EXPLORER_URL).toBe("https://monadvision.com");
    expect(c.FAUCET_URL).toBeNull();
    expect(c.NAD_ROUTER).toBe("0x8986C8fD44eb85294A725a7e61AF35E76bA26F91");
    expect(c.NAD_BONDING_CURVE).toBe("0x9f3832732923252A21044F21eE6bd87F09514ae4");
    expect(c.NADFUN_API_URL).toBe("https://api.nad.fun");
    expect(c.NETWORK.feeTiers).toEqual([1]);
  });

  it("uses mainnet by default", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "");
    const c = await import("./constants");
    expect(c.IS_MAINNET).toBe(true);
    expect(c.NETWORK.name).toBe("Monad");
  });

  it("uses testnet when NEXT_PUBLIC_CHAIN_ID=10143", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "10143");
    const c = await import("./constants");
    expect(c.IS_MAINNET).toBe(false);
    expect(c.NETWORK.name).toBe("Monad Testnet");
    expect(c.FAUCET_URL).toBe("https://faucet.monad.xyz");
  });
});
