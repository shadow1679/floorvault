"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useConnect, useConnectors, useConnection } from "wagmi";
import { NETWORK } from "@/lib/constants";
import { explainError } from "@/lib/errors";

type WalletDialogApi = { open: () => void };
const WalletDialogContext = createContext<WalletDialogApi>({ open: () => {} });

export const useWalletDialog = () => useContext(WalletDialogContext);

export function WalletDialogProvider({ children }: { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => {
    setIsOpen(true);
    dialogRef.current?.showModal();
  }, []);
  const close = useCallback(() => {
    dialogRef.current?.close();
    setIsOpen(false);
  }, []);

  return (
    <WalletDialogContext.Provider value={{ open }}>
      {children}
      <dialog
        ref={dialogRef}
        aria-labelledby="wallet-dialog-title"
        onClose={() => setIsOpen(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-3xl border border-line bg-card p-0 text-text backdrop:bg-black/70"
      >
        {isOpen ? <WalletList onDone={close} /> : null}
      </dialog>
    </WalletDialogContext.Provider>
  );
}

function WalletList({ onDone }: { onDone: () => void }) {
  const connectors = useConnectors();
  const { connectAsync, isPending } = useConnect();
  const { isConnected } = useConnection();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isConnected) onDone();
  }, [isConnected, onDone]);

  // Prefer named wallets found through EIP-6963; hide the generic fallback when one exists.
  const named = connectors.filter((c) => c.id !== "injected");
  const list = named.length > 0 ? named : connectors;

  return (
    <div className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="wallet-dialog-title" className="font-display text-2xl font-semibold">
          Connect a wallet
        </h2>
        <button
          type="button"
          onClick={onDone}
          className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-text"
          aria-label="Close wallet dialog"
        >
          Close
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">FloorVault runs on {NETWORK.name}. Pick the wallet you want to use.</p>
      <ul className="mt-4 space-y-2">
        {list.map((c) => (
          <li key={c.uid}>
            <button
              type="button"
              disabled={isPending}
              onClick={async () => {
                setError(null);
                try {
                  await connectAsync({ connector: c });
                } catch (e) {
                  setError(explainError(e, "switch"));
                }
              }}
              className="flex w-full items-center gap-3 rounded-2xl border border-line bg-card-2 px-4 py-3 text-left font-semibold hover:border-brand disabled:opacity-60"
            >
              {c.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.icon} alt="" width={28} height={28} className="size-7 rounded-lg" />
              ) : (
                <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-brand/20 text-brand">
                  W
                </span>
              )}
              {c.name}
            </button>
          </li>
        ))}
      </ul>
      {list.length === 0 || (named.length === 0 && typeof window !== "undefined" && !("ethereum" in window)) ? (
        <p className="mt-4 rounded-2xl bg-card-2 p-3 text-sm text-muted">
          No browser wallet detected. Install a wallet extension such as MetaMask, Rabby or Phantom, then reload this
          page.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
