# Slope Product and Protocol Specification

This document describes what the Slope product **is** and how the protocol behaves. It is the product-facing companion to [`spec/SPEC.md`](spec/SPEC.md) (the normative master, including the decision changelog) and [`ARCHITECTURE.md`](ARCHITECTURE.md) (module boundaries and flows). Where documents overlap, SPEC.md governs.

## 1. Product

Slope is a non-custodial execution protocol for takers. A user does not submit just an amount; the user publishes a bounded execution policy describing **how the order is allowed to unfold over time**:

- a budget of `tokenIn` sold for `tokenOut`;
- a schedule window (`duration`) over which the curve spreads execution — a remainder after the window still settles; nothing is forfeited;
- a curve shape — AGGRESSIVE, NEUTRAL, or CONSERVATIVE — that schedules the cumulative fraction of budget that may have executed at each moment;
- absolute price bounds and a per-fill price-impact limit;
- a minimum fill size.

The protocol executes that policy with real fills settled through the official 1inch Aqua contracts, and then shows the user — honestly — how the execution compared against a plain linear TWAP on the same window and budget.

## 2. One Schedule Family

Every position uses the same user-facing configuration:

```text
Position(tokenIn, tokenOut, totalBudget, duration, curveShape, minPrice, maxPrice, maxSlippageBps, minFillAmount)
```

Let `elapsed = block.timestamp - startTimestamp`. The schedule returns a progress fraction in 18-decimal fixed point (`1e18` = 100%):

```text
progress(t) = t * 1e18 / duration               NEUTRAL      (exactly a linear TWAP)
progress(t) = (t / duration)^(1/2) * 1e18       AGGRESSIVE   (front-loaded)
progress(t) = (t / duration)^2 * 1e18           CONSERVATIVE (back-loaded)
```

There are no user-supplied exponents and no arbitrary curves. Three fixed shapes keep the math auditable: the fractional exponent is a battle-tested square root from a pinned library, never a hand-rolled power function. Boundary conditions are exact and unit-tested — `progress(0) = 0` and `progress(duration) = 1e18` — because every downstream authorization depends on them.

NEUTRAL is the degenerate case of the family: it must be indistinguishable from a classic TWAP, and it is used as the benchmark against which the other shapes are judged. This mirrors how a bounded curve family keeps an honest baseline inside itself.

## 3. Authorization Semantics

At any moment the contract computes:

```text
authorizedCumulative = totalBudget * progress(elapsed) / 1e18
authorizedNow        = authorizedCumulative - executedAmount
fillAmount           = min(authorizedNow, maxAmountIn)
```

`authorizedNow` is what the schedule says **should** have executed by now minus what already has. The keeper computes the same value off-chain from the shared reference model and sends it as `maxAmountIn`, making its intent explicit in calldata and auditable from a block explorer. The `min()` is the safety net: the contract is authoritative under all conditions, and a keeper can never push a fill larger than the curve allows — only smaller.

Integer division means `authorizedNow` can be zero or dust for stretches of time; that is correct behavior. The schedule simply has nothing more to give yet.

## 4. Terminal Clamp and Completion

Integer rounding could otherwise leave a few wei authorized forever, hanging the position. Two rules close it:

1. **Terminal clamp**: for `elapsed >= duration`, `authorizedCumulative` is set to `totalBudget` directly — the exact remainder becomes authorized, bypassing curve rounding entirely.
2. **Completion**: after a successful fill, if `executedAmount >= totalBudget` (or the remainder is at or below the dust threshold), the position is completed: `isActive = false` and `PositionCompleted` is emitted exactly once.

The final settlement fill bypasses the `minFillAmount` floor — otherwise a remainder smaller than the floor could never execute and the position would hang. This exception exists only in the terminal window. Past the window the schedule stays clamped at 100%: the remainder remains executable until the budget is exhausted — `duration` bounds the schedule, not the position's life (REVISION 3).

## 5. Price Convention and Impact Measurement

Prices are tokenOut per one whole tokenIn, normalized to 18 decimals, with token decimals cached at creation:

```text
price = (amountOut * 10^(18 - decimalsOut) * 1e18) / (amountIn * 10^(18 - decimalsIn))
```

