"use client";

import Link from "next/link";
import type { Coin } from "@/lib/chain";
import { monLabel, shortAddress } from "@/lib/format";
import { useCollection } from "@/lib/hooks";
import { CoinAvatar } from "./art";
import { Badge, Card } from "./ui";

export default function CoinCard({ coin }: { coin: Coin }) {
  const collection = useCollection(coin.collection);
  return (
    <Card className="group relative overflow-hidden transition-transform duration-200 hover:-translate-y-1 hover:border-brand focus-within:border-brand">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-card-2">
        <CoinAvatar
          image={coin.image}
          seed={coin.token}
          name={coin.name}
          className="size-full !rounded-none transition-transform duration-300 group-hover:scale-105"
        />
        <div className="absolute left-3 top-3">
          <Badge tone="brand">${coin.symbol}</Badge>
        </div>
      </div>
      <div className="p-5">
        <h3 className="truncate font-display text-2xl font-semibold">
          <Link href={`/coin/${coin.token}`} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-offset-[-3px]">
            {coin.name}
          </Link>
        </h3>
        <p className="mt-1 truncate text-sm text-muted">
          Buys <span className="font-bold text-text">{collection.data?.name ?? shortAddress(coin.collection)}</span>
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <dt className="text-xs font-bold uppercase tracking-wide text-muted">NFT budget</dt>
            <dd className="truncate font-display text-lg font-semibold text-brand-soft">{monLabel(coin.budget)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-bold uppercase tracking-wide text-muted">NFTs bought</dt>
            <dd className="font-display text-lg font-semibold">{coin.boughtCount}</dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}
