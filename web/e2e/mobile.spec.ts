import { demoChain } from "./support/rpc";
import { expect, test } from "./support/test";

// Runs on a phone-sized viewport (see the "mobile" project in playwright.config.ts).
test.describe("mobile layout", () => {
  test("swaps the header links for a menu button", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    const toggle = page.getByRole("button", { name: "Open menu" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("navigation", { name: "Mobile" });
    for (const label of ["Explore", "Gallery", "Launch", "Docs"]) {
      await expect(menu.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("choosing a link goes there and closes the menu", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "Gallery" }).click();

    await expect(page).toHaveURL(/\/gallery$/);
    await expect(page.getByRole("navigation", { name: "Mobile" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  });

  test("Escape closes the menu and puts focus back on the button", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("navigation", { name: "Mobile" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
  });

  for (const path of ["/", "/explore", "/gallery", "/launch", "/docs"]) {
    test(`${path} does not scroll sideways`, async ({ page, chain }) => {
      Object.assign(chain, demoChain());
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // Let the data-driven part of the page render before measuring.
      await page.waitForLoadState("networkidle");

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
