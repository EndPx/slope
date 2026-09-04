# Implementation Order

Dependency-ordered development sequence with exit gates and intended commit granularity. Work proceeds strictly top-to-bottom; a unit is not started before the unit above it passes its gate. This expands SPEC.md section 9 into commit-sized units.

## Unit 0 — Repository initialization ✅

- `chore: add .gitignore`
- `docs: add product and protocol specification`
- `docs: add research notes from primary-source verification`
- `docs: add README`
- `docs: add hackathon plan, implementation order, rules compliance audit`

**Gate (passed):** public repository with granular history; spec committed before any implementation.

## Unit 1 — Monorepo scaffold

- pnpm workspace layout: `contracts/`, `frontend/`, `keeper/`, `subgraph/`, `shared/`
- Foundry project inside `contracts/` (solc 0.8.30, WSL2), `shared/` TypeScript package, root tooling scripts

Intended commits: `chore: scaffold pnpm monorepo`, `chore: add foundry workspace`

**Gate:** `pnpm install` and `forge build` both succeed on the target machines.

## Unit 2 — Curve kernel (NEUTRAL only)

- `CurveMath` library: `curveFunction(elapsed, duration, shape)` returning 1e18 fixed-point progress; NEUTRAL = `elapsed * 1e18 / duration`
- Unit tests: boundary conditions (elapsed=0 → 0; elapsed=duration → exactly 1e18)
- Fuzz tests: monotonically non-decreasing, always within [0, 1e18]

Intended commits: `feat(contracts): add NEUTRAL curve kernel`, `test(contracts): curve boundary and fuzz tests`

**Gate:** full curve test suite green.

## Unit 3 — SlopePosition: creation and storage

- Position struct with all Revision-2 fields (`decimalsIn`, `decimalsOut`, `minFillAmount` included), pull-per-fill custody model (no escrow), creation with events
- Unit tests for creation validation and event emission

Intended commits: `feat(contracts): SlopePosition storage and creation`, `test(contracts): creation paths`

**Gate:** creation tests green; struct matches SPEC.md section 3 exactly.

## Unit 4 — AdaptiveExecute (NEUTRAL, mock settlement)

- Full Revision-2 execution logic against interface-based mock quote/fill adapters: terminal clamp, minFillAmount bypass on final settlement, dual-quote price impact, absolute price bounds, pull-per-fill with skip-on-failure, completion/dust handling
- All skip paths return early with distinguishable events/errors — never hard-revert from keeper-triggered calls

Intended commits: `feat(contracts): adaptive execution engine`, `test(contracts): execution skip semantics`, `test(contracts): pull-per-fill failure handling`

**Gate:** execution test matrix green (execute, each skip reason, completion, settlement below minFillAmount).

## Unit 5 — AGGRESSIVE/CONSERVATIVE + reference model

- AGGRESSIVE exponent 0.5 via a battle-tested sqrt (solmate FixedPointMathLib or PRBMath — never hand-rolled); CONSERVATIVE exponent 2 via standard mul
- `shared/` TypeScript reference model with identical decimal-normalization formula; deterministic test vectors committed; cross-validation test (WETH(18)/USDC(6) asymmetric case)

Intended commits: `feat(contracts): aggressive and conservative curves`, `feat(shared): high-precision reference model`, `test: cross-validate contract curve against reference model`

**Gate:** contract and reference model agree on all committed vectors; fuzz invariants hold for all three shapes.

## Unit 6 — Aqua integration

- Deployment scripts for the official registry + router (tag `v1.0.2`, `via_ir`, cancun) to Base Sepolia
- Seed ungated WETH/USDC strategies (ship; total shipped ≤ wallet balance)
- Replace mock adapters with real `quote()` / `swap()` wiring; probe-quote + execution-quote impact check on-chain
- `WIRE_FORMAT.md`: order/program encoding, taker traits blob, event contract, units and byte offsets

Intended commits: `feat(contracts): deploy official aqua contracts to base sepolia`, `feat(contracts): settle fills through aqua router`, `docs: add wire format`

**Gate:** a scripted on-chain fill settles through the deployed router on Base Sepolia; quote/swap consistency verified.

## Unit 7 — Privy bounded delegation

- App authorization key (P-256) + 1-of-1 key quorum; policy template builder (target allowlist, function restriction, per-tx cap, aggregation rolling cap with headroom, expiry)
- Frontend: Privy embedded-wallet onboarding as the primary path; `addSigners` consent flow after order creation; revoke
- Keeper: `eth_signTransaction` via `@privy-io/node` + self-broadcast to RPC

Intended commits: `feat(keeper): privy session signer execution`, `feat(frontend): privy onboarding and signer consent`, `test(keeper): policy-scoped execution flow`

**Gate:** an end-to-end delegated fill executes on Base Sepolia with policy evaluation at signing; out-of-policy requests are rejected by Privy; revoke works.

## Unit 8 — Subgraph

- schema.graphql (Position, Fill, BenchmarkComparison as-of-last-fill snapshot), AssemblyScript mappings, Base Sepolia manifest
- Deploy to Subgraph Studio; pin the versioned query URL; API key for queries

Intended commits: `feat(subgraph): schema and mappings`, `feat(subgraph): studio deployment config`

**Gate:** live Studio query returns positions and fills created on-chain.

## Unit 9 — Keeper service

- Polling loop (configurable interval), subgraph route query, on-chain re-verification before send, execution with skip-reason logging, persistent-failure parking

Intended commits: `feat(keeper): polling loop with route verification`, `feat(keeper): skip-reason logging and position parking`

**Gate:** a position completes autonomously end-to-end (multiple fills, correct PositionCompleted).

## Unit 10 — Frontend

- Screen 1 Create Order (Privy onboarding primary, curve preview via Canvas, approval + create flow, advanced settings), Screen 2 Execution Progress (planned vs actual, fill table, revoke), Screen 3 Performance (benchmark overlay, history)
- Dark theme, card layout, live indicator, monospace numerics

Intended commits: `feat(frontend): create order screen`, `feat(frontend): execution progress screen`, `feat(frontend): performance dashboard`, `chore: vercel deployment`

**Gate:** full user flow works on the hosted public URL.

## Unit 11 — Submission package

- Demo seeding, `DEPLOYMENT.md` runbook, `IMPLEMENTATION_STATUS.md`, `DEMO_VIDEO_SCRIPT.md`, FEEDBACK documents (1inch, Privy, The Graph), final `ETHGLOBAL_RULES_COMPLIANCE.md` pass, README Status update

Intended commits: one per document, plus the final Status update.

**Gate:** submission checklist fully green; submitted by the internal target in `HACKATHON_PLAN.md`.

## Commit discipline

- Every unit lands as small, reviewable commits — one logical change each, conventional prefixes (`feat`, `test`, `docs`, `chore`, `fix`).
- Every completed unit is pushed directly to `main` immediately; no long-lived local branches.
- External dependencies are added in their own commits, so the history records when and why each tool was introduced.
