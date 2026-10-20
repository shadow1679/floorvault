# Addendum: Technical Research (for PRD and Architecture)

Gathered 2026-10-12. Facts marked **verified** were read from official docs or on-chain; the rest are unconfirmed.

## nad.fun V2

- Build against V2; V1 is legacy and its sources conflict with V2.
- `NadFunRouter.create(CreateParams)` params: `name`, `symbol`, `tokenURI`, `quoteToken` (WMON or LVMON), `creatorFeeRate` (bps), `vaults[]` of `{vault, bps, setupData}`, `salt`, `dexType` (0), `buyQuoteAmount`, `deadline`. There is also `createWithNative`. Router needs approval for `deployFee + buyQuoteAmount`. **Verified.**
- Vault rules: 1 to 5 vaults, bps total 10000, no duplicates, each vault active in the registry. **Verified.**
- Creator fee rate: mainnet `[100]`, testnet `[100, 300, 500]`; immutable after setup. **Verified.**
- Fees: 10 MON create fee, 2% curve trade fee (1% protocol, 1% creator-configurable), 1,000 MON graduation fee, post-graduation CPMM 1.60% (1% customizable, 0.35% protocol, 0.25% LP). Per nad.fun's fees page.
- Official docs say nad.fun supports tokens launched through its frontend or official API; direct router launches may not be indexed. **Unconfirmed.**

### Addresses

| Item | Testnet (10143) | Mainnet (143) |
|---|---|---|
| Router | `0x75588668999cA0557b78046b8a5E86b47b9234ec` | `0x8986C8fD44eb85294A725a7e61AF35E76bA26F91` |
| Creator Fee vault | `0xfEB12B7698e296C57BBF9f0c9b38B3e908285A99` | `0x687f9172D5F4798694811333C5C5696afCF4F6f4` |
| WMON | `0x5a4E0bFDeF88C9032CB4d24338C5EB3d3870BfDd` | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` |
| LVMON | `0xBe3fa50514D9617ce645a02B34F595541AF02b6b` | `0x91b81bfbe3A747230F0529Aa28d8b2Bc898E6D56` |
| BondingCurve | `0x27063a38eC0D3281D354090EB92e669Ed1eB956C` | `0x9f3832732923252A21044F21eE6bd87F09514ae4` |

Sources: github.com/Naddotfun/nadfun-v2-intergration (ROUTER_INTEGRATION.md, BONDING_CURVE_INTEGRATION.md), nad-fun.gitbook.io.

### Creator Fee vault (testnet, bytecode analysis)

- UUPS proxy; implementation `0xd9cde52e1aede312451b160f850400aa324132de`, source not verified on explorers.
- Functions seen: `claim(address token)`, `getCreator(address)`, `setCreator(address,address)`, `getBalance(address)`, `getQuoteToken(address)`, `setup(address,bytes)`, `afterDeposit(address,address,uint256)`.
- `claim(token)` reverts `NotAuthorized` unless `msg.sender` equals the stored creator for that token; reverts if the balance is zero; pays out in the quote token. **Verified from bytecode.**
- No `ORIGIN` opcode, so a contract can be the recipient. **Verified from bytecode.**
- Not yet confirmed: who may call `setup`, and the exact payout destination.

## Seaport and OpenSea on Monad

- Seaport 1.6 at `0x0000000000000068F116a894984e2DB1123eB395` has verified source on Monad mainnet. ConduitController at `0x00000000F9490004C11Cef243f5400493c00Ad63`. The Seaport README table omits Monad and is stale. **Verified.**
- OpenSea is live on Monad mainnet; its API v2 covers listings, offers and fulfillment data. **Verified.**
- Magic Eden appears to have dropped Monad EVM NFTs (single third-party source). **Unconfirmed.**
- Not checked: OpenSea's conduit and signed zone on Monad, the API chain slug (probably `monad`), and NFT liquidity or volume.
- **Testnet: canonical Seaport 1.6 and ConduitController have no code on Monad testnet (10143)**, checked with `cast code` on 2026-10-12. Seaport is on mainnet only. OpenSea's testnet support was not researched. The demo targets testnet, so the NFT-buying path needs a workaround: deploy Seaport and a ConduitController ourselves, use a mock marketplace, or demo that step on mainnet with small amounts.

## Monad

- Mainnet chain ID 143 (launched 2025-11-24); testnet 10143, RPC `https://testnet-rpc.monad.xyz`, faucet `https://faucet.monad.xyz`.
- 300 ms blocks, finality in 2 blocks, gas charged on gas limit rather than gas used, no blob transactions, 128 KB max contract size.
- Foundry v1.8.0 or later. Testnet RPC limits `eth_getLogs` to 100 blocks.
