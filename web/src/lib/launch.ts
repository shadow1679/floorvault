import type { Address } from "viem";
import { normalizeAddress } from "./config";
import type { LaunchAssets } from "./nadfun";
import { devBuyWei, feeTierToBps, type LaunchForm } from "./validation";

export const LAUNCH_DEADLINE_SECONDS = 3600;

/**
 * The LaunchArgs struct for FloorVault.launch: validated form values plus the metadata URI and salt from nad.fun.
 * `creator` (the connected wallet) is the fallback owner of NFTs the raffle cannot give to a holder.
 */
export function buildLaunchArgs(
  form: LaunchForm,
  nowSeconds: number,
  assets: Pick<LaunchAssets, "tokenURI" | "salt">,
  creator: Address,
) {
  const symbol = form.symbol.trim().toUpperCase();
  const collection = normalizeAddress(form.collection);
  if (!collection) throw new Error("Collection must be a valid address.");
  return {
    name: form.name.trim(),
    symbol,
    tokenURI: assets.tokenURI,
    creatorFeeRate: feeTierToBps(form.feeTier),
    salt: assets.salt,
    deadline: BigInt(Math.floor(nowSeconds) + LAUNCH_DEADLINE_SECONDS),
    collection: collection as Address,
    nftRecipient: creator,
    devBuy: devBuyWei(form),
  };
}
