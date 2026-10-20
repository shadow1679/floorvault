import { ADDR } from "./support/env";
import { demoChain } from "./support/rpc";
import { expect, test } from "./support/test";

test.describe("home page", () => {
  test("pitches the product and explains the four steps", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Coins that eat the floor.");
    const how = page.getByRole("region", { name: "How it works" });
    for (const step of ["Launch a coin", "Trades make fees", "Split 80 / 20", "The vault buys"]) {
      await expect(how.getByRole("heading", { level: 3, name: step })).toBeVisible();
    }
  });

  test("the hero buttons lead to Launch and Explore", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Launch a coin" }).first().click();
    await expect(page).toHaveURL(/\/launch$/);

    await page.goto("/");
    await page.getByRole("link", { name: "Explore coins" }).first().click();
    await expect(page).toHaveURL(/\/explore$/);
  });

  test("features the CHOG collection with a link that pre-fills the launch form", async ({ page, chain }) => {
    Object.assign(chain, demoChain());
    await page.goto("/");

    const featured = page.getByRole("region", { name: "Start with CHOG" });
    await expect(featured.getByRole("heading", { level: 3, name: "Test CHOG" })).toBeVisible();
    const cta = featured.getByRole("link", { name: "Launch a CHOG coin" });
    await expect(cta).toHaveAttribute("href", new RegExp(`/launch\\?collection=${ADDR.testChog}`, "i"));

    await cta.click();
    await expect(page.getByLabel("NFT collection")).toHaveValue(new RegExp(`^${ADDR.testChog}$`, "i"));
  });
});

test.describe("site navigation", () => {
  const pages = [
    { label: "Explore", path: "/explore", heading: "Explore coins" },
    { label: "Gallery", path: "/gallery", heading: "The gallery" },
    { label: "Launch", path: "/launch", heading: "Launch a coin" },
    { label: "Docs", path: "/docs", heading: "Docs" },
  ];

  for (const { label, path, heading } of pages) {
    test(`header link "${label}" opens ${path} and is marked as the current page`, async ({ page }) => {
      await page.goto("/");
      const main = page.getByRole("navigation", { name: "Main" });
      await main.getByRole("link", { name: label }).click();

      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(main.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    });
  }

  test("the wordmark returns home and the skip link targets the main landmark", async ({ page }) => {
    await page.goto("/docs");
    await page.getByRole("link", { name: "floorvault home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    await expect(page.locator("main#main")).toBeAttached();
  });

  test("the footer repeats the navigation and links out to the explorer and faucet", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByRole("navigation", { name: "Footer" });
    for (const label of ["Explore", "Gallery", "Launch", "Docs"]) {
      await expect(footer.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await expect(footer.getByRole("link", { name: "Explorer", exact: true })).toHaveAttribute("href", /monadvision\.com/);
    await expect(footer.getByRole("link", { name: "Testnet faucet" })).toHaveAttribute("href", "https://faucet.monad.xyz");
  });
});
