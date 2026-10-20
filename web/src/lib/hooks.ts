"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { configResult } from "./config";
import {
  getBlockClock,
  getCollectionInfo,
  getCoinDirect,
  getCollectionSupply,
  getAllRaffleStates,
  getCurveInfo,
  getFloor,
  getKeeper,
  getNftImage,
  getRaffleStates,
  getTradeQuote,
  getVaultData,
  getWalletBalances,
  scanHolders,
  watchTrades,
  type Coin,
  type TradeScan,
  type TradeScanStatus,
} from "./chain";
import { IS_MAINNET } from "./constants";
import { fetchGeckoCandles, gtResolution } from "./geckoterminal";
import { chartResolution, fetchNadfunCandles } from "./nadfun";

export function useAppConfig() {
  return configResult;
}

export function useVaultData() {
  const cfg = configResult.ok ? configResult.config : null;
  return useQuery({
    queryKey: ["vault", cfg?.floorVault],
    queryFn: () => getVaultData(cfg!),
    enabled: !!cfg,
    refetchInterval: 20_000,
    staleTime: 5_000,
  });
}

export function useCoin(token: Address | undefined): {
  coin: Coin | undefined;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
} {
  const cfg = configResult.ok ? configResult.config : null;
  const q = useVaultData();
  const scanned = token ? q.data?.coins.find((c) => c.token.toLowerCase() === token.toLowerCase()) : undefined;
  // The scan can lag a fresh launch; fall back to reading the pairing directly.
  const direct = useQuery({
    queryKey: ["coin-direct", cfg?.floorVault, token?.toLowerCase()],
    queryFn: () => getCoinDirect(cfg!, token!),
    enabled: !!cfg && !!token && !scanned && !q.isLoading,
    refetchInterval: 10_000,
  });
  return {
    coin: scanned ?? direct.data ?? undefined,
    isLoading: q.isLoading || (!scanned && direct.isLoading),
    error: scanned ? null : (q.error && !direct.data ? q.error : direct.error),
    refetch: () => {
      void q.refetch();
      void direct.refetch();
    },
  };
}

export function useFloor(collection: Address | undefined) {
  const cfg = configResult.ok ? configResult.config : null;
  return useQuery({
    queryKey: ["floor", cfg?.chainId, cfg?.marketplace, collection],
    queryFn: () => getFloor(cfg!, collection!),
    enabled: !!cfg && !!collection,
    refetchInterval: 20_000,
    staleTime: 5_000,
  });
}

/** The address allowed to call FloorVault.buy (zero means anyone). Rarely changes. */
export function useKeeper() {
  const cfg = configResult.ok ? configResult.config : null;
  return useQuery({
    queryKey: ["keeper", cfg?.floorVault],
    queryFn: () => getKeeper(cfg!),
    enabled: !!cfg,
    staleTime: 60_000,
  });
}

export function useCollection(address: Address | undefined) {
  return useQuery({
    queryKey: ["collection", address],
    queryFn: () => getCollectionInfo(address!),
    enabled: !!address,
    staleTime: Infinity,
  });
}

export function useCollectionSupply(address: Address | undefined) {
  return useQuery({
    queryKey: ["supply", address],
    queryFn: () => getCollectionSupply(address!),
    enabled: !!address,
    staleTime: 30_000,
  });
}

export function useNftImage(collection: Address, tokenId: bigint) {
  return useQuery({
    queryKey: ["nft-image", collection, tokenId.toString()],
    queryFn: () => getNftImage(collection, tokenId),
    staleTime: Infinity,
  });
}

const subscribeSecond = (cb: () => void) => {
  const t = setInterval(cb, 1000);
  return () => clearInterval(t);
};
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Unix seconds from the browser clock, ticking once a second. The contract still has the last word. */
export function useNowSeconds(): bigint {
  return BigInt(useSyncExternalStore(subscribeSecond, nowSeconds, nowSeconds));
}

/** Live on-chain state for a coin's raffles, keyed by raffle id. */
export function useRaffleStates(ids: bigint[]) {
  const cfg = configResult.ok ? configResult.config : null;
  const idKey = ids.map(String).join(",");
  return useQuery({
    queryKey: ["raffle", cfg?.raffle, idKey],
    queryFn: () => getRaffleStates(cfg!, ids),
    enabled: !!cfg && ids.length > 0,
    refetchInterval: 8_000,
    staleTime: 3_000,
  });
}

