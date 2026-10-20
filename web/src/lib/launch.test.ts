import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, getAddress, type Hash } from "viem";
import { floorVaultAbi } from "@/abi/FloorVault";
import { buildLaunchArgs, LAUNCH_DEADLINE_SECONDS } from "./launch";
import type { LaunchForm } from "./validation";

const form: LaunchForm = {
  name: "  Chog Floor Fund ",
  symbol: " cff ",
  image: null,
  feeTier: 3,
  collection: "0x8b5459fad279f1beef9854d70167a79fc19411e1",
  devBuy: "",
};
const creator = getAddress("0x8b6a7b5011ee7e06e3c36a2b3c04e0ef3837a76f");
const salt = `0x${"ab".repeat(32)}` as Hash;
const tokenURI = "https://storage.nadapp.net/metadata/abc.json";
const assets = { tokenURI, salt };

describe("buildLaunchArgs", () => {
  it("maps fee tiers 1/3/5 to 100/300/500 bps", () => {
    const rates = [1, 3, 5].map((feeTier) => buildLaunchArgs({ ...form, feeTier }, 0, assets, creator).creatorFeeRate);
    expect(rates).toEqual([100, 300, 500]);
  });

  it("trims the name, trims and uppercases the symbol", () => {
    const a = buildLaunchArgs(form, 0, assets, creator);
    expect(a.name).toBe("Chog Floor Fund");
    expect(a.symbol).toBe("CFF");
  });

  it("sets the deadline to now + 3600 seconds", () => {
    expect(LAUNCH_DEADLINE_SECONDS).toBe(3600);
    expect(buildLaunchArgs(form, 1_700_000_000.9, assets, creator).deadline).toBe(1_700_003_600n);
  });

  it("uses the metadata URI and salt that nad.fun returned", () => {
    const a = buildLaunchArgs(form, 0, assets, creator);
    expect(a.tokenURI).toBe(tokenURI);
    expect(a.salt).toBe(salt);
  });

  it("normalizes addresses, including a bad mixed-case checksum, so viem can encode them", () => {
    const args = buildLaunchArgs({ ...form, collection: "0x8B5459fad279f1beef9854d70167a79fc19411e1" }, 0, assets, creator);
    expect(args.collection).toBe(getAddress("0x8b5459fad279f1beef9854d70167a79fc19411e1"));
    const data = encodeFunctionData({ abi: floorVaultAbi, functionName: "launch", args: [args] });
    expect(decodeFunctionData({ abi: floorVaultAbi, data }).functionName).toBe("launch");
  });

  it("falls back to the connected wallet as nftRecipient, and sends the dev buy in wei", () => {
    expect(buildLaunchArgs(form, 0, assets, creator).nftRecipient).toBe(creator);
    expect(buildLaunchArgs(form, 0, assets, creator).devBuy).toBe(0n);
    expect(buildLaunchArgs({ ...form, devBuy: "2.5" }, 0, assets, creator).devBuy).toBe(2_500_000_000_000_000_000n);
  });

  it("throws on an invalid address instead of encoding garbage", () => {
    expect(() => buildLaunchArgs({ ...form, collection: "0x123" }, 0, assets, creator)).toThrow();
  });
});
