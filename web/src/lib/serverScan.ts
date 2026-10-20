// Server-side home of the vault log scan. The public RPC caps eth_getLogs at 100 blocks, so reading the
// whole history takes thousands of calls. Doing that once here, on a long-lived Node process, and
// handing browsers the result (see `/api/scan`) replaces the old committed snapshot: it refreshes
// itself and never goes stale. State lives in memory, and on disk so a restart resumes instead of
// starting over. Where the disk is read-only the memory copy still works.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, http, type PublicClient } from "viem";
import { advanceScan, cacheKey, monadChain, publicClient, SERVER_TAIL_BLOCKS, type ScanState, type ServerScan } from "./chain";
import type { AppConfig } from "./config";
import { parseBig, stringifyBig } from "./serialize";
import { hypersyncTransport, isHyperSyncUrl } from "../../scripts/hypersync.mjs";

const CACHE_DIR = path.join(process.cwd(), ".scan-cache");
const MIN_RERUN_MS = 2_000; // between two catch-up runs, so polling clients cannot hammer the RPC

type Slot = {
  state?: ScanState;
  /** Chain head seen by the latest run; 0 until the first run has asked. */
  head: bigint;
  loaded: boolean;
  running?: Promise<void>;
  lastRunAt: number;
};

// Module state is dropped on a dev hot reload; globalThis keeps the slots (and the running scan) alive.
const slots = ((globalThis as { __floorvaultScanSlots?: Map<string, Slot> }).__floorvaultScanSlots ??= new Map());

const fileFor = (key: string) => path.join(CACHE_DIR, `${key.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);

function isScanState(v: unknown): v is ScanState {
  const s = v as Partial<ScanState> | null;
  return (
    !!s &&
    typeof s.scannedTo === "bigint" &&
    Array.isArray(s.launched) &&
    Array.isArray(s.harvested) &&
    Array.isArray(s.bought) &&
    Array.isArray(s.raffle)
  );
}

async function readDisk(file: string): Promise<ScanState | undefined> {
  try {
    const parsed = parseBig<unknown>(await readFile(file, "utf8"));
    return isScanState(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function writeDisk(file: string, state: ScanState): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, stringifyBig(state));
    await rename(tmp, file); // atomic, so a crash never leaves a half-written snapshot
  } catch {
    // Read-only disk: the in-memory copy still serves requests.
  }
}

// Optional log provider for this server only (never NEXT_PUBLIC_, it carries an API token): HyperRPC takes a
// whole history in one eth_getLogs call where the public RPC needs 100-block chunks. Calls can take tens of
// seconds, so the client gets a long timeout. Any failure falls back to the public RPC and resumes from the
// progress already kept.
export const WIDE_SCAN = { chunk: 500_000n, concurrency: 1 };
const logsRpcUrl = () => (process.env.LOGS_RPC_URL ?? "").trim();

export function wideClient(): PublicClient | undefined {
  const url = logsRpcUrl();
  if (!url) return undefined;
  // HyperSync's own API (`*.hypersync.xyz`) is not JSON-RPC; HyperRPC and any other provider are.
  const transport = isHyperSyncUrl(url) ? hypersyncTransport(url) : http(url, { timeout: 120_000, retryCount: 1 });
  return createPublicClient({ chain: monadChain, transport });
}

/** An error message safe to log: viem embeds the request URL, which here includes the API token. */
export function redacted(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const url = logsRpcUrl();
  return url ? msg.split(url).join("<LOGS_RPC_URL>") : msg;
}

async function catchUp(cfg: AppConfig, slot: Slot, file: string): Promise<void> {
  const onBatch = (state: ScanState, head: bigint) => {
    slot.state = state;
    slot.head = head;
    void writeDisk(file, state);
  };
  try {
    let done: ScanState | undefined;
    const wide = wideClient();
    if (wide) {
      try {
        done = await advanceScan(cfg, wide, slot.state, onBatch, WIDE_SCAN);
      } catch (e) {
        console.error("[scan] LOGS_RPC_URL failed, using the public RPC:", redacted(e));
      }
    }
    done ??= await advanceScan(cfg, publicClient, slot.state, onBatch);
    slot.state = done;
    await writeDisk(file, done);
  } catch (e) {
    // Progress up to the last good batch is already kept; the next request resumes from it.
    console.error("[scan] catch-up failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Resolves when the catch-up `getServerScan` started has finished. Serverless hosts freeze the process once
 * the response is sent, so a route hands this to `after()` to keep the scan alive until it is done.
 */
export const scanSettled = (cfg: AppConfig): Promise<void> => slots.get(cacheKey(cfg))?.running ?? Promise.resolve();

/**
 * The server's scan so far, starting a background catch-up when none is running. `indexing` is true while
 * the snapshot trails the head by more than a browser should scan itself.
 */
export async function getServerScan(cfg: AppConfig): Promise<ServerScan> {
  const key = cacheKey(cfg);
  const file = fileFor(key);
  let slot = slots.get(key);
  if (!slot) {
    slot = { head: 0n, loaded: false, lastRunAt: 0 };
    slots.set(key, slot);
  }
  if (!slot.loaded) {
    slot.state = await readDisk(file);
    slot.loaded = true;
  }
  if (!slot.running && Date.now() - slot.lastRunAt >= MIN_RERUN_MS) {
    const s = slot;
    s.running = catchUp(cfg, s, file).finally(() => {
      s.running = undefined;
      s.lastRunAt = Date.now();
    });
  }
  const state = slot.state ?? { scannedTo: cfg.deployBlock - 1n, launched: [], harvested: [], bought: [], raffle: [] };
  const indexing = slot.head === 0n || slot.head - state.scannedTo > SERVER_TAIL_BLOCKS;
  return { state, indexing };
}
