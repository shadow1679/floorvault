import type { Address } from "viem";

export const MONAD_TESTNET_ID = 10143;
export const MONAD_MAINNET_ID = 143;
export type SupportedChainId = typeof MONAD_TESTNET_ID | typeof MONAD_MAINNET_ID;

/** Chog Genesis, the only collection mainnet supports (1,969 NFTs, ERC-2981 royalties). */
export const CHOG_MAINNET_ADDRESS = "0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763" as const;

export type NetworkInfo = {
  id: SupportedChainId;
  /** Chain name as wallets and the switch button show it. */
  name: string;
  isMainnet: boolean;
  rpcUrl: string;
  explorerUrl: string;
  /** Null on mainnet: there is no faucet for real MON. */
  faucetUrl: string | null;
  /** nad.fun V2 (see the research addendum). Coins trade through the router; prices come from the bonding curve. */
  nadRouter: Address;
  nadBondingCurve: Address;
  /** nad.fun's REST API (indexer, chart, metadata storage, salt mining). */
  nadfunApiUrl: string;
  /** Creator fee tiers nad.fun allows, in percent. Mainnet allows 1% only. */
  feeTiers: readonly number[];
};

export const NETWORKS: Record<SupportedChainId, NetworkInfo> = {
  [MONAD_TESTNET_ID]: {
    id: MONAD_TESTNET_ID,
    name: "Monad Testnet",
    isMainnet: false,
    rpcUrl: "https://testnet-rpc.monad.xyz",
    explorerUrl: "https://testnet.monadvision.com",
    faucetUrl: "https://faucet.monad.xyz",
    nadRouter: "0x75588668999cA0557b78046b8a5E86b47b9234ec",
    nadBondingCurve: "0x27063a38eC0D3281D354090EB92e669Ed1eB956C",
    nadfunApiUrl: "https://dev-api.nadapp.net",
    feeTiers: [1, 3, 5],
  },
  [MONAD_MAINNET_ID]: {
    id: MONAD_MAINNET_ID,
    name: "Monad",
    isMainnet: true,
    rpcUrl: "https://rpc.monad.xyz",
    explorerUrl: "https://monadvision.com",
    faucetUrl: null,
    nadRouter: "0x8986C8fD44eb85294A725a7e61AF35E76bA26F91",
    nadBondingCurve: "0x9f3832732923252A21044F21eE6bd87F09514ae4",
    nadfunApiUrl: "https://api.nad.fun",
    feeTiers: [1],
  },
};

/** The network used when NEXT_PUBLIC_CHAIN_ID is blank. Set NEXT_PUBLIC_CHAIN_ID=10143 for testnet. */
export const DEFAULT_CHAIN_ID: SupportedChainId = MONAD_MAINNET_ID;

/**
 * The chain id from NEXT_PUBLIC_CHAIN_ID. Blank means mainnet. Anything other than 143 or 10143
 * returns null so the caller can report it instead of silently picking a network.
 */
export function resolveChainId(raw: string | undefined): SupportedChainId | null {
  const v = (raw ?? "").trim();
  if (v === "") return DEFAULT_CHAIN_ID;
  if (v === String(MONAD_TESTNET_ID)) return MONAD_TESTNET_ID;
  if (v === String(MONAD_MAINNET_ID)) return MONAD_MAINNET_ID;
  return null;
}

// Static env access so Next inlines it. A bad value falls back to the default here; config.ts reports it.
export const CHAIN_ID: SupportedChainId = resolveChainId(process.env.NEXT_PUBLIC_CHAIN_ID) ?? DEFAULT_CHAIN_ID;
export const NETWORK: NetworkInfo = NETWORKS[CHAIN_ID];
export const IS_MAINNET = NETWORK.isMainnet;

export const EXPLORER_URL = NETWORK.explorerUrl;
export const FAUCET_URL = NETWORK.faucetUrl;
export const NAD_ROUTER = NETWORK.nadRouter;
export const NAD_BONDING_CURVE = NETWORK.nadBondingCurve;

// NEXT_PUBLIC_NADFUN_API_URL overrides the network's default API.
export const NADFUN_API_URL = (process.env.NEXT_PUBLIC_NADFUN_API_URL ?? "").trim().replace(/\/+$/, "") || NETWORK.nadfunApiUrl;
