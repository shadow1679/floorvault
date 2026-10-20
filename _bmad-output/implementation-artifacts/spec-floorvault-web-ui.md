---
title: 'floorvault web UI'
type: 'feature'
created: '2026-10-12'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'NO_VCS'
context:
  - '{project-root}/_bmad-output/planning-artifacts/briefs/brief-launcher-2026-10-12/brief.md'
  - '{project-root}/_bmad-output/planning-artifacts/briefs/brief-launcher-2026-10-12/addendum.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FloorVault (coins whose creator fees buy NFTs) has contracts but no frontend, so a judge cannot launch a coin, watch fees flow, or see the vault buy an NFT.

**Approach:** Build a Next.js app in `web/`, inspired by usenosh.app's information architecture (Explore, Gallery, Claims, Launch, Docs) but with its own dark, Monad-purple, playful identity and "floorvault" wordmark. Reads come live from Monad testnet via viem; coins are discovered by scanning `Launched` events in 100-block chunks.

## Boundaries & Constraints

**Always:** Monad testnet (10143) only. Wallet connect + writes via wagmi/viem. Contract addresses from `NEXT_PUBLIC_*` env (FloorVault, MockMarketplace, TestChog, deploy block); show a clear "not configured" state if missing. Amounts as MON/WMON, never raw wei. `harvest`/`buy` are permissionless, so Claims lets anyone call them. Every page works at phone width and passes basic a11y (labels, focus, contrast).

**Never:** Copy nosh's layout, copy, or branding verbatim. No Giveaways, Analytics, or Suggest pages (defer to `deferred-work.md`). Do not modify `contracts/`. No custom indexer service or database. No mainnet or Seaport code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Launch | Name, symbol, image URL, fee tier (1/3/5%), collection, NFT recipient, create fee | `FloorVault.launch` tx; redirect to the new coin page | Wrong chain: prompt switch. Revert: show reason. Bad address: inline error |
| Explore | Launched events exist | Grid of coins: name, paired collection, budget, NFTs bought | None found: empty state with Launch CTA |
| Harvest | Coin page, any wallet | `harvest(token)` shows 80/20 split result | Revert when no fees: "No fees to claim yet" |
| Buy | Budget >= floor | `buy(token)`; NFT appears in Gallery | Floor above budget: button disabled with gap shown |
| Gallery | `Bought` events | Tiles of bought NFTs with coin, price, recipient | None: empty state |
| No wallet | Not connected | Read pages work; write buttons say "Connect wallet" | N/A |

</frozen-after-approval>

## Code Map

- `contracts/src/FloorVault.sol` -- ABI source: `launch(LaunchArgs)` payable, `harvest`, `buy`, `pairings(token)`; events `Launched`, `Harvested`, `Bought`. Treasury share 20%.
- `contracts/src/MockMarketplace.sol` -- `floor(collection)` for the floor price; `Listed`/`Bought` events.
- `contracts/src/TestChog.sol` -- demo collection (`name`, `totalSupply`, `ownerOf`, no tokenURI).
- `contracts/out/` -- compiled ABIs to copy into `web/src/abi/`.
- `contracts/script/DeployTestnet.s.sol` -- deploy logs addresses only; user copies to `.env.local`.
- `web/` -- new; none exists. Node 26, npm 11 available; no pnpm.

## Tasks & Acceptance

**Execution:**
- [x] `web/` -- scaffold Next.js (App Router, TypeScript, Tailwind), wagmi + viem + TanStack Query, Monad testnet chain config, `.env.example` -- foundation
- [x] `web/src/abi/*.ts` -- FloorVault, MockMarketplace, TestChog ABIs from `contracts/out` -- typed contract access
- [x] `web/src/lib/chain.ts` -- chunked (100-block) `getLogs` scan from deploy block with cache; coin, bought-NFT, and budget reads -- data layer
- [x] `web/src/app/layout.tsx` + components -- header (wordmark, nav, connect), footer, theme tokens, shared cards -- shell
- [x] `web/src/app/page.tsx` -- landing: hero, how-it-works (launch, fees, 80/20, buy), featured CHOG -- entry
- [x] `web/src/app/explore`, `coin/[token]` -- coin grid; detail with stats, Harvest, Buy -- core flow
- [x] `web/src/app/launch` -- form with validation, tx states -- launching
- [x] `web/src/app/gallery`, `claims` -- bought NFTs; coins with harvest/buy actions -- remaining core pages
- [x] `web/src/app/docs` -- static explainer of fee flow, split, contracts, risks -- docs
- [x] `web/src/lib/*.test.ts` -- unit tests for formatting, validation, log chunking -- I/O matrix edge cases

