"use client";

import Link from "next/link";
import { useConnection } from "wagmi";
import { useAllRaffleStates, useNowSeconds } from "@/lib/hooks";
import { claimableWins, type ClaimableWin } from "@/lib/raffle";
import { useRaffleTx } from "@/lib/tx";
import { Countdown } from "./bits";
import { isBusy, TxButton, TxStatus } from "./tx";

/**
 * Shown on every page when the connected wallet has won a raffle and can still claim. The keeper does
 * everything up to the winner, but only the winner can claim, so this is how they find out.
 */
export default function WinnerBanner() {
  const { address } = useConnection();
  const states = useAllRaffleStates(!!address);
  const now = useNowSeconds();
  const wins = claimableWins(states.data, address, now);
  if (wins.length === 0) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
      <ul aria-label="NFTs you won" className="space-y-3">
        {wins.map((w) => (
          <li key={w.id.toString()}>
            <WinRow win={w} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function WinRow({ win }: { win: ClaimableWin }) {
  const { state: tx, send } = useRaffleTx();
  const busy = isBusy(tx);
  const { state } = win;

  return (
    <div role="status" className="rounded-2xl border border-mint/40 bg-mint/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold text-mint">You won NFT #{state.tokenId.toString()}!</p>
          <p className="text-sm text-muted">
            Claim it within <Countdown until={state.claimDeadline} /> or it is raffled again.{" "}
            <Link href={`/coin/${state.token}`} className="font-bold text-brand-soft underline">
              View the coin
            </Link>
          </p>
        </div>
        <TxButton busy={busy} onAction={() => void send({ fn: "claim", id: win.id })} className="w-full sm:w-auto">
          {busy ? "Claiming…" : "Claim"}
        </TxButton>
      </div>
      <TxStatus state={tx} />
    </div>
  );
}
