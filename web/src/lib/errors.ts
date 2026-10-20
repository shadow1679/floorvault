import { NETWORK } from "./constants";

export type TxAction = "launch" | "harvest" | "buy" | "switch" | "raffle" | "trade";

type ErrLike = {
  name?: string;
  code?: number;
  message?: string;
  shortMessage?: string;
  details?: string;
  reason?: string;
  cause?: unknown;
  walk?: (fn?: (e: unknown) => boolean) => unknown;
};

function chain(err: unknown): ErrLike[] {
  const out: ErrLike[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 8 && cur && typeof cur === "object"; i++) {
    out.push(cur as ErrLike);
    cur = (cur as ErrLike).cause;
  }
  return out;
}

function haystack(err: unknown): string {
  if (typeof err === "string") return err;
  return chain(err)
    .flatMap((e) => [e.name, e.shortMessage, e.reason, e.details, e.message])
    .filter(Boolean)
    .join(" | ");
}

export function isUserRejection(err: unknown): boolean {
  return chain(err).some((e) => e.code === 4001 || e.name === "UserRejectedRequestError") ||
    /user (rejected|denied)/i.test(haystack(err));
}

/** The contract revert reason if one can be found, e.g. "floor above budget". */
export function revertReason(err: unknown): string | undefined {
  for (const e of chain(err)) if (typeof e.reason === "string" && e.reason) return e.reason;
  const m = /reverted with the following reason:\s*([^\n|]+)/i.exec(haystack(err));
  return m?.[1]?.trim();
}

const CONTRACT_FAILURE_NAMES = new Set(["ContractFunctionRevertedError", "ContractFunctionZeroDataError"]);

/** True when the error is the contract itself failing (a revert or empty return), not a transport problem. */
export function isContractCallFailure(err: unknown): boolean {
  return chain(err).some((e) => e.name !== undefined && CONTRACT_FAILURE_NAMES.has(e.name));
}

/** A contract revert that carries no reason string: a bare revert or a custom error we have no ABI for. */
function isUnspecificRevert(err: unknown): boolean {
  if (revertReason(err)) return false;
  return (
    chain(err).some((e) => e.name === "ContractFunctionRevertedError") ||
    /reverted with the following signature|execution reverted/i.test(haystack(err))
  );
}

/** Turn a wallet/RPC/contract error into a short message a person can act on. */
const RAFFLE_REASONS: Record<string, string> = {
  "too early": "It is not draw time yet.",
  "already drawn": "This round has already been drawn.",
  "not settling": "This raffle is not in its settle window right now.",
  "settle window closed": "The settle window has closed. Finalize the round instead.",
  "settle window open": "The settle window is still open. Wait for the countdown.",
  "holder not eligible": "That address cannot win: it is the coin, the bonding curve, or a protocol address.",
  "past winner": "That address already won this raffle and did not claim in time.",
  "no balance": "That address no longer holds this coin.",
  "nothing to claim": "There is nothing to claim on this raffle right now.",
  "not the winner": "Only the winner can claim this NFT.",
  "claim window expired": "The 7-day claim window has ended. Anyone can re-raffle it now.",
  "claim window open": "The winner still has time to claim. Re-raffle opens when the window ends.",
  "not re-raffleable": "This raffle cannot be re-raffled right now.",
  "unknown raffle": "That raffle does not exist.",
};

export function explainError(err: unknown, action: TxAction): string {
  if (isUserRejection(err)) return "Cancelled in your wallet. Nothing was sent.";
  const text = haystack(err);
  if (/insufficient funds|exceeds the balance/i.test(text)) return "Not enough MON in this wallet to cover the amount and gas.";
  if (/chain (mismatch|id)|does not match the target chain/i.test(text)) return `Your wallet is on the wrong network. Switch to ${NETWORK.name}.`;

  const reason = revertReason(err);

  if (action === "harvest") {
    if (reason === "unknown token") return "FloorVault does not know this coin.";
    if (reason === "reentrant") return "Another FloorVault call is in progress. Try again.";
    if (isUnspecificRevert(err)) return "No fees to claim yet. Trades on this coin create fees, then you can claim them.";
  }
  if (action === "buy") {
    if (reason === "not keeper") return "Only the vault's keeper can buy. It does this automatically.";
    if (reason === "floor above budget" || reason === "above budget" || reason === "floor above max price") return "The floor is above this coin's budget. More fees need to arrive first.";
    if (reason === "no listings") return "No NFTs are listed for this collection right now.";
    if (reason === "unknown token") return "FloorVault does not know this coin.";
  }
  if (action === "raffle" && reason && RAFFLE_REASONS[reason]) return RAFFLE_REASONS[reason];
  if (action === "trade" && !reason && isUnspecificRevert(err)) {
    return "The trade was rejected. The price may have moved past your slippage, or the amount is too large for the curve. Try a smaller amount or more slippage.";
  }
  if (action === "launch") {
    if (reason === "zero address") return "Collection and NFT recipient cannot be the zero address.";
    if (reason === "collection not supported") return "This vault only supports its featured collection.";
    if (reason) return `Launch reverted: ${reason}`;
  }
  if (reason) return `Transaction reverted: ${reason}`;

  const short = chain(err).find((e) => e.shortMessage)?.shortMessage ?? (err instanceof Error ? err.message : undefined);
  const trimmed = (short ?? "Something went wrong.").split("\n")[0].slice(0, 220);
  return trimmed;
}
