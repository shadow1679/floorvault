"use client";

import Link from "next/link";
import type { Coin } from "@/lib/chain";
import { zeroAddress } from "viem";
import { IS_MAINNET } from "@/lib/constants";
import { budgetGap, isSameAddress, monLabel } from "@/lib/format";
import { useFloor, useKeeper } from "@/lib/hooks";
import { useBuy, useWalletStatus } from "@/lib/tx";
import { isBusy, TxButton, TxStatus } from "./tx";
import { cx } from "./ui";

export function BuyControl({ coin, compact = false }: { coin: Coin; compact?: boolean }) {
  const { state, buy } = useBuy();
  const floor = useFloor(coin.collection);
  const keeper = useKeeper();
  const { address } = useWalletStatus();
  const price = floor.data?.price;
  const hasListing = !!floor.data;
  const gap = price !== undefined ? budgetGap(price, coin.budget) : 0n;
  const canBuy = hasListing && gap === 0n;
  const r = state.result;

  // Only the keeper may call FloorVault.buy. On mainnet it also needs a signed OpenSea order picked
  // off-chain, so there is nothing for a browser wallet to press there.
  const keeperOnly = IS_MAINNET || (!!keeper.data && keeper.data !== zeroAddress && !isSameAddress(keeper.data, address));

  let hint: string | null = null;
  if (floor.isLoading) hint = "Checking the floor…";
  else if (floor.isError) hint = "Could not read the floor price.";
  else if (!hasListing) hint = "No NFTs are listed for this collection right now.";
  else if (gap > 0n) hint = `Floor is ${monLabel(price!)}. Needs ${monLabel(gap)} more in budget.`;
  else hint = `Floor is ${monLabel(price!)}. Budget covers it.`;

  if (keeperOnly) {
    return (
      <div className="min-w-0">
        <p className={cx("text-sm", canBuy ? "text-mint" : "text-muted")}>{hint}</p>
        <p className="mt-1.5 text-sm text-muted">
          Buying is automatic: the vault&apos;s keeper buys the cheapest listing as soon as the budget covers it.
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <TxButton
        busy={isBusy(state)}
        disabled={!canBuy}
        onAction={() => void buy(coin.token, price!)}
        className={compact ? "w-full" : "w-full sm:w-auto"}
      >
        {isBusy(state) ? "Buying…" : price !== undefined ? `Buy floor NFT (${monLabel(price)})` : "Buy floor NFT"}
      </TxButton>
      <p className={cx("mt-1.5 text-sm", canBuy ? "text-mint" : "text-muted")}>{hint}</p>
      <TxStatus state={state} />
      {state.phase === "success" && r ? (
        <div className="mt-2 rounded-2xl bg-card-2 p-3 text-sm" role="status">
          <p className="font-bold text-mint">
            Bought NFT #{r.tokenId.toString()} for {monLabel(r.price)}
          </p>
          <p className="mt-1 text-muted">A raffle for this coin&apos;s holders is now open on this page.</p>
          <Link href="/gallery" className="mt-1 inline-block font-bold text-brand-soft underline">
            See it in the Gallery
          </Link>
        </div>
      ) : null}
    </div>
  );
}
