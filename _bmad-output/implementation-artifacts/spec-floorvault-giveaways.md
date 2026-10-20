---
title: 'floorvault giveaways'
type: 'feature'
created: '2026-10-12'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: 'NO_VCS'
context:
  - '{project-root}/_bmad-output/planning-artifacts/briefs/brief-launcher-2026-10-12/brief.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-floorvault-web-ui.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The brief lists a Nosh-style raffle as a parity feature, and nothing exists for it. A coin's holders never get anything from the NFTs the vault buys.

**Approach:** Each NFT the vault buys for a coin is raffled to that coin's holders, with odds proportional to coin balance. The drawn winner has 7 days to claim the NFT in the UI. If they do not, anyone can re-raffle. It lives only on that coin's detail page. There is no app-wide giveaways page, nav link, or listing.

## Boundaries & Constraints

**Always:** Monad testnet (10143) only. `FloorVault.buy` sends the bought NFT to a `Raffle` contract and opens the raffle in the same transaction; this redeploys `FloorVault` and the existing demo coins are dropped. One raffle per bought NFT, scoped to its paired coin. Nothing to enter: holding the coin is enough. No creator action. A round is: draw delay, then a draw that fixes a seed, then a short settle window where anyone submits holders and the best weighted score becomes the winner, then a 7-day claim window. Only the winner can claim, from the coin page. After the claim window anyone can re-raffle: a new round with a new seed, and past winners of that raffle cannot win again. A round with no valid holder sends the NFT to the coin's recorded `nftRecipient`. Randomness is on-chain pseudo-randomness (`prevrandao`), a known demo-grade weakness the UI states. Delay and settle window are constructor parameters so demos can use short ones; the claim window is fixed at 7 days. Event scans chunked to 100 blocks. Addresses from `NEXT_PUBLIC_*` env with the existing "not configured" state. Phone width and basic a11y.

**Never:** An app-wide Giveaways page, nav entry, or cross-coin raffle. An indexer, database, or off-chain keeper. Mainnet code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open | Vault buys an NFT for a coin | Raffle opens, round 1 draw time set | N/A |
| Draw early | Before the draw time | Countdown shown | Revert "too early" |
| Draw | After draw time, anyone calls | Seed fixed, settle window opens | Revert if already drawn this round |
| Settle | Holder with balance > 0, not a past winner, submitted in window | Best score so far is the leading winner | Revert for zero balance, excluded address, or closed window |
| Finalize | Settle window closed | Winner recorded, 7-day claim window starts | Revert while window open |
| Claim | Winner calls within 7 days | NFT transfers to the winner | Revert for anyone else or after expiry |
| Re-raffle | Claim window expired, anyone calls | New round with a fresh draw time; previous winner excluded | Revert before expiry or after a claim |
| No holders | No valid holder at finalize | NFT goes to `nftRecipient` | N/A |

</frozen-after-approval>

## Code Map

- `contracts/src/FloorVault.sol` -- `buy` ends with `market.buyFloor(..., p.nftRecipient)` and emits `Bought`; `pairings(token)` holds collection and recipient. Change it to send the NFT to the raffle and open it.
- `contracts/src/MockMarketplace.sol` -- `buyFloor` moves the NFT with plain `transferFrom`, so no receiver hook fires. Hence the explicit `open` call.
- `contracts/src/TestChog.sol` -- ERC-721 with `ownerOf`/`transferFrom`, the prize type.
- `contracts/test/MockMarketplace.t.sol` -- offline unit test pattern. New tests must pass under `forge test --no-match-contract FloorVaultForkTest`.
- `contracts/script/DeployTestnet.s.sol`, `export-deployments.mjs` -- add the new contract and its env var.
- `web/src/lib/chain.ts`, `scan.ts` -- chunked scan with cache; add raffle events. Coin holders come from the coin's ERC-20 `Transfer` logs scanned the same way.
- `web/src/components/CoinDetail.tsx`, `CoinActions.tsx`, `app/coin/[token]` -- where the raffle panel goes.
- `web/src/abi/*.ts` -- add `Raffle.ts`; regenerate `FloorVault.ts`.
- `web/src/lib/config.ts` -- keep `NEXT_PUBLIC_*` access static in `readEnv()`.
- `web/AGENTS.md` -- read the Next.js guide in `web/node_modules/next/dist/docs/` before writing Next code.

