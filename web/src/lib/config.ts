import { getAddress, isAddress, type Address } from "viem";
import {
  CHOG_MAINNET_ADDRESS,
  MONAD_MAINNET_ID,
  DEFAULT_CHAIN_ID,
  NETWORKS,
  resolveChainId,
  type SupportedChainId,
} from "./constants";

export const DEFAULT_RPC_URL = NETWORKS[DEFAULT_CHAIN_ID].rpcUrl;

export type RawEnv = Record<string, string | undefined>;

export type AppConfig = {
  chainId: SupportedChainId;
  floorVault: Address;
  raffle: Address;
  /** The MockMarketplace, testnet only. Null on mainnet, where NFTs are bought on OpenSea through Seaport. */
  marketplace: Address | null;
  /** The featured collection and, on mainnet, the only one the vault accepts (Chog Genesis). */
  collection: Address;
  deployBlock: bigint;
  rpcUrl: string;
};

export type ConfigResult =
  | { ok: true; config: AppConfig }
  | { ok: false; missing: string[]; invalid: string[] };

/** Checksummed address, or null when the text is not an address. Tolerates bad mixed-case checksums. */
export function normalizeAddress(value: string): Address | null {
  const v = value.trim();
  return isAddress(v, { strict: false }) ? getAddress(v.toLowerCase()) : null;
}

/** RPC URL from NEXT_PUBLIC_RPC_URL, or the selected network's public RPC. */
export function resolveRpcUrl(env: RawEnv): string {
  const override = (env.NEXT_PUBLIC_RPC_URL ?? "").trim();
  if (override) return override;
  return NETWORKS[resolveChainId(env.NEXT_PUBLIC_CHAIN_ID) ?? DEFAULT_CHAIN_ID].rpcUrl;
}

const COLLECTION_KEY = "NEXT_PUBLIC_COLLECTION_ADDRESS";
/** Original name of the collection variable, still read on testnet. */
const LEGACY_COLLECTION_KEY = "NEXT_PUBLIC_TEST_CHOG_ADDRESS";

/** Pure parser so it can be unit tested. Whitespace-only values count as missing. */
export function parseConfig(env: RawEnv): ConfigResult {
  const get = (k: string) => (env[k] ?? "").trim();
  const chainId = resolveChainId(env.NEXT_PUBLIC_CHAIN_ID);
  const invalid: string[] = [];
  if (chainId === null) invalid.push("NEXT_PUBLIC_CHAIN_ID");
  const isMainnet = chainId === MONAD_MAINNET_ID;

  // Mainnet names the collection variable neutrally; testnet accepts it or the original TEST_CHOG name.
  const collectionKey = isMainnet || get(COLLECTION_KEY) !== "" ? COLLECTION_KEY : LEGACY_COLLECTION_KEY;
  const addressKeys = [
    "NEXT_PUBLIC_FLOORVAULT_ADDRESS",
    "NEXT_PUBLIC_RAFFLE_ADDRESS",
    ...(isMainnet ? [] : ["NEXT_PUBLIC_MOCK_MARKETPLACE_ADDRESS"]),
    collectionKey,
  ];
  const required = [...addressKeys, "NEXT_PUBLIC_DEPLOY_BLOCK"];
  const missing = required.filter((k) => get(k) === "");

  for (const k of addressKeys) {
    if (get(k) !== "" && !isAddress(get(k), { strict: false })) invalid.push(k);
  }
  const blockRaw = get("NEXT_PUBLIC_DEPLOY_BLOCK");
  if (blockRaw !== "" && !/^(\d+|0x[0-9a-fA-F]+)$/.test(blockRaw)) invalid.push("NEXT_PUBLIC_DEPLOY_BLOCK");

  // Mainnet is CHOG-only: a different collection here is a misconfiguration, not a feature.
  const collectionRaw = get(collectionKey);
  if (
    isMainnet &&
    isAddress(collectionRaw, { strict: false }) &&
    collectionRaw.toLowerCase() !== CHOG_MAINNET_ADDRESS.toLowerCase()
  ) {
    invalid.push(collectionKey);
  }

  if (missing.length > 0 || invalid.length > 0) return { ok: false, missing, invalid };

  return {
    ok: true,
    config: {
      chainId: chainId!,
      floorVault: normalizeAddress(get("NEXT_PUBLIC_FLOORVAULT_ADDRESS"))!,
      raffle: normalizeAddress(get("NEXT_PUBLIC_RAFFLE_ADDRESS"))!,
      marketplace: isMainnet ? null : normalizeAddress(get("NEXT_PUBLIC_MOCK_MARKETPLACE_ADDRESS"))!,
      collection: normalizeAddress(collectionRaw)!,
      deployBlock: BigInt(blockRaw),
      rpcUrl: resolveRpcUrl(env),
    },
  };
}

// NEXT_PUBLIC_* must be referenced statically so Next.js can inline them into the client bundle.
export function readEnv(): RawEnv {
  return {
    NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
    NEXT_PUBLIC_FLOORVAULT_ADDRESS: process.env.NEXT_PUBLIC_FLOORVAULT_ADDRESS,
    NEXT_PUBLIC_RAFFLE_ADDRESS: process.env.NEXT_PUBLIC_RAFFLE_ADDRESS,
    NEXT_PUBLIC_MOCK_MARKETPLACE_ADDRESS: process.env.NEXT_PUBLIC_MOCK_MARKETPLACE_ADDRESS,
    NEXT_PUBLIC_COLLECTION_ADDRESS: process.env.NEXT_PUBLIC_COLLECTION_ADDRESS,
    NEXT_PUBLIC_TEST_CHOG_ADDRESS: process.env.NEXT_PUBLIC_TEST_CHOG_ADDRESS,
    NEXT_PUBLIC_DEPLOY_BLOCK: process.env.NEXT_PUBLIC_DEPLOY_BLOCK,
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
  };
}

export const configResult: ConfigResult = parseConfig(readEnv());

/** The RPC URL is safe to use even when contract addresses are missing. */
export const rpcUrl: string = resolveRpcUrl(readEnv());
