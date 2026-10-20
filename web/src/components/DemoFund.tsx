"use client";

import { useState } from "react";
import { useConnection } from "wagmi";
import { formatEther } from "viem";
import type { Coin } from "@/lib/chain";
import { formatMon, monLabel, parseMonInput, splitFee } from "@/lib/format";
import { useDemoPot, useWalletBalances } from "@/lib/hooks";
import { useDemoFund } from "@/lib/tx";
import { isBusy, TxButton, TxStatus } from "./tx";

const STEP = 10n ** 14n;
const FALLBACK = "0.1";

/** Smallest round amount whose 80% budget share covers `gap`, so one press is enough to reach the floor. */
function amountToCover(gap: bigint): string {
  if (gap <= 0n) return FALLBACK;
  const { toBudget: shareFor1 } = splitFee(10n ** 18n);
  const raw = (gap * 10n ** 18n + shareFor1 - 1n) / shareFor1;
  return formatEther(((raw + STEP - 1n) / STEP) * STEP);
}

/**
 * Testnet demo only: nad.fun settles real creator fees after about 100 MON, so a demo would never see a
 * budget move. This pays MON from the connected wallet into the vault's DemoFeePot and harvests it. Renders
 * nothing unless the configured vault is a FloorVaultDemo.
 */
export function DemoFund({ coin, gap }: { coin: Coin; gap: bigint }) {
  const pot = useDemoPot();
  const { address } = useConnection();
  const balances = useWalletBalances(coin.token, address);
  const { state, fund, reset } = useDemoFund();
  const [amount, setAmount] = useState("");

  if (!pot.data) return null;

  const suggested = amountToCover(gap);
  const parsed = parseMonInput(amount.trim() === "" ? suggested : amount);
  const busy = isBusy(state);
  const balance = balances.data?.mon;

  let problem: string | null = null;
  if (parsed === null || parsed === 0n) problem = "Enter a number such as 0.5.";
  else if (balance !== undefined && parsed > balance) problem = "That is more MON than this wallet holds.";

  const r = state.result;

  return (
    <div className="mt-4 rounded-2xl border-2 border-dashed border-line p-4">
      <p className="text-sm font-bold">Testnet demo: add MON to the budget</p>
      <p className="mt-1 text-xs text-muted">
        Stands in for nad.fun&apos;s fee settlement. It pays MON from your wallet into the demo fee pot and harvests it, so
        the usual 10% treasury / 10% creator / 80% budget split applies.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          inputMode="decimal"
          autoComplete="off"
          aria-label="MON to add"
          placeholder={suggested}
          value={amount}
          disabled={busy}
          onChange={(e) => {
            setAmount(e.target.value.replace(",", "."));
            if (state.phase === "success" || state.phase === "error") reset();
          }}
          className="min-h-11 w-32 min-w-0 rounded-2xl border-2 border-line bg-ink px-4 font-mono tabular-nums outline-none focus:border-brand"
        />
        <TxButton
          busy={busy}
          disabled={!!problem}
          onAction={() => {
            if (parsed && pot.data) void fund(pot.data, coin.token, parsed).then((done) => done && setAmount(""));
          }}
        >
          {busy ? "Adding…" : `Add ${parsed ? formatMon(parsed, 4) : suggested} MON`}
        </TxButton>
      </div>
      {problem && amount.trim() !== "" ? <p className="mt-1.5 text-sm text-danger">{problem}</p> : null}
      <TxStatus state={state} />
      {state.phase === "success" && r ? (
        <p className="mt-1 text-sm font-bold text-mint" role="status">
          Added {monLabel(r.funded)}. {monLabel(r.toBudget)} went to the budget.
        </p>
      ) : null}
    </div>
  );
}
