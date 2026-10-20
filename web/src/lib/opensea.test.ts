import { describe, expect, it } from "vitest";
import { parseBestListing } from "./opensea";

const listing = (over: Record<string, unknown> = {}) => ({
  order_hash: "0x1",
  chain: "monad",
  price: { current: { currency: "MON", decimals: 18, value: "5450000000000000000000" } },
  asset: { contract: "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763", identifier: "1234" },
  ...over,
});

describe("parseBestListing", () => {
  it("reads the price in wei and the token id of the first (cheapest) listing", () => {
    expect(parseBestListing({ listings: [listing(), listing({ price: { current: { decimals: 18, value: "9" } } })], next: null })).toEqual({
      floor: "5450000000000000000000",
      tokenId: "1234",
    });
  });
  it("falls back to the order's offer item when the asset is absent", () => {
    const l = listing({ asset: null, protocol_data: { parameters: { offer: [{ itemType: 2, identifierOrCriteria: "77" }] } } });
    expect(parseBestListing({ listings: [l] })?.tokenId).toBe("77");
  });
  it("returns null for an empty market", () => {
    expect(parseBestListing({ listings: [], next: null })).toBeNull();
  });
  it("throws on a body it does not understand rather than showing a wrong floor", () => {
    expect(() => parseBestListing({})).toThrow(/no listings array/);
    expect(() => parseBestListing(null)).toThrow();
    expect(() => parseBestListing({ listings: [listing({ price: { current: { decimals: 18, value: "1.5" } } })] })).toThrow(/bad price/);
    expect(() => parseBestListing({ listings: [listing({ price: { current: { decimals: 6, value: "1500000" } } })] })).toThrow(/18-decimal/);
  });
});
