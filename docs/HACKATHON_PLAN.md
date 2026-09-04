# Slope Hackathon Execution Plan

## 1. Mission

Build the smallest complete proof that **execution timing is a user-visible, verifiable product primitive**:

> Slope is a non-custodial layer where one large order is executed along a
> bounded time-curve — Aggressive, Neutral, or Conservative — instead of a
> single price-moving swap or a naive linear TWAP. Every fill is pulled from
> the user's own wallet, settled through official 1inch Aqua contracts, and
> measured against a verifiable linear-TWAP benchmark.

The project wins by making that claim visible in one honest demo — a position
visibly following its curve, real token transfers, and a benchmark verdict —
not by shipping the largest protocol.

## 2. Definition of success

The core is demo-ready only when all of the following are true:

1. A user onboards with a Privy embedded wallet (email/social, no seed phrase)
   and creates a position in one flow: token approval, position creation, and
   scoped session-signer consent.
2. The curve preview shown in the UI is identical to the committed TypeScript
   reference model — same formula, same vectors, no artistic license.
3. Fills execute on the schedule the chosen shape implies; each fill pulls
   `fillAmount` from the owner's wallet and settles through the official Aqua
   router on-chain — real token transfers, never mocked success values.
4. Every skip path (absolute price bounds, price impact, minimum fill size,
   failed transfer, expiry) returns early with a distinguishable event — the
   keeper logs reasons and no path hard-reverts on routine conditions.
5. The UI shows planned vs. actual cumulative execution, a per-fill table with
   explorer links, remaining budget and time, and a completion benchmark
   against linear TWAP on the same window and budget.
6. A live Subgraph Studio index (queried with an API key) feeds both keeper
   decisions and the dashboard — no local Graph Node, no static data.
7. The Privy policy blocks out-of-scope requests before signing, and revoke
   works from the UI.
8. Unit, fuzz, and integration tests are green from a fresh clone; contract
   and reference model agree on all committed vectors.
9. The two-to-four-minute demo can be recorded twice without manual repair.

This remains hackathon software. Audit, formal verification, economic stress
testing, and production operations are explicitly outside the submission claim.

### Finalist Live Gate

A fresh browser must reach the public app, the live index, and explorer
evidence for every demo transaction without a team laptop serving any
dependency. Localhost is valid for development only and is never on the
canonical demo path. The page-by-page rules audit lives in
[`ETHGLOBAL_RULES_COMPLIANCE.md`](ETHGLOBAL_RULES_COMPLIANCE.md).

## 3. Frozen MVP

### In scope

- Three fixed curve shapes with hard-coded exponents — AGGRESSIVE (0.5),
  NEUTRAL (1, exactly a linear TWAP), CONSERVATIVE (2) — over an 18-decimal
  fixed-point kernel. No user-supplied exponents, no arbitrary curves.
- One token pair (WETH/USDC) on Base Sepolia, against self-deployed official
  Aqua registry + SwapVM router (tag `v1.0.2`).
- Pull-per-fill custody: approval at creation, `transferFrom` at execution
  time, no escrow, no refund path.
- Permissionless `AdaptiveExecute(positionId, maxAmountIn)`: anyone may
  trigger; the contract is authoritative on every constraint.
- Dual-quote price-impact measurement (probe quote vs. execution quote) plus
  independent absolute price bounds.
- A keeper service as a single polling loop; the Subgraph is its discovery
  input and on-chain state is its source of truth.
- Privy bounded delegation: policy (target allowlist, function restriction,
  per-transaction cap, rolling aggregation cap, expiry) evaluated at signing.
- A three-screen interface with Canvas curve previews and live status.

### Explicitly out of scope

- Custom user exponents, arbitrary curve DSLs, or user-authored bytecode.
- Multiple pairs, markets, or chains; mainnet deployment.
- Decentralized keeper networks (Chainlink Automation, Gelato) — documented as
  roadmap, not demo scope.
- Account-abstraction bundling (ZeroDev or similar) on top of Privy's native
  policy engine.
- Governance, protocol fees, staking, mobile clients, production admin.
- Superficial integrations added only to increase the number of sponsor logos.

## 4. Curve semantics and math

The normative specification is SPEC.md section 4; the summary every
contributor must internalize:

