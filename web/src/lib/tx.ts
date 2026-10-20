"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection, useSwitchChain, useWriteContract } from "wagmi";
import { parseEventLogs, type Address, type Hash } from "viem";
import { floorVaultAbi } from "@/abi/FloorVault";
import { raffleAbi } from "@/abi/Raffle";
import { erc20Abi } from "@/abi/erc20";
import { nadRouterAbi } from "@/abi/nad";
import { monadChain, publicClient } from "./chain";
import { configResult } from "./config";
import { NAD_ROUTER } from "./constants";
import { explainError, type TxAction } from "./errors";
import { buildLaunchArgs } from "./launch";
import { prepareLaunchAssets } from "./nadfun";
import { CREATE_FEE, devBuyWei, type LaunchForm } from "./validation";

export type TxPhase = "idle" | "preparing" | "simulating" | "wallet" | "confirming" | "success" | "error";

export type TxState<R> = {
  phase: TxPhase;
  hash?: Hash;
  error?: string;
  result?: R;
};

export type BuyResult = { hash: Hash; tokenId: bigint; price: bigint; to: Address; collection: Address };
export type LaunchResult = { hash: Hash; token: Address };

/** The keeper runs every other raffle step; the winner's claim is the only one a person sends. */
export type RaffleStepCall = { fn: "claim"; id: bigint };
export type RaffleTxResult = { hash: Hash; fn: RaffleStepCall["fn"] };

export const PHASE_LABEL: Record<TxPhase, string> = {
  idle: "",
  preparing: "Uploading your coin to nad.fun…",
  simulating: "Checking the transaction…",
  wallet: "Confirm in your wallet…",
  confirming: "Waiting for Monad to confirm…",
  success: "Done",
  error: "Failed",
};

/** Wallet state relevant to sending transactions. */
export function useWalletStatus() {
  const { address, chainId, isConnected, status } = useConnection();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const wrongChain = isConnected && chainId !== monadChain.id;
  return {
    address,
    isConnected,
    isReconnecting: status === "reconnecting" || status === "connecting",
    wrongChain,
    isSwitching,
    switchToMonad: () => switchChainAsync({ chainId: monadChain.id }),
  };
}

function useTxRunner<R>(action: TxAction) {
  const [state, setState] = useState<TxState<R>>({ phase: "idle" });
  const queryClient = useQueryClient();

  const run = useCallback(
    async (exec: (set: (p: TxPhase, hash?: Hash) => void) => Promise<R>): Promise<R | undefined> => {
      setState({ phase: "simulating" });
      try {
        const result = await exec((phase, hash) => setState((s) => ({ ...s, phase, hash: hash ?? s.hash })));
        setState((s) => ({ ...s, phase: "success", result }));
        // Refresh in the background: callers (like the launch redirect) should not wait for a rescan.
        for (const queryKey of [["vault"], ["floor"], ["coin-direct"], ["raffle"], ["curve"], ["wallet-balances"], ["quote"]]) {
          void queryClient.invalidateQueries({ queryKey });
        }
        return result;
      } catch (e) {
        setState((s) => ({ phase: "error", hash: s.hash, error: explainError(e, action) }));
        return undefined;
      }
    },
    [action, queryClient],
  );

  const reset = useCallback(() => setState({ phase: "idle" }), []);
  return { state, run, reset };
}

function requireConfig() {
  if (!configResult.ok) throw new Error("FloorVault is not configured.");
  return configResult.config;
}

export function useBuy() {
  const { address } = useConnection();
  const { writeContractAsync } = useWriteContract();
  const { state, run, reset } = useTxRunner<BuyResult>("buy");

  const buy = useCallback(
    // Only the vault's keeper may call buy. On testnet the mock marketplace ignores the listing data, so
    // `maxPrice` (the floor the UI just read) is all the keeper wallet has to supply.
    (token: Address, maxPrice: bigint) =>
      run(async (set) => {
        const cfg = requireConfig();
        const call = {
          address: cfg.floorVault,
          abi: floorVaultAbi,
          functionName: "buy",
          args: [token, maxPrice, "0x"],
        } as const;
        await publicClient.simulateContract({ ...call, account: address });
        set("wallet");
        const hash = await writeContractAsync({ ...call, chainId: monadChain.id });
        set("confirming", hash);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Buy transaction reverted.");
        const [ev] = parseEventLogs({ abi: floorVaultAbi, logs: receipt.logs, eventName: "Bought" });
        if (!ev) throw new Error("Buy confirmed but no Bought event was found.");
        return { hash, tokenId: ev.args.tokenId, price: ev.args.price, to: ev.args.to, collection: ev.args.collection };
      }),
    [address, run, writeContractAsync],
  );
  return { state, buy, reset };
}

/** Sends the winner's `claim`. Only the winner can; the rest of the raffle is driven by the keeper. */
export function useRaffleTx() {
  const { address } = useConnection();
  const { writeContractAsync } = useWriteContract();
  const { state, run, reset } = useTxRunner<RaffleTxResult>("raffle");

  const send = useCallback(
    (step: RaffleStepCall) =>
      run(async (set) => {
        const cfg = requireConfig();
        const call = { address: cfg.raffle, abi: raffleAbi, functionName: step.fn, args: [step.id] } as const;
        await publicClient.simulateContract({ ...call, account: address });
        set("wallet");
        const hash = await writeContractAsync({ ...call, chainId: monadChain.id });
        set("confirming", hash);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Raffle transaction reverted.");
        return { hash, fn: step.fn };
      }),
    [address, run, writeContractAsync],
  );
  return { state, send, reset };
}

