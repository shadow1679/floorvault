#!/usr/bin/env node
// Turns a Foundry broadcast of DeployTestnet (or, with --mainnet, DeployMainnet) into
// deployments/<chainId>.json and, with --env, into a web env file. Reads the exact receipts, so the
// deploy block is the real inclusion block.
//
//   node script/export-deployments.mjs                     # write deployments/10143.json
//   node script/export-deployments.mjs --env               # also write ../web/.env.local (--force to overwrite)
//   node script/export-deployments.mjs --mainnet --env    # deployments/143.json + ../web/.env.mainnet.local
//   node script/export-deployments.mjs --run broadcast/DeployTestnet.s.sol/10143/run-123.json
//
// The mainnet env goes to a separate file so it never overwrites the testnet .env.local; copy it over when switching.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.indexOf(name);
const runIdx = flag("--run");
const mainnet = flag("--mainnet") >= 0;
const defaultRun = mainnet
  ? "broadcast/DeployMainnet.s.sol/143/run-latest.json"
  : "broadcast/DeployTestnet.s.sol/10143/run-latest.json";
const runFile = resolve(root, runIdx >= 0 ? args[runIdx + 1] : defaultRun);

if (!existsSync(runFile)) {
  console.error(`No broadcast file at ${runFile}. Run ${mainnet ? "DeployMainnet" : "DeployTestnet"} with --broadcast first.`);
  process.exit(1);
}

const run = JSON.parse(readFileSync(runFile, "utf8"));
const creates = run.transactions.filter((t) => t.transactionType === "CREATE");
const byName = (name) => {
  const matches = creates.filter((t) => t.contractName === name);
  if (matches.length !== 1) {
    console.error(`Expected exactly one CREATE of ${name} in ${runFile}, found ${matches.length}.`);
    process.exit(1);
  }
  return matches[0];
};

const vault = byName("FloorVault");
const chog = mainnet ? null : byName("TestChog");
const market = mainnet ? null : byName("MockMarketplace");
const adapter = mainnet ? byName("SeaportAdapter") : null;
const raffle = byName("Raffle");

const receiptFor = (tx, label) => {
  const receipt = run.receipts.find((r) => r.transactionHash.toLowerCase() === tx.hash.toLowerCase());
  if (!receipt) {
    console.error(`No receipt for the ${label} deploy. Was the broadcast completed?`);
    process.exit(1);
  }
  if (receipt.status !== "0x1") {
    console.error(`${label} deploy transaction did not succeed.`);
    process.exit(1);
  }
  return receipt;
};
const vaultReceipt = receiptFor(vault, "FloorVault");
const raffleReceipt = receiptFor(raffle, "Raffle");

// Raffle is deployed before FloorVault, so scanning from the earlier block covers both contracts.
const deployBlock = Math.min(Number(BigInt(vaultReceipt.blockNumber)), Number(BigInt(raffleReceipt.blockNumber)));
// FloorVault constructor args: router, creator fee vault, wmon, marketplace, raffle, treasury, keeper, allowedCollection.
const treasury = vault.arguments?.[5] ?? null;
const keeper = vault.arguments?.[6] ?? null;
const collection = vault.arguments?.[7] ?? null;

const out = {
  chainId: Number(run.chain),
  deployBlock,
  floorVault: vault.contractAddress,
  raffle: raffle.contractAddress,
  ...(mainnet
    ? { seaportAdapter: adapter.contractAddress, collection }
    : { mockMarketplace: market.contractAddress, testChog: chog.contractAddress }),
  treasury,
  ...(keeper ? { keeper } : {}), // absent in deployments made before keeper-gated buy
  deployTx: vault.hash,
  deployedAt: new Date(run.timestamp).toISOString(),
};

const dir = resolve(root, "deployments");
mkdirSync(dir, { recursive: true });
const jsonPath = resolve(dir, `${out.chainId}.json`);
writeFileSync(jsonPath, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${jsonPath}`);

if (flag("--env") >= 0) {
  const envPath = resolve(root, mainnet ? "../web/.env.mainnet.local" : "../web/.env.local");
  if (existsSync(envPath) && flag("--force") < 0) {
    console.error(`${envPath} already exists. Re-run with --force to overwrite it.`);
    process.exit(1);
  }
  writeFileSync(
    envPath,
    (mainnet
      ? [
          `NEXT_PUBLIC_CHAIN_ID=143`,
          `NEXT_PUBLIC_FLOORVAULT_ADDRESS=${out.floorVault}`,
          `NEXT_PUBLIC_RAFFLE_ADDRESS=${out.raffle}`,
          `NEXT_PUBLIC_COLLECTION_ADDRESS=${out.collection}`,
          `NEXT_PUBLIC_DEPLOY_BLOCK=${out.deployBlock}`,
          `SEAPORT_ADAPTER_ADDRESS=${out.seaportAdapter}`,
          "# Server-side secrets, set by hand: OPENSEA_API_KEY, KEEPER_ACCOUNT, KEEPER_PASSWORD_FILE",
          "",
        ]
      : [
          `NEXT_PUBLIC_FLOORVAULT_ADDRESS=${out.floorVault}`,
          `NEXT_PUBLIC_RAFFLE_ADDRESS=${out.raffle}`,
          `NEXT_PUBLIC_MOCK_MARKETPLACE_ADDRESS=${out.mockMarketplace}`,
          `NEXT_PUBLIC_TEST_CHOG_ADDRESS=${out.testChog}`,
          `NEXT_PUBLIC_DEPLOY_BLOCK=${out.deployBlock}`,
          "",
        ]
    ).join("\n"),
  );
  console.log(`Wrote ${envPath}`);
}
