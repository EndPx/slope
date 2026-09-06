# Subgraph — Deployment And Query Record

The Slope subgraph indexes the live `SlopePosition` contract on Base Sepolia and is deployed to **Subgraph Studio** (the official hosted service — the track requirement is consuming live data from a Graph provider with a real API key; local/mock data does not qualify).

## Deployment

| | |
| --- | --- |
| Subgraph (slug) | `slope-base-sepolia` |
| Studio dashboard | https://thegraph.com/studio/subgraph/slope-base-sepolia |
| Version | `v0.0.1` (versioned query URL — pinned; redeploys archive previous versions) |
| Queries (HTTP) | `https://api.studio.thegraph.com/query/1758808/slope-base-sepolia/v0.0.1` |
| Deployment manifest | `Qmb6nMDR692w2QaCJXdoTLsrEMWEuBGejXNn7GZiKHXxTm` |
| Network | `base-sepolia` |
| Data source | `SlopePosition` [`0xC7c6FaD1C2A0e8961E34D40c39C059ECE6dBB8Cc`](https://sepolia.basescan.org/address/0xC7c6FaD1C2A0e8961E34D40c39C059ECE6dBB8Cc#code) |
| startBlock | `46418713` (deployment block, from [`contracts/deployments/base-sepolia.json`](../contracts/deployments/base-sepolia.json)) |
| Toolchain | `@graphprotocol/graph-cli` 0.98.1, `@graphprotocol/graph-ts` 0.38.2 |

**Authentication**: queries require the Studio API key, appended as `?key=<GRAPH_API_KEY>`. Keys live only in the gitignored `.env` (`GRAPH_API_KEY`, `GRAPH_DEPLOY_KEY`) — see `.env.example`. No key material appears anywhere in this repository.

## Schema And Semantics

Entities (SPEC section 6): `Position`, `Fill`, `Skip`, `BenchmarkComparison`.

- `Fill.impactChecked` carries the REVISION 3 flag: `false` marks fills below the probe floor whose price impact could not be measured.
- `Skip` records every `PositionSkipped` with its reason — the guard rails' decisions are first-class audit records.
- `BenchmarkComparison` is the as-of-last-fill snapshot (DECISION 4), computed in the mapping per MATH_SPEC section 6: `actualVWAP` versus the NEUTRAL schedule at the same observed fill prices, `improvementBps` on the sell side. Live planned-vs-actual curves are computed in the frontend — mappings run on events only, there is no "now" at query time.

The mapping is pure event indexing (zero `eth_calls`). `Position.startTimestamp` is the creation block time — the event itself carries no start time.

## Live Consumer — The Keeper

The keeper is the subgraph's production consumer (track requirement: meaningful work with live Graph data, not a dashboard-only index). Every tick (`keeper/src/keeper.ts`):

1. **Queries the pinned versioned endpoint** above with the API key (`keeper/src/subgraph.ts`) for active positions, their indexed `executedAmount`, the newest fill timestamp, and the five newest skips — plus `_meta.block.number`.
2. **Selects candidates without spending RPC** (`keeper/src/candidates.ts`, unit-tested): not-due positions are dropped using the indexed `executedAmount` + the shared curve model with the position's own shape; positions never delegated to this keeper are logged; a `TRANSFER_FAILED` skip within the last 15 minutes parks the position immediately (only an owner-side fund+approve can change it); a recent streak of impact/bounds/quote skips degrades priority for route review.
3. **Ranks the remainder by estimated due increment** (largest first) and executes — but only after re-reading the position's authoritative state on-chain: the final authorization is recomputed from the contract state, never from indexed data, and price/quotes/slippage are enforced by the contract during execution.

**No-fallback rule**: if the subgraph is unreachable, the tick is skipped and logged (`SUBGRAPH UNREACHABLE — no execution this tick (no fallback path)`); the keeper never substitutes local data, because that would invalidate the live-Graph-consumption claim. The `_meta` block is compared against the chain head every tick and a lag above 50 blocks logs an explicit staleness warning — quantifying exactly why execution-critical state is re-verified on-chain (SPEC section 5).

## Redeploying

```sh
cd subgraph
npm install
npx graph codegen && npx graph build
npx graph deploy slope-base-sepolia --deploy-key "$GRAPH_DEPLOY_KEY" --version-label v0.0.N
```

Each redeploy archives the previous version — update the pinned versioned query URL in this file and in the README.

## Verified After Deployment (2026-09-07)

Synced past the chain head with all events indexed. Spot checks against the versioned endpoint:

- **10 positions** indexed (ids 1–10).
- **Position 10 — 57 delegated fills** (the keeper's ~15 s cadence over the schedule), fully settled; benchmark `improvementBps = +33.62` versus linear TWAP at the same observed prices.
- **Position 8** — 3 fills through the delegated path including the terminal clamp; honest negative benchmark (`−56.23 bps`) when large terminal fills landed at higher observed prices.
- **Position 9** — 17 skips indexed with reasons (`TRANSFER_FAILED`: the owner wallet lacked tokenIn balance/allowance; the guard rail made the decision, and the ledger proves it).
- Single-fill positions (1, 2) show `improvementBps = 0` by construction — one fill's VWAP equals the TWAP reference at the same instant.
