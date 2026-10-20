"use client";

import Link from "next/link";
import { zeroAddress, type Address } from "viem";
import { normalizeAddress } from "@/lib/config";
import { monLabel, shortAddress } from "@/lib/format";
import { useCoin, useCollection, useCurve, useFloor } from "@/lib/hooks";
import { BuyControl } from "./CoinActions";
import { CoinAvatar } from "./art";
import { AddressLink } from "./bits";
import { HoldersBoard } from "./HoldersBoard";
import { ConfigGate } from "./ConfigNotice";
import { NextNftCard } from "./NextNftCard";
import { PriceChart } from "./PriceChart";
import { RafflePanel } from "./RafflePanel";
import { TradeCard } from "./TradeCard";
import { WinChance } from "./WinChance";
import { Badge, ButtonLink, Card, EmptyState, ErrorState, Skeleton, Stat } from "./ui";

export default function CoinDetail({ token }: { token: string }) {
  const normalized = normalizeAddress(token);
  if (!normalized) {
    return (
      <EmptyState
        title="That is not a coin address"
        body="Coin pages use the token contract address, like /coin/0x… . Check the link or pick a coin from Explore."
        action={<ButtonLink href="/explore">Back to Explore</ButtonLink>}
      />
    );
  }
  return (
    <ConfigGate>
      <CoinInner token={normalized} />
    </ConfigGate>
  );
}

function CoinInner({ token }: { token: Address }) {
  const { coin, isLoading, error, refetch } = useCoin(token);
  const collection = useCollection(coin?.collection);
  const floor = useFloor(coin?.collection);
  const curve = useCurve(coin?.token);

  if (isLoading) {
    return (
      <div role="status" aria-label="Loading coin" className="space-y-5">
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (!coin) {
    if (error) return <ErrorState onRetry={refetch} />;
    return (
      <EmptyState
        title="FloorVault does not know this coin"
        body="It was not launched through this vault, or it is still confirming. If you just launched it, give it a few seconds."
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <ButtonLink href="/explore">Back to Explore</ButtonLink>
          </div>
        }
      />
    );
  }

  const collectionName = collection.data?.name ?? shortAddress(coin.collection);

  return (
    <div className="space-y-6">
      <Link href="/explore" className="inline-block text-sm font-bold text-brand-soft hover:underline">
        &larr; All coins
      </Link>

      <Card className="flex items-center gap-4 p-4 sm:p-5">
        <CoinAvatar image={coin.image} seed={coin.token} name={coin.name} className="size-16 shrink-0 sm:size-20" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words font-display text-2xl font-bold leading-tight sm:text-3xl">{coin.name}</h1>
            <Badge tone="brand">${coin.symbol}</Badge>
            <Badge tone="mint">{collectionName}</Badge>
          </div>
          {coin.description ? <p className="mt-1 line-clamp-2 text-sm text-muted">{coin.description}</p> : null}
          <p className="mt-1 text-xs text-muted">
            Token <AddressLink address={coin.token} />
            {coin.creator !== zeroAddress ? (
              <>
                {" "}
                &middot; launched by <AddressLink address={coin.creator} />
              </>
            ) : null}
          </p>
        </div>
      </Card>

      <section aria-label="Price and trading" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <PriceChart coin={coin} curve={curve.data} curveLoading={curve.isLoading} />
        </div>
        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <TradeCard coin={coin} curve={curve.data} />
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <NextNftCard coin={coin} floor={floor} curve={curve.data} collectionName={collectionName} />
        </div>
      </section>

      <HoldersBoard coin={coin} />

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <RafflePanel coin={coin} collectionName={collectionName} />
        <WinChance coin={coin} />
      </div>

      <section aria-labelledby="stats-h">
        <h2 id="stats-h" className="sr-only">
          Stats
        </h2>
        <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat compact label="NFT budget" value={monLabel(coin.budget)} hint="Ready to spend on the floor" />
          <Stat
            compact
            label="Floor price"
            value={floor.isLoading ? "…" : floor.isError ? "n/a" : floor.data ? monLabel(floor.data.price) : "No listings"}
            hint={collectionName}
          />
          <Stat
            compact
            label="NFTs bought"
            value={coin.boughtCount}
            hint={coin.boughtCount ? `${monLabel(coin.spentTotal)} spent` : "None yet"}
          />
          <Stat
            compact
            label="Fees claimed"
            value={monLabel(coin.claimedTotal)}
            hint={`${monLabel(coin.treasuryTotal)} to the treasury`}
          />
        </dl>
      </section>

      <section aria-labelledby="how-h">
        <Card className="grid gap-4 p-4 text-sm text-muted sm:p-5 md:grid-cols-[1fr_1fr_auto] md:items-start">
          <div>
            <h2 id="how-h" className="font-display text-base font-semibold text-text">
              1. Harvest fees
            </h2>
            <p className="mt-0.5">
              Automatic. Once nad.fun settles this coin&apos;s creator fees, the keeper pulls them in: 80% becomes NFT
              budget, 10% goes to the creator and 10% to the treasury.
            </p>
          </div>
          <div>
            <h3 className="font-display text-base font-semibold text-text">2. Buy the floor</h3>
            <p className="mt-0.5">
              When the budget covers the cheapest listing, the keeper buys it and a raffle opens for this coin&apos;s
              holders. With no taker, it goes to <AddressLink address={coin.nftRecipient} />, the launcher.
            </p>
          </div>
          <div className="md:w-56">
            <BuyControl coin={coin} compact />
          </div>
        </Card>
      </section>
    </div>
  );
}
