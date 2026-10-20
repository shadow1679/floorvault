import { isAddress, parseEther, zeroAddress } from "viem";
import { CHOG_MAINNET_ADDRESS, NETWORK } from "./constants";
import { parseMonInput } from "./format";
import { validateImageFile } from "./nadfun";

/** Creator fee tiers (percent) nad.fun allows on this network: 1, 3 or 5 on testnet, only 1 on mainnet. */
export const FEE_TIERS: readonly number[] = NETWORK.feeTiers;
export type FeeTier = number;

export const NAME_MAX = 32;
export const SYMBOL_MAX = 10;
/** nad.fun's one-time fee to create a coin, in MON. The launch transaction always carries it. */
export const CREATE_FEE_MON = "10";
export const CREATE_FEE = parseEther(CREATE_FEE_MON);

export type LaunchForm = {
  name: string;
  symbol: string;
  image: File | null;
  feeTier: number;
  collection: string;
  /** MON the creator spends buying their own coin at launch. Empty or "0" means no dev buy. */
  devBuy: string;
};

export type LaunchErrors = Partial<Record<keyof LaunchForm, string>>;

export function validateAddress(value: string, label: string): string | null {
  const v = value.trim();
  if (v === "") return `${label} is required.`;
  if (!isAddress(v, { strict: false })) return `${label} is not a valid address (0x followed by 40 hex characters).`;
  if (v.toLowerCase() === zeroAddress) return `${label} cannot be the zero address.`;
  return null;
}

export function validateLaunch(form: LaunchForm): LaunchErrors {
  const errors: LaunchErrors = {};
  const name = form.name.trim();
  const symbol = form.symbol.trim();

  if (name === "") errors.name = "Give your coin a name.";
  else if (name.length > NAME_MAX) errors.name = `Keep the name to ${NAME_MAX} characters or fewer.`;

  if (symbol === "") errors.symbol = "Pick a ticker symbol.";
  else if (symbol.length > SYMBOL_MAX) errors.symbol = `Keep the symbol to ${SYMBOL_MAX} characters or fewer.`;
  else if (!/^[A-Za-z0-9]+$/.test(symbol)) errors.symbol = "Use letters and numbers only.";

  const imageError = validateImageFile(form.image);
  if (imageError) errors.image = imageError;

  if (!FEE_TIERS.includes(form.feeTier)) errors.feeTier = `Pick ${FEE_TIERS.map((t) => `${t}%`).join(", ").replace(/, (\d+%)$/, " or $1")}.`;

  const collectionError = validateAddress(form.collection, "Collection address");
  if (collectionError) errors.collection = collectionError;
  else if (NETWORK.isMainnet && form.collection.trim().toLowerCase() !== CHOG_MAINNET_ADDRESS.toLowerCase()) {
    errors.collection = "Mainnet launches only support Chog Genesis.";
  }

  if (form.devBuy.trim() !== "" && parseMonInput(form.devBuy) === null) {
    errors.devBuy = "Enter an amount in MON, for example 5, or leave it empty.";
  }

  return errors;
}

/** The dev buy in wei; empty means none. Call after validateLaunch. */
export function devBuyWei(form: Pick<LaunchForm, "devBuy">): bigint {
  return form.devBuy.trim() === "" ? 0n : (parseMonInput(form.devBuy) ?? 0n);
}

export function hasErrors(errors: LaunchErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Fee tier percent to nad.fun creatorFeeRate basis points (1% = 100). */
export function feeTierToBps(tier: number): number {
  return tier * 100;
}

/** Non-negative integer string, or null. Used for deploy block style inputs. */
export function parseBlockNumber(value: string): bigint | null {
  return /^\d+$/.test(value.trim()) ? BigInt(value.trim()) : null;
}