"Slippage" is defined precisely, because an undefined slippage check is a check that measures nothing. Impact is computed from **two quotes against the official Aqua router in the same transaction**:

```text
referencePrice  = quote(probe amount)      e.g. 0.1% of fillAmount — approximates spot
executionPrice  = quote(fillAmount)        the real size
priceImpactBps  = (referencePrice - executionPrice) / referencePrice * 10000
```

The fill is skipped if `priceImpactBps > maxSlippageBps`. Independently, the execution price must lie within `[minPrice, maxPrice]`. Both checks apply; they are not redundant — one is relative (this fill's own footprint), one is absolute (the acceptable price range). A single pre-trade quote would make "slippage" zero by construction; the probe-versus-execution pair is what makes the check real.

## 6. Custody Model

Slope is pull-per-fill, never escrow:

- At creation, the user grants `SlopePosition` an ERC-20 allowance of at least `totalBudget`.
- At each fill, the contract pulls exactly `fillAmount` from the owner's wallet and settles it through Aqua in the same atomic transaction.
- Between fills, the contract holds nothing. There is no vault, no refund path, and no claim on future budget.

This is what makes the non-custodial claim literal: an unexecuted budget has never left the user's wallet. It also produces a clean kill switch — revoking the token allowance stops all future fills with zero stranded funds; the position simply stops. Cancelling a position only sets `isActive = false`, because there is nothing to return.

## 7. Encoded and Runtime State

```text
Position {
    owner, tokenIn, tokenOut,
    decimalsIn, decimalsOut,        // cached at creation (IERC20Metadata)
    totalBudget, executedAmount,    // executedAmount starts at 0, only increases
    minFillAmount,
    startTimestamp, duration,
    curveShape,                     // AGGRESSIVE | NEUTRAL | CONSERVATIVE
    minPrice, maxPrice,             // 1e18 fixed point
    maxSlippageBps,                 // default 500
    isActive
}
```

Static policy parameters are immutable for the life of the position — there is no edit path, only cancel and re-create, so a quote can never silently change shape between simulation and execution. The only evolving values are `executedAmount` and `isActive`. `decimalsIn`/`decimalsOut` are cached once rather than read per fill, and raw token decimals never enter the curve math: amounts are normalized at the math boundary.

## 8. Execution Flow

`AdaptiveExecute(uint256 positionId, uint256 maxAmountIn)` — permissionless — performs:

1. load the position; revert only if inactive (REVISION 3: past-window calls stay valid and settle the remainder);
2. `elapsed`; progress; `authorizedCumulative` (terminal clamp applies);
3. `authorizedNow`; `fillAmount = min(authorizedNow, maxAmountIn)`;
4. skip if `fillAmount <= 0`, or below `minFillAmount` outside the terminal window;
5. dual quotes on the official router; impact and absolute-bounds checks — skip with a reason if either fails;
6. `transferFrom(owner, ..., fillAmount)` — skip with a reason if it fails;
7. `router.swap(...)` exact-input through official Aqua — pull and push atomically;
8. `executedAmount += fillAmount`; emit `FillExecuted`;
9. completion check; emit `PositionCompleted` at most once.

Skips return early with a distinguishable event — they are first-class outcomes, not errors:

| Reason | Trigger | Keeper behavior |
| --- | --- | --- |
| `NOT_DUE` | `authorizedNow <= 0` | Nothing is scheduled yet; retry next cycle. |
| `MIN_FILL` | Below `minFillAmount`, not terminal | Wait until the schedule accumulates a worthwhile fill. |
| `BOUNDS` | Price outside `[minPrice, maxPrice]` | Wait for the market to return to the accepted range. |
| `IMPACT` | `priceImpactBps > maxSlippageBps` | Wait for deeper/ calmer liquidity. |
| `TRANSFER_FAILED` | Insufficient balance or revoked allowance | Park the position; a persistent failure is a user decision, not a glitch. |
| `QUOTE_INVALID` | Probe or execution quote unusable (zero output) | Wait for a routable market; kept distinct from `IMPACT` so quote failures never masquerade as market moves. |

## 9. Position Lifecycle

1. Onboard with a Privy embedded wallet (email/social login, no seed phrase).
2. Configure the order; the curve preview is drawn from the same reference model the contract implements.
3. Approve tokenIn (≥ `totalBudget`) and create the position — two visible transactions, or one if the token supports permit.
4. Grant delegated authority: a Privy session signer scoped by policy, attached to the wallet with explicit consent.
5. Watch fills follow the curve; cancel or revoke at any time.
6. At completion, read the benchmark verdict.

A user who walks away after step 4 is safe: the schedule is the only authority on amounts, and unexecuted budget never moved.

## 10. Execution Automation (Keeper)

An on-chain contract cannot wake itself up, so a keeper triggers fills — but the trigger is deliberately worthless as an attack: it is permissionless, and the contract re-derives everything. Our keeper is a single Node.js polling loop: discover active positions from the Subgraph (one indexed query), compute `authorizedNow` from the shared reference model, cheaply skip cycles that are not due, re-verify price on-chain with the dual-quote check, sign via Privy (`eth_signTransaction` — the policy is evaluated at signing) and self-broadcast, then log executed/skipped with the on-chain reason. Positions with persistent failures (a revoked allowance) are parked, not retried forever.

The keeper is untrusted and replaceable. It holds no funds and no on-chain privileges; its `maxAmountIn` can only tighten what the curve already authorizes. If it disappears, any other account can advance open positions.

## 11. Delegated Authority (Privy)

The delegation boundary is enforced by Privy's infrastructure at signing time, scoped by a policy attached to the session signer with the user's explicit consent:

| Rule | Scope |
| --- | --- |
| Target allowlist | Exactly the `SlopePosition` contract — nothing else. |
| Function restriction | Exactly `AdaptiveExecute` — not cancel, not anything else. |
| Per-transaction cap | Bounds the signed transaction value/calldata. |
| Rolling aggregation cap | Sums `maxAmountIn` over a rolling window as a blast-radius limit (headroom above `totalBudget`, because signed-but-skipped fills still consume it). |
| Expiry | Authority ends automatically at order expiry. |

Framing rules that the documentation must keep honest: Privy constrains **the delegated signer's** scope and rate — it does not rate-limit execution in general (execution is permissionless), and the **contract**, not any off-chain infrastructure, enforces the budget. Revocation is one click in the UI; expiry is automatic.

## 12. Benchmark

Every position is judged against the NEUTRAL shape — a pure linear TWAP on the same window and budget:

- **Hypothetical executed amount**: what linear TWAP would have executed by now (`totalBudget * elapsed / duration`).
- **Actual vs. hypothetical VWAP**: the volume-weighted average price of real fills versus the TWAP schedule's hypothetical VWAP at the same timestamps.

The Subgraph stores this as an auditable as-of-last-fill snapshot computed in the mapping; the frontend extrapolates the live planned-vs-actual curves from position parameters plus fills. Honest expectations: adaptive scheduling improves on naive execution by a few percent in institutional literature — the demo claims what it can show, nothing more.

## 13. Onchain Modules

| Module | Responsibility |
| --- | --- |
| `SlopeTypes` | Position struct, shapes, events, errors; keeps stored prices and raw amounts distinct |
| `CurveMath` | Progress fractions, exact boundaries, terminal clamp (pure) |
| `PriceMath` | 18-decimal normalization, dual-quote impact measurement (pure) |
| `SlopePosition` | Storage, creation, `AdaptiveExecute`, cancel, completion |
| `IAquaSwapVMRouter` | Minimal Aqua interface authored by us — independent calling code |
| Deploy scripts | Official Aqua v1.0.2 to Base Sepolia, seed strategies, manifest |
| `SlopeSwapVMRouter` (stretch) | Redeployed router with a custom `_slopeXD` opcode; committed under `LicenseRef-Degensoft-SwapVM-1.1` |

## 14. Offchain Modules

| Module | Responsibility |
| --- | --- |
| `shared/curve` | Exact TypeScript mirror of schedule and price math; UI preview, keeper computation, cross-validation vectors |
| `shared/types` | Position/event/skip types shared by frontend and keeper |
| `shared/privy-policy` | The policy template builder shared by consent flow and keeper |
| `keeper/` | Polling loop, verification pipeline, Privy signing, skip logging |
| `subgraph/` | Position, Fill, and benchmark snapshot indexing |
| `frontend/` | Onboarding, creation, progress, performance |

The precise boundaries, protocol calls, and flows are in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## 15. Interface

**Create Order** shows the curve being purchased — literally the reference model rendered on Canvas — alongside budget, duration, bounds, and advanced settings; submission is the visible three-step flow (approve, create, delegate). **Execution Progress** shows the planned curve against actual cumulative execution, each fill with an explorer link, remaining budget and time, and the exits (cancel, revoke). **Performance** shows the benchmark verdict and position history. Dark theme, card layout, live indicator, monospace numerics; raw parameters behind advanced disclosure; sponsor attribution in the footer.

## 16. Events and Indexed Data

Events are split by authority:

- `PositionCreated`, `FillExecuted`, `PositionSkipped`, `PositionCompleted` — the product's own truth, emitted by `SlopePosition`.
- Aqua `Shipped`, `Pushed`, `Pulled`, `Docked` — seed-liquidity context on the maker side.

The Subgraph derives `Position`, `Fill`, and `BenchmarkComparison` from the product events; skipped fills are indexed too, because the skip history is part of the product's evidence. Exact event fields and identifiers are frozen in `WIRE_FORMAT.md` at the integration milestone.

## 17. Correctness and Security Matrix

The required test coverage:

- Exact boundary conditions (`progress(0) = 0`, `progress(duration) = 1e18`) for all shapes.
- Fuzz: progress monotonically non-decreasing and within `[0, 1e18]`.
- Differential vectors: Solidity vs. the TypeScript reference model, including the WETH(18)/USDC(6) asymmetric-decimals case.
- The full skip matrix: every reason reachable and distinguishable; no hard reverts on keeper paths.
- `min(authorizedNow, maxAmountIn)` semantics: a keeper-proposed amount larger than authorized cannot execute; smaller always can.
- Terminal clamp: exact completion; settlement below `minFillAmount` after expiry of the schedule; single `PositionCompleted`.
- Invariant `executedAmount <= totalBudget` under all fuzz schedules.
- Permissionless equivalence: any caller produces the same state transition.
- Pull failures (insufficient balance, revoked allowance) skip cleanly and park.
- Real token transfers through the deployed official Aqua router — never mocked success values.
- Delegated authority: out-of-scope signer requests rejected; revoke ends authority; aggregation headroom behavior matches its documented caveats.
- Standard ERC-20 tokens only; rebasing, fee-on-transfer, and callback-bearing tokens are unsupported and out of scope.

## 18. Deployment and Operations

Deployment is assembled in dependency order: pin the official Aqua/SwapVM tag (`v1.0.2`) and SDK versions with license review; deploy the official registry and router to Base Sepolia; seed ungated WETH/USDC strategies (total shipped ≤ wallet balance); deploy `SlopePosition`; publish one versioned manifest (`deployments/84532.json`) consumed by web, keeper, and subgraph; deploy the Subgraph to Subgraph Studio and verify live sync; configure the keeper against the manifest; build the web app on public addresses only — API keys stay in server environments and never enter the browser bundle. A documented reset procedure re-seeds the demo state. The deployment is explicitly not audited and not represented as production-ready.

## 19. Sponsor Mapping

**1inch** is the settlement architecture: liquidity is provisioned as ungated Aqua strategies, prices come from the official router's `quote`, and every fill settles through `swap`'s atomic pull/push — the product cannot move a token without it. **The Graph** is the live discovery and evidence layer: the keeper's automation runs on indexed data, the dashboard's benchmark is computed from indexed fills, and no mocked or local dataset appears anywhere. **Privy** is the access and delegation layer: seed-phrase-free onboarding and a policy-scoped session signer whose authority the infrastructure itself enforces.

## 20. Demo Definition of Done

The seeded state contains three positions on the same WETH/USDC pair:

- one AGGRESSIVE position, front-loading its budget;
- one NEUTRAL position, executing exactly like a linear TWAP (and serving as the visible baseline);
- one CONSERVATIVE position, holding back until later in its window.

The demo shows all three following their distinct schedules under the same keeper, with each fill explorer-linked; at least one skip occurs and its reason is surfaced, proving the guardrails; a position completes via the terminal clamp and renders its benchmark verdict against linear TWAP; the Subgraph shows the same fills behind an API-key-authenticated live query. The same flow must work twice from the documented seeded state without console intervention.