export type TradeSpec = {
  side: "buy" | "sell";
  token: Address;
  /** MON in (buy) or coin in (sell), in wei. */
  amountIn: bigint;
  /** The least the router may pay out, already reduced by slippage. */
  amountOutMin: bigint;
};
export type TradeResult = { hash: Hash; side: "buy" | "sell"; amountIn: bigint; amountOut: bigint };

const TRADE_DEADLINE_SECONDS = 20 * 60;

/**
 * Buy or sell a coin on nad.fun through its router. A sell first approves the router to take the coins
 * (exactly the amount sold) when the allowance is short, so it can be two wallet prompts.
 */
export function useTrade() {
  const { address } = useConnection();
  const { writeContractAsync } = useWriteContract();
  const { state, run, reset } = useTxRunner<TradeResult>("trade");

  const trade = useCallback(
    (spec: TradeSpec) =>
      run(async (set) => {
        if (!address) throw new Error("Connect a wallet first.");
        const deadline = BigInt(Math.floor(Date.now() / 1000) + TRADE_DEADLINE_SECONDS);

        if (spec.side === "sell") {
          const allowance = await publicClient.readContract({
            address: spec.token,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, NAD_ROUTER],
          });
          if (allowance < spec.amountIn) {
            set("wallet");
            const approveHash = await writeContractAsync({
              address: spec.token,
              abi: erc20Abi,
              functionName: "approve",
              args: [NAD_ROUTER, spec.amountIn],
              chainId: monadChain.id,
            });
            set("confirming", approveHash);
            const approval = await publicClient.waitForTransactionReceipt({ hash: approveHash });
            if (approval.status !== "success") throw new Error("Approval transaction reverted.");
          }
        }

        // Buy and sell differ only in function name, arguments and value; as with the raffle steps,
        // TypeScript cannot narrow the ABI-typed call across that union, so it is typed as a buy.
        const call = (
          spec.side === "buy"
            ? {
                address: NAD_ROUTER,
                abi: nadRouterAbi,
                functionName: "buyWithNative",
                args: [{ amountOutMin: spec.amountOutMin, token: spec.token, to: address, deadline }],
                value: spec.amountIn,
              }
            : {
                address: NAD_ROUTER,
                abi: nadRouterAbi,
                functionName: "sellToNative",
                args: [{ amountIn: spec.amountIn, amountOutMin: spec.amountOutMin, token: spec.token, to: address, deadline }],
              }
        ) as unknown as {
          address: typeof NAD_ROUTER;
          abi: typeof nadRouterAbi;
          functionName: "buyWithNative";
          args: readonly [{ amountOutMin: bigint; token: Address; to: Address; deadline: bigint }];
          value: bigint;
        };
        await publicClient.simulateContract({ ...call, account: address });
        set("wallet");
        const hash = await writeContractAsync({ ...call, chainId: monadChain.id });
        set("confirming", hash);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Trade transaction reverted.");
        const [ev] = parseEventLogs({
          abi: nadRouterAbi,
          logs: receipt.logs,
          eventName: spec.side === "buy" ? "Buy" : "Sell",
        });
        return { hash, side: spec.side, amountIn: spec.amountIn, amountOut: ev ? ev.args.amountOut : 0n };
      }),
    [address, run, writeContractAsync],
  );
  return { state, trade, reset };
}

export function useLaunch() {
  const { address } = useConnection();
  const { writeContractAsync } = useWriteContract();
  const { state, run, reset } = useTxRunner<LaunchResult>("launch");

  const launch = useCallback(
    (form: LaunchForm) =>
      run(async (set) => {
        const cfg = requireConfig();
        if (!address) throw new Error("Connect a wallet to launch.");
        if (!form.image) throw new Error("Add a picture for your coin.");
        // nad.fun's create fee is fixed; the dev buy rides on top of it, and the router refunds any excess.
        const value = CREATE_FEE + devBuyWei(form);
        // nad.fun indexes a coin only if its image and metadata live in its storage and its salt came from
        // its miner, so those come first. FloorVault is the creator the router sees, so the salt is for it.
        set("preparing");
        const assets = await prepareLaunchAssets({
          image: form.image,
          name: form.name.trim(),
          symbol: form.symbol.trim().toUpperCase(),
          creator: cfg.floorVault,
        });
        set("simulating");
        const call = {
          address: cfg.floorVault,
          abi: floorVaultAbi,
          functionName: "launch",
          args: [buildLaunchArgs(form, Date.now() / 1000, assets, address)],
          value,
        } as const;
        await publicClient.simulateContract({ ...call, account: address });
        set("wallet");
        const hash = await writeContractAsync({ ...call, chainId: monadChain.id });
        set("confirming", hash);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Launch transaction reverted.");
        const [ev] = parseEventLogs({ abi: floorVaultAbi, logs: receipt.logs, eventName: "Launched" });
        if (!ev) throw new Error("Launch confirmed but no Launched event was found.");
        return { hash, token: ev.args.token };
      }),
    [address, run, writeContractAsync],
  );
  return { state, launch, reset };
}
