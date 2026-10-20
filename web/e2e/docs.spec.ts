import { ADDR } from "./support/env";
import { expect, test } from "./support/test";

test.describe("docs", () => {
  test("explains the fee flow in five sections", async ({ page }) => {
    await page.goto("/docs");

    await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
    for (const title of ["Fee flow", "The 80/20 split", "How buying works", "Contracts", "Risks"]) {
      await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
    }
  });

  test("the on-page menu jumps to a section", async ({ page }) => {
    await page.goto("/docs");

    await page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "Risks" }).click();
    await expect(page).toHaveURL(/\/docs#risks$/);
    await expect(page.getByRole("heading", { level: 2, name: "Risks" })).toBeInViewport();
  });

  test("lists the deployed contracts with links to the explorer", async ({ page }) => {
    await page.goto("/docs");

    const contracts = page.getByRole("region", { name: "Contracts" });
    for (const [label, address] of [
      ["FloorVault", ADDR.floorVault],
      ["MockMarketplace", ADDR.marketplace],
      ["Test CHOG", ADDR.testChog],
    ]) {
      const row = contracts.locator("div").filter({ has: page.getByText(label, { exact: true }) }).last();
      const link = row.getByRole("link", { name: new RegExp(address, "i") });
      await expect(link).toHaveAttribute("href", new RegExp(`monadvision\\.com/address/${address}`, "i"));
      await expect(link).toHaveAttribute("target", "_blank");
    }
  });
});
