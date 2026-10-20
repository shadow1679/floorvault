---
title: "Product Brief: Monad-native Nosh clone (working title)"
status: draft
created: 2026-10-12
updated: 2026-10-12
---

# Product Brief: Monad-native Nosh clone (working title)

## Executive Summary

A memecoin launcher for Monad where every coin is paired with an NFT collection, and a share of the coin's trading fees automatically buys that collection's NFTs. It is a Monad-native take on usenosh.app, which does this on Robinhood Chain. Coins launch on nad.fun, NFTs are bought through Seaport, and an on-chain vault enforces what the fees can be spent on.

This is a hackathon build for the CHOG NFT hackathon. Success is a convincing run on Monad testnet, not a production launch. The pitch to judges: memecoin volume becomes a steady bid under NFT floors, and CHOG is the featured collection.

## The Problem

NFT collections on Monad have thin liquidity and little structural buying pressure. Memecoin launches generate heavy trading volume but none of it flows back to anything durable. Nosh showed the two can be linked; nothing like it exists on Monad. [ASSUMPTION: no existing Monad equivalent. Not yet researched.]

## The Solution

A creator launches a coin on nad.fun and pairs it with an NFT collection. The coin's creator fee is routed to our vault contract. The contract keeps 80% to buy NFTs from the paired collection at or near floor, and sends 20% to the project treasury, which the project keeps. The creator chooses where purchased NFTs go. Any collection can be paired; CHOG NFTs are featured prominently.

Fee mechanics, verified against nad.fun's docs and testnet contract:
- The creator fee is the only fee we control. Mainnet fixes it at 1% of volume; testnet allows 1%, 3% or 5%. The other 1% of the curve fee goes to nad.fun.
- Our vault is set as the Creator Fee vault recipient at launch and pulls its own fees with `claim(token)`, since only the recipient may claim.
- Fees arrive as WMON or LVMON and are unwrapped before buying.

## What Makes This Different

Honestly: the idea is Nosh's. The differences are Monad-native execution, CHOG as the featured collection, and building on nad.fun's existing fee vaults instead of a custom launcher. The moat is speed and fit to this hackathon, not technology.

## Who This Serves

- **Coin creators** who want a story beyond "number goes up": a coin that visibly supports an NFT community.
- **NFT communities and holders**, CHOG first, who gain a buyer for their floor.
- **Traders** who want coins with a built-in utility narrative.
- **The project**, which earns the 20% treasury share.

## Success Criteria

For the hackathon (testnet):
- A coin launches on nad.fun testnet with our vault as fee recipient.
- Trades generate fees; the vault claims them and splits 80/20 on-chain.
- The vault buys at least one NFT from a paired collection through Seaport, with the spending rules visibly enforced by the contract.
- A judge can follow it end to end in a short demo. [ASSUMPTION: demo flow is launch, trade, fees flow to the vault, the vault buys a CHOG NFT.]

## Scope

**In (first version, demo-grade):** coin launch paired to any collection, the fee vault with 80/20 split, NFT buying via Seaport, creator-chosen destination for purchased NFTs, and Explore, Gallery and Claims pages. CHOG featured. Next.js frontend, Solidity with Foundry, Monad testnet.

**Also targeted, lower priority:** Giveaways/raffle, Analytics, Docs, and a collection suggestion form, for parity with Nosh. These are first to be cut if the demo needs focus. [ASSUMPTION: you said full parity; I am treating the extras as stretch.]

**Out:** mainnet deployment, audits, production hardening, fee economics tuning.

## Risks and Open Questions

- **Thin NFT liquidity on Monad.** Few listings may exist for the vault to buy; check CHOG listings early.
- **nad.fun indexing.** Launches made directly through the router may not appear in nad.fun's own UI.
- **Unverified mechanics.** Who may call the vault's `setup`, and where `claim` pays out, are not yet confirmed. A Foundry fork test is the next step.
- **Seaport is not on Monad testnet.** It exists on mainnet only, so the testnet demo of NFT buying needs a workaround: deploy Seaport ourselves, use a mock marketplace, or run that step on mainnet with small amounts. [OPEN DECISION]
- **Seaport specifics.** OpenSea's conduit and zone addresses on Monad, and its API chain slug, are not confirmed.
- **Unaudited contracts.** Acceptable for a testnet demo, not beyond.

Addresses, contract findings and sources are in `addendum.md`.

## Vision

If it works, any Monad NFT collection can attach a coin that props up its floor, on mainnet, with audited vault contracts and a real treasury. For now the goal is a working demo.