**Acceptance Criteria:**
- Given env is set, when I open Explore, then coins from `Launched` events render without errors.
- Given a coin with budget >= floor, when I click Buy, then the tx confirms and Gallery shows the NFT.
- Given a 375px viewport, when I visit any page, then no horizontal scroll appears.
- Given env is missing, when any page loads, then a configuration notice shows and nothing crashes.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter, edge-case-hunter, verification-gap). Routes: patch unless noted.

- medium, patch: harvest revert mapping is too broad (`errors.ts` matches any "revert", incl. the app's own "Harvest transaction reverted."). Verified in `errors.ts`.
- medium, patch: `getCoinMeta` caches "Unnamed coin"/image-less fallbacks permanently. Verified `chain.ts:266-278`.
- medium, patch: `getFloor` catches every error as "no listings", so `floor.isError` is unreachable. Verified `chain.ts:391`.
- medium, patch: Explore/Claims/Gallery replace present data with an error card when a refetch fails (`isError || !data`). Verified `ExploreView.tsx:20`.
- medium, patch: mixed-case bad-checksum addresses pass `validateAddress` but viem rejects them; reviewer confirmed with viem.
- medium, patch: launch form says "Collection found: Unknown collection" for non-NFT addresses; launch is irreversible. Verified `chain.ts:399-406`.
- low, patch: `art.tsx` uses `>>` after `>>> 0`, giving negative modulo and an undefined mouth for some seeds. Verified `art.tsx:30-31`.
- low, patch: `validateImageUrl` accepts `ipfs:bafy`/`ipfs://` that `safeImageUrl` rejects; the bad link is stored in the immutable tokenURI. Verified.
- low, patch: deploy block rejects hex though `.env.example` says hex. Verified `config.ts:37`.
- low, patch: FeaturedChog "Minted" shows "…" forever when supply is null. Verified `FeaturedChog.tsx:35`.
- medium, patch: `useTxRunner` awaits vault-scan invalidation before returning, and `coin-direct` is never invalidated; launch redirect waits on the refetch. Verified `tx.ts:58-70`.
- low, patch: `publicClient` lacks `batch.multicall`; per-card reads are N+1 on a rate-limited RPC (cheap one-line fix).
- low, patch: reduced-motion rule leaves `infinite` iteration at 0.01ms (strobe).
- low, patch: two `<nav aria-label="Main">`; mobile menu has no Escape close.
- medium, patch: verification gaps. No tests for `scanVault`, `getVaultData`, `getCoinMeta`, launch-arg construction (fee-tier to bps), and `rpcUrl` override; matrix rows Explore/Gallery/Buy/Launch lack covering tests.
- medium, defer: first scan cost grows with chain age and UI waits on the whole scan. Fix needs an indexer or progressive rendering.
- low, defer: only `data:` tokenURI metadata resolves; `ipfs://`/`https://` JSON is not fetched, so third-party NFTs show generated art.
- low, defer: injected-wallet only; mobile browsers without an extension hit a dead end (WalletConnect needs a project id).
- maybe-false, defer (unverified, would be medium): Header at 375px with wallet connected on the wrong chain may push the menu button off-screen (reviewer's claim; implementer measured only other states).
- low, rejected: no per-wave persistence in `scanVault`; cache-shape validation; `scannedTo > head` after a testnet reset; failed `pairings` multicall shown as budget 0; receipt-wait timeout; client clock skew on deadline; `getCoinDirect` zero stats on a brand-new coin. Unlikely in the demo and fixes add guards/surface.
- low, rejected: 80/20 hard-coded in copy and bars (matches the contract constant); `next-env.d.ts` vs `.gitignore` (no VCS here); no ABI regen script, lockfile, `engines`; unused helpers; amount truncation; `error.tsx`/`not-found.tsx`/OG metadata/CSP; `role="switch"` double announcement; heading levels; "connect" error wording; off-chain image IP leak.
- false, rejected: `overflow-x: clip` masks overflow. The implementer measured element widths at 375px in iframes, not just visual clipping.
- false, rejected: harvest on zero fees does not revert. The contract itself doesn't, but the nad.fun vault's `claim` reverts on zero balance (addendum, verified from bytecode), so the revert path exists.

## Design Notes

Identity: near-black background, Monad purple accent (~#836EF9), chunky rounded display type, large NFT-forward cards, playful microcopy. Nosh informs only the page set and the launch, claim, and gallery flows. Coin metadata (`tokenURI`) is a JSON data URI built client-side, so no upload service is needed.

## Verification

**Commands:**
- `cd web && npm run build` -- expected: succeeds
- `cd web && npm run lint && npm test` -- expected: clean, tests pass

**Manual checks (if no CLI):**
- Run `npm run dev`, open each page at desktop and 375px, and confirm the not-configured state without env.
