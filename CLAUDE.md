# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FloorVault: a hackathon (CHOG NFT hackathon) memecoin launcher for Monad, modeled on usenosh.app. A coin is launched on nad.fun V2 and paired with an NFT collection. The coin's creator fee is routed to our `FloorVault` contract, which keeps 10% for a treasury, pays 10% to the coin's creator and uses 80% as a per-coin budget to buy NFTs from the paired collection. Runs on **Monad mainnet restricted to Chog Genesis** (the default: a blank `NEXT_PUBLIC_CHAIN_ID` means 143, in the web app and the keeper) and, with `NEXT_PUBLIC_CHAIN_ID=10143`, on **Monad testnet (chain 10143)** with a mock marketplace. `web/.env.local` pins 10143 because it holds the testnet deployment. Mainnet buys through Seaport/OpenSea (`DeployMainnet`, `SeaportAdapter`). Mainnet has not been deployed yet. Contracts are unaudited. This directory is not a git repository.

Three parts, each with its own toolchain:

- `contracts/` -- Solidity with Foundry (Foundry >= 1.8; installed 1.8.3).
- `web/` -- Next.js + wagmi/viem frontend (Explore, Gallery, Launch, Docs). There is no Claims page: `web/scripts/keeper.mjs` harvests and buys automatically and drives each raffle up to the winner's claim.
- `_bmad-output/`, `_bmad/` -- BMad workflow artifacts (product brief, specs, `deferred-work.md`) and the installed BMad tooling. These are planning records, not product code. `planning-artifacts/briefs/*/addendum.md` holds the verified nad.fun and Monad addresses and findings; read it before touching anything nad.fun-related.

## Commands

Contracts (run from `contracts/`):

```sh
forge build
forge test --no-match-contract FloorVaultForkTest      # offline unit tests (MockMarketplace)
forge test --network monad --match-contract FloorVaultForkTest -vv   # needs network; forks live testnet
forge test --match-test test_floorIsCheapestListing    # single test
# Deploy TestChog + MockMarketplace + FloorVault (use --account for a Foundry keystore, e.g. launcher-deployer):
forge script script/DeployTestnet.s.sol --rpc-url https://testnet-rpc.monad.xyz --account <keystore> --broadcast
node script/export-deployments.mjs [--env [--force]]   # broadcast JSON -> deployments/10143.json (+ web/.env.local)
# Mainnet (real funds; TREASURY and KEEPER required; omit --broadcast for a dry run):
TREASURY=0x.. KEEPER=0x.. forge script script/DeployMainnet.s.sol --rpc-url https://rpc.monad.xyz --account <keystore> --broadcast
node script/export-deployments.mjs --mainnet --env     # deployments/143.json + web/.env.mainnet.local (not .env.local)
forge test --network monad --match-contract "SeaportAdapterForkTest|FloorVaultMainnetForkTest" -vv   # mainnet fork tests
```

Web (run from `web/`): `npm run dev | build | lint | typecheck | test`. Single test: `npx vitest run src/lib/scan.test.ts` (or add `-t "name"`).

Keeper (from `web/`): `KEEPER_ACCOUNT=launcher-deployer KEEPER_PASSWORD_FILE=~/.foundry/keystores/.launcher-deployer.pass npm run keeper` loops `harvest` then `buy` for every launched coin, then, when `NEXT_PUBLIC_RAFFLE_ADDRESS` is set, `draw`, `settle`, `finalize` and `reRaffle` for every open raffle (`-- --once` for a single pass). It never claims: only the winner can. It folds each coin's `Transfer` logs into balances ahead of the draw and keeps them in the state file. Each call is simulated first and skipped if it would revert. `buy` is keeper-only, so `KEEPER_ACCOUNT` must be the vault's `keeper()`. On mainnet it also needs `OPENSEA_API_KEY` and `SEAPORT_ADAPTER_ADDRESS`. It signs through `cast`, keeps its scan cursor in `web/.keeper-state.json`, and the first run takes minutes because public RPCs rate-limit log scans.

Note: plain `forge test` also runs the fork test, which fails without `--network monad` (Foundry reports "cannot create a `monad` fork with an EVM instantiated for `ethereum`").

## Architecture

