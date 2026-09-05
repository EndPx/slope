# Slope Mathematical Kernel

Normative reference for every quantity, formula, and rounding rule that affects what the contract authorizes. The product framing is in [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md); module boundaries are in [`ARCHITECTURE.md`](ARCHITECTURE.md); the decision history is in [`spec/SPEC.md`](spec/SPEC.md). If any document disagrees with this one on mathematics, this one governs.

## 1. Units, Domains, and Orientation

All fixed-point quantities are unsigned 256-bit integers scaled by `1e18` (WAD):

```text
progress          ∈ [0, 1e18]         fraction of budget authorized so far
price             ∈ (0, …]            tokenOut per one whole tokenIn, WAD-scaled
raw amounts       uint256             native token units (never enter curve math directly)
elapsed, duration uint256 seconds     duration > 0
```

The interface and events display prices in the normalized convention; raw token amounts appear only at the token-transfer boundary. Token decimals are read once at creation and cached in the position; decimals outside `0 ≤ d ≤ 18` are rejected at creation (normalization would leave the integer domain). Raw decimals never enter any formula in this document — normalization happens exactly once, at the price boundary (section 5).

Every product-then-division in the authorization path is evaluated with full-precision 512-bit-intermediate division (`Math.mulDiv` from the pinned OpenZeppelin library). Plain `a * b / c` is forbidden in this path: it can overflow on intermediate products even when the final result fits. One rule, no exceptions, no per-site gas micro-optimizations until the security review.

## 2. Integer Arithmetic Contract

All quantities in this document are non-negative; no signed arithmetic exists in the kernel. The single rounding primitive is floor division; the single rounding decision the kernel makes is **directional**, chosen per operation so that rounding can never authorize more than the ideal real-valued schedule:

| Operation | Formula | Rounding | Direction rationale |
| --- | --- | --- | --- |
| Progress, all shapes | section 3 | floor | Under-authorizes by at most one unit; never over. |
| Authorized cumulative | section 4 | floor (`mulDiv`) | Same: rounding can only delay execution, never advance it. |
| Price normalization | section 5 | floor (`mulDiv`) | Applied identically to probe and execution quotes, so comparisons are apples-to-apples. |
| Price impact (bps) | section 5 | **ceil** | User-protective: a borderline impact rounds toward skipping, not toward accepting. |
| Benchmark quantities | section 6 | exact (BigDecimal) | Display and audit only — never consensus-critical, never on-chain. |

Division by zero reverts in the pure math layer; at the execution layer every caller ensures the denominator cannot be zero before entering (duration > 0 at creation; reference price checked before the impact division). Boundary exactness is guaranteed by construction, not by rounding luck — see section 3.

## 3. The Progress Schedule

With `elapsed = block.timestamp - startTimestamp` (clamped to the position window as described below), let:

```text
r = mulDiv(elapsed, 1e18, duration)                     // WAD fraction of the window
```

The three shapes:

```text
NEUTRAL:      progress = r                              // exact linear TWAP
AGGRESSIVE:   progress = sqrtWad(r)                     // floor sqrt, pinned library
CONSERVATIVE: progress = mulDiv(r, r, 1e18)             // (t/d)^2 in WAD
```

Properties, each of which is a hard test obligation:

1. **Boundary exactness.** At `elapsed = duration`, `r = 1e18` exactly (the denominator divides the numerator); `sqrtWad(1e18) = 1e18` exactly; `mulDiv(1e18, 1e18, 1e18) = 1e18` exactly. So `progress(duration) = 1e18` with **zero rounding error for every shape**. At `elapsed = 0`, `progress = 0` exactly.
2. **Monotonicity.** `r` is non-decreasing in `elapsed`; floor-sqrt and floor-squared of a non-decreasing WAD are non-decreasing. Progress never decreases.
3. **Range.** `r ∈ [0, 1e18]` implies all three outputs lie in `[0, 1e18]`.
4. **Overflow safety.** `r ≤ 1e18`, so `r² ≤ 1e36 ≪ 2^256`; all products go through `mulDiv` regardless.

