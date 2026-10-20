// Pure helpers for scanning logs in small block ranges. Monad testnet's public RPC rejects
// eth_getLogs ranges above 100 blocks, so everything is fetched in 100-block chunks.

export const CHUNK_SIZE = 100n;

export type BlockRange = { from: bigint; to: bigint };

/** Split [from, to] (inclusive) into ranges of at most `size` blocks. Empty when from > to. */
export function chunkRanges(from: bigint, to: bigint, size: bigint = CHUNK_SIZE): BlockRange[] {
  if (size <= 0n) throw new Error("chunk size must be positive");
  const ranges: BlockRange[] = [];
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n;
    ranges.push({ from: start, to: end > to ? to : end });
  }
  return ranges;
}

export type LogKey = { transactionHash: string; logIndex: number };

export const logKey = (l: LogKey) => `${l.transactionHash}:${l.logIndex}`;

/** Merge new logs into existing ones, dropping duplicates (rescans overlap by a few blocks). */
export function mergeLogs<T extends LogKey & { blockNumber: bigint }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map(logKey));
  const merged = [...existing];
  for (const l of incoming) {
    const k = logKey(l);
    if (!seen.has(k)) {
      seen.add(k);
      merged.push(l);
    }
  }
  return merged.sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
}

/**
 * Fetch every range with bounded concurrency, in order. Results from fully completed waves are
 * returned even if a later wave fails, so callers can keep partial progress without leaving holes.
 */
export async function fetchRanges<T>(
  ranges: BlockRange[],
  fetchRange: (r: BlockRange) => Promise<T[]>,
  concurrency = 6,
): Promise<{ items: T[]; completedTo: bigint | null; error?: unknown }> {
  const items: T[] = [];
  let completedTo: bigint | null = null;
  for (let i = 0; i < ranges.length; i += concurrency) {
    const wave = ranges.slice(i, i + concurrency);
    try {
      const results = await Promise.all(wave.map(fetchRange));
      for (const r of results) items.push(...r);
      completedTo = wave[wave.length - 1].to;
    } catch (error) {
      return { items, completedTo, error };
    }
  }
  return { items, completedTo };
}

/** Retry an async call with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4, baseMs = 250): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastError;
}

/**
 * Like `fetchRanges`, but newest range first, so recent history can be shown before old history is
 * read. `ranges` are given oldest first (as `chunkRanges` returns them). `completedFrom` is the lowest
 * block that is fully fetched with nothing missing above it, or null when the first wave failed.
 */
export async function fetchRangesBackward<T>(
  ranges: BlockRange[],
  fetchRange: (r: BlockRange) => Promise<T[]>,
  concurrency = 6,
): Promise<{ items: T[]; completedFrom: bigint | null; error?: unknown }> {
  const items: T[] = [];
  let completedFrom: bigint | null = null;
  const newestFirst = [...ranges].reverse();
  for (let i = 0; i < newestFirst.length; i += concurrency) {
    const wave = newestFirst.slice(i, i + concurrency);
    try {
      const results = await Promise.all(wave.map(fetchRange));
      for (const r of results) items.push(...r);
      completedFrom = wave[wave.length - 1].from;
    } catch (error) {
      return { items, completedFrom, error };
    }
  }
  return { items, completedFrom };
}
