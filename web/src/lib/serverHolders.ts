// Server-side home of the per-coin holder scan (the `Transfer` logs folded into balances). Like the vault
// scan in `serverScan.ts`, the long walk from the coin's launch happens once here, on a long-lived Node
// process (in one call when `LOGS_RPC_URL` is set), and browsers fetch the result from `/api/holders` and
// read only the short tail. State lives in memory and in `.scan-cache/`, so a restart resumes.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Address } from "viem";
import { advanceHolders, monadChain, publicClient, SERVER_TAIL_BLOCKS, type HolderScan, type ServerHolders } from "./chain";
import type { AppConfig } from "./config";
import { parseBig, stringifyBig } from "./serialize";
import { redacted, getServerScan, WIDE_SCAN, wideClient } from "./serverScan";

const CACHE_DIR = path.join(process.cwd(), ".scan-cache");
const MIN_RERUN_MS = 2_000; // between two catch-up runs of one coin, so polling clients cannot hammer the RPC
const WAIT_MS = 20_000; // how long one request waits for a running catch-up before answering with what exists

type Slot = {
  state?: HolderScan;
  /** Chain head seen by the latest run; 0 until the first run has asked. */
  head: bigint;
  loaded: boolean;
  running?: Promise<void>;
  lastRunAt: number;
};

// Module state is dropped on a dev hot reload; globalThis keeps the slots (and the running scans) alive.
const slots = ((globalThis as { __floorvaultHolderSlots?: Map<string, Slot> }).__floorvaultHolderSlots ??= new Map());

const fileFor = (token: Address) => path.join(CACHE_DIR, `holders_${monadChain.id}_${token.toLowerCase()}.json`);

function isHolderScan(v: unknown): v is HolderScan {
  const s = v as Partial<HolderScan> | null;
  return !!s && typeof s.scannedTo === "bigint" && !!s.balances && typeof s.balances === "object";
}

async function readDisk(file: string): Promise<HolderScan | undefined> {
  try {
    const parsed = parseBig<unknown>(await readFile(file, "utf8"));
    return isHolderScan(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function writeDisk(file: string, state: HolderScan): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, stringifyBig(state));
    await rename(tmp, file); // atomic, so a crash never leaves a half-written snapshot
  } catch {
    // Read-only disk: the in-memory copy still serves requests.
  }
}

async function catchUp(token: Address, launchBlock: bigint, slot: Slot, file: string): Promise<void> {
  const keep = (scan: HolderScan) => {
    slot.state = scan;
    void writeDisk(file, scan);
  };
  try {
    let done = false;
    const wide = wideClient();
    if (wide) {
      const { scan, error } = await advanceHolders(token, launchBlock, wide, slot.state, WIDE_SCAN);
      keep(scan);
      if (error) console.error("[holders] LOGS_RPC_URL failed, using the public RPC:", redacted(error));
      else done = true;
    }
    if (!done) {
      const { scan, error } = await advanceHolders(token, launchBlock, publicClient, slot.state);
      keep(scan);
      if (error) throw error;
    }
    slot.head = await publicClient.getBlockNumber();
  } catch (e) {
    // Progress up to the last good wave is already kept; the next request resumes from it.
    console.error("[holders] catch-up failed:", redacted(e));
  }
}

/** Resolves when the catch-up `getServerHolders` started for this coin has finished (see `scanSettled`). */
export const holdersSettled = (token: Address): Promise<void> => slots.get(token.toLowerCase())?.running ?? Promise.resolve();

/**
 * The server's balances for one coin so far, starting a background catch-up when none is running. Only coins
 * the vault launched are served (so nobody can make the server scan arbitrary contracts), and the start block
 * comes from the server's own launch record. Returns undefined for any other token. `indexing` is true while
 * the snapshot trails the head by more than a browser should scan itself.
 */
export async function getServerHolders(cfg: AppConfig, token: Address): Promise<ServerHolders | undefined> {
  const launch = (await getServerScan(cfg)).state.launched.find((l) => l.token.toLowerCase() === token.toLowerCase());
  if (!launch) return undefined;

  const key = token.toLowerCase();
  const file = fileFor(token);
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
    s.running = catchUp(token, launch.blockNumber, s, file).finally(() => {
      s.running = undefined;
      s.lastRunAt = Date.now();
    });
  }
  // A fast log provider finishes within a second or two: wait for it so the first answer is already complete.
  if (slot.running) await Promise.race([slot.running, new Promise((r) => setTimeout(r, WAIT_MS))]);

  const scan = slot.state ?? { scannedTo: launch.blockNumber - 1n, balances: {} };
  const indexing = slot.head === 0n || slot.head - scan.scannedTo > SERVER_TAIL_BLOCKS;
  return { scan, indexing };
}