**Terminal clamp.** For `elapsed >= duration`, `authorizedCumulative` is set to `totalBudget` directly — the progress formula is bypassed entirely, so accumulated rounding can never strand a remainder. The schedule input is clamped to the window (an `elapsed` beyond `duration` evaluates at `duration`), and calls past the window keep working: they authorize exactly the unexecuted remainder until the budget is exhausted — `duration` bounds the schedule, not the position's liveness (REVISION 3).

There is no generic power, no logarithm, no exponential anywhere in the kernel. The only non-linear primitive is the floor square root of a pinned, battle-tested implementation.

## 4. Authorized Amounts

```text
authorizedCumulative = mulDiv(totalBudget, progress, 1e18)      // floor
authorizedNow        = authorizedCumulative - executedAmount
fillAmount           = min(authorizedNow, maxAmountIn)
```

Invariants (fuzz-tested):

```text
0 <= executedAmount <= totalBudget                              // budget conservation
executedAmount    is non-decreasing while the position is active
authorizedCumulative(elapsed) is non-decreasing in elapsed      // follows from section 3
```

Because both the progress floor and the cumulative floor round down, `authorizedCumulative` never exceeds the ideal real-valued schedule: rounding can delay a fill by one unit of tokenIn but can never create authorization. The keeper's `maxAmountIn` — computed by the same formulas off-chain — can only tighten the result. `fillAmount <= 0` is not an execution: it is a skip with reason `NOT_DUE`.

The skip conditions evaluate in this order after scheduling: `NOT_DUE` (`fillAmount <= 0`); `MIN_FILL` (`fillAmount < minFillAmount` and `elapsed < duration`); price checks (section 5); transfer (section 4 of the product spec); expiry is checked before all of these. The order matters for gas: the cheapest rejections come first, and no token movement happens before every check has passed.

## 5. Price Normalization and Dual-Quote Impact

### 5.1 Normalization

```text
price = mulDiv(amountOut, 10^(18 - decimalsOut) * 1e18, amountIn * 10^(18 - decimalsIn))
```

Evaluated with `mulDiv` end-to-end (the scalars `10^(18 - d)` are compile-time or cached constants ≤ `1e18`). Both the reference and the execution price use this identical formula with identical rounding, so their difference measures the market, not the arithmetic. Numerator-scaling overflow (`amountOut` beyond the uint256 domain after scaling) is excluded by a pre-check against the scaling constant before the multiplication; a degenerate quote (`amountOut = 0` or `amountIn = 0`) is handled as a skip (`IMPACT`), never as an arithmetic exception.

### 5.2 Dual-quote impact

```text
probeAmount     = max(fillAmount / 1000, 10^(decimalsIn - 4))   // floored, capped at fillAmount
referencePrice  = normalized quote(probeAmount)
executionPrice  = normalized quote(fillAmount)
priceImpactBps  = ceil( (referencePrice - executionPrice) * 10000 / referencePrice )
```

The probe is normatively 0.1% of `fillAmount`, lifted to a floor of `10^(decimalsIn - 4)` — 1/10000 of a whole tokenIn unit, quotable on 6-decimal tokens and far below ordinary fills on 18-decimal ones — and capped at the fill itself. **When the fill is below the floor, the fill is its own probe: `referencePrice == executionPrice`, the impact measurement is undefined, and it is not applied** — the fill settles with `impactChecked = false` on the event, and the absolute `[minPrice, maxPrice]` bounds are the only price protection for it. `priceImpactBps` is negative when the execution price is favorable; only a positive value above `maxSlippageBps` skips. The ceil direction is deliberate: at the comparison boundary, ambiguity resolves in the user's favor.

The absolute check is independent: the normalized `executionPrice` must satisfy `minPrice <= executionPrice <= maxPrice`. Both checks run; passing one never implies the other. The property that makes the dual-quote design sound is quote/swap consistency of the official router — the static quote executes the same program as the swap — and it is asserted by a dedicated test at the integration milestone.

## 6. Benchmark Mathematics

The benchmark compares the realized execution against the NEUTRAL shape on the same window and budget, **at the same observed prices** — this isolates the effect of the size-and-timing distribution from the effect of the price path, which is the honest claim Slope makes. For fills `i = 1..n` with raw fill amounts `a_i`, normalized prices `p_i`, and per-fill elapsed times `e_i`:

