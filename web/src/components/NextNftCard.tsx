"use client";

import type { Coin, CurveInfo, Floor } from "@/lib/chain";
import { formatMon, monLabel, nextBuyProgress, volumeToCloseGap } from "@/lib/format";
import { Card, Skeleton, cx } from "./ui";

/**
 * How close the coin is to buying its next NFT: the budget against the cheapest listing.
 * Budget only grows when fees are harvested, so this moves in steps, not with every trade.
 */
export function NextNftCard({
  coin,
  floor,
  curve,
  collectionName,
}: {
  coin: Coin;
  floor: { data?: Floor | null; isLoading: boolean; isError: boolean };
  curve?: CurveInfo | null;
  collectionName: string;
}) {
  let body;
  if (floor.isLoading) {
    body = <Skeleton className="h-16" />;
  } else if (floor.isError) {
    body = <p className="text-muted">Could not read the floor price, so progress is unknown.</p>;
  } else if (!floor.data) {
    body = (
      <p className="text-muted">
        Nothing is listed in {collectionName} right now. Once something is, this shows how close the budget is to buying it.
      </p>
    );
  } else {
    const p = nextBuyProgress(coin.budget, floor.data.price);
    const volume = volumeToCloseGap(p.gap, curve?.creatorFeeBps ?? 0);
    body = (
      <>
        <div className="flex items-baseline justify-between gap-3">
          <p className={cx("font-display text-4xl font-bold tabular-nums", p.ready ? "text-mint" : "text-text")}>{p.percent}%</p>
          <p className="text-right text-sm text-muted">
            {monLabel(coin.budget)} of {monLabel(floor.data.price)}
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="Budget toward the next NFT"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={p.percent}
          className="mt-2 h-3 overflow-hidden rounded-full bg-ink"
        >
          <div
            className={cx("h-full rounded-full transition-[width] duration-500", p.ready ? "bg-mint" : "bg-brand")}
            style={{ width: `${p.percent}%` }}
          />
        </div>
        {p.ready ? (
          <p className="mt-3 text-sm text-mint">The budget covers the floor. The keeper buys it automatically.</p>
        ) : (
          <p className="mt-3 text-sm text-muted">
            {monLabel(p.gap)} more budget to go.
            {volume > 0n ? (
              <>
                {" "}
                At this coin&apos;s {(curve!.creatorFeeBps / 100).toString()}% creator fee that is roughly{" "}
                <span className="font-bold text-text">{formatMon(volume, volume < 10n ** 19n ? 2 : 0)} MON</span> more trading. nad.fun pays fees out in
                batches, then the keeper harvests them into budget.
              </>
            ) : null}
          </p>
        )}
      </>
    );
  }

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="mb-3 font-display text-2xl font-semibold">Until the next NFT</h2>
      {body}
    </Card>
  );
}
