"use client";

import { useMemo } from "react";
import { useConnection } from "wagmi";
import type { Coin } from "@/lib/chain";
import { isSameAddress } from "@/lib/format";
import { useNowSeconds, useRaffleStates, useVaultData } from "@/lib/hooks";
import { deriveRaffles, deriveWinners, raffleStep, type RaffleState, type RaffleSummary } from "@/lib/raffle";
import { useRaffleTx } from "@/lib/tx";
import { NftArt } from "./art";
import { AddressLink, Countdown } from "./bits";
import { GiveawayHistory } from "./GiveawayHistory";
import { isBusy, TxButton, TxStatus } from "./tx";
import { Badge, Card, ErrorState, Skeleton, cx } from "./ui";

/**
 * The raffle for this coin's bought NFTs. It only exists on the coin page: each NFT the vault buys
 * is raffled to the holders of this coin. The keeper runs every step up to the winner, so nobody presses
 * anything here except the winner, who claims on the card. Claimed NFTs move to the giveaway history.
 */
export function RafflePanel({ coin, collectionName }: { coin: Coin; collectionName: string }) {
  const vault = useVaultData();
  const now = useNowSeconds();
  const raffles = useMemo(() => deriveRaffles(vault.data?.raffleLogs ?? [], coin.token), [vault.data?.raffleLogs, coin.token]);
  const winners = useMemo(() => deriveWinners(vault.data?.raffleLogs ?? [], coin.token), [vault.data?.raffleLogs, coin.token]);
  const states = useRaffleStates(raffles.map((r) => r.id));

  const live = raffles.filter((r) => {
    const s = states.data?.get(r.id.toString());
    if (!s) return true;
    const kind = raffleStep(s, now).kind;
    return kind !== "claimed" && kind !== "fallback";
  });

  let body;
  if (vault.isLoading) {
    body = <Skeleton className="h-40" />;
  } else if (raffles.length === 0) {
    body = (
      <Card className="p-6 text-muted">
        No raffle yet. The next NFT this coin buys opens one, and every holder of ${coin.symbol} is in it automatically.
      </Card>
    );
  } else if (states.isError && !states.data) {
    body = <ErrorState onRetry={() => void states.refetch()} />;
  } else if (live.length === 0) {
    body = (
      <Card className="p-6 text-muted">
        No giveaway is running right now. The next NFT this coin buys opens one, and every holder of ${coin.symbol} is in it
        automatically.
      </Card>
    );
  } else {
    body = (
      <ul className="space-y-4">
        {live.map((r) => {
          const state = states.data?.get(r.id.toString());
          return (
            <li key={r.id.toString()}>
              {state ? (
                <RaffleCard summary={r} state={state} collectionName={collectionName} />
              ) : (
                <Skeleton className="h-40" />
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section aria-labelledby="raffle-h">
      <h2 id="raffle-h" className="font-display text-2xl font-semibold">
        Holder raffle
      </h2>
      <p className="mb-4 mt-1 max-w-3xl text-muted">
        Every NFT this coin buys is raffled to the people who hold ${coin.symbol}. There is nothing to enter and nothing to
        press: holding the coin is enough, a bigger balance gives better odds, and the draw runs by itself. The winner is
        shown here and has 7 days to claim. If they don&apos;t, the NFT is raffled again automatically and the old winner is
        out.
      </p>
      {body}
      {raffles.length > 0 && !vault.isLoading ? (
        <GiveawayHistory coin={coin} collectionName={collectionName} raffles={raffles} states={states.data} winners={winners} />
      ) : null}
      <p className="mt-4 max-w-3xl text-xs text-muted">
        Demo-grade fairness: the draw seed comes from the block&apos;s <span className="font-mono">prevrandao</span>, which a
        validator could nudge, and the odds follow balance only approximately. If nobody holds the coin when a round
        closes, the NFT goes to the recipient chosen at launch.
      </p>
    </section>
  );
}

function RaffleCard({
  summary,
  state,
  collectionName,
}: {
  summary: RaffleSummary;
  state: RaffleState;
  collectionName: string;
}) {
  const now = useNowSeconds();
  const { address } = useConnection();
  const { state: tx, send } = useRaffleTx();
  const step = raffleStep(state, now);
  const busy = isBusy(tx);
  const isWinner = isSameAddress(address, state.winner);
  const mine = isWinner && step.kind === "claimable";
  const name = `${collectionName} #${summary.tokenId.toString()}`;

  return (
    <Card className={cx("overflow-hidden sm:flex", mine && "border-mint ring-2 ring-mint/30")}>
      <NftArt
        collection={summary.collection}
        tokenId={summary.tokenId}
        alt={name}
        className="sm:size-56 sm:w-56 sm:shrink-0"
      />
      <div className="min-w-0 flex-1 space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-xl font-semibold">{name}</h3>
          <Badge tone="muted">Raffle #{summary.id.toString()}</Badge>
          <Badge tone="brand">Round {state.round}</Badge>
          <StageBadge kind={step.kind} />
        </div>

        {step.kind === "wait-draw" ? (
          <p className="text-muted">
            The draw runs automatically in <Countdown until={step.until} />. Every holder of the coin is in.
          </p>
        ) : null}

        {step.kind === "can-draw" ? (
          <p className="fv-pulse text-muted">Drawing now. The winner shows up here in a minute or so.</p>
        ) : null}

        {step.kind === "settling" ? (
          <>
            <p className="text-muted">
              Drawn. Holders are being ranked and the winner is locked in automatically in <Countdown until={step.until} />. A
              bigger balance gives a better score.
            </p>
            <Leader state={state} />
          </>
        ) : null}

        {step.kind === "can-finalize" ? (
          <p className="fv-pulse text-muted">Locking in the winner. This takes a minute or so.</p>
        ) : null}

        {step.kind === "claimable" ? (
          <>
            <div className={cx("rounded-2xl border p-3", mine ? "border-mint/40 bg-mint/10" : "border-line")}>
              <p className="text-sm text-muted">Winner</p>
              <p className="break-all font-display text-lg font-semibold">
                <AddressLink address={state.winner} />
                {mine ? <span className="ml-2 text-mint">you</span> : null}
              </p>
              <p className="mt-1 text-sm text-muted">
                {mine ? "You won this NFT! Claim it within " : "Only the winner can claim, and has "}
                <Countdown until={step.until} />
                {mine ? " or it is raffled again." : " left. If they don't, it is raffled again automatically."}
              </p>
            </div>
            {mine ? (
              <TxButton busy={busy} onAction={() => void send({ fn: "claim", id: summary.id })} className="w-full sm:w-auto">
                {busy ? "Claiming…" : "Claim NFT"}
              </TxButton>
            ) : (
              <p className="text-xs text-muted">Connect the winner wallet to claim.</p>
            )}
          </>
        ) : null}

        {step.kind === "expired" ? (
          <p className="fv-pulse text-muted">
            <AddressLink address={state.winner} /> did not claim in time. A new round starts automatically and they cannot
            win it again.
          </p>
        ) : null}

        {summary.pastWinners.length > 0 ? (
          <p className="text-sm text-muted">
            Out of this raffle (did not claim in time):{" "}
            {summary.pastWinners.map((w, i) => (
              <span key={`${w}-${i}`}>
                {i > 0 ? ", " : ""}
                <AddressLink address={w} />
              </span>
            ))}
          </p>
        ) : null}

        <TxStatus state={tx} />
        {tx.phase === "success" ? (
          <p role="status" className="text-sm font-bold text-mint">
            Claimed. The page updates in a few seconds.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function StageBadge({ kind }: { kind: ReturnType<typeof raffleStep>["kind"] }) {
  const map: Record<typeof kind, { label: string; tone: "brand" | "mint" | "pink" | "lemon" | "muted" }> = {
    "wait-draw": { label: "Waiting for the draw", tone: "muted" },
    "can-draw": { label: "Drawing", tone: "brand" },
    settling: { label: "Picking the winner", tone: "brand" },
    "can-finalize": { label: "Picking the winner", tone: "brand" },
    claimable: { label: "Winner picked", tone: "mint" },
    expired: { label: "Unclaimed, re-raffling", tone: "pink" },
    claimed: { label: "Claimed", tone: "mint" },
    fallback: { label: "Sent to recipient", tone: "muted" },
  };
  const m = map[kind];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

function Leader({ state }: { state: RaffleState }) {
  const none = state.leader === "0x0000000000000000000000000000000000000000";
  return (
    <p className="text-sm text-muted">
      Leading right now: {none ? <span className="font-bold text-text">nobody yet</span> : <AddressLink address={state.leader} />}
    </p>
  );
}