```text
progress(t) = t * 1e18 / duration                    NEUTRAL (exact linear TWAP)
progress(t) = (t / duration)^(1/2) * 1e18            AGGRESSIVE (sqrt)
progress(t) = (t / duration)^2 * 1e18                CONSERVATIVE
```

- Fixed-point 18 decimals; `1e18` represents 1.0. Boundary conditions are
  exact and unit-tested: `progress(0) = 0`, `progress(duration) = 1e18`.
- Terminal clamp: for `elapsed >= duration`, `authorizedCumulative` is set to
  `totalBudget` directly, bypassing the curve — the exact remainder becomes
  authorized so integer rounding can never strand dust.
- `fillAmount = min(authorizedNow, maxAmountIn)`; the keeper computes
  `authorizedNow` from the same formula in `shared/` and sends it as
  `maxAmountIn`.
- Price convention: tokenOut per one whole tokenIn, 18-decimal normalized:

```text
price = (amountOut * 10^(18 - decimalsOut) * 1e18) / (amountIn * 10^(18 - decimalsIn))
```

- Price impact (what "slippage" means here) is measured against a probe quote,
  never against a single pre-check quote (which would be zero by construction):

```text
priceImpactBps = ((referencePrice - executionPrice) / referencePrice) * 10000
```

  where `referencePrice` comes from a small probe amount and `executionPrice`
  from the actual `fillAmount`, both via `AquaSwapVMRouter.quote(...)` in the
  same transaction. Absolute bounds `[minPrice, maxPrice]` are checked on the
  execution price independently. Both checks apply; they are not redundant.

The TypeScript reference model in `shared/` implements the identical formulas
and is cross-validated against Solidity on committed vectors, including the
WETH(18)/USDC(6) asymmetric-decimals case.

## 5. Architecture

### Settlement layer

- `CurveMath`: progress fractions for the three shapes, checked fixed-point
  helpers, terminal clamp.
- `SlopePosition`: position storage (all Revision-2 fields), creation with
  approval-based custody, and the permissionless `AdaptiveExecute` instruction
  — load, schedule, dual-quote validation, pull-per-fill, Aqua settlement,
  events, completion.
- Official Aqua registry + AquaSwapVMRouter (tag `v1.0.2`, `via_ir`, cancun),
  self-deployed to Base Sepolia. Slope ships its own ungated WETH/USDC
  strategies (total shipped ≤ wallet balance; virtual balances are
  commitments, not escrow) and settles every fill through
  `router.swap(...)` — pull and push in one atomic call.

### Keeper service

- Polling loop over active positions; queries the Subgraph for candidate
  routes/prices; re-verifies state on-chain with the dual-quote check; sends
  `AdaptiveExecute(positionId, maxAmountIn)` via `eth_signTransaction` through
  `@privy-io/node` (policy and aggregation evaluated at signing) and
  self-broadcasts the raw transaction; logs executed/skipped with reasons and
  parks persistently failing positions. Execution is permissionless by design:
  if our keeper dies, anyone can advance open positions.

### Data layer

- Subgraph Studio deployment on Base Sepolia indexing `Position`, `Fill`, and
  `BenchmarkComparison` (as-of-last-fill snapshot computed in the mapping).
- The frontend computes the live planned-vs-actual curves from position
  parameters plus indexed fills; the keeper consumes the live index for
  discovery, then re-verifies on-chain before any send.

### Interface

Three screens — Create Order (Privy onboarding primary, curve preview,
approval + create + signer consent, advanced settings), Execution Progress
(planned vs. actual, fill table with explorer links, revoke), Performance
(benchmark overlay, position history). Dark theme, card layout, live
indicator, monospace numerics; raw parameters behind advanced disclosure. The
interface must prioritize the visual proof: fills landing exactly on the
previewed curve, and the honest benchmark verdict at completion.

## 6. Correctness gates

No milestone is complete until its tests pass. Required properties:

1. `progress(0) = 0` and `progress(duration) = 1e18` exactly, for all shapes.
2. Fuzz: progress is monotonically non-decreasing in elapsed time and always
   within `[0, 1e18]`.
3. Contract progress equals the TypeScript reference model on all committed
   vectors, including the WETH(18)/USDC(6) decimal-normalization case.
4. `fillAmount = min(authorizedNow, maxAmountIn)` with `authorizedNow =
   totalBudget * progress(elapsed) / 1e18 - executedAmount`; integer-division
   semantics are documented and directionally tested.
