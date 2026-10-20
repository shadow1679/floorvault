# FloorVault contracts (Monad testnet 10143, mainnet 143)

## Deploy

`DeployTestnet` deploys TestChog, MockMarketplace, Raffle, then FloorVault (wired to the nad.fun V2 testnet
router, creator fee vault, WMON and the Raffle), then calls `Raffle.init(vault)`. The raffle draw delay and
settle window default to 5 and 2 minutes; override with `RAFFLE_DRAW_DELAY` / `RAFFLE_SETTLE_WINDOW` (seconds), then mints and lists 5 TestChog NFTs at 0.1 to 0.5 MON.
Treasury and keeper are `$TREASURY` / `$KEEPER` if set, otherwise the deployer (only the keeper may call `FloorVault.buy`). Get testnet MON at https://faucet.monad.xyz.

```shell
forge script script/DeployTestnet.s.sol --rpc-url https://testnet-rpc.monad.xyz \
  --account <keystore> --broadcast        # keystores live in ~/.foundry/keystores

# Export the result for the frontend (reads the broadcast receipts, so the deploy block is exact):
node script/export-deployments.mjs --env     # writes deployments/10143.json and ../web/.env.local
```

`--env` refuses to overwrite an existing `web/.env.local` unless you add `--force`. Restart
`npm run dev` after it changes, since `NEXT_PUBLIC_*` values are inlined at build time.
The record of the current deployment is `deployments/10143.json`.

## Mainnet (chain 143, Chog Genesis only)

`DeployMainnet` deploys `SeaportAdapter`, `Raffle` and `FloorVault`, wired to the live nad.fun V2 contracts and
Seaport 1.6, with `FloorVault` limited to Chog Genesis (`0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763`, ERC-721 with
5% ERC-2981 royalties, 1,969 supply). `TREASURY` and `KEEPER` are required: use a multisig or hardware wallet for the
treasury, and never the throwaway `launcher-deployer` keystore for real funds. Raffle timings default to a 1 day draw
delay and 6 hour settle window. It costs about 1.9 MON of gas.

```shell
# Dry run (simulates against the live chain, sends nothing):
TREASURY=0x.. KEEPER=0x.. forge script script/DeployMainnet.s.sol --rpc-url https://rpc.monad.xyz --sender <deployer>
# Real deploy: add --account <keystore> --broadcast, then
node script/export-deployments.mjs --mainnet --env   # deployments/143.json + ../web/.env.mainnet.local
```

The mainnet env goes to `web/.env.mainnet.local` so it never overwrites the testnet `.env.local`; copy it over
when switching. Add `OPENSEA_API_KEY`, `KEEPER_ACCOUNT` and `KEEPER_PASSWORD_FILE` by hand.

How buying works: Seaport has no on-chain floor, so the keeper picks the cheapest affordable listing off-chain
(OpenSea API), asks `fulfillment_data` for the order with the **SeaportAdapter as fulfiller**, and calls
`FloorVault.buy(token, maxPrice, abi.encode(AdvancedOrder))`. `buy` is keeper-only (the treasury can rotate the
keeper with `setKeeper`); otherwise anyone could list a CHOG NFT at exactly the budget and drain it. The budget is
charged what the marketplace actually kept, and unspent MON is wrapped back to WMON. Mainnet creator fees are only
100 bps, and mainnet's Creator Fee vault pays **native MON**, which `harvest` wraps (testnet pays WMON).

Fork tests (need network): `forge test --network monad --match-contract "SeaportAdapterForkTest|FloorVaultMainnetForkTest"`.

## First launch

`FloorVault.launch` creates the coin on nad.fun with FloorVault as the creator-fee recipient and
records the pairing. The web Launch page does this for you; with `cast`:

```shell
V=$(jq -r .floorVault deployments/10143.json)
CHOG=$(jq -r .testChog deployments/10143.json)
URI="data:application/json;base64,$(printf '{"name":"Demo Coin","symbol":"DEMO"}' | base64)"

cast send $V "launch((string,string,string,uint16,bytes32,uint256,address,address,uint256))" \
  "(\"Demo Coin\",\"DEMO\",\"$URI\",100,$(cast keccak my-unique-salt),$(( $(date +%s) + 3600 )),$CHOG,$NFT_RECIPIENT,0)" \
  --value 10ether --rpc-url https://testnet-rpc.monad.xyz --account <keystore>
```

| Field | Meaning |
|-------|---------|
| `name`, `symbol`, `tokenURI` | Coin metadata. `tokenURI` may be a `data:` JSON URI (what the web app builds) or a URL. |
| `creatorFeeRate` | Creator fee in bps. Testnet allows only `100`, `300` or `500`. |
| `salt` | 32 bytes, a CREATE2 salt on the live chain. Reusing one that already launched reverts with `FailedDeployment()`; never reuse the fork test's salt. |
| `deadline` | Unix seconds after which nad.fun rejects the launch. |
| `collection` | NFT collection the fees buy from. Use `testChog` for the demo. |
| `nftRecipient` | Fallback owner: every NFT the vault buys is raffled to the coin's holders, and goes here only if a round has no valid holder. |
| `devBuy` | MON the creator spends buying the new coin in the same transaction (0 = none). The coins are forwarded to the caller. |
| `msg.value` | nad.fun create fee (currently 10 MON) plus `devBuy`. Any excess is refunded. |

Harvest caveat: nad.fun only pays creator fees to the vault after its keeper calls `settle`, once ~100 MON of fees
have accumulated. A live `harvest` therefore cannot be demoed on testnet; `FloorVaultForkTest` is the proof of that path.

Use `cast call` instead of `cast send` (same arguments, add `--from <address>`) to simulate without sending.

## Verifying source (not yet run)

Untested here: Monad's documented Sourcify route is below. Run it per contract after deploying.

```shell
forge verify-contract <address> src/FloorVault.sol:FloorVault --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockscout.com/
```

FloorVault also needs `--constructor-args $(cast abi-encode "constructor(address,address,address,address,address,address,address,address)" <router> <creatorFeeVault> <wmon> <marketplace> <raffle> <treasury> <keeper> <allowedCollection>)` (`allowedCollection` is `0x0` on testnet).

---

## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
