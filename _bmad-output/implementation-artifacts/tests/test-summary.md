# Test Automation Summary

Project: launcher (FloorVault web app, `web/`). Scope chosen: API tests and browser E2E.

## Generated Tests

### API tests (Vitest, `web/src/lib/`)
- [x] `nadfun.api.test.ts` (18 tests) - nad.fun REST client: request shape for each launch step (content type, body, base URL), description only when given, salt request uses the metadata URI just returned, stop-on-failure ordering, network failure -> status 0, plain-text/empty/oversized error bodies, rate limit, chart window maths (clamped start, count-back, price chart), empty/partial chart data, only 404 means "unknown coin", storage-host allow-list, metadata trimming and 500-char cap.
- [x] `constants.test.ts` (3 tests) - `NADFUN_API_URL`: default, whitespace-only, override with trailing slashes trimmed.

### E2E tests (Playwright, `web/e2e/`)
- [x] `home.spec.ts` (9) - pitch and four steps, hero buttons, CHOG card and pre-filled launch link, header nav with `aria-current`, wordmark and skip link, footer links.
- [x] `explore.spec.ts` (5) - empty state, coin card (symbol, collection, budget, buys), card -> coin page, plural count and newest first, RPC down -> error -> retry recovers.
- [x] `gallery.spec.ts` (4) - empty state, bought NFT tile (price, coin, generated-art fallback), newest first, tile -> coin page.
- [x] `docs.spec.ts` (3) - five sections, on-page menu jump, contract list with explorer links.
- [x] `launch.spec.ts` (19) - form defaults, live preview, collection warning, "Use Test CHOG"; wallet connect, closing the dialog, no-wallet hint, wrong-network switch; validation (empty form, live clearing, name/symbol/address/fee, image type and size, "Use my wallet"); full launch flow (nad.fun uploads in order, one transaction to FloorVault with the 10 MON fee, decoded calldata, redirect to the new coin); typed collection/recipient/fee are what gets sent; NSFW image; nad.fun 429; wallet rejection; failed pre-flight simulation sends nothing.
- [x] `unconfigured.spec.ts` (6) - blank env: notice lists all five missing variables on Explore, Gallery and Launch, no RPC calls made, launch form hidden, Home and Docs still render.
- [x] `mobile.spec.ts` (8) - menu button, link closes menu, Escape returns focus, no sideways scroll on five pages (Pixel 7).

Support code in `web/e2e/support/`: `env.ts` (fake addresses and URLs), `rpc.ts` (fake Monad JSON-RPC: logs, multicall, pairings, receipts), `wallet.ts` (EIP-6963 stand-in wallet that records sent transactions), `test.ts` (blocks every non-localhost request, fails a test on uncaught page errors).

## Results

| Suite | Command | Result |
|---|---|---|
| Vitest (whole project) | `npm test` | 196 passed, 1 skipped (live seed-scan, needs network) |
| Playwright | `npm run test:e2e` | 54 passed, ~15 s, two consecutive runs with no flakes |
| Typecheck / lint | `npm run typecheck`, `npx eslint e2e` | clean |

## Coverage

- Routes with E2E: 5 of 6 (`/`, `/explore`, `/gallery`, `/launch`, `/docs`). `/coin/[token]` is only reached by navigation, not exercised.
- nad.fun client (`nadfun.ts`) functions with tests: 5 of 5 (all of them now have request-shape and error-path coverage).
- Not covered (known gaps): coin detail page (`CoinDetail`, `CoinActions`, `TradeCard`, `PriceChart`, `RafflePanel`, `NextNftCard`, `GiveawayHistory`); the harvest, buy, trade and raffle transaction hooks in `tx.ts` (only the launch hook runs, through the E2E launch flow); `hooks.ts`; the keeper script (`scripts/keeper.mjs`); Solidity contracts (Foundry tests already exist and were not touched).

## How it works

- The browser never reaches a real network. `rpc.ts` answers the app's RPC calls from a fixture the test can edit, and the wallet and nad.fun API are stand-ins.
- Two dev servers start on ports 3100 (fake contract addresses) and 3101 (blank addresses), each with its own build folder (`.next-e2e-*`).
- A dev server that is already running on :3000 is not used or stopped.

## Changes to existing files

- `web/package.json`: added `@playwright/test` (dev dependency) and a `test:e2e` script.
- `web/next.config.ts`: `distDir` reads `NEXT_DIST_DIR` (default `.next`, so normal dev and build are unchanged). Next locks one dev server per build folder, so the two test servers need their own.
- `web/tsconfig.json`: four `include` globs for those build folders (Next adds them itself otherwise, and reformats the file).
- `web/.gitignore`: Playwright output and `.next-e2e-*`.

## Next Steps

- Run `npm run test:e2e` in CI (first run compiles pages and takes longer; Chromium must be installed with `npx playwright install chromium`).
- Add a coin-page spec: needs fake bonding-curve and marketplace reads (`getCurveInfo`, `getFloor`) in `rpc.ts`, then harvest, buy and trade flows can reuse the wallet stand-in.
- Add React hook tests (jsdom + Testing Library) if `tx.ts` state transitions need finer coverage than the E2E flow gives.
