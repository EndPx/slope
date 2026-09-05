# 07 — Review: Deployment Forensics and Manifest

Issued after the live Base Sepolia deployment. Three confirmations required BEFORE step 4, plus manifest corrections.

## 1. The 45 accidental transactions — treat as serious, verify not summarize

Broadcast-in-test had signed and sent real transactions. Questions: did any land and change state (unrecorded `SlopePosition` artifacts, eroded liquidity)? Is the maker wallet still sufficient to back the shipped commitment — a drained wallet makes recorded `ship()` commitments fail at fill time with confusing errors. Verify both BEFORE continuing.

Resolution (verified on-chain): every deterministic deployment address from those runs has zero bytecode on-chain; the real registry's entire event history is exactly five events in two transactions (the seed and the known fill); the real `SlopePosition` has exactly `PositionCreated`/`FillExecuted`/`PositionCompleted` for one position; the maker's nonce of 16 equals exactly the legitimate deployment and fill transactions. The 45-tx address is outside our manifest entirely and touched none of our contracts. Additionally, the same-address maker/taker flow on the demo position nets to zero wallet movement — dETH 6010e18 and dUSD 18M versus commitments of 1000e18 and 3M: solvency proven with margin.

## 2. The natural path was never proven on-chain

The successful 10-dETH fill went through the **terminal clamp**, not the curve. The production-heavy path — staged fills following the curve inside the window — had only mock/fork evidence. Required before demo recording: at least one position filled naturally mid-window. Executed on-chain: position #2, filled at elapsed ≈ 55 s of 1000 — exactly 0.5 dETH in → 1,469.98 dUSD out, `executedAmount = 0.5e18` partial, position still active, price 2939.96 consistent with post-fill-1 spot. Also verified: the impact math (~1.22% for a 1%-of-pool fill against the 3000 spot) is internally consistent.

## 3. Provenance traceability from the submission repo

`~/slope-live` is a local copy outside the repo — judges checking that the deployment really came from official v1.0.2 must be able to trace it from the submission. Resolution: the pinned submodules and package lockfiles in the repo already define the exact sources; bytecode comparison was run (registry, SlopePosition, MockERC20 byte-identical; the router identical in length with differences confined to 37 constructor-immutable regions — registry address, `"AquaSwapVMRouter"`/`"1.0.2"` ASCII, derived hashes), and all five contracts were source-verified on Basescan. Documented in `docs/DEPLOYMENT.md`.

## 4. Manifest fixes

- **BUG**: `strategyHex` (write) vs `strategy` (read) key asymmetry — `m.strategy` always came back empty after a round-trip, so any script reading the manifest got empty program bytes and would fail opaquely. Unify on one key and verify a write→read round-trip returns identical bytes.
- **BUG**: the `weth` field is unused and misleading (canonical WETH is not our demo pair) — remove from struct, read, write, and the JSON; an unused token field in a file three consumers read is an invitation to misuse.
- **Additions**: `sourceCommit` (the git commit at deployment time — without it there is no way to trace the exact source behind the on-chain bytecode; with it plus Basescan verification the v1.0.2 claim becomes provable), `slopePositionTx` (direct explorer evidence, complementing the block number), `deployedAt` (ISO 8601, human-readable), and a network block (name, public RPC, explorer URL) so frontend/keeper/subgraph need no hardcoded endpoints.
- **Keep the structure FLAT** — no nesting, no schema/protocol version fields, one file per chain. One core contract and one chain; flat means less parsing in three consumers and easier judging.

Then proceed to step 4 (Privy).