## Tasks & Acceptance

**Execution:**
- [x] `contracts/src/Raffle.sol` -- new: `init(vault)` once; vault-only `open(token, collection, tokenId, fallbackTo)` that checks it owns the NFT; `draw`, `settle`, `finalize`, `claim`, `reRaffle`; per-raffle round, seed, leader, winner, deadline and excluded winners; events per step -- raffle core
- [x] `contracts/src/FloorVault.sol` -- add immutable `raffle`; `buy` sends the NFT to it and calls `open` -- automatic opening
- [x] `contracts/test/Raffle.t.sol` -- offline tests for every matrix row with `vm.warp`, a mock ERC-20 coin and `MockMarketplace` -- coverage
- [x] `contracts/test/FloorVault.fork.t.sol` -- adjust constructor and the buy assertion (NFT now owned by the raffle); keep the fee-path proof
- [x] `contracts/script/DeployTestnet.s.sol`, `export-deployments.mjs` -- deploy Raffle, then FloorVault, then `init`; export `NEXT_PUBLIC_RAFFLE`
- [x] `web/src/abi/Raffle.ts`, `FloorVault.ts` -- regenerate from `contracts/out`
- [x] `web/src/lib/chain.ts`, `scan.ts`, `config.ts` -- scan raffle events, derive holders from coin `Transfer` logs, add the env var
- [x] `web/src/components/RafflePanel.tsx`, `CoinDetail.tsx` -- per-coin panel with the NFT, current round stage, draw, submit best holder, winner, a Claim button for the winner with a 7-day countdown, and a re-raffle button after expiry; no nav entry or new page
- [x] `web/src/lib/*.test.ts` -- holder derivation and score ordering

**Acceptance Criteria:**
- Given a coin with budget at or above the floor, when anyone calls `buy`, then the raffle owns the NFT and a raffle for that coin and token id is open.
- Given a finalized winner, when the winner claims within 7 days, then they own the NFT and no re-raffle is possible.
- Given a winner who did not claim in 7 days, when anyone re-raffles, then a new round starts and the old winner cannot win it.
- Given a round with no valid holder, when it finalizes, then the NFT goes to `nftRecipient`.
- Given the app, then no page, nav link, or listing exists outside the coin page.

## Design Notes

The chain cannot list a coin's holders, so the browser builds the list from `Transfer` logs. After the draw, anyone submits a candidate and the contract checks the candidate's current balance. The best score, `hash(seed, holder) / balance`, leads until the settle window closes. This approximates balance-weighted odds, not exactly, and the UI says so. Exclude the coin contract, the bonding curve, the vault and the raffle. The holder scan is the slow part and reuses the existing cache.

## Implementation Notes

## Verification

