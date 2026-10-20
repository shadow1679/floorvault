import { describe, expect, it } from "vitest";
import { parseBig, stringifyBig } from "./serialize";

describe("serialize", () => {
  it("round-trips bigint values", () => {
    const v = { a: 1n, nested: [{ b: 2n ** 80n }], s: "x" };
    expect(parseBig(stringifyBig(v))).toEqual(v);
  });
});
