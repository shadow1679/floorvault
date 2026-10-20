import { defineConfig, devices } from "@playwright/test";
import { BARE_ENV, BARE_PORT, CONFIGURED_ENV, CONFIGURED_PORT } from "./e2e/support/env";

const configuredUrl = `http://localhost:${CONFIGURED_PORT}`;
const bareUrl = `http://localhost:${BARE_PORT}`;

// Two dev servers: one with fake contract addresses (the normal app) and one with none (the
// "not configured" notice). NEXT_PUBLIC_* values are inlined per server, so they cannot share one.
// The browser never reaches a real chain or API: see e2e/support/test.ts.
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "./e2e/.report" }]],
  use: { trace: "on-first-retry", screenshot: "only-on-failure" },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], baseURL: configuredUrl },
      testIgnore: [/unconfigured\.spec/, /mobile\.spec/],
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], baseURL: configuredUrl },
      testMatch: /mobile\.spec/,
    },
    {
      name: "unconfigured",
      use: { ...devices["Desktop Chrome"], baseURL: bareUrl },
      testMatch: /unconfigured\.spec/,
    },
  ],
  webServer: [
    {
      command: `npx next dev --port ${CONFIGURED_PORT}`,
      url: configuredUrl,
      env: { ...CONFIGURED_ENV, NEXT_TELEMETRY_DISABLED: "1", NEXT_DIST_DIR: ".next-e2e-configured" },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npx next dev --port ${BARE_PORT}`,
      url: bareUrl,
      env: { ...BARE_ENV, NEXT_TELEMETRY_DISABLED: "1", NEXT_DIST_DIR: ".next-e2e-bare" },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
