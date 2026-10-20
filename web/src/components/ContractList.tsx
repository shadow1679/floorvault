"use client";

import { configResult } from "@/lib/config";
import { CHOG_MAINNET_ADDRESS, EXPLORER_URL, IS_MAINNET } from "@/lib/constants";
import { explorerAddressUrl } from "@/lib/format";

export default function ContractList() {
  if (!configResult.ok) {
    return (
      <p className="rounded-2xl bg-card-2 p-4 text-muted">
        Contract addresses appear here once <code className="font-mono text-text">web/.env.local</code> is set.
      </p>
    );
  }
  const c = configResult.config;
  const rows: Array<readonly [string, string]> = IS_MAINNET
    ? [
        ["FloorVault", c.floorVault],
        ["Raffle", c.raffle],
        ["Seaport 1.6 (OpenSea)", "0x0000000000000068F116a894984e2DB1123eB395"],
        ["Chog Genesis", CHOG_MAINNET_ADDRESS],
      ]
    : [
        ["FloorVault", c.floorVault],
        ["MockMarketplace", c.marketplace!],
        ["Test CHOG", c.collection],
      ];
  return (
    <dl className="space-y-3">
      {rows.map(([label, addr]) => (
        <div key={label} className="rounded-2xl bg-card-2 p-4">
          <dt className="text-sm font-bold text-muted">{label}</dt>
          <dd className="break-all font-mono text-sm">
            <a
              href={explorerAddressUrl(EXPLORER_URL, addr)}
              target="_blank"
              rel="noreferrer"
              className="text-brand-soft underline"
            >
              {addr}
            </a>
          </dd>
        </div>
      ))}
    </dl>
  );
}