5. The terminal clamp authorizes the exact remainder; a settlement fill below
   `minFillAmount` succeeds after expiry; completion fires exactly once with
   `PositionCompleted`.
6. Price-impact and absolute-bounds skips return early with distinguishable
   events; zero hard reverts on any keeper-reachable path.
7. A failing `transferFrom` (insufficient balance or revoked approval) is a
   skip with its own event, and the keeper parks the position on persistence.
8. Invariant: `executedAmount <= totalBudget` under all fuzz schedules; no
   path executes more than the curve authorizes.
9. Permissionless equivalence: any caller produces the same state transition.
10. Integration tests show real Aqua settlements — official router events and
    real token transfers, not mocked success values.
11. Out-of-scope signer requests are rejected by Privy's policy evaluation;
    in-scope requests pass; revoke removes the delegated authority.
12. One command runs the full suite green from a fresh clone.

Test mix: Foundry unit + fuzz, differential vectors against `shared/`, and a
scripted Base Sepolia end-to-end run.

## 7. Sponsor strategy

The three partner selections are fixed: 1inch, The Graph, Privy. A fourth
integration would fragment implementation time without strengthening the core
proof.

### Primary: 1inch — Build an Aqua App

This is the architectural center, not an adapter. Slope turns each order into
a taker-side position settled through the official shared-liquidity layer —
self-deployed from the official source (explicitly permitted by the prize:
"redeployments of a modified SwapVM contract is allowed"). The demo must show
official contracts, real transfers, tests, and a credible commit history. The
stretch goal — a custom `_slopeXD` opcode ported from the unregistered `_twap`
instruction — is attempted only after the baseline demo is green, because the
prize scores modified opcodes higher and a broken core forfeits everything.
License discipline: pin tag `v1.0.2`; never vendor licensed source into this
repository; integrate via deployment and interfaces; see
[`RESEARCH-NOTES.md`](RESEARCH-NOTES.md).

### Second: The Graph — Best AI Tooling or AI Use Case (From Scratch)

Decision locked: the submission qualifies as an AI **use case** — the keeper
performs meaningful automated work over live subgraph data (route ranking by
marginal price, execution-window decisions, on-chain re-verification, skip
logic), and the dashboard derives benchmark comparisons from indexed fills.
No MCP server, no track switch. The subgraph is deployed to Subgraph Studio
and queried with an API key; mocked, local, or static data never appears on
the canonical demo path. The README states this qualification explicitly.

### Third: Privy — Best Financial Flow

Embedded-wallet onboarding (email/social, no seed phrase) is the primary
path — a hard track requirement. The live financial flow is the delegated
swap execution within policy bounds. Framing rules are locked: Privy enforces
the delegated signer's scope (allowlist, per-transaction cap, rolling cap,
expiry) at signing time; the contract enforces the budget. No claim that
Privy rate-limits execution in general — execution is permissionless by
design.

## 8. Time-boxed build order

`T0` is the start of protocol implementation (target: 6 September morning,
WIB). Work backward from the internal submission target — **12 September,
20:00 WIB** — with the hard deadline at 13 September, 23:00 WIB. The
dependency gates in [`IMPLEMENTATION_ORDER.md`](IMPLEMENTATION_ORDER.md) are
authoritative; time pressure never permits reordering a dependent phase.

| Window | Deliverable | Exit test |
| --- | --- | --- |
| T0 to T+6h | Monorepo scaffold; NEUTRAL curve kernel; boundary + fuzz tests | `forge test` green on boundary and monotonicity |
| T+6h to T+14h | `SlopePosition` storage, creation, pull-per-fill custody | Creation and event tests green |
| T+14h to T+24h | `AdaptiveExecute` full Revision-2 mechanics vs. mock adapters | Execution matrix green: skips, failures, completion |
| T+24h to T+30h | AGGRESSIVE/CONSERVATIVE + `shared/` reference model | Cross-validation vectors pass (WETH/USDC case) |
| T+30h to T+44h | Official Aqua deploy (v1.0.2) + strategy seeding + real quote/swap | Scripted on-chain fill settles on Base Sepolia |
| T+44h to T+56h | Privy onboarding, policy template, keeper sign + broadcast | Delegated fill executes with policy evaluation; revoke works |
| T+56h to T+68h | Subgraph mappings + Studio deployment | Live Studio query returns on-chain positions/fills |
| T+68h to T+78h | Keeper polling loop with route verification | A position completes autonomously end-to-end |
| T+78h to T+100h | Three frontend screens + Vercel | Full user flow works on the hosted public URL |
| T+100h to T+120h | Integration E2E, demo seeding, two rehearsal recordings | Demo runs twice without manual repair |
| T+120h to T+146h | Video, README final, FEEDBACK ×3, final rules audit, submission package | Compliance checklist fully green; dashboard submitted |
| T+146h onward | Untouched buffer | Nothing new ships |

