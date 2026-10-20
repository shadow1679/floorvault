import { MISSING_VARS } from "./support/env";
import { expect, test } from "./support/test";

// These run against a dev server started with blank contract addresses (see playwright.config.ts).
test.describe("when the contract addresses are not set", () => {
  for (const path of ["/explore", "/gallery", "/launch"]) {
    test(`${path} explains what is missing instead of breaking`, async ({ page, chain }) => {
      await page.goto(path);

      const notice = page.getByRole("status").filter({ hasText: "floorvault is not configured yet" });
      await expect(notice).toBeVisible();
      for (const name of MISSING_VARS) await expect(notice.getByText(name, { exact: true })).toBeVisible();
      await expect(notice.getByText("web/.env.example")).toBeVisible();

      // With nothing to read, the page must not poke the RPC at all.
      expect(chain.calls).toEqual([]);
    });
  }

  test("the launch form is hidden, so nobody can send a transaction", async ({ page }) => {
    await page.goto("/launch");
    await expect(page.getByRole("heading", { name: "floorvault is not configured yet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Launch coin" })).toHaveCount(0);
    await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  });

  test("the home page still renders, with a short notice in the CHOG section", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Coins that eat the floor.");
    const chog = page.getByRole("region", { name: "Start with CHOG" });
    await expect(chog.getByText("Live data and transactions are off until the contract addresses are set.")).toBeVisible();
    await expect(chog.getByText("Copy web/.env.example")).toHaveCount(0);
  });

  test("the docs page still renders and says where addresses will appear", async ({ page }) => {
    await page.goto("/docs");

    await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
    await expect(page.getByText(/Contract addresses appear here once/)).toBeVisible();
  });
});
