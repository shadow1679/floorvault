"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { parseUnits, zeroAddress } from "viem";
import { useConnection } from "wagmi";
import type { Coin } from "@/lib/chain";
import { NAD_BONDING_CURVE } from "@/lib/constants";
import { formatTokens } from "@/lib/format";
import { winChances } from "@/lib/holders";
import { useAppConfig, useHolders } from "@/lib/hooks";
import { Card, Skeleton, Stat } from "./ui";

/** "12.3%", "0.04%", "<0.01%". */
function formatChance(p: number): string {
  if (p <= 0) return "0%";
  const pct = p * 100;
  if (pct < 0.01) return "<0.01%";
  return `${pct.toFixed(pct >= 10 ? 1 : 2)}%`;
}

/** "1 in 8", from a probability. */
function oneIn(p: number): string {
  if (p <= 0) return "never";
  if (p >= 0.995) return "a sure thing";
  return `1 in ${new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(Math.round(1 / p))}`;
}

function parseTokens(value: string): bigint | null {
  const v = value.trim();
  if (!v || !/^\d*\.?\d*$/.test(v) || v === ".") return null;
  try {
    return parseUnits(v, 18);
  } catch {
    return null;
  }
}

/**
 * Your chance of winning each NFT this coin buys, worked out from the live holder list with the same rule
 * the Raffle contract uses (lowest hash(seed, holder) / balance). The what-if box swaps in a different
 * balance for you, so a visitor can see what buying more (or less) would do to their odds.
 */
export function WinChance({ coin }: { coin: Coin }) {
  const cfg = useAppConfig();
  const { address } = useConnection();
  const holders = useHolders(coin.token, coin.launchBlock);
  const [whatIf, setWhatIf] = useState("");
  const deferredWhatIf = useDeferredValue(whatIf);

  const me = address?.toLowerCase();
  const balances = holders.data?.balances;

  // Everyone but the protocol addresses can win. "Others" excludes the viewer so their balance can be swapped.
  const { others, myBalance } = useMemo(() => {
    const skip = new Set<string>([zeroAddress, NAD_BONDING_CURVE.toLowerCase()]);
    if (cfg.ok) {
      skip.add(cfg.config.floorVault.toLowerCase());
      skip.add(cfg.config.raffle.toLowerCase());
    }
    const rest: bigint[] = [];
    let mine = 0n;
    for (const [holder, balance] of Object.entries(balances ?? {})) {
      if (balance <= 0n || skip.has(holder)) continue;
      if (holder === me) mine = balance;
      else rest.push(balance);
    }
    return { others: rest, myBalance: mine };
  }, [balances, cfg, me]);

  const whatIfBalance = parseTokens(deferredWhatIf);
  const usingWhatIf = whatIfBalance !== null;
  const mine = whatIfBalance ?? myBalance;

  const chance = useMemo(() => {
    if (mine <= 0n) return 0;
    return winChances([mine, ...others])[0];
  }, [mine, others]);

  const totalEligible = others.reduce((s, b) => s + b, 0n) + mine;
  const share = totalEligible > 0n ? Number((mine * 1_000_000n) / totalEligible) / 1_000_000 : 0;
  const eligibleHolders = others.length + (mine > 0n ? 1 : 0);

  let body;
  if (holders.isError && !holders.data) {
    body = <Card className="p-6 text-muted">Could not read this coin&apos;s holders, so the odds are not available right now.</Card>;
  } else if (!holders.data) {
    body = <Skeleton className="h-40" />;
  } else {
    body = (
      <Card className="grid gap-5 p-4 sm:p-5">
        <div>
          <p className="mb-3 text-sm font-bold text-muted">
            {usingWhatIf
              ? `If you held ${formatTokens(mine)} $${coin.symbol}`
              : address
                ? mine > 0n
                  ? `Your ${formatTokens(mine)} $${coin.symbol}`
                  : `You hold no $${coin.symbol}`
                : "Connect a wallet to see your own odds"}
          </p>
          <dl className="grid grid-cols-2 gap-2">
            <Stat compact label="Win chance" value={formatChance(chance)} hint="Per NFT this coin buys" />
            <Stat compact label="Roughly" value={oneIn(chance)} hint="Over many raffles" />
            <Stat
              compact
              label="Share of eligible coins"
              value={formatChance(share)}
              hint={`${eligibleHolders} eligible holder${eligibleHolders === 1 ? "" : "s"}`}
            />
            <Stat
              compact
              label="Eligible supply"
              value={formatTokens(totalEligible)}
              hint="Excludes the curve and vault contracts"
            />
          </dl>
        </div>

        <div>
          <label htmlFor="winchance-what-if" className="text-sm font-bold">
            What if I held…
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="winchance-what-if"
              inputMode="decimal"
              autoComplete="off"
              placeholder={myBalance > 0n ? formatTokens(myBalance) : "1000000"}
              value={whatIf}
              onChange={(e) => setWhatIf(e.target.value.replace(",", "."))}
              aria-invalid={whatIf.trim() !== "" && !usingWhatIf ? true : undefined}
              className="min-h-11 w-full min-w-0 rounded-2xl border-2 border-line bg-ink px-4 font-mono text-lg tabular-nums outline-none focus:border-brand"
            />
            <span className="shrink-0 text-sm text-muted">${coin.symbol}</span>
          </div>
          <p className="mt-2 text-xs text-muted">
            {whatIf.trim() !== "" && !usingWhatIf
              ? "Enter a plain number of coins, like 2500000."
              : "Type a balance to see how the odds would change. Everyone else stays as they are now."}
          </p>
          {usingWhatIf ? (
            <button
              type="button"
              onClick={() => setWhatIf("")}
              className="mt-2 text-xs font-bold text-brand-soft hover:underline"
            >
              Back to my real balance
            </button>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <section aria-labelledby="winchance-h">
      <h2 id="winchance-h" className="mb-1 font-display text-2xl font-semibold">
        Your winning chance
      </h2>
      <p className="mb-4 max-w-3xl text-sm text-muted">
        Each NFT goes to the holder with the lowest <span className="font-mono">hash(seed, holder) / balance</span>. The seed is
        random, so a bigger balance wins more often, and a little more than its plain share of the coins once it is large.
        The odds use today&apos;s balances and move as people buy and sell.
      </p>
      {body}
    </section>
  );
}
