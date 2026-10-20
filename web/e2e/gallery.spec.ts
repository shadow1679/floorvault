import { ADDR } from "./support/env";
import { demoChain } from "./support/rpc";
import { expect, test } from "./support/test";

test.describe("gallery", () => {
  test("is empty until a coin has bought an NFT", async ({ page, chain }) => {
    Object.assign(chain, demoChain());
    chain.bought = [];
    await page.goto("/gallery");

    await expect(page.getByRole("heading", { level: 1, name: "The gallery" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The gallery is empty" })).toBeVisible();
    await page.getByRole("link", { name: "Explore coins" }).click();
    await expect(page).toHaveURL(/\/explore$/);
  });

  test("shows every bought NFT with its price and the coin that bought it", async ({ page, chain }) => {
    Object.assign(chain, demoChain());
    await page.goto("/gallery");

    await expect(page.getByText("1 NFT bought with creator fees")).toBeVisible();
    const tile = page.getByRole("listitem").filter({ hasText: "Test CHOG #7" });
    await expect(tile.getByText("Bought for 1.25 MON")).toBeVisible();
    await expect(tile.getByText("raffled to $CFF holders")).toBeVisible();
    // No readable tokenURI, so the tile falls back to generated art instead of a broken image.
    await expect(tile.getByRole("img", { name: "Generated artwork" })).toBeVisible();
  });

  test("lists the newest purchase first", async ({ page, chain }) => {
    Object.assign(chain, demoChain());
    chain.bought.push({ ...chain.bought[0], tokenId: 9n, block: 1040n, txHash: `0x${"e5".repeat(32)}` });
    await page.goto("/gallery");

    await expect(page.getByText("2 NFTs bought with creator fees")).toBeVisible();
    const titles = page.getByRole("listitem").locator("p.font-display");
    await expect(titles).toHaveText(["Test CHOG #9", "Test CHOG #7"]);
  });

  test("a tile links to the coin that bought it", async ({ page, chain }) => {
    Object.assign(chain, demoChain());
    await page.goto("/gallery");

    await page.getByRole("link", { name: "$CFF" }).click();
    await expect(page).toHaveURL(new RegExp(`/coin/${ADDR.coin}$`, "i"));
  });
});
