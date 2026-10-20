import { describe, expect, it } from "vitest";
import { explainError } from "./errors";

const revert = (reason?: string, short = "The contract function reverted") => ({
  name: "ContractFunctionExecutionError",
  shortMessage: short,
  cause: { name: "ContractFunctionRevertedError", reason, shortMessage: short },
});

describe("explainError", () => {
  it("handles wallet rejection", () => {
    expect(explainError({ code: 4001, message: "User rejected the request." }, "buy")).toMatch(/Cancelled/);
    expect(explainError({ name: "UserRejectedRequestError" }, "launch")).toMatch(/Cancelled/);
  });

  it("says there are no fees to claim when harvest reverts", () => {
    expect(explainError(revert(undefined, "execution reverted"), "harvest")).toMatch(/No fees to claim yet/);
  });

  it("does not call every failure 'no fees': app errors and other reasons keep their real message", () => {
    expect(explainError(new Error("Harvest transaction reverted."), "harvest")).toBe("Harvest transaction reverted.");
    expect(explainError(revert("reentrant"), "harvest")).toMatch(/in progress/);
    expect(explainError(revert("some other reason"), "harvest")).toBe("Transaction reverted: some other reason");
    expect(explainError({ name: "HttpRequestError", shortMessage: "HTTP request failed. revert-proxy 502" }, "harvest")).toBe(
      "HTTP request failed. revert-proxy 502",
    );
  });

  it("treats a bare signature-only revert (custom error) as no fees", () => {
    const err = new Error('The contract function "harvest" reverted with the following signature:\n0x669567ea');
    expect(explainError(err, "harvest")).toMatch(/No fees to claim yet/);
  });

  it("keeps a distinct message for an unknown coin on harvest", () => {
    expect(explainError(revert("unknown token"), "harvest")).toMatch(/does not know/);
  });

  it("explains buy reverts", () => {
    expect(explainError(revert("floor above budget"), "buy")).toMatch(/floor is above/i);
    expect(explainError(revert("no listings"), "buy")).toMatch(/No NFTs are listed/);
    expect(explainError(revert("above budget"), "buy")).toMatch(/floor is above/i);
    expect(explainError(revert("not keeper"), "buy")).toMatch(/keeper/i);
    expect(explainError(revert("collection not supported"), "launch")).toMatch(/only supports/i);
  });

  it("surfaces launch revert reasons", () => {
    expect(explainError(revert("zero address"), "launch")).toMatch(/zero address/);
    expect(explainError(revert("deadline passed"), "launch")).toMatch(/deadline passed/);
  });

  it("explains every raffle revert the contract can raise", () => {
    expect(explainError(revert("too early"), "raffle")).toMatch(/not draw time/);
    expect(explainError(revert("settle window open"), "raffle")).toMatch(/still open/);
    expect(explainError(revert("not the winner"), "raffle")).toMatch(/Only the winner/);
    expect(explainError(revert("claim window expired"), "raffle")).toMatch(/Anyone can re-raffle/);
    expect(explainError(revert("claim window open"), "raffle")).toMatch(/still has time/);
    expect(explainError(revert("past winner"), "raffle")).toMatch(/already won/);
  });

  it("falls back to the raw reason for an unmapped raffle revert", () => {
    expect(explainError(revert("something new"), "raffle")).toBe("Transaction reverted: something new");
  });

  it("reports missing gas funds without blaming the contract", () => {
    expect(explainError({ shortMessage: "The total cost exceeds the balance of the account." }, "harvest")).toMatch(
      /Not enough MON/,
    );
  });

  it("falls back to the first line of the message", () => {
    expect(explainError(new Error("boom\nstack"), "buy")).toBe("boom");
  });
});
