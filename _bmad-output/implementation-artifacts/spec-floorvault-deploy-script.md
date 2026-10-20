---
title: 'FloorVault deploy script'
type: 'feature'
created: '2026-10-12'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `contracts/script/DeployTestnet.s.sol` deploys TestChog and MockMarketplace but not FloorVault, so the demo stack cannot be stood up on Monad testnet with one command.

**Approach:** Extend `DeployTestnet` to also deploy FloorVault wired to the nad.fun V2 testnet addresses (router, creator fee vault, WMON from the addendum) and the freshly deployed MockMarketplace. Treasury comes from the optional `TREASURY` env var and defaults to the broadcaster. Log all deployed addresses.

</frozen-after-approval>

## Implementation Notes

- Changed only `contracts/script/DeployTestnet.s.sol`: added FloorVault deploy (nad.fun V2 testnet router, creator fee vault, WMON as constants), a `TREASURY` env override defaulting to the broadcaster, and a chain-id guard (10143).
- Surprise: the old script minted to `msg.sender`, which in `run()` is Foundry's default sender and not the `--private-key` wallet. The earlier dry-run showed the mints going to `0x…dEaD`. Switched to the broadcaster from `vm.readCallers()` for mints and the treasury default.
- Verified: in-memory simulation (before the chain guard) and a testnet-fork simulation both pass; any other chain reverts with the guard message. Nothing was broadcast.
- Not run: `forge test` (fork tests unchanged, FloorVault untouched).

## Review Triage Log

- Chain / empty-address guard: medium, real. Patched with a `block.chainid == 10143` require.
- `readCallers()` fragile: false. Simulation resolved the treasury to the key's own address and all 5 listings succeeded.
- Treasury validation: low, rejected. The fallback is logged, and an unparsable `TREASURY` reverts in `envOr`.
- `--private-key` in the usage comment: low, rejected. Pre-existing comment, testnet only.
- Post-deploy asserts and magic numbers: low, rejected. The simulation exercises the path, and the loop was pre-existing.
- Deployments JSON, `--verify`, first-launch docs: deferred to `deferred-work.md`.