**On-chain flow** (`contracts/src/FloorVault.sol`): `launch` calls nad.fun's `createWithNative` with the Creator Fee vault (100% bps) as the only vault and `abi.encode(address(this))` as setup data, so the vault contract becomes the fee recipient, then records a `Pairing` (collection, nftRecipient, budget). `msg.value` is nad.fun's fixed 10 MON create fee plus `devBuy`, which is passed as `buyQuoteAmount`; the router delivers those coins to the vault, which forwards them to the caller. The web form has no recipient or create-fee input: it sends the connected wallet as `nftRecipient` (the raffle fallback) and adds the fixed `CREATE_FEE` to the optional dev buy. `harvest(token)` calls the Creator Fee vault's `claim`, splits 10/10/80 (treasury/creator/budget), and credits the budget. `buy(token)` reads `market.floor`, requires price <= budget, unwraps WMON, and calls `market.buyFloor`. `launch` only accepts `allowedCollection` (Chog Genesis on mainnet; 0 = any on testnet). `harvest` is permissionless because destinations are fixed at launch; it handles both WMON and native MON payouts (mainnet's Creator Fee vault pays native MON, testnet's pays WMON) and wraps native into the budget. `buy(token, maxPrice, data)` is **keeper-only** (`keeper`, rotated by the treasury via `setKeeper`; 0 = anyone, testnet mock only): Seaport has no on-chain floor, so the keeper picks the listing off-chain and passing it in permissionlessly would let anyone list an NFT at exactly the budget and drain it. The budget is charged what the marketplace actually kept (balance delta); unspent MON is wrapped back.

**Raffle** (`contracts/src/Raffle.sol`): `buy` sends the NFT to the `Raffle` contract and calls `open`; holders of that coin are raffled the NFT (draw, settle window, finalize, 7-day claim, re-raffle). `Raffle.init(vault)` runs once after FloorVault is deployed. The UI lives only on the coin page (`RafflePanel.tsx`); holders come from the coin's ERC-20 `Transfer` logs (`holders.ts`). Needs `NEXT_PUBLIC_RAFFLE_ADDRESS`.

**Marketplace seam**: `IMarketplace.buyListing(collection, maxPrice, to, data)` is the only thing FloorVault knows about NFT markets. Testnet uses `MockMarketplace` (Seaport is not deployed on Monad testnet; it ignores `data` and sells its own floor). Mainnet uses `SeaportAdapter`, where `data = abi.encode(SeaportAdvancedOrder)`: it checks the order sells one ERC-721 of the collection, calls Seaport 1.6 `fulfillAdvancedOrder` with `recipient = Raffle`, and requires the NFT to have landed. OpenSea's signed-zone `extraData` commits to the fulfiller, so request `fulfillment_data` with the **adapter** (not the keeper) as fulfiller. The keeper logic is in `web/scripts/seaport.mjs` (pure, tested) and `keeper.mjs`.

