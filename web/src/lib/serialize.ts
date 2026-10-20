// JSON with bigint support, for caching scan results in localStorage.

export function stringifyBig(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? { __big: v.toString() } : v));
}

export function parseBig<T>(text: string): T {
  return JSON.parse(text, (_k, v) =>
    v && typeof v === "object" && typeof (v as { __big?: unknown }).__big === "string"
      ? BigInt((v as { __big: string }).__big)
      : v,
  ) as T;
}
