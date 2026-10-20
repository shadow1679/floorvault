"use client";

import { EXPLORER_URL } from "@/lib/constants";
import { explorerAddressUrl, shortAddress } from "@/lib/format";
import { useNowSeconds } from "@/lib/hooks";
import { formatCountdown } from "@/lib/raffle";

/** A short address that links to the block explorer. */
export function AddressLink({ address }: { address: string }) {
  return (
    <a
      href={explorerAddressUrl(EXPLORER_URL, address)}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-brand-soft underline decoration-brand/40 underline-offset-2 hover:text-text"
    >
      {shortAddress(address)}
    </a>
  );
}

/** Time left until `until` (unix seconds), ticking every second. The browser clock can drift from the chain's. */
export function Countdown({ until }: { until: bigint }) {
  const now = useNowSeconds();
  return <span className="font-bold tabular-nums text-text">{formatCountdown(until - now)}</span>;
}