/** Live state of every raffle, for the app-wide "you won" banner. Pass false to stay idle (no wallet connected). */
export function useAllRaffleStates(enabled: boolean) {
  const cfg = configResult.ok ? configResult.config : null;
  return useQuery({
    queryKey: ["raffle", cfg?.raffle, "all"],
    queryFn: () => getAllRaffleStates(cfg!),
    enabled: !!cfg && enabled,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

/** The coin's live nad.fun bonding-curve state: price, graduation, creator fee rate. */
export function useCurve(token: Address | undefined) {
  return useQuery({
    queryKey: ["curve", token?.toLowerCase()],
    queryFn: () => getCurveInfo(token!),
    enabled: !!token,
    refetchInterval: 6_000,
    staleTime: 2_000,
  });
}

/** What the router would pay for `amountIn` (wei). Null data means it cannot quote that amount. */
export function useTradeQuote(token: Address | undefined, side: "buy" | "sell", amountIn: bigint | null) {
  return useQuery({
    queryKey: ["quote", token?.toLowerCase(), side, amountIn?.toString()],
    queryFn: () => getTradeQuote(token!, side, amountIn!),
    enabled: !!token && amountIn !== null && amountIn > 0n,
    staleTime: 3_000,
    retry: 1,
  });
}

/** The connected wallet's MON and coin balances. */
export function useWalletBalances(token: Address | undefined, owner: Address | undefined) {
  return useQuery({
    queryKey: ["wallet-balances", token?.toLowerCase(), owner?.toLowerCase()],
    queryFn: () => getWalletBalances(token!, owner!),
    enabled: !!token && !!owner,
    refetchInterval: 10_000,
    staleTime: 3_000,
  });
}

/** Head block and measured block time, to show rough times on the chart. */
export function useBlockClock() {
  return useQuery({
    queryKey: ["block-clock"],
    queryFn: () => getBlockClock(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/**
 * A coin's candles from GeckoTerminal, in US dollars per token. Mainnet only (it indexes no testnet). `data` is
 * undefined while loading, else the candles, oldest first; empty means it has no pool for the coin yet.
 */
export function useGeckoCandles(token: Address | undefined, ageSeconds: number | null) {
  const { timeframe, aggregate } = gtResolution(ageSeconds ?? 0);
  return useQuery({
    queryKey: ["gt-candles", token?.toLowerCase(), timeframe, aggregate],
    queryFn: () => fetchGeckoCandles(token!, { ageSeconds: ageSeconds! }),
    enabled: IS_MAINNET && !!token && ageSeconds !== null,
    // The route caches for 30 s; no point asking faster.
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: 1,
  });
}

/**
 * A coin's price candles from nad.fun's API. `data` is undefined while loading, null when nad.fun does not
 * know the coin (so the caller should read the chain instead), else the candles, oldest first.
 */
export function useNadfunCandles(token: Address | undefined, ageSeconds: number | null) {
  const resolution = ageSeconds === null ? "" : chartResolution(ageSeconds);
  return useQuery({
    queryKey: ["nadfun-candles", token?.toLowerCase(), resolution],
    queryFn: () => fetchNadfunCandles(token!, { ageSeconds: ageSeconds! }),
    enabled: !!token && ageSeconds !== null,
    // The API allows few unauthenticated calls per minute, so poll gently.
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: 1,
  });
}

/** MON in US dollars, or null while unknown (the route answers 502 when no rate is available). */
export function useMonUsd() {
  return useQuery({
    queryKey: ["mon-usd"],
    queryFn: async (): Promise<number | null> => {
      const res = await fetch("/api/mon-price");
      if (!res.ok) return null;
      const json = (await res.json()) as { usd?: number };
      return typeof json.usd === "number" && json.usd > 0 ? json.usd : null;
    },
    refetchInterval: 300_000,
    staleTime: 120_000,
  });
}

type TradeHistoryState = { token?: Address; scan?: TradeScan; status: TradeScanStatus };

/**
 * A coin's price history, read from the chain newest first (see `watchTrades`). `refreshKey` should
 * change whenever the price does, so the newest trades are picked up straight away.
 */
export function useTradeHistory(token: Address | undefined, launchBlock: bigint, refreshKey: string) {
  const cfg = configResult.ok ? configResult.config : null;
  const lowerBound = launchBlock > 0n ? launchBlock : (cfg?.deployBlock ?? 0n);
  const [state, setState] = useState<TradeHistoryState>({ status: "scanning" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!token) return;
    return watchTrades(token, lowerBound, (scan, status) => setState({ token, scan, status }));
  }, [token, lowerBound, refreshKey, tick]);

  // Re-join every so often: it retries after an RPC hiccup and picks up trades made by others.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);

  const own = token && state.token?.toLowerCase() === token.toLowerCase();
  return { scan: own ? state.scan : undefined, status: own ? state.status : ("scanning" as TradeScanStatus), lowerBound };
}

/**
 * A coin's holders, folded from its Transfer logs (see `scanHolders`). The first load scans from the
 * launch block; later polls only read new blocks. A failed scan keeps what it fetched, so the retry resumes.
 */
export function useHolders(token: Address | undefined, launchBlock: bigint) {
  const cfg = configResult.ok ? configResult.config : null;
  const fromBlock = launchBlock > 0n ? launchBlock : (cfg?.deployBlock ?? 0n);
  return useQuery({
    queryKey: ["holders", token?.toLowerCase(), fromBlock.toString()],
    queryFn: () => scanHolders(token!, fromBlock),
    enabled: !!token && !!cfg,
    retry: 3,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
