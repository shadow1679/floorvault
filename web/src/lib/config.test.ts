import { describe, expect, it } from "vitest";
import { DEFAULT_RPC_URL, normalizeAddress, parseConfig, resolveRpcUrl } from "./config";
import { CHOG_MAINNET_ADDRESS } from "./constants";

const full = {
  NEXT_PUBLIC_CHAIN_ID: "10143",
  NEXT_PUBLIC_FLOORVAULT_ADDRESS: "0xfa6be1e26b2197a6507480f692f6d6594c9c193c",
  NEXT_PUBLIC_RAFFLE_ADDRESS: "0x34a1d3fff3958843c43ad80f30b94c510645c316",
  NEXT_PUBLIC_MOCK_MARKETPLACE_ADDRESS: "0x8b6a7b5011ee7e06e3c36a2b3c04e0ef3837a76f",
  NEXT_PUBLIC_TEST_CHOG_ADDRESS: "0x8b5459fad279f1beef9854d70167a79fc19411e1",
  NEXT_PUBLIC_DEPLOY_BLOCK: "70307798",
};

describe("parseConfig", () => {
  it("reports everything missing for an empty env (the not-configured state)", () => {
    const r = parseConfig({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toHaveLength(4);
  });

  it("treats blank values as missing", () => {
    const r = parseConfig({ ...full, NEXT_PUBLIC_TEST_CHOG_ADDRESS: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["NEXT_PUBLIC_TEST_CHOG_ADDRESS"]);
  });

  it("flags malformed values", () => {
    const r = parseConfig({ ...full, NEXT_PUBLIC_FLOORVAULT_ADDRESS: "0x123", NEXT_PUBLIC_DEPLOY_BLOCK: "abc" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.invalid).toEqual(["NEXT_PUBLIC_FLOORVAULT_ADDRESS", "NEXT_PUBLIC_DEPLOY_BLOCK"]);
  });

  it("parses a complete env", () => {
    const r = parseConfig(full);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.deployBlock).toBe(70307798n);
      expect(r.config.raffle).toBe(normalizeAddress(full.NEXT_PUBLIC_RAFFLE_ADDRESS));
      expect(r.config.rpcUrl).toBe("https://testnet-rpc.monad.xyz");
    }
  });
});

describe("parseConfig details", () => {
  it("accepts a 0x-hex deploy block (as printed in the broadcast receipts)", () => {
    const r = parseConfig({ ...full, NEXT_PUBLIC_DEPLOY_BLOCK: "0x430cfd6" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.deployBlock).toBe(70307798n);
  });

  it("rejects a malformed hex block", () => {
    expect(parseConfig({ ...full, NEXT_PUBLIC_DEPLOY_BLOCK: "0xzz" }).ok).toBe(false);
  });

  it("checksums addresses, even ones with a bad mixed-case checksum", () => {
    const bad = "0xFA6be1e26b2197a6507480f692f6d6594c9c193c";
    const r = parseConfig({ ...full, NEXT_PUBLIC_FLOORVAULT_ADDRESS: bad });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.floorVault).toBe(normalizeAddress(bad));
  });
});

describe("resolveRpcUrl", () => {
  it("defaults to the public Monad mainnet RPC", () => {
    expect(resolveRpcUrl({})).toBe("https://rpc.monad.xyz");
    expect(resolveRpcUrl({})).toBe(DEFAULT_RPC_URL);
    expect(resolveRpcUrl({ NEXT_PUBLIC_RPC_URL: "   " })).toBe(DEFAULT_RPC_URL);
  });
  it("uses the override, trimmed", () => {
    expect(resolveRpcUrl({ NEXT_PUBLIC_RPC_URL: " https://rpc.example/x " })).toBe("https://rpc.example/x");
  });
  it("flows into the parsed config", () => {
    const r = parseConfig({ ...full, NEXT_PUBLIC_RPC_URL: "https://rpc.example/x" });
    expect(r.ok && r.config.rpcUrl).toBe("https://rpc.example/x");
  });
});

describe("parseConfig on testnet", () => {
  it("defaults to mainnet when the chain id is blank", () => {
    const r = parseConfig({ ...full, NEXT_PUBLIC_CHAIN_ID: "", NEXT_PUBLIC_COLLECTION_ADDRESS: CHOG_MAINNET_ADDRESS });
    expect(r.ok && r.config.chainId).toBe(143);
    expect(r.ok && r.config.marketplace).toBeNull();
  });

  it("keeps the mock marketplace required on testnet", () => {
    const r = parseConfig({ ...full, NEXT_PUBLIC_MOCK_MARKETPLACE_ADDRESS: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["NEXT_PUBLIC_MOCK_MARKETPLACE_ADDRESS"]);
  });

  it("reads the collection from TEST_CHOG or from the neutral COLLECTION variable, which wins", () => {
    const legacy = parseConfig(full);
    expect(legacy.ok && legacy.config.collection).toBe(normalizeAddress(full.NEXT_PUBLIC_TEST_CHOG_ADDRESS));
    const neutral = parseConfig({ ...full, NEXT_PUBLIC_TEST_CHOG_ADDRESS: "", NEXT_PUBLIC_COLLECTION_ADDRESS: CHOG_MAINNET_ADDRESS });
    expect(neutral.ok && neutral.config.collection).toBe(CHOG_MAINNET_ADDRESS);
    const config = legacy.ok ? legacy.config : null;
    expect(config?.chainId).toBe(10143);
    expect(config?.marketplace).toBe(normalizeAddress(full.NEXT_PUBLIC_MOCK_MARKETPLACE_ADDRESS));
  });

  it("rejects a chain id that is neither 143 nor 10143", () => {
    const r = parseConfig({ ...full, NEXT_PUBLIC_CHAIN_ID: "1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.invalid).toEqual(["NEXT_PUBLIC_CHAIN_ID"]);
  });
});

describe("parseConfig on mainnet", () => {
  const mainnet = {
    NEXT_PUBLIC_CHAIN_ID: "143",
    NEXT_PUBLIC_FLOORVAULT_ADDRESS: full.NEXT_PUBLIC_FLOORVAULT_ADDRESS,
    NEXT_PUBLIC_RAFFLE_ADDRESS: full.NEXT_PUBLIC_RAFFLE_ADDRESS,
    NEXT_PUBLIC_COLLECTION_ADDRESS: CHOG_MAINNET_ADDRESS,
    NEXT_PUBLIC_DEPLOY_BLOCK: "113000000",
  };

  it("does not need the mock marketplace and exposes no marketplace address", () => {
    const r = parseConfig(mainnet);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.chainId).toBe(143);
      expect(r.config.marketplace).toBeNull();
      expect(r.config.collection).toBe(CHOG_MAINNET_ADDRESS);
      expect(r.config.rpcUrl).toBe("https://rpc.monad.xyz");
    }
  });

  it("requires the collection under its neutral name, not TEST_CHOG", () => {
    const r = parseConfig({ ...mainnet, NEXT_PUBLIC_COLLECTION_ADDRESS: "", NEXT_PUBLIC_TEST_CHOG_ADDRESS: CHOG_MAINNET_ADDRESS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["NEXT_PUBLIC_COLLECTION_ADDRESS"]);
  });

  it("is CHOG-only: any other collection address is invalid", () => {
    const r = parseConfig({ ...mainnet, NEXT_PUBLIC_COLLECTION_ADDRESS: full.NEXT_PUBLIC_TEST_CHOG_ADDRESS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.invalid).toEqual(["NEXT_PUBLIC_COLLECTION_ADDRESS"]);
  });

  it("accepts the CHOG address in any letter case", () => {
    expect(parseConfig({ ...mainnet, NEXT_PUBLIC_COLLECTION_ADDRESS: CHOG_MAINNET_ADDRESS.toLowerCase() }).ok).toBe(true);
  });

  it("an RPC override still wins", () => {
    expect(resolveRpcUrl({ NEXT_PUBLIC_CHAIN_ID: "143", NEXT_PUBLIC_RPC_URL: "https://rpc3.monad.xyz" })).toBe("https://rpc3.monad.xyz");
    expect(resolveRpcUrl({ NEXT_PUBLIC_CHAIN_ID: "143" })).toBe("https://rpc.monad.xyz");
  });
});
