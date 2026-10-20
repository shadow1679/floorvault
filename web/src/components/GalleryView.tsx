"use client";

import Link from "next/link";
import type { BoughtNft } from "@/lib/chain";
import { monLabel, shortAddress } from "@/lib/format";
import { useCollection, useVaultData } from "@/lib/hooks";
import { NftArt } from "./art";
import { ConfigGate } from "./ConfigNotice";
import { ButtonLink, Card, EmptyState, ErrorState, GridSkeleton, IndexingNote } from "./ui";

export default function GalleryView() {
  return (
    <ConfigGate>
      <GalleryInner />
    </ConfigGate>
  );
}

function NftTile({ nft }: { nft: BoughtNft }) {
  const collection = useCollection(nft.collection);
  const name = `${collection.data?.name ?? "NFT"} #${nft.tokenId.toString()}`;
  return (
    <Card className="group relative overflow-hidden transition-transform duration-200 hover:-translate-y-1 hover:border-brand focus-within:border-brand">
      <NftArt
        collection={nft.collection}
        tokenId={nft.tokenId}
        alt={name}
        className="transition-transform duration-300 group-hover:scale-105"
      />
      <div className="space-y-1 bg-card p-4">
        <p className="truncate font-display text-xl font-semibold">{name}</p>
        <p className="text-sm text-muted">
          Bought for <span className="font-bold text-text">{monLabel(nft.price)}</span>
        </p>
        <p className="truncate text-sm text-muted">
          by{" "}
          <Link
            href={`/coin/${nft.token}`}
            className="font-bold text-brand-soft after:absolute after:inset-0 after:content-[''] focus-visible:outline-offset-[-3px]"
          >
            ${nft.coinSymbol ?? shortAddress(nft.token)}
          </Link>
        </p>
        <p className="truncate text-sm text-muted">
          raffled to ${nft.coinSymbol ?? shortAddress(nft.token)} holders
        </p>
      </div>
    </Card>
  );
}

function GalleryInner() {
  const { data, isLoading, refetch } = useVaultData();
  if (isLoading) return <GridSkeleton count={8} />;
  if (!data) return <ErrorState onRetry={() => void refetch()} />;
  if (data.bought.length === 0 && data.indexing) {
    return (
      <>
        <IndexingNote scannedTo={data.scannedTo} />
        <GridSkeleton count={8} />
      </>
    );
  }
  if (data.bought.length === 0) {
    return (
      <EmptyState
        title="The gallery is empty"
        body="No coin has bought an NFT yet. Coins buy automatically once their creator fees cover the floor price."
        action={<ButtonLink href="/explore">Explore coins</ButtonLink>}
      />
    );
  }
  return (
    <>
      {data.indexing ? <IndexingNote scannedTo={data.scannedTo} /> : null}
      <p className="mb-4 text-sm text-muted">
        {data.bought.length} NFT{data.bought.length === 1 ? "" : "s"} bought with creator fees
      </p>
      <ul className="grid grid-cols-1 gap-5 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.bought.map((b) => (
          <li key={`${b.transactionHash}:${b.logIndex}`}>
            <NftTile nft={b} />
          </li>
        ))}
      </ul>
    </>
  );
}
