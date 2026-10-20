"use client";

import type { ReactNode } from "react";
import { configResult } from "@/lib/config";
import { NETWORK } from "@/lib/constants";
import { Card } from "./ui";

export function ConfigNotice({ compact = false }: { compact?: boolean }) {
  if (configResult.ok) return null;
  const { missing, invalid } = configResult;
  return (
    <Card role="status" className="border-lemon/40 p-6">
      <h2 className="font-display text-2xl font-semibold text-lemon">floorvault is not configured yet</h2>
      <p className="mt-2 text-muted">
        {compact
          ? "Live data and transactions are off until the contract addresses are set."
          : `This page reads from the FloorVault contracts on ${NETWORK.name}, but their addresses are not set. Nothing is broken: add them and reload.`}
      </p>
      {missing.length > 0 ? (
        <>
          <p className="mt-3 text-sm font-bold">Missing</p>
          <ul className="mt-1 list-inside list-disc font-mono text-sm text-muted">
            {missing.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </>
      ) : null}
      {invalid.length > 0 ? (
        <>
          <p className="mt-3 text-sm font-bold">Not valid</p>
          <ul className="mt-1 list-inside list-disc font-mono text-sm text-muted">
            {invalid.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </>
      ) : null}
      {compact ? null : (
        <p className="mt-4 text-sm text-muted">
          Copy <code className="font-mono text-text">web/.env.example</code> to{" "}
          <code className="font-mono text-text">web/.env.local</code>, paste the addresses printed by the deploy script,
          then restart <code className="font-mono text-text">npm run dev</code>.
        </p>
      )}
    </Card>
  );
}

/** Renders children only when env is complete; otherwise shows the configuration notice. */
export function ConfigGate({ children }: { children: ReactNode }) {
  if (!configResult.ok) return <ConfigNotice />;
  return <>{children}</>;
}
