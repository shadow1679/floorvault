# floorvault web

Next.js frontend for FloorVault on Monad Testnet (chain id 10143): Explore, Gallery, Launch, Docs. Harvest and buy run automatically via `npm run keeper` (see `scripts/keeper.mjs`), and with `NEXT_PUBLIC_RAFFLE_ADDRESS` set it also draws, settles, finalizes and re-raffles. Winners still claim themselves.

## Setup

```sh
cp .env.example .env.local   # then fill in the addresses printed by contracts/script/DeployTestnet.s.sol
npm install
npm run dev
```

Without the env vars every data page shows a "not configured" notice instead of crashing.

## Scripts

- `npm run dev` / `npm run build` / `npm start`
- `npm run lint`, `npm run typecheck`, `npm test`

## Notes

- Reads use viem against the public testnet RPC. `Launched`, `Harvested` and `Bought` events are scanned from
  `NEXT_PUBLIC_DEPLOY_BLOCK` in 100-block chunks (the RPC's `eth_getLogs` limit) and cached in memory and localStorage.
- ABIs in `src/abi/` are generated from `contracts/out`; regenerate them after changing the contracts.