**Commands:**
- `cd contracts && forge test --no-match-contract FloorVaultForkTest` -- expected: all pass
- `cd contracts && forge test --network monad --match-contract FloorVaultForkTest -vv` -- expected: pass
- `cd web && npm run typecheck && npm run lint && npm test` -- expected: clean

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `finalize` falls back when nobody submitted, even if holders exist (blind, edge x2) | high | intent_gap | `Raffle.finalize` falls back on `leader == 0`. Spec says "no valid holder", but the contract cannot tell the two apart. With a manual 2-minute settle window, a silent round sends the NFT to `nftRecipient`, which breaks the "automatic" goal. The fix needs a policy choice. |
| 2 | Raffle stuck forever if nobody calls `draw` or `finalize`; delivery now depends on third parties (edge x2) | high | intent_gap | No timeout or sweep path exists in `Raffle.sol`. Grouped with #1. |
| 3 | 2-minute settle window shorter than the UI flow (full Transfer scan, then a wallet tx) (blind) | medium | intent_gap | `scanHolders` walks 100-block chunks from launch; the seed is only known once Settling. Grouped with #1. |
| 4 | Winner can dump coins after submitting; balance not re-checked at `finalize` (edge) | medium | intent_gap | Balance read only in `settle`. Fix changes the empty-round behavior, so grouped with #1. |
| 5 | Balance reuse across addresses, flash-buying, public seed, no snapshot (blind, edge x2) | medium | patch (disclose) | Real, but the nad.fun coin has no snapshot, and the frozen block accepts demo-grade fairness. Smallest fix: state this in the UI note and README. Structural fix not attempted. |
| 6 | DEX pair after graduation not blocked; can lead, never claim, repeating 7-day stalls (blind, edge) | medium | bad_spec | Design Notes list only curve, vault, raffle. Needs a deployer-managed `block(address)`; adds public surface. |
| 7 | No `onERC721Received`; a `safeTransferFrom` market would revert `buy` (blind, edge, gap) | low | rejected | `MockMarketplace` uses `transferFrom`; spec excludes Seaport code; fix adds public surface. |
| 8 | `open` does not prove the NFT arrived this transaction (blind) | false | rejected | Only `FloorVault` can call `open`, and `buy` transfers immediately before. |
| 9 | `LaunchForm` still says bought NFTs are "sent here, every time" (blind) | medium | patch | Text is now false; recipient is only the fallback. |
| 10 | Gallery always says "raffled to holders"; `Bought.to` is now always the raffle (blind, gap, edge) | medium | patch | Smallest fix: neutral copy plus a link to the coin page. |
| 11 | `BuyResult.to` / `BoughtRec.to` carry no information (blind) | low | rejected | Unused field, no user harm. |
| 12 | `scanVault` `address`/`events` filter unasserted; test fake ignores them (gap) | medium | patch | Dropping `cfg.raffle` keeps tests green and empties every coin's raffle list. |
| 13 | Deploy wiring (`raffle.init`) untested; exporter index untested (gap) | medium | patch | Deleting `init` keeps 40 tests green; `buy` then reverts "only vault". Add an assertion to the script. Exporter test deferred. |
| 14 | `candidate()` past-winner and stage branches unpinned; also true after `settleEnd` (gap, edge) | medium | patch | Mutations left all 40 tests passing. One-line view fix plus tests. |
| 15 | TS vs Solidity `scoreOf` parity pinned on the TS side only (gap) | medium | patch | Changing `abi.encode` to `encodePacked` keeps all tests green. |
| 16 | `settleWindow_ > 0` guard unpinned; weak "worse score" test; tie, nonexistent-id and `open`-revert tests missing (gap, blind) | low | patch | Direct test additions. |
| 17 | `findBestCandidate` returns none on all-failed multicalls; caps at 120 candidates (blind, edge) | medium | patch | Throw on all-failed reads. The 120 cap is low and rejected. |
| 18 | `NEXT_PUBLIC_RAFFLE_ADDRESS` required with no migration note; README splice, Sourcify args and env vars missing (blind) | low | patch | Docs-only corrections. |
| 19 | `CLAUDE.md` still describes the old flow and constructor (blind) | low | defer | Fix edits an agent-context file; also edited by the implementer outside the spec. |
| 20 | `DeployTestnet` truncates oversize `uint64` env values (blind, edge) | low | patch | Add a range `require`. |
| 21 | `errors.ts`: misplaced JSDoc, prototype-key lookup, test title overclaims, `buy` reasons unmapped (blind, edge) | low | patch | Direct corrections. |
| 22 | `RafflePanel`: lowercase zero-address compare; skeleton forever on a failed read (blind, edge) | low | patch | Use `zeroAddress`; show an error state. |
| 23 | `ContractList` omits Raffle (gap) | low | patch | Add one row. |
| 24 | Per-card 1s timers, 8s polling for finished raffles, no `aria-live`, holders cache never pruned, scan has no reorg overlap (blind, edge) | low | rejected | No user-visible harm shown; fixes add complexity. |
