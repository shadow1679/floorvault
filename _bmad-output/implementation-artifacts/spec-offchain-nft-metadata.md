---
title: 'Resolve off-chain NFT metadata'
type: 'feature'
created: '2026-10-14'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `getNftImage` only reads `data:` tokenURIs, so any real collection (CHOG included) whose tokenURI is `ipfs://` or `https://` JSON shows generated placeholder art.

**Approach:** Fetch http(s) and ipfs tokenURI JSON from the browser with a timeout and a size cap, read its `image` field through the existing `safeImageUrl`, and keep returning `null` on any failure so the placeholder still shows.

</frozen-after-approval>

## Implementation Notes

- `web/src/lib/metadata.ts` -- added `metadataFetchUrl` (ipfs:// to the `ipfs.io` gateway, http(s) as is, `..` path segments rejected) and `fetchNftImage` (5s abort, streamed 256 KB cap, `image` then `image_url`, `image/*` response uses the URL itself, no credentials and no referrer). `safeImageUrl` now delegates its ipfs/http(s) cases to `metadataFetchUrl`.
- Decision: `fetchNftImage` returns `null` for a definite miss (404, not JSON, oversize, unsafe image) but throws on network error, timeout, 429 and 5xx. `useNftImage` has `staleTime: Infinity`, so swallowing those would remember "no image" for the whole session; throwing lets react-query retry. This refines the Approach's "null on any failure" for transient failures only.
- `web/src/lib/chain.ts` -- `getNftImage` tries `parseTokenUri`, then a case-insensitive `data:` check, then `fetchNftImage`. An unreadable `tokenURI()` still returns `null`.
- Tests: `metadata.test.ts` (fetch URL mapping, JSON/`image_url`/content-type paths, real size-cap cases, traversal, transient throws, timeout abort) and `chain.test.ts` (`getNftImage` branches). 175 tests, typecheck and lint pass.
- Not verified in a browser against a live CHOG collection.

## Review Triage Log

- Size-cap tests did not test the cap -- real (medium) -- rewrote with a padded valid body and an oversize `content-length`.
- `res.text()` buffers before the cap -- real (medium) -- replaced with a streamed byte-capped read.
- `image/*` branch left the body open -- real (low) -- body cancelled.
- Transient failure cached forever via `staleTime: Infinity` -- real (high) -- `fetchNftImage` throws on transient failures.
- `data:` check stricter than `parseTokenUri` -- real (low) -- trimmed, case-insensitive.
- Viewer data sent to a third party -- real (medium) -- `credentials: "omit"`, `referrerPolicy: "no-referrer"`. Blocking plain `http:` not done (rejected low: keeps http collections working on a local dev server).
- Duplicated scheme logic -- real (low) -- `safeImageUrl` delegates to `metadataFetchUrl`.
- IPFS `..` traversal -- real (low) -- rejected in `metadataFetchUrl`, test added.
- No timeout test -- real (low) -- fake-timer test added.
- `getNftImage` untested -- real (medium) -- branch tests added.
- arweave / `image_data` / relative paths, gateway rate limits -- deferred (new scope), see `deferred-work.md`.
- Loose JSON parsing -- real (low) -- explicit object check.
