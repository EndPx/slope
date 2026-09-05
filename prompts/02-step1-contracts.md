# 02 — Step 1: Core Contracts + Test Suite (implementation directive)

Goal directive issued for the first implementation step. Scope was explicit: **only this, nothing more**.

## Scope

- Monorepo scaffold per the locked stack (`contracts/`, `frontend/`, `keeper/`, `subgraph/`, `shared/` — only contracts and shared populated; the rest empty with `.gitkeep`).
- Foundry project with the verified configuration: solc 0.8.30, `via_ir = true`, EVM target cancun.
- `SlopePosition` with the full struct per SPEC section 3 + REVISION 2 (including `minFillAmount`, `decimalsIn`, `decimalsOut`).
- `curveFunction` for **NEUTRAL only** — AGGRESSIVE/CONSERVATIVE explicitly deferred to step 2.
- `AdaptiveExecute(uint256 positionId, uint256 maxAmountIn)` with the full REVISION 1 + 2 logic: `min(authorizedNow, maxAmountIn)`, `minFillAmount` check with the final-settlement exception, terminal clamp at `elapsed ≥ duration`, pull-per-fill via `transferFrom` with skip (not revert) on failure.
- `createPosition` and `cancel`/deactivate.
- TypeScript reference model in `shared/` with the identical price-normalization convention.
- Full NEUTRAL test suite: boundary tests (0 → 0, duration → exactly 1e18), monotonicity + range fuzz, execution tests (impact skip, bounds skip, past-duration revert, `executedAmount` correctness, completion flips `isActive`, transfer-failure skips for both balance and approval cases, final settlement bypassing `minFillAmount`), an integration cycle with simulated time, and Solidity ↔ TypeScript cross-validation including the asymmetric-decimals WETH/USDC case.

## Aqua handling for this step

Aqua integration is step 3 — use a minimal interface + mocks for quote and swap in tests. The interface must stay consistent with the verified official surface (`AquaSwapVMRouter.quote`, `router.swap`) so step 3 swaps the mock for the real router without reshaping the contract.

## Work rules

- Granular commits per completed unit; the FIRST commit contains SPEC.md + Revision 1 + Revision 2 only (spec before code — a hard ETHGlobal requirement).
- `.gitignore` from the first commit covering `.playwright-mcp/`, `.privy-research/`, `research/`, `.env`, `.env.*` — the research folders hold third-party documentation that must never enter the repo.
- Do not start step 2 until step 1 passes all tests and the creator reviews it.
- Ambiguities are questions, not guesses; architectural decisions outside the spec go to the creator first.
- When done: run the whole suite, report results, wait for review.