Feature freeze begins four hours before the internal target. After freeze,
only blockers, documentation, rehearsal, and submission work are allowed.

## 9. Stop-loss rules

- If the custom `_slopeXD` opcode is blocked for more than 90 minutes, ship
  strategy composition against the official router (the baseline qualifies)
  and return to the opcode only after the demo is green.
- If the Base Sepolia self-deployment of Aqua is blocked for more than 90
  minutes, test against a Base mainnet fork while continuing deployment
  attempts — never mock settlement.
- If Privy aggregations are blocked for more than 60 minutes, keep the
  per-transaction cap and expiry (the contract enforces the budget anyway)
  and document the change.
- If Subgraph Studio deployment is blocked for more than 60 minutes, fix
  against the supported-network list — never serve indexed data from a local
  Graph Node on the canonical demo path.
- If keeper automation is not stable by demo time, fall back to a manual
  per-fill trigger, honestly labelled in the README.
- Never sacrifice: the test suite, real transfers, Privy onboarding, granular
  commit history, or the final submission buffer.

## 10. Commit sequence

Each commit must build and test independently and is pushed directly to
`main` as soon as its unit's gate passes. The unit-by-unit breakdown with
intended commit messages is authoritative in
[`IMPLEMENTATION_ORDER.md`](IMPLEMENTATION_ORDER.md); its high-level order is
Units 0–11: repository → scaffold → curve kernel → position storage →
execution engine → all shapes + reference model → Aqua integration → Privy →
subgraph → keeper → frontend → submission package.

## 11. Demo storyboard (2–4 minutes, rules-compliant)

Human narration only, recorded on a desktop, no speed-up, self-introduction
kept under 20 seconds:

| Time | What the audience sees |
| --- | --- |
| 0:00–0:20 | One sentence: a single large swap moves the price against you; Slope executes it along a curve you choose. |
| 0:20–1:00 | Create order: Privy email onboarding, pick a shape with the live curve preview, set bounds, submit — approval, creation, signer consent. |
| 1:00–2:20 | Execution progress: fills landing on the planned curve in real time; planned-vs-actual chart; fill table with Basescan links. |
| 2:20–3:10 | Completion and performance: the linear-TWAP benchmark verdict; the live Subgraph query behind it. |
| 3:10–3:50 | Architecture in one slide: official Aqua settlement, Privy-scoped keeper, The Graph indexing; a flash of the test suite. |
| 3:50–4:00 | Close on the shift: from one price moment to a bounded, verifiable execution policy. |

Pre-fund every wallet, pre-open every tab, keep explorer links ready, and
record a fallback run against the same deployed contracts. Never wait for a
faucet or an indexer on stage.

## 12. Submission checklist

- Public repository, meaningful granular history, no secrets, clean
  fresh-clone setup.
- Explicit license for original code (MIT) with the Aqua/SwapVM attribution
  preserved; third-party material linked, never vendored.
- Public HTTPS application; canonical demo path contains no localhost-only
  service.
- Exact deployed addresses, chain ID, transaction hashes, and contract links.
- One-command tests; no production-readiness claim; known-limitations section.
- Architecture diagram, curve equations, threat model, and skip-path map.
- Sponsor matrix mapping each prize requirement to files, lines, live
  evidence, and the matching video moment (in
  [`ETHGLOBAL_RULES_COMPLIANCE.md`](ETHGLOBAL_RULES_COMPLIANCE.md)).
- 1inch: official-contract evidence and on-chain token transfers.
- The Graph: live Studio endpoint, API-key queries, automation narrative.
- Privy: embedded-wallet flow evidence and delegated-execution evidence.
- FEEDBACK documents for all three partners.
- Two-to-four-minute submission video at ≥720p per the recording rules.
- No more than three partner organizations selected.
- AI-use disclosures and committed spec/prompt artifacts.
- Final smoke test in a second browser/wallet; submitted by the internal
  target with the hard deadline untouched.
