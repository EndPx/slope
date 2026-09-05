# 01 — Review: Position Mechanics Gaps (produced REVISION 2)

Issued after the initial research and before step-1 implementation. Six gaps in the Position struct and `AdaptiveExecute` logic; items 1, 2, 3, and 5 were blocking for step 1. Full text mirrored in SPEC.md CHANGELOG REVISION 2.

## 1. Token custody model — never specified (DECIDED: pull-per-fill)

The spec never said how tokenIn reaches the executing party. Decision: **pull-per-fill, NOT escrow** — approval ≥ `totalBudget` at creation, `transferFrom` exactly `fillAmount` at each fill, the contract NEVER holds funds between fills, no refund path; cancelling just deactivates. Rationale: makes the non-custodial claim literally true and matches the Privy bounded-delegation mental model. Escrow switching is forbidden without confirmation. A failing `transferFrom` must be a skip with a distinguishable event (never a gas-wasting revert), with unit tests for insufficient balance and revoked approval.

## 2. Minimum fill size (new field `minFillAmount`)

A keeper polling every few seconds authorizes curve deltas that are tiny — dozens of micro-fills whose gas exceeds the slippage savings, and burned Privy aggregation headroom. New struct field; skip when `fillAmount < minFillAmount` except final settlement. MVP default 1–5% of budget, exposed as an advanced setting; document the default in the README.

## 3. Slippage reference price (must be defined or it measures nothing)

"Compute the slippage" against the just-obtained quote is zero by construction — a check that looks like it works while checking nothing. Fix: PRICE IMPACT from **two quotes in the same transaction**: a small probe quote (≈ spot) vs the execution quote for `fillAmount`; `priceImpactBps = (reference − execution)/reference × 10000`; skip if above `maxSlippageBps`. The absolute `[minPrice, maxPrice]` bounds check is a different check on the execution price; both apply, neither is redundant. Document the definition — judges will ask.

## 4. Decimal normalization (defined once, mirrored exactly)

WETH(18)/USDC(6) makes raw `amountOut/amountIn` meaningless as a 1e18 price. Convention: tokenOut per one whole tokenIn, 18-decimal normalized; decimals cached in the struct at creation; identical formula in the TypeScript reference model; a committed cross-validation test on the asymmetric-decimals case.

## 5. Dust residual — positions may never close

Integer division can leave `executedAmount` a few wei short forever. Fixes: **terminal clamp** (`elapsed ≥ duration` ⇒ authorized cumulative = `totalBudget`, bypassing the curve) and a dust-threshold completion; the final settlement fill bypasses `minFillAmount`. Explicit lifecycle tests required.

## 6. Access control on `AdaptiveExecute` (decide deliberately)

Permissionless (recommended, adopted): the contract is authoritative on every constraint that matters and liveness beats caller restriction. Consequence: the README must never claim Privy rate-limits execution in general — the policy constrains only the delegated signer.

## 7. Non-blocking

Keep concrete competitive research out of the spec; hold it in internal pitch notes, with a specific "how is this different from X?" answer ready for Q&A.

**Struct delta**: add `minFillAmount`, `decimalsIn`, `decimalsOut`. No escrow field.