**Frontend data layer** (`web/src/lib/`): no indexer or database. `chain.ts` scans `Launched`/`Harvested`/`Bought` events from `NEXT_PUBLIC_DEPLOY_BLOCK` in 100-block chunks (`scan.ts`), caches the result in memory and localStorage (bigint-safe via `serialize.ts`), and derives coins, budgets, and bought NFTs. The long walk happens once on the server: `/api/scan` (`serverScan.ts`) keeps the scan in memory and in `web/.scan-cache/`, advances it in the background, and tells the browser whether it is still `indexing`. A cold browser fetches that snapshot and scans only the tail; while the server is far behind, Explore and Gallery show what exists so far with a note. If `/api/scan` is unreachable the browser scans everything itself, as before. A coin's holder balances work the same way: `/api/holders?token=` (`serverHolders.ts`, only for coins the vault launched) keeps the `Transfer` fold, so a cold coin page reads only the tail. Both server scans (and the keeper) use the optional server-only `LOGS_RPC_URL` (Envio, no 100-block cap, a full history in one call) and fall back to the public RPC; the browser never sees it. It takes either Envio product: a `*.rpc.hypersync.xyz` URL is plain JSON-RPC (HyperRPC), while a `*.hypersync.xyz` URL is HyperSync's own `/query` API, which `web/scripts/hypersync.mjs` adapts to a viem transport (a token made for one product gets a 403 from the other). The price chart still scans `Sync` events in the browser when nad.fun's chart API has no candles for a coin. **nad.fun's REST API is the other half of the data layer** (`nadfun.ts`; base `NEXT_PUBLIC_NADFUN_API_URL`, default the testnet dev API `https://dev-api.nadapp.net`, mainnet `https://api.nad.fun`). A coin is only indexed by it if it was launched through its flow, so `useLaunch` first uploads the image (`POST /metadata/image`), then the metadata (`/metadata/metadata`, whose `metadata_uri` becomes the on-chain `tokenURI`), then mines the vanity `…7777` salt (`/token/salt` with `creator` = the FloorVault address, since it is the router's caller). The price chart reads `/trade/chart/{token}` first (`useNadfunCandles`) and only falls back to scanning `Sync` events off the chain (slow, 100-block chunks) when the API answers 404, which is the case for coins launched before this flow (`data:` `tokenURI`, random salt). `getCoinMeta` still decodes those `data:` URIs and fetches `https://storage.nadapp.net/` metadata for new ones. The API is rate limited (a few unauthenticated calls per minute), so keep polling gentle. `config.ts` parses `NEXT_PUBLIC_*` env into a typed result, and pages show a "not configured" notice when it is invalid, so keep env access static in `readEnv()` or Next will not inline it.

**Contract addresses flow**: `DeployTestnet` -> `broadcast/.../run-latest.json` -> `export-deployments.mjs` -> `deployments/10143.json` and `web/.env.local`. `web/src/abi/*.ts` are copied from `contracts/out` by hand; regenerate them after changing a contract's interface.

## Gotchas

- **OpenSea API (mainnet keeper/floor).** Needs `OPENSEA_API_KEY` (server-side only). A free key comes from `POST https://api.opensea.io/api/v2/auth/keys` (expires in 7 days; 600 reads/h, 5 fulfillment calls/min). The best-listings response has `protocol_data.signature: null`; the signed order comes from `POST /listings/fulfillment_data` in `fulfillment_data.orders[0]`, and listings can expire within ~10 minutes, so fetch, simulate and send in one pass.
- **Mainnet economics.** Mainnet allows only a 100 bps creator fee, the vault keeps 80% of it as budget, and nad.fun settles fees only after 100 MON accumulate. A CHOG NFT costs about 5,700 MON (sampled 2026-10-14), so buying one takes on the order of 700k MON of volume on a single coin.
- **Raffle blocked list.** Only the bonding curve is blocked at deploy; a graduated coin's DEX pair is not, so it could be picked as a winner and delay the NFT 7 days until `reRaffle`. No funds are lost.

- **nad.fun creator fee rate is immutable per coin.** Testnet allows 100, 300 or 500 bps (mainnet only 100). To change a coin's rate, launch a new coin. The `launch` salt is a CREATE2 salt on the live chain: reusing one that was already launched reverts with `FailedDeployment()`. The fork test uses its own salt for this reason; do not reuse it for live launches.
- **Live harvest can't be demoed end to end.** nad.fun holds creator fees in its FeeCollector and only pays the Creator Fee vault when `settle` is called by nad.fun's own keeper after ~100 MON of accumulated fees. The fork test fakes that with `vm.mockCall` on the access authority; treat the fork test as the proof of the fee path.
- **Foundry scripts: `msg.sender` is not the wallet.** Inside `run()` it is the default sender. Use `(, address deployer,) = vm.readCallers()` after `vm.startBroadcast()`, as `DeployTestnet` does. The script also reverts on any chain other than 10143 because the nad.fun addresses are hardcoded.
- **Public testnet RPC limits `eth_getLogs` to 100 blocks.** Any new log scan must chunk. Mainnet's public RPC has the same cap. The first load after a fresh deployment (or after deleting `web/.scan-cache/`) makes the server walk the whole history, which takes a few minutes for about 2,000 chunks per day of age; open Explore once before a demo so the server has caught up. Free third-party RPCs (dRPC, Ankr, OnFinality) cap the range too, so a bigger window is not an option. Gas on Monad is charged on the gas limit, not gas used.
- **`web/` runs a non-standard Next.js (16.4) and React 19.3.** Per `web/AGENTS.md`, read the relevant guide in `web/node_modules/next/dist/docs/` before writing Next.js code; do not rely on memorized APIs.

## Deployer wallet

Mainnet involves real funds: never use this throwaway wallet for the mainnet treasury (use a multisig or hardware wallet), and give the keeper only the gas it needs. Testnet deploys and launches use the Foundry keystore `launcher-deployer` (`~/.foundry/keystores/launcher-deployer`, address `0x461723FFf16C0B6f8a11fFea2AA0f1d31FeD019a`). It is also the NFT recipient and the treasury of the current deployment. Fund it from https://faucet.monad.xyz (captcha, so it can't be scripted); a full `DeployTestnet` run needs about 1.2 MON.

```sh
PW=~/.foundry/keystores/.launcher-deployer.pass
forge script script/DeployTestnet.s.sol --rpc-url https://testnet-rpc.monad.xyz --account launcher-deployer --password-file $PW --broadcast
cast send <FloorVault> "launch((string,string,string,uint16,bytes32,uint256,address,address,uint256))(address)" "(<name>,<symbol>,<tokenURI>,<bps>,<salt>,<deadline>,<collection>,<recipient>,<devBuy>)" --value 12ether --account launcher-deployer --password-file $PW --rpc-url https://testnet-rpc.monad.xyz
# <tokenURI> and <salt> must come from nad.fun's API (POST /metadata/image, /metadata/metadata, /token/salt with creator=<FloorVault>) or the coin will not be indexed by it.
```

The keystore password lives only in `~/.foundry/keystores/.launcher-deployer.pass` (mode 600, outside this repo), so forge runs without prompting. Foundry has no env var for it; pass `--password-file` each time. Never copy the password into the repo, a command line (`--password`), or a doc. This is a throwaway testnet wallet: never put real funds in it. `chog-deployer` and `deployer` also exist in the keystore folder but belong to other work, so leave them alone.
