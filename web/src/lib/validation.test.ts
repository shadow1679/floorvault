import { describe, expect, it } from "vitest";
import { devBuyWei, feeTierToBps, hasErrors, validateAddress, validateLaunch, type LaunchForm } from "./validation";

const good: LaunchForm = {
  name: "Chog Floor Fund",
  symbol: "CFF",
  image: new File(["x"], "a.png", { type: "image/png" }),
  feeTier: 3,
  collection: "0x8b5459fad279f1beef9854d70167a79fc19411e1",
  devBuy: "",
};

describe("validateLaunch", () => {
  it("accepts a good form", () => {
    expect(hasErrors(validateLaunch(good))).toBe(false);
  });

  it("flags missing name and symbol", () => {
    const e = validateLaunch({ ...good, name: "  ", symbol: "" });
    expect(e.name).toBeTruthy();
    expect(e.symbol).toBeTruthy();
  });

  it("limits length and symbol characters", () => {
    expect(validateLaunch({ ...good, name: "x".repeat(33) }).name).toBeTruthy();
    expect(validateLaunch({ ...good, symbol: "TOOLONGSYMBOL" }).symbol).toBeTruthy();
    expect(validateLaunch({ ...good, symbol: "A-B" }).symbol).toBeTruthy();
  });

  it("only allows 1, 3 or 5 percent", () => {
    expect(validateLaunch({ ...good, feeTier: 2 }).feeTier).toBeTruthy();
    for (const t of [1, 3, 5]) expect(validateLaunch({ ...good, feeTier: t }).feeTier).toBeUndefined();
  });

  it("shows an inline error for a bad collection address", () => {
    expect(validateLaunch({ ...good, collection: "0x123" }).collection).toMatch(/valid address/);
  });

  it("rejects the zero address as a collection", () => {
    const e = validateLaunch({ ...good, collection: "0x0000000000000000000000000000000000000000" });
    expect(e.collection).toMatch(/zero/);
  });

  it("treats the dev buy as optional but rejects a malformed amount", () => {
    for (const devBuy of ["", "  ", "0", "5", "0.5"]) expect(validateLaunch({ ...good, devBuy }).devBuy).toBeUndefined();
    for (const devBuy of ["ten", "-1", "1.2.3"]) expect(validateLaunch({ ...good, devBuy }).devBuy).toBeTruthy();
  });
});

describe("devBuyWei", () => {
  it("is zero when empty and the parsed amount otherwise", () => {
    expect(devBuyWei({ devBuy: "" })).toBe(0n);
    expect(devBuyWei({ devBuy: "0" })).toBe(0n);
    expect(devBuyWei({ devBuy: "2.5" })).toBe(2_500_000_000_000_000_000n);
  });
});

describe("image", () => {
  it("is required", () => {
    expect(validateLaunch({ ...good, image: null }).image).toBeTruthy();
    expect(validateLaunch(good).image).toBeUndefined();
  });
  it("rejects other types", () => {
    expect(validateLaunch({ ...good, image: new File(["x"], "a.gif", { type: "image/gif" }) }).image).toBeTruthy();
  });
});

describe("helpers", () => {
  it("validateAddress names the field", () => {
    expect(validateAddress("", "Recipient")).toBe("Recipient is required.");
  });
  it("converts fee tiers to basis points", () => {
    expect(feeTierToBps(1)).toBe(100);
    expect(feeTierToBps(5)).toBe(500);
  });
});
