import type { Page } from "@playwright/test";
import { decodeFunctionData, type Hex } from "viem";
import { floorVaultAbi } from "../src/abi/FloorVault";
import { ADDR, NADFUN_API_URL, TX } from "./support/env";
import { demoCoin } from "./support/rpc";
import { expect, test } from "./support/test";
import { installWallet, sentTransactions, WALLET_NAME } from "./support/wallet";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const png = { name: "coin.png", mimeType: "image/png", buffer: PNG };

const SALT = `0x${"ab".repeat(32)}`;
const STORED_IMAGE = "https://storage.nadapp.net/coin/image-1";
const METADATA_URI = "https://storage.nadapp.net/metadata/meta-1.json";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "POST, OPTIONS",
};

type ApiCall = { path: string; contentType?: string; body: unknown };

/** A stand-in for nad.fun's API: records what the app sends and answers the three launch endpoints. */
async function mockNadfun(
  page: Page,
  opts: { nsfw?: boolean; failImage?: { status: number; error: string } } = {},
): Promise<ApiCall[]> {
  const calls: ApiCall[] = [];
  await page.route(`${NADFUN_API_URL}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });

    const path = new URL(request.url()).pathname;
    const contentType = request.headers()["content-type"];
    const body = path === "/metadata/image" ? { bytes: request.postDataBuffer()?.length ?? 0 } : request.postDataJSON();
    calls.push({ path, contentType, body });

    const reply = (json: unknown, status = 200) =>
      route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(json) });

    if (path === "/metadata/image") {
      if (opts.failImage) return reply({ error: opts.failImage.error }, opts.failImage.status);
      return reply({ is_nsfw: opts.nsfw ?? false, image_uri: STORED_IMAGE });
    }
    if (path === "/metadata/metadata") return reply({ metadata_uri: METADATA_URI });
    if (path === "/token/salt") return reply({ salt: SALT, address: ADDR.newCoin });
    return reply({ error: "not mocked" }, 404);
  });
  return calls;
}

async function connectWallet(page: Page) {
  await page.getByRole("banner").getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("dialog", { name: "Connect a wallet" }).getByRole("button", { name: WALLET_NAME }).click();
  await expect(page.getByRole("banner").getByRole("button", { name: /^Connected as 0x5555/i })).toBeVisible();
}

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const feeTier = (page: Page, percent: number) => page.locator("label").filter({ hasText: new RegExp(`^${percent}%$`) });

async function fillCoin(page: Page, name = "Chog Floor Fund", symbol = "cff") {
  await field(page, "Name").fill(name);
  await field(page, "Symbol").fill(symbol);
  await field(page, "Picture").setInputFiles(png);
}

test.describe("launch form", () => {
  test("starts with the Test CHOG collection, a 1% fee and an empty dev buy", async ({ page }) => {
    await page.goto("/launch");

    await expect(page.getByRole("heading", { level: 1, name: "Launch a coin" })).toBeVisible();
    await expect(field(page, "NFT collection")).toHaveValue(new RegExp(`^${ADDR.testChog}$`, "i"));
    await expect(field(page, "Dev buy (MON, optional)")).toHaveValue("");
    await expect(page.getByLabel("Who receives the NFTs")).toHaveCount(0);
    await expect(page.getByLabel("Create fee (MON)")).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "1%" })).toBeChecked();
    await expect(page.getByRole("complementary", { name: "Preview" })).toContainText("Your coin");
  });

  test("the preview follows what you type and the collection it finds", async ({ page }) => {
    await page.goto("/launch");
    await field(page, "Name").fill("Chog Floor Fund");
    await field(page, "Symbol").fill("cff");
    await feeTier(page, 3).click();

    // The symbol is shown in capitals as it is typed.
    await expect(field(page, "Symbol")).toHaveValue("CFF");
    const preview = page.getByRole("complementary", { name: "Preview" });
    await expect(preview).toContainText("Chog Floor Fund");
    await expect(preview).toContainText("$CFF");
    await expect(preview).toContainText("3% creator fee");
    await expect(page.getByText("Collection found: Test CHOG")).toBeVisible();
    await expect(preview).toContainText("buys Test CHOG");
  });

  test("warns when the collection address does not look like an NFT contract", async ({ page }) => {
    await page.goto("/launch");
    await field(page, "NFT collection").fill(ADDR.stranger);

    await expect(page.getByRole("status").filter({ hasText: "doesn't look like an NFT collection" })).toBeVisible();
  });

  test("'Use Test CHOG' restores the featured collection", async ({ page }) => {
    await page.goto("/launch");
    await field(page, "NFT collection").fill(ADDR.stranger);
    await page.getByRole("button", { name: "Use Test CHOG" }).click();

    await expect(field(page, "NFT collection")).toHaveValue(new RegExp(`^${ADDR.testChog}$`, "i"));
  });
});

test.describe("launch form: wallet", () => {
  test("asks to connect first, then shows the launch button", async ({ page }) => {
    await installWallet(page);
    await page.goto("/launch");

    const main = page.getByRole("main");
    await expect(main.getByRole("button", { name: "Launch coin" })).toHaveCount(0);
    await main.getByRole("button", { name: "Connect wallet" }).click();
    await page.getByRole("dialog", { name: "Connect a wallet" }).getByRole("button", { name: WALLET_NAME }).click();

    await expect(main.getByRole("button", { name: "Launch coin" })).toBeVisible();
  });

  test("the wallet dialog can be closed without connecting", async ({ page }) => {
    await installWallet(page);
    await page.goto("/launch");
    await page.getByRole("banner").getByRole("button", { name: "Connect wallet" }).click();

    const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close wallet dialog" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("banner").getByRole("button", { name: "Connect wallet" })).toBeVisible();
  });

  test("tells a visitor with no wallet extension what to do", async ({ page }) => {
    await page.goto("/launch");
    await page.getByRole("banner").getByRole("button", { name: "Connect wallet" }).click();

    await expect(page.getByText("No browser wallet detected.")).toBeVisible();
  });

  test("offers to switch networks when the wallet is on the wrong chain", async ({ page }) => {
    await installWallet(page, { chainId: 1 });
    await page.goto("/launch");
    await connectWallet(page);

    const main = page.getByRole("main");
    await expect(main.getByRole("button", { name: "Launch coin" })).toHaveCount(0);
    await main.getByRole("button", { name: "Switch to Monad Testnet" }).click();

    await expect(main.getByRole("button", { name: "Launch coin" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: /Switch to/ })).toHaveCount(0);
  });
});

test.describe("launch form: validation", () => {
  test.beforeEach(async ({ page }) => {
    await installWallet(page);
    await page.goto("/launch");
    await connectWallet(page);
  });

  test("an empty form lists what is missing and sends nothing", async ({ page }) => {
    await page.getByRole("button", { name: "Launch coin" }).click();

    await expect(page.getByText("Give your coin a name.")).toBeVisible();
    await expect(page.getByText("Pick a ticker symbol.")).toBeVisible();
    await expect(page.getByText("Add a picture for your coin.")).toBeVisible();
    await expect(page.getByText("Fix the highlighted fields and try again.")).toBeVisible();
    await expect(field(page, "Name")).toHaveAttribute("aria-invalid", "true");
    expect(await sentTransactions(page)).toEqual([]);
  });

  test("errors clear as soon as each field is fixed", async ({ page }) => {
    await page.getByRole("button", { name: "Launch coin" }).click();
    await expect(page.getByText("Give your coin a name.")).toBeVisible();

    await field(page, "Name").fill("Chog Floor Fund");
    await expect(page.getByText("Give your coin a name.")).toHaveCount(0);
    await field(page, "Symbol").fill("CFF");
    await expect(page.getByText("Pick a ticker symbol.")).toHaveCount(0);
    await field(page, "Picture").setInputFiles(png);
    await expect(page.getByText("Add a picture for your coin.")).toHaveCount(0);
    await expect(page.getByText("Fix the highlighted fields and try again.")).toHaveCount(0);
  });

  test("rejects a long name, a symbol with punctuation, a bad collection and a bad dev buy", async ({ page }) => {
    await fillCoin(page, "N".repeat(33), "BAD!");
    await field(page, "NFT collection").fill("0x123");
    await field(page, "Dev buy (MON, optional)").fill("ten");
    await page.getByRole("button", { name: "Launch coin" }).click();

    await expect(page.getByText("Keep the name to 32 characters or fewer.")).toBeVisible();
    await expect(page.getByText("Use letters and numbers only.")).toBeVisible();
    await expect(page.getByText(/Collection address is not a valid address/)).toBeVisible();
    await expect(page.getByText("Enter an amount in MON, for example 5, or leave it empty.")).toBeVisible();

    await field(page, "Dev buy (MON, optional)").fill("5");
    await expect(page.getByText("Enter an amount in MON, for example 5, or leave it empty.")).toHaveCount(0);
    expect(await sentTransactions(page)).toEqual([]);
  });

  test("rejects a picture that is the wrong type or over 5 MB", async ({ page }) => {
    await fillCoin(page);
    await field(page, "Picture").setInputFiles({ name: "anim.gif", mimeType: "image/gif", buffer: PNG });
    await page.getByRole("button", { name: "Launch coin" }).click();
    await expect(page.getByText("Use a PNG, JPEG, WebP or SVG image.")).toBeVisible();

    await field(page, "Picture").setInputFiles({
      name: "huge.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
    });
    await expect(page.getByText("The image must be 5 MB or smaller.")).toBeVisible();

    await field(page, "Picture").setInputFiles(png);
    await expect(page.getByText("The image must be 5 MB or smaller.")).toHaveCount(0);
  });
});

test.describe("launching a coin", () => {
  test.beforeEach(async ({ chain }) => {
    // What the chain will report once the stand-in wallet "sends" the launch.
    chain.pendingLaunch = { ...demoCoin, token: ADDR.newCoin, txHash: TX.newLaunch, block: 1059n };
  });

  test("uploads to nad.fun, sends the launch transaction and opens the new coin", async ({ page }) => {
    const api = await mockNadfun(page);
    await installWallet(page);
    await page.goto("/launch");
    await connectWallet(page);

    await fillCoin(page);
    await feeTier(page, 3).click();
    await page.getByRole("button", { name: "Launch coin" }).click();

    await expect(page).toHaveURL(new RegExp(`/coin/${ADDR.newCoin}$`, "i"));

    // nad.fun first: image, then metadata that points at it, then a salt mined for FloorVault.
    expect(api.map((c) => c.path)).toEqual(["/metadata/image", "/metadata/metadata", "/token/salt"]);
    expect(api[0]).toMatchObject({ contentType: "image/png", body: { bytes: PNG.length } });
    expect(api[1].body).toEqual({ image_uri: STORED_IMAGE, name: "Chog Floor Fund", symbol: "CFF" });
    expect(api[2].body).toMatchObject({ creator: ADDR.floorVault, metadata_uri: METADATA_URI, version: "V2" });

    // Then exactly one transaction, to FloorVault, carrying the 10 MON create fee and what the form said.
    const [sent, ...rest] = await sentTransactions(page);
    expect(rest).toEqual([]);
    expect(sent.to.toLowerCase()).toBe(ADDR.floorVault);
    expect(sent.from.toLowerCase()).toBe(ADDR.wallet);
    expect(BigInt(sent.value as Hex)).toBe(10n * 10n ** 18n);

    const call = decodeFunctionData({ abi: floorVaultAbi, data: sent.data as Hex });
    expect(call.functionName).toBe("launch");
    const args = (call.args as unknown as readonly [Record<string, unknown>])[0];
    expect(args).toMatchObject({
      name: "Chog Floor Fund",
      symbol: "CFF",
      tokenURI: METADATA_URI,
      creatorFeeRate: 300,
      salt: SALT,
    });
    expect((args.collection as string).toLowerCase()).toBe(ADDR.testChog);
    expect((args.nftRecipient as string).toLowerCase()).toBe(ADDR.wallet);
    // A deadline about an hour out, so a stalled transaction cannot land much later.
    const now = BigInt(Math.floor(Date.now() / 1000));
    expect(args.deadline as bigint).toBeGreaterThan(now + 3500n);
    expect(args.deadline as bigint).toBeLessThanOrEqual(now + 3700n);
  });

  test("adds the dev buy on top of the create fee and sends the collection the person typed", async ({ page }) => {
    await mockNadfun(page);
    await installWallet(page);
    await page.goto("/launch");
    await connectWallet(page);

    await fillCoin(page);
    await field(page, "NFT collection").fill(ADDR.stranger);
    await field(page, "Dev buy (MON, optional)").fill("2.5");
    await page.getByRole("button", { name: "Launch coin" }).click();
    await expect(page).toHaveURL(/\/coin\/0x/i);

    const [sent] = await sentTransactions(page);
    expect(BigInt(sent.value as Hex)).toBe(12_500_000_000_000_000_000n);
    const call = decodeFunctionData({ abi: floorVaultAbi, data: sent.data as Hex });
    const args = (call.args as unknown as readonly [Record<string, string | bigint>])[0];
    expect((args.collection as string).toLowerCase()).toBe(ADDR.stranger);
    expect(args.devBuy).toBe(2_500_000_000_000_000_000n);
  });

  test("stops on an image nad.fun flags as NSFW, before any transaction", async ({ page }) => {
    const api = await mockNadfun(page, { nsfw: true });
    await installWallet(page);
    await page.goto("/launch");
    await connectWallet(page);

    await fillCoin(page);
    await page.getByRole("button", { name: "Launch coin" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "flagged this image as NSFW" })).toBeVisible();
    await expect(page).toHaveURL(/\/launch$/);
    await expect(page.getByRole("button", { name: "Launch coin" })).toBeEnabled();
    expect(api.map((c) => c.path)).toEqual(["/metadata/image"]);
    expect(await sentTransactions(page)).toEqual([]);
  });

  test("shows nad.fun's own message when its API refuses the upload", async ({ page }) => {
    await mockNadfun(page, { failImage: { status: 429, error: "Rate limit exceeded" } });
    await installWallet(page);
    await page.goto("/launch");
    await connectWallet(page);

    await fillCoin(page);
    await page.getByRole("button", { name: "Launch coin" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "Rate limit exceeded" })).toBeVisible();
    expect(await sentTransactions(page)).toEqual([]);
  });

  test("says nothing was sent when the wallet rejects the transaction", async ({ page }) => {
    await mockNadfun(page);
    await installWallet(page, { rejectSend: true });
    await page.goto("/launch");
    await connectWallet(page);

    await fillCoin(page);
    await page.getByRole("button", { name: "Launch coin" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "Cancelled in your wallet. Nothing was sent." })).toBeVisible();
    await expect(page).toHaveURL(/\/launch$/);

    // The message goes away on request, and the form can be submitted again.
    await page.getByRole("button", { name: "Clear message" }).click();
    // (Next keeps an empty role="alert" route announcer on the page, so only alerts with text count.)
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Launch coin" })).toBeEnabled();
  });

  test("does not ask the wallet to sign when the pre-flight check fails", async ({ page, chain }) => {
    chain.pendingLaunch = undefined; // the simulated launch call now reverts
    await mockNadfun(page);
    await installWallet(page);
    await page.goto("/launch");
    await connectWallet(page);

    await fillCoin(page);
    await page.getByRole("button", { name: "Launch coin" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "Launch reverted" })).toBeVisible();
    await expect(page).toHaveURL(/\/launch$/);
    expect(await sentTransactions(page)).toEqual([]);
  });
});
