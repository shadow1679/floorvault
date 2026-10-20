"use client";

import { useConnection, useDisconnect } from "wagmi";
import { shortAddress } from "@/lib/format";
import { monadChain } from "@/lib/chain";
import { useWalletStatus } from "@/lib/tx";
import { Button } from "./ui";
import { useWalletDialog } from "./WalletDialog";

export default function ConnectButton() {
  const { open } = useWalletDialog();
  const { address, isConnected } = useConnection();
  const { disconnect } = useDisconnect();
  const { wrongChain, switchToMonad, isSwitching } = useWalletStatus();

  // wagmi (ssr mode) reports "disconnected" until the browser reconnects, so server and first client render match.
  if (!isConnected || !address) {
    return (
      <Button onClick={open} aria-label="Connect wallet" className="min-h-10 whitespace-nowrap px-4 py-2 text-sm sm:text-base">
        Connect<span className="hidden min-[400px]:inline">&nbsp;wallet</span>
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {wrongChain ? (
        <Button
          variant="secondary"
          onClick={() => void switchToMonad().catch(() => {})}
          disabled={isSwitching}
          className="min-h-10 border-lemon px-3 py-2 text-sm text-lemon"
        >
          Switch to {monadChain.name}
        </Button>
      ) : null}
      <Button
        variant="secondary"
        onClick={() => disconnect()}
        title="Disconnect wallet"
        aria-label={`Connected as ${address}. Disconnect wallet`}
        className="min-h-10 px-3 py-2 font-mono text-sm"
      >
        {shortAddress(address, 5, 4)}
      </Button>
    </div>
  );
}
