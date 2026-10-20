"use client";

import { useEffect, useState } from "react";
import { useConnection } from "wagmi";
import { formatEther } from "viem";
import type { Coin, CurveInfo } from "@/lib/chain";
import { EXPLORER_URL, IS_MAINNET } from "@/lib/constants";
import { explorerTxUrl, formatMon, monLabel, parseMonInput } from "@/lib/format";
import { useTradeQuote, useWalletBalances } from "@/lib/hooks";
import { useTrade } from "@/lib/tx";
import { formatPrice, minAfterSlippage, SLIPPAGE_OPTIONS_BPS } from "@/lib/trades";
import { isBusy, TxButton, TxStatus } from "./tx";
import { Card, cx } from "./ui";

type Side = "buy" | "sell";

/** The value, but only after it has stopped changing for `ms`, so typing does not fire a quote per key. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const BUY_PRESETS = ["0.1", "0.5", "1"];

/** Buy or sell the coin on nad.fun through its router, priced on the bonding curve. */
export function TradeCard({ coin, curve }: { coin: Coin; curve?: CurveInfo | null }) {
  const { address } = useConnection();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(300);
  const settled = useDebounced(amount, 350);

  const parsed = parseMonInput(amount);
  const amountWei = parseMonInput(settled);
  const quote = useTradeQuote(coin.token, side, amountWei);
  const balances = useWalletBalances(coin.token, address);
  const { state, trade, reset } = useTrade();
  const busy = isBusy(state);

  const balance = side === "buy" ? balances.data?.mon : balances.data?.coin;
  const unit = side === "buy" ? "MON" : `$${coin.symbol}`;
  const outUnit = side === "buy" ? `$${coin.symbol}` : "MON";
  const q = quote.data;

  let problem: string | null = null;
  if (amount.trim() !== "" && parsed === null) problem = "Enter a number such as 0.5.";
  else if (parsed !== null && parsed > 0n && balance !== undefined && parsed > balance) {
    problem = side === "buy" ? "That is more MON than this wallet holds." : `You only hold ${formatMon(balance, 4)} $${coin.symbol}.`;
  }

  const waiting = parsed !== null && parsed > 0n && (settled !== amount || quote.isFetching);
  const unquotable = !waiting && amountWei !== null && amountWei > 0n && !quote.isError && q === null;
  const ready = !problem && !waiting && !!q && q > 0n && amountWei !== null && amountWei === parsed && !busy;

  const switchSide = (next: Side) => {
    if (next === side || busy) return;
    setSide(next);
    setAmount("");
    reset();
  };

  const submit = async () => {
    if (!ready || q === null || q === undefined || amountWei === null) return;
    const done = await trade({ side, token: coin.token, amountIn: amountWei, amountOutMin: minAfterSlippage(q, slippageBps) });
    if (done) setAmount("");
  };

  const effectivePrice =
    q && amountWei && q > 0n ? (side === "buy" ? Number(amountWei) / Number(q) : Number(q) / Number(amountWei)) : null;
  const r = state.result;

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="font-display text-2xl font-semibold">Trade ${coin.symbol}</h2>

      <div role="group" aria-label="Buy or sell" className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-card-2 p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            onClick={() => switchSide(s)}
            className={cx(
              "min-h-11 rounded-full font-display text-base font-semibold transition-colors",
              side === s ? (s === "buy" ? "bg-mint text-ink" : "bg-pink text-ink") : "text-muted hover:text-text",
            )}
          >
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="trade-amount" className="text-sm font-bold">
            {side === "buy" ? "You pay" : "You sell"} ({unit})
          </label>
          {address && balance !== undefined ? (
            <span className="text-xs text-muted">Balance {formatMon(balance, 4)}</span>
          ) : null}
        </div>
        <div className="mt-1 flex gap-2">
          <input
            id="trade-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.0"
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value.replace(",", "."))}
            aria-invalid={problem ? true : undefined}
            aria-describedby="trade-hint"
            className="min-h-11 w-full min-w-0 rounded-2xl border-2 border-line bg-ink px-4 font-mono text-lg tabular-nums outline-none focus:border-brand"
          />
          {side === "sell" && balances.data && balances.data.coin > 0n ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setAmount(formatEther(balances.data!.coin))}
              className="min-h-11 shrink-0 rounded-2xl border-2 border-line px-4 text-sm font-bold text-brand-soft hover:border-brand disabled:opacity-55"
            >
              Max
            </button>
          ) : null}
        </div>
        {side === "buy" ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {BUY_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={busy}
                onClick={() => setAmount(p)}
                className="min-h-9 rounded-full bg-card-2 px-3.5 text-sm font-bold text-muted hover:text-text disabled:opacity-55"
              >
                {p} MON
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div id="trade-hint" aria-live="polite" className="mt-3 min-h-[3.5rem] space-y-0.5 text-sm">
        {problem ? (
          <p role="alert" className="font-semibold text-danger">
            {problem}
          </p>
        ) : curve?.graduated ? (
          <p className="text-lemon">This coin has graduated from the bonding curve. nad.fun&apos;s curve quotes no longer apply, so trading is off here.</p>
        ) : waiting ? (
          <p className="fv-pulse font-semibold text-brand-soft">Getting a quote…</p>
        ) : quote.isError ? (
          <p className="text-danger">Could not get a quote. The RPC may be busy; try again.</p>
        ) : unquotable ? (
          <p className="text-muted">The curve cannot quote that amount. Try a smaller one.</p>
        ) : q && q > 0n ? (
          <>
            <p>
              You get about <span className="font-bold text-text">{formatMon(q, 4)} {outUnit}</span>
              {effectivePrice ? <span className="text-muted"> at {formatPrice(effectivePrice)} MON each</span> : null}
            </p>
            <p className="text-muted">
              At least {formatMon(minAfterSlippage(q, slippageBps), 4)} {outUnit} or the trade is cancelled.
            </p>
          </>
        ) : (
          <p className="text-muted">Enter an amount to see what you would get.</p>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span id="slippage-label" className="text-xs font-bold uppercase tracking-wide text-muted">
          Slippage
        </span>
        <div role="group" aria-labelledby="slippage-label" className="flex gap-1">
          {SLIPPAGE_OPTIONS_BPS.map((bps) => (
            <button
              key={bps}
              type="button"
              aria-pressed={slippageBps === bps}
              disabled={busy}
              onClick={() => setSlippageBps(bps)}
              className={cx(
                "min-h-9 rounded-full px-3 text-sm font-bold",
                slippageBps === bps ? "bg-brand/20 text-brand-soft" : "bg-card-2 text-muted hover:text-text",
              )}
            >
              {bps / 100}%
            </button>
          ))}
        </div>
      </div>

      <TxButton
        busy={busy}
        disabled={!ready || !!curve?.graduated}
        onAction={() => void submit()}
        className={cx("mt-4 w-full", side === "sell" && "!bg-pink hover:!bg-pink/80")}
      >
        {busy ? (side === "buy" ? "Buying…" : "Selling…") : side === "buy" ? `Buy $${coin.symbol}` : `Sell $${coin.symbol}`}
      </TxButton>
      <TxStatus state={state} />
      {state.phase === "success" && r ? (
        <div role="status" className="mt-2 rounded-2xl bg-card-2 p-3 text-sm">
          <p className="font-bold text-mint">
            {r.side === "buy"
              ? `Bought ${formatMon(r.amountOut, 4)} $${coin.symbol} for ${monLabel(r.amountIn)}`
              : `Sold ${formatMon(r.amountIn, 4)} $${coin.symbol} for ${monLabel(r.amountOut)}`}
          </p>
          <a href={explorerTxUrl(EXPLORER_URL, r.hash)} target="_blank" rel="noreferrer" className="text-xs text-muted underline hover:text-text">
            View transaction
          </a>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-muted">
        Trades go through nad.fun&apos;s router on Monad {IS_MAINNET ? "mainnet" : "testnet"}. A share of each trade is the creator fee that later pays for
        this coin&apos;s NFTs. Selling asks your wallet to approve the amount first.
      </p>
    </Card>
  );
}
