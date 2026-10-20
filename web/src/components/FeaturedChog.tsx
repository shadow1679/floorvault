"use client";

import { configResult } from "@/lib/config";
import { IS_MAINNET } from "@/lib/constants";
import { monLabel } from "@/lib/format";
import { useCollection, useCollectionSupply, useFloor, useVaultData } from "@/lib/hooks";
import { GeneratedArt } from "./art";
import { ConfigNotice } from "./ConfigNotice";
import { ButtonLink, Card, Stat } from "./ui";

export default function FeaturedChog() {
  if (!configResult.ok) return <ConfigNotice compact />;
  return <FeaturedInner chog={configResult.config.collection} />;
}

function FeaturedInner({ chog }: { chog: `0x${string}` }) {
  const info = useCollection(chog);
  const supply = useCollectionSupply(chog);
  const floor = useFloor(chog);
  const vault = useVaultData();
  const pairedCoins = (vault.data?.coins ?? []).filter((c) => c.collection.toLowerCase() === chog.toLowerCase()).length;

  return (
    <Card className="grid gap-6 overflow-hidden p-5 sm:p-7 md:grid-cols-[14rem_1fr] md:items-center">
      <div className="mx-auto aspect-square w-48 overflow-hidden rounded-3xl md:w-full">
        <GeneratedArt seed={`${chog}:chog`} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold uppercase tracking-wide text-pink">Featured collection</p>
        <h3 className="font-display text-3xl font-bold sm:text-4xl">{info.data?.name ?? "CHOG"}</h3>
        <p className="mt-1 max-w-xl text-muted">
          The hackathon&apos;s hero collection. Launch a coin that buys CHOG and every trade becomes a bid under its floor.
        </p>
        <dl className="mt-5 grid grid-cols-3 gap-3">
          <Stat
            label={IS_MAINNET ? "OpenSea floor" : "Floor"}
            value={floor.isLoading ? "…" : floor.isError ? "n/a" : floor.data ? monLabel(floor.data.price) : "None"}
          />
          <Stat label="Minted" value={supply.isLoading ? "…" : supply.data == null ? "n/a" : supply.data.toString()} />
          <Stat label="Coins" value={vault.isLoading ? "…" : pairedCoins} />
        </dl>
        <div className="mt-5 flex flex-wrap gap-3">
          <ButtonLink href={`/launch?collection=${chog}`}>Launch a CHOG coin</ButtonLink>
          <ButtonLink href="/explore" variant="secondary">
            See coins
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}
