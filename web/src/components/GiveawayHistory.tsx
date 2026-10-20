"use client";

import { useConnection } from "wagmi";
import type { Coin } from "@/lib/chain";
import { isSameAddress } from "@/lib/format";
import { useBlockClock, useNowSeconds } from "@/lib/hooks";
import { formatCountdown, raffleStep, winnerStatus, type RaffleState, type RaffleSummary, type WinnerRecord } from "@/lib/raffle";
import { secondsAgo } from "@/lib/trades";
import { NftArt } from "./art";
import { AddressLink } from "./bits";
import { Badge, Card } from "./ui";

type Tone = "brand" | "mint" | "pink" | "lemon" | "muted";

const STATUS: Record<ReturnType<typeof winnerStatus>, { label: string; tone: Tone }> = {
  claimable: { label: "Can claim", tone: "lemon" },
  claimed: { label: "Claimed", tone: "mint" },
  expired: { label: "Did not claim", tone: "pink" },
  open: { label: "Picked", tone: "brand" },
  fallback: { label: "Sent to recipient", tone: "muted" },
};

/**
 * Finished giveaways for one coin: a tile per NFT that was claimed or sent to the launch recipient,
 * and a list of every result, including winners who ran out of time. Claiming happens on the live card.
 */
export function GiveawayHistory({
  coin,
  collectionName,
  raffles,
  states,
  winners,
}: {
  coin: Coin;
  collectionName: string;
  raffles: RaffleSummary[];
  states: Map<string, RaffleState> | undefined;
  winners: WinnerRecord[];
}) {
  const now = useNowSeconds();
  const tiles = raffles.flatMap((r) => {
    const state = states?.get(r.id.toString());
    if (!state) return [];
    const kind = raffleStep(state, now).kind;
    return kind === "claimed" || kind === "fallback" ? [{ summary: r, state }] : [];
  });
  const claimed = winners.filter((w) => w.outcome === "claimed").length;

  return (
    <section aria-labelledby="history-h" className="mt-8">
      <h2 id="history-h" className="font-display text-2xl font-semibold">
        Giveaway history
      </h2>
      <p className="mb-4 mt-1 text-muted">
        {winners.length === 0
          ? `No winner has been picked yet. Every result of a $${coin.symbol} giveaway is listed here.`
          : `${winners.length} result${winners.length === 1 ? "" : "s"}, ${claimed} claimed.`}
      </p>

      {tiles.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map(({ summary, state }) => (
            <li key={summary.id.toString()}>
              <GiveawayTile summary={summary} state={state} collectionName={collectionName} />
            </li>
          ))}
        </ul>
      ) : null}

      {winners.length > 0 ? (
        <>
          <h3 className="mb-3 mt-8 font-display text-xl font-semibold">Winners</h3>
          <WinnersList winners={winners} collectionName={collectionName} />
        </>
      ) : null}
    </section>
  );
}

function GiveawayTile({
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
  const step = raffleStep(state, now);
  const isWinner = isSameAddress(address, state.winner);
  const name = `${collectionName} #${summary.tokenId.toString()}`;
  const badge = step.kind === "claimed" ? STATUS.claimed : STATUS.fallback;

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <NftArt collection={summary.collection} tokenId={summary.tokenId} alt={name} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-display text-lg font-semibold">{name}</h4>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>

        {step.kind === "claimed" ? (
          <p className="text-sm text-muted">
            Claimed by {isWinner ? <span className="font-bold text-mint">you</span> : <AddressLink address={state.winner} />}.
          </p>
        ) : null}
        {step.kind === "fallback" ? (
          <p className="text-sm text-muted">
            Nobody held the coin when the round closed, so the NFT went to <AddressLink address={summary.fallbackTo} />.
          </p>
        ) : null}

        {summary.pastWinners.length > 0 ? (
          <p className="text-xs text-muted">
            Earlier winner{summary.pastWinners.length === 1 ? "" : "s"} who did not claim:{" "}
            {summary.pastWinners.map((w, i) => (
              <span key={`${w}-${i}`}>
                {i > 0 ? ", " : ""}
                <AddressLink address={w} />
              </span>
            ))}
          </p>
        ) : null}

      </div>
    </Card>
  );
}

function WinnersList({ winners, collectionName }: { winners: WinnerRecord[]; collectionName: string }) {
  const now = useNowSeconds();
  const { address } = useConnection();
  const clock = useBlockClock();

  const ago = (block: bigint) => {
    if (!clock.data) return null;
    const secs = secondsAgo(Number(block), clock.data.headBlock, clock.data.secPerBlock);
    return secs < 60 ? "just now" : `${formatCountdown(BigInt(secs))} ago`;
  };

  return (
    <Card>
      <ul className="divide-y divide-line">
        {winners.map((w) => {
          const status = winnerStatus(w, now);
          const badge = STATUS[status];
          const when = ago(w.blockNumber);
          const you = isSameAddress(address, w.winner);
          return (
            <li key={`${w.raffleId}-${w.round}-${w.blockNumber}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block">
                  <AddressLink address={w.winner} />
                  {you ? <span className="ml-2 text-sm font-bold text-mint">you</span> : null}
                </span>
                <span className="block text-sm text-muted">
                  {collectionName} #{w.tokenId.toString()} &middot; round {w.round}
                  {when ? <> &middot; {when}</> : null}
                </span>
              </span>
              <Badge tone={badge.tone}>{badge.label}</Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