```text
actualVWAP   = sum(a_i * p_i) / sum(a_i)
twapAmount_i = totalBudget * e_i / duration                   // the NEUTRAL schedule at the same instants
twapVWAP     = sum(twapAmount_i * p_i) / sum(twapAmount_i)
improvementBps (sell side) = (actualVWAP - twapVWAP) * 10000 / twapVWAP
```

A positive `improvementBps` means the realized curve bought tokenOut more cheaply than the linear schedule at the same observed prices. For a buy-side position the sign convention flips; the MVP demo pair is a sell (WETH → USDC), and the direction is explicit in every UI label. These quantities are computed in exact BigDecimal (Subgraph mapping and frontend) — they are audit and display mathematics, never consensus-critical, and are therefore exempt from the integer contract of section 2 while remaining exact.

## 7. Reference Model Parity

The TypeScript reference model (`shared/curve`) replicates sections 3–5 exactly, using BigInt arithmetic whose floor division matches the kernel's `mulDiv` for the non-negative domain. Parity obligations:

- **Bit-exact (consensus-critical):** `progress`, `authorizedCumulative`, `authorizedNow`, `fillAmount`, both normalized quote prices, and `priceImpactBps`. Committed vectors pin these; a mismatch is a build failure.
- **Exact-real (display/audit):** the benchmark quantities of section 6 (BigDecimal in the model; the mapping computes the same definition).

The vector schema, regeneration procedure, and trust boundary are specified in `REFERENCE_MODEL.md` at the reference-model milestone.

## 8. Numerical Safety

- The only non-linear primitive is the pinned floor square root. No generic `pow`, `ln`, or `exp` exists in the system; consequently there are no transcendental domains to audit.
- Every product-then-division uses `mulDiv`; the known worst-case intermediate (`r² ≤ 1e36`) is documented and safe.
- Numerator-scaling overflow in section 5 is excluded by pre-check (section 5.1), preserving the no-hard-revert guarantee on keeper paths.
- `duration = 0` is rejected at creation; `elapsed` is non-negative by construction.
- Guard rails on configuration: `decimals ∈ [0, 18]`, `totalBudget > 0`, `minFillAmount <= totalBudget`, `minPrice < maxPrice`, `duration > 0`, `maxSlippageBps > 0`. All rejected at creation with explicit errors.

## 9. Required Mathematical Tests

- Boundary vectors per shape: `elapsed = 0 → 0`; `elapsed = duration → exactly 1e18`.
- Monotonicity fuzz over `(elapsed, duration)`; range fuzz asserting `[0, 1e18]`.
- Differential vectors: Solidity kernel vs. `shared/curve` (BigInt), including the WETH(18)/USDC(6) normalization case and a rounding-sensitive case where the floor is observable.
- Terminal clamp: at `elapsed = duration` the authorized cumulative equals `totalBudget` exactly for every shape; the sub-`minFillAmount` remainder settles.
- Conservation fuzz: `executedAmount <= totalBudget` across adversarial call schedules (including permissionless calls at adversarial timestamps).
- `min()` semantics: oversized `maxAmountIn` cannot exceed `authorizedNow`; undersized always caps the fill.
- Impact edge cases: `executionPrice == referencePrice` (zero impact), favorable execution (negative bps), degenerate quotes (skip, not revert), and the `ceil` boundary at exactly `maxSlippageBps`.
- Probe definition: `probeAmount = fillAmount / 1000` with the minimum-one-unit floor exercised.
- Zero guards: `duration = 0`, zero-amount quotes, and zero-denominator divisions are rejected at their boundaries.

## 10. Kernel Boundary

This document defines the schedule, the authorization arithmetic, the price measurement, and the benchmark quantities — nothing else. It does not define:

- custody, approvals, or the transfer flow (product spec, section 6);
- who may call execution and what the keeper does (product spec, sections 8–10);
- Privy policy scope or aggregation behavior (product spec, section 11);
- Subgraph entity shapes or frontend rendering (architecture);
- gas budgets, storage layout, or contract wiring (architecture and implementation).

Those layers inherit these definitions and must not re-derive them: any change here is a spec revision, propagated to `shared/curve`, the tests, and the committed vectors in the same commit.
