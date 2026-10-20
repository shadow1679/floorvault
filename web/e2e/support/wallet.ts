// A stand-in browser wallet. It announces itself over EIP-6963 (which wagmi discovers) and answers the few
// requests the app makes, so tests can click "Connect wallet" and "Launch coin" like a person would.
import type { Page } from "@playwright/test";
import type { Address, Hex } from "viem";
import { ADDR, TX } from "./env";

export type WalletOptions = {
  account?: Address;
  /** The chain the wallet starts on. 10143 is Monad testnet. */
  chainId?: number;
  /** The hash eth_sendTransaction returns. */
  txHash?: Hex;
  /** Make eth_sendTransaction fail like a user pressing "Reject". */
  rejectSend?: boolean;
};

export type SentTx = { from: Address; to: Address; value?: Hex; data?: Hex };

export const WALLET_NAME = "E2E Wallet";

export async function installWallet(page: Page, options: WalletOptions = {}) {
  const config = {
    account: options.account ?? ADDR.wallet,
    chainId: options.chainId ?? 10143,
    txHash: options.txHash ?? TX.newLaunch,
    rejectSend: options.rejectSend ?? false,
    name: WALLET_NAME,
  };

  await page.addInitScript((o) => {
    type Listener = (...args: unknown[]) => void;
    const w = window as unknown as { __e2eTxs: unknown[] };
    w.__e2eTxs = [];
    const listeners: Record<string, Listener[]> = {};
    let chainHex = "0x" + o.chainId.toString(16);
    let connected = false;
    const emit = (event: string, ...args: unknown[]) => (listeners[event] ?? []).forEach((fn) => fn(...args));

    const provider = {
      isE2E: true,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        switch (method) {
          case "eth_requestAccounts":
            connected = true;
            return [o.account];
          case "eth_accounts":
            return connected ? [o.account] : [];
          case "eth_chainId":
            return chainHex;
          case "net_version":
            return String(parseInt(chainHex, 16));
          case "wallet_requestPermissions":
          case "wallet_getPermissions":
            return [{ parentCapability: "eth_accounts" }];
          case "wallet_switchEthereumChain": {
            chainHex = (params?.[0] as { chainId: string }).chainId;
            emit("chainChanged", chainHex);
            return null;
          }
          case "eth_sendTransaction": {
            if (o.rejectSend) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
            w.__e2eTxs.push((params as unknown[])[0]);
            return o.txHash;
          }
          default:
            throw Object.assign(new Error(`${method} is not supported by the E2E wallet`), { code: -32601 });
        }
      },
      on: (event: string, fn: Listener) => {
        (listeners[event] ??= []).push(fn);
      },
      removeListener: (event: string, fn: Listener) => {
        listeners[event] = (listeners[event] ?? []).filter((l) => l !== fn);
      },
    };

    const info = {
      uuid: "e2e-wallet-0001",
      name: o.name,
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
      rdns: "test.e2e.wallet",
    };
    const announce = () =>
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, config);
}

/** Transactions the stand-in wallet was asked to send, in order. */
export function sentTransactions(page: Page): Promise<SentTx[]> {
  return page.evaluate(() => (window as unknown as { __e2eTxs: SentTx[] }).__e2eTxs);
}
