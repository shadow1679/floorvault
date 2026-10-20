"use client";

import { ConfigGate } from "./ConfigNotice";
import CoinCard from "./CoinCard";
import { ButtonLink, EmptyState, ErrorState, GridSkeleton, IndexingNote } from "./ui";
import { useVaultData } from "@/lib/hooks";

export default function ExploreView() {
  return (
    <ConfigGate>
      <ExploreInner />
    </ConfigGate>
  );
}

function ExploreInner() {
  const { data, isLoading, refetch } = useVaultData();

  if (isLoading) return <GridSkeleton />;
  if (!data) return <ErrorState onRetry={() => void refetch()} />;
  if (data.coins.length === 0 && data.indexing) {
    return (
      <>
        <IndexingNote scannedTo={data.scannedTo} />
        <GridSkeleton />
      </>
    );
  }
  if (data.coins.length === 0) {
    return (
      <EmptyState
        title="No coins yet"
        body="Nobody has launched a coin on this vault. Be the first: pick a collection and let the fees start stacking."
        action={<ButtonLink href="/launch">Launch a coin</ButtonLink>}
      />
    );
  }
  return (
    <>
      {data.indexing ? <IndexingNote scannedTo={data.scannedTo} /> : null}
      <p className="mb-4 text-sm text-muted">
        {data.coins.length} coin{data.coins.length === 1 ? "" : "s"} launched
      </p>
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {data.coins.map((c) => (
          <li key={c.token}>
            <CoinCard coin={c} />
          </li>
        ))}
      </ul>
    </>
  );
}
