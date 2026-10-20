import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The app defaults to mainnet; most fixtures describe the testnet deployment. Tests of the default stub the variable blank.
    env: { NEXT_PUBLIC_CHAIN_ID: "10143" },
  },
});
