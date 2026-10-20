import { ADDR } from "./support/env";
import { demoChain } from "./support/rpc";
import { expect, test } from "./support/test";

test.describe("explore", () => {
  test("shows an empty state with a way to launch the first coin", async ({ page }) => {
    await page.goto("/explore");

    await expect(page.getByRole("heading", { level: 1, name: "Explore coins" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No coins yet" })).toBeVisible();
    await page.getByRole("link", { name: "Launch a coin" }).last().click();
    await expect(page).toHaveURL(/\/launch$/);
  });

  test("lists each launched coin with its collection, budget and purchases", async ({ page, chain }) => {
    Object.assign(chain, demoChain());
    await page.goto("/explore");

    await expect(page.getByText("1 coin launched")).toBeVisible();
    const card = page.getByRole("listitem").filter({ hasText: "Chog Floor Fund" });
    await expect(card.getByText("$CFF")).toBeVisible();
    await expect(card.getByText("Buys")).toContainText("Test CHOG");
    await expect(card.locator("dt", { hasText: "NFT budget" }).locator("xpath=following-sibling::dd")).toHaveText("2.5 MON");
    await expect(card.locator("dt", { hasText: "NFTs bought" }).locator("xpath=following-sibling::dd")).toHaveText("1");
  });

  test("a coin card opens that coin's page", async ({ page, chain }) => {
    Object.assign(chain, demoChain());
    await page.goto("/explore");

    await page.getByRole("link", { name: "Chog Floor Fund" }).click();
    await expect(page).toHaveURL(new RegExp(`/coin/${ADDR.coin}$`, "i"));
  });

  test("pluralises the coin count", async ({ page, chain }) => {
    Object.assign(chain, demoChain());
    chain.coins.push({
      ...chain.coins[0],
      token: ADDR.newCoin,
      name: "Second Coin",
      symbol: "TWO",
      block: 1030n,
      txHash: `0x${"d4".repeat(32)}`,
    });
    await page.goto("/explore");

    await expect(page.getByText("2 coins launched")).toBeVisible();
    // Newest launch first.
    const names = page.getByRole("heading", { level: 3 });
    await expect(names.first()).toHaveText("Second Coin");
  });

  test("shows an error with a retry when the RPC is down, and recovers", async ({ page, chain }) => {
    Object.assign(chain, demoChain());
    chain.down = true;
    await page.goto("/explore");

    await expect(page.getByRole("alert").filter({ hasText: "Could not load data" })).toBeVisible({ timeout: 40_000 });

    chain.down = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("link", { name: "Chog Floor Fund" })).toBeVisible();
  });
});
