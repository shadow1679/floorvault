"use client";

import { useMemo, useState } from "react";
import { useConnection } from "wagmi";
import type { Coin } from "@/lib/chain";
import { NAD_BONDING_CURVE } from "@/lib/constants";
import { formatTokens, isSameAddress } from "@/lib/format";
import { buildHolderRows } from "@/lib/holders";
import { useAppConfig, useHolders, useRaffleStates, useVaultData } from "@/lib/hooks";
import { deriveRaffles, Stage } from "@/lib/raffle";
import { AddressLink } from "./bits";
import { Badge, Card, ErrorState, Skeleton } from "./ui";

const PAGE_SIZE = 10;

/**
 * Who holds this coin. Balances come from the coin's Transfer logs, so the first visit scans the chain and
 * later ones only read new blocks. While a raffle is in its settle window, a "Draw" column shows each holder's
 * place in it. The bonding curve and the vault's own contracts are listed but cannot win.
 */
export function HoldersBoard({ coin }: { coin: Coin }) {
  const cfg = useAppConfig();
  const { address } = useConnection();
  const holders = useHolders(coin.token, coin.launchBlock);
  const vault = useVaultData();
  const raffles = useMemo(() => deriveRaffles(vault.data?.raffleLogs ?? [], coin.token), [vault.data?.raffleLogs, coin.token]);
  const states = useRaffleStates(raffles.map((r) => r.id));
  const [page, setPage] = useState(0);

  const seed = useMemo(() => {
    for (const s of states.data?.values() ?? []) if (s.stage === Stage.Settling) return s.seed;
    return null;
  }, [states.data]);

  const rows = useMemo(() => {
    if (!holders.data) return [];
    const labels: Record<string, string> = { [NAD_BONDING_CURVE]: "Bonding curve" };
    if (cfg.ok) {
      labels[cfg.config.floorVault] = "FloorVault";
      labels[cfg.config.raffle] = "Raffle";
    }
    return buildHolderRows(holders.data.balances, { labels, seed });
  }, [holders.data, cfg, seed]);

  let body;
  if (holders.isError && !holders.data) {
    body = <ErrorState title="Could not load holders" onRetry={() => void holders.refetch()} />;
  } else if (!holders.data) {
    body = (
      <div role="status" aria-label="Loading holders" className="space-y-3">
        <Skeleton className="h-48" />
        <p className="text-sm text-muted">Reading this coin&apos;s transfers from the chain. The first visit can take a minute.</p>
      </div>
    );
  } else if (rows.length === 0) {
    body = <Card className="p-6 text-muted">Nobody holds ${coin.symbol} yet.</Card>;
  } else {
    const pages = Math.ceil(rows.length / PAGE_SIZE);
    // Clamp rather than reset: a refresh that shrinks the list must not strand the reader on an empty page.
    const current = Math.min(page, pages - 1);
    const start = current * PAGE_SIZE;
    const shown = rows.slice(start, start + PAGE_SIZE);
    body = (
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[24rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr className="border-b border-line">
              <th scope="col" className="px-4 py-3">#</th>
              <th scope="col" className="px-4 py-3">Holder</th>
              <th scope="col" className="px-4 py-3 text-right">Balance</th>
              <th scope="col" className="px-4 py-3 text-right">% of supply</th>
              {seed ? <th scope="col" className="px-4 py-3 text-right">Draw</th> : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.holder} className="border-b border-line/50 last:border-0">
                <td className="px-4 py-2.5 tabular-nums text-muted">{start + i + 1}</td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <AddressLink address={r.holder} />
                    {r.label ? <Badge tone="muted">{r.label}</Badge> : null}
                    {isSameAddress(r.holder, address) ? <Badge tone="brand">You</Badge> : null}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatTokens(r.balance)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.percent < 0.01 ? "<0.01" : r.percent.toFixed(2)}%</td>
                {seed ? (
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {r.raffleRank ? (
                      <span className={r.raffleRank === 1 ? "font-bold text-mint" : undefined}>{r.raffleRank}</span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {pages > 1 ? (
          <nav aria-label="Holders pages" className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
            <button
              type="button"
              onClick={() => setPage(current - 1)}
              disabled={current === 0}
              className="font-bold text-brand-soft hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
            >
              &larr; Prev
            </button>
            <span className="tabular-nums text-muted">
              Page {current + 1} of {pages}
            </span>
            <button
              type="button"
              onClick={() => setPage(current + 1)}
              disabled={current >= pages - 1}
              className="font-bold text-brand-soft hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
            >
              Next &rarr;
            </button>
          </nav>
        ) : null}
      </Card>
    );
  }

  return (
    <section aria-labelledby="holders-h">
      <h2 id="holders-h" className="mb-1 font-display text-2xl font-semibold">
        Holders
      </h2>
      <p className="mb-4 text-sm text-muted">
        {holders.data ? `${rows.length} holder${rows.length === 1 ? "" : "s"}. ` : ""}
        Every holder is in the raffle, except the contracts labelled here.
        {seed ? " Draw is each holder's place in the raffle that is picking its winner now; 1 leads." : ""}
      </p>
      {body}
    </section>
  );
}
