// Shared constants for the browser tests. Every address and URL here is fake: the app is started against
// them and the chain and nad.fun API are answered by route handlers, so no test touches a real network.
import type { Address, Hex } from "viem";

export const CONFIGURED_PORT = 3100;
export const BARE_PORT = 3101;

export const RPC_URL = "https://rpc.e2e.test";
export const NADFUN_API_URL = "https://nadfun-api.e2e.test";

export const DEPLOY_BLOCK = 1000n;
export const HEAD_BLOCK = 1060n;

export const ADDR = {
  floorVault: "0x1111111111111111111111111111111111111111",
  raffle: "0x2222222222222222222222222222222222222222",
  marketplace: "0x3333333333333333333333333333333333333333",
  testChog: "0x4444444444444444444444444444444444444444",
  wallet: "0x5555555555555555555555555555555555555555",
  coin: "0x6666666666666666666666666666666666666666",
  newCoin: "0x7777777777777777777777777777777777777777",
  stranger: "0x8888888888888888888888888888888888888888",
} as const satisfies Record<string, Address>;

export const TX = {
  launchedCoin: `0x${"a1".repeat(32)}`,
  bought: `0x${"b2".repeat(32)}`,
  newLaunch: `0x${"c3".repeat(32)}`,
} as const satisfies Record<string, Hex>;

/** Environment for a dev server that is fully configured. */
export const CONFIGURED_ENV = {
  NEXT_PUBLIC_FLOORVAULT_ADDRESS: ADDR.floorVault,
  NEXT_PUBLIC_RAFFLE_ADDRESS: ADDR.raffle,
  NEXT_PUBLIC_MOCK_MARKETPLACE_ADDRESS: ADDR.marketplace,
  NEXT_PUBLIC_TEST_CHOG_ADDRESS: ADDR.testChog,
  NEXT_PUBLIC_DEPLOY_BLOCK: DEPLOY_BLOCK.toString(),
  NEXT_PUBLIC_RPC_URL: RPC_URL,
  NEXT_PUBLIC_NADFUN_API_URL: NADFUN_API_URL,
} as const;

/** Blank values beat web/.env.local (a real process env is never overridden), giving the "not configured" state. */
export const BARE_ENV = {
  ...CONFIGURED_ENV,
  NEXT_PUBLIC_FLOORVAULT_ADDRESS: "",
  NEXT_PUBLIC_RAFFLE_ADDRESS: "",
  NEXT_PUBLIC_MOCK_MARKETPLACE_ADDRESS: "",
  NEXT_PUBLIC_TEST_CHOG_ADDRESS: "",
  NEXT_PUBLIC_DEPLOY_BLOCK: "",
} as const;

export const MISSING_VARS = [
  "NEXT_PUBLIC_FLOORVAULT_ADDRESS",
  "NEXT_PUBLIC_RAFFLE_ADDRESS",
  "NEXT_PUBLIC_MOCK_MARKETPLACE_ADDRESS",
  "NEXT_PUBLIC_TEST_CHOG_ADDRESS",
  "NEXT_PUBLIC_DEPLOY_BLOCK",
] as const;
