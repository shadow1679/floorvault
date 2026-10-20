"use client";

import type { ReactNode } from "react";
import { EXPLORER_URL, NETWORK } from "@/lib/constants";
import { explorerTxUrl } from "@/lib/format";
import { PHASE_LABEL, useWalletStatus, type TxState } from "@/lib/tx";
import { Button } from "./ui";
import { useWalletDialog } from "./WalletDialog";

/**
 * A button that handles the wallet prerequisites for a write: connect first, then switch to
 * the app's Monad network, then run the action.
 */
export function TxButton({
  children,
  onAction,
  disabled,
  busy,
  variant = "primary",
  className,
  type = "button",
}: {
  children: ReactNode;
  onAction?: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  type?: "button" | "submit";
}) {
  const { open } = useWalletDialog();
  const { isConnected, wrongChain, switchToMonad, isSwitching } = useWalletStatus();

  if (!isConnected) {
    return (
      <Button variant={variant} type="button" onClick={open} className={className}>
        Connect wallet
      </Button>
    );
  }
  if (wrongChain) {
    return (
      <Button
        variant="secondary"
        type="button"
        disabled={isSwitching}
        onClick={() => void switchToMonad().catch(() => {})}
        className={className}
      >
        {isSwitching ? "Switching…" : `Switch to ${NETWORK.name}`}
      </Button>
    );
  }
  return (
    <Button variant={variant} type={type} disabled={disabled || busy} aria-busy={busy} onClick={onAction} className={className}>
      {children}
    </Button>
  );
}

export function TxStatus({ state }: { state: TxState<unknown> }) {
  const message = state.phase === "error" ? state.error : PHASE_LABEL[state.phase];
  return (
    <div aria-live="polite" className="min-h-6">
      {state.phase === "error" ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {message}
        </p>
      ) : state.phase !== "idle" && state.phase !== "success" ? (
        <p className="fv-pulse text-sm font-semibold text-brand-soft">{message}</p>
      ) : null}
      {state.hash && state.phase !== "idle" ? (
        <a
          href={explorerTxUrl(EXPLORER_URL, state.hash)}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted underline hover:text-text"
        >
          View transaction
        </a>
      ) : null}
    </div>
  );
}

export const isBusy = (s: TxState<unknown>) =>
  s.phase === "preparing" || s.phase === "simulating" || s.phase === "wallet" || s.phase === "confirming";
