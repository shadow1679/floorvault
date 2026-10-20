- source_spec: `/Users/mac/launcher/_bmad-output/implementation-artifacts/spec-floorvault-deploy-script.md`
  summary: Make deploys easier to consume: write deployed addresses to a deployments JSON for the frontend, document `--verify`, and document the first `FloorVault.launch` call (salt, create fee in msg.value, collection, nftRecipient).
  evidence: DeployTestnet only logs four addresses to the console, so they must be copied by hand from the console or `broadcast/`; the first pairing step is undocumented. Real but new scope, not caused by this change.
- source_spec: `/Users/mac/launcher/_bmad-output/implementation-artifacts/spec-floorvault-web-ui.md`
  summary: Make the first vault scan scale: render cached or partial results while scanning, or add an enumerable on-chain getter or indexer.
  evidence: scanVault walks from the deploy block to head in 100-block chunks and useVaultData waits for the whole scan, so load time grows with chain age on a rate-limited RPC.
- source_spec: `/Users/mac/launcher/_bmad-output/implementation-artifacts/spec-floorvault-web-ui.md`
  summary: Resolve off-chain NFT metadata (ipfs:// and https:// tokenURI JSON) with size and timeout limits so third-party collections show their art.
  evidence: getNftImage and parseTokenUri only handle data: URIs; any non-demo collection falls back to generated placeholder art.
- source_spec: `/Users/mac/launcher/_bmad-output/implementation-artifacts/spec-floorvault-web-ui.md`
  summary: Add a WalletConnect (or mobile deep-link) path to the wallet dialog.
  evidence: The dialog supports injected wallets only, so mobile browsers without an extension hit a dead end.
- source_spec: `/Users/mac/launcher/_bmad-output/implementation-artifacts/spec-floorvault-web-ui.md`
  summary: Check the header at 375px with a wallet connected on the wrong chain (unverified, maybe-false).
  evidence: Wordmark, "Switch to Monad Testnet", address button and menu button share one non-wrapping row; the menu button could be pushed off-screen. Open the page at 375px in that state to settle it.
- source_spec: `/Users/mac/launcher/_bmad-output/implementation-artifacts/spec-floorvault-giveaways.md`
  summary: Update `CLAUDE.md` for the raffle flow (new 6-argument FloorVault constructor, NFTs go to Raffle, redeploy needed, `NEXT_PUBLIC_RAFFLE_ADDRESS`).
  evidence: The implementer added one raffle line but CLAUDE.md still describes the old flow and recipient model. Agent-context files are not edited by review fixes.
- source_spec: `/Users/mac/launcher/_bmad-output/implementation-artifacts/spec-floorvault-giveaways.md`
  summary: Add a test for `export-deployments.mjs` (treasury argument index, min deploy block, `raffle` field).
  evidence: No test references the exporter; a wrong index would silently record the wrong treasury in `deployments/10143.json`.
- source_spec: `/Users/mac/launcher/_bmad-output/implementation-artifacts/spec-offchain-nft-metadata.md`
  summary: Support the other common NFT metadata shapes (`arweave://` URIs, inline `image_data` SVG, relative image paths) and an alternate IPFS gateway.
  evidence: `fetchNftImage` only reads `image` / `image_url` and uses one public gateway (`ipfs.io`), so those collections still get placeholder art.
- source_spec: `/Users/mac/launcher/_bmad-output/implementation-artifacts/spec-offchain-nft-metadata.md`
  summary: Limit concurrent per-NFT metadata fetches on the Gallery page.
  evidence: Each NFT tile fetches its own tokenURI through `useNftImage` with no concurrency cap, so a big gallery can hit the ipfs.io rate limit (maybe-false: not measured; open the Gallery with 50+ ipfs NFTs to settle it).
