# Slope

Slope is a non-custodial execution product for takers: it splits one large token swap across **time** along a user-chosen execution curve — Aggressive, Neutral, or Conservative — instead of dumping the full size into a single swap or a naive linear TWAP. Positions are created from an embedded wallet in one flow, executed by a delegated keeper within Privy-policy bounds, settled through the official 1inch Aqua/SwapVM shared-liquidity layer, and audited against a verifiable linear-TWAP benchmark indexed by The Graph.

## Status

This repository was initialized from an empty GitHub repository on **5 September 2026**, during ETHGlobal Online. Work is spec-driven: the complete product and protocol specification was written and committed **before** implementation began, and every post-handoff design decision is recorded as a numbered, dated revision inside that document.

### Implemented — core contracts are live on Base Sepolia

- **`SlopePosition` deployed and source-verified**: [`0xC7c6FaD1C2A0e8961E34D40c39C059ECE6dBB8Cc`](https://sepolia.basescan.org/address/0xC7c6FaD1C2A0e8961E34D40c39C059ECE6dBB8Cc#code) (deployment block `46418713`, the subgraph's future `startBlock`).
- **Official 1inch Aqua infrastructure self-deployed from the pinned `v1.0.2` sources** (prize-permitted redeployment) and source-verified: registry [`0xd2A8…64DA`](https://sepolia.basescan.org/address/0xd2A8f6D7645F53aB23dC3EcB146a196026F964DA#code), SwapVM router [`0x054F…7DA2`](https://sepolia.basescan.org/address/0x054F6A7CE03fdEB7814977B0FE7017cc5B2d7DA2#code); demo pair dETH (18 dec) / dUSD (6 dec).
- **Real on-chain fills through the official router**: a full position settlement of **10 dETH → 29,702.97 dUSD** — tx [`0x3ca31dd7…b28c70`](https://sepolia.basescan.org/tx/0x3ca31dd7488ad4303a5822bed5c085a95dc8b71c329336e72528421430b28c70) — and a natural **mid-window partial fill** (0.5 dETH → 1,469.72 dUSD, position still active): tx [`0xf46ae64d…555a6`](https://sepolia.basescan.org/tx/0xf46ae64daeeca8a51e98ebbdad4e1b63832cc87e12ca2122cca92684c4c555a6). Every fill is guarded by the curve schedule, dual-quote price impact, absolute bounds, and pull-per-fill custody.
- **Tests**: 67 Foundry tests green (curve boundaries exact to the wei, monotonicity/range fuzz across all three shapes, full skip matrix, lifecycle completion, base-mainnet fork validation against the official router) plus 18 TypeScript reference-model tests, with 96 committed cross-validation vectors matching Solidity bit-for-bit.
- Addresses, deployment transaction hashes, source provenance, and the runbook: [`deployments/base-sepolia.json`](contracts/deployments/base-sepolia.json) + [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### Implemented — delegated execution is live (Privy + keeper)

- **Privy embedded-wallet onboarding + bounded delegation**: a user onboards with email (no seed phrase), creates a position in one flow, and delegates execution with explicit frontend consent. Each position gets its own P-256 authorization key registered as a 1-of-1 key quorum — per-position key isolation.
- **Scope enforced by Privy at signing time**: one per-position policy allows exactly one thing — `adaptiveExecute` calls to the `SlopePosition` contract, bound to that signer's **own** `positionId`, with a per-transaction input cap and an expiry. Everything else the wallet could do is implicitly denied. Budget and schedule are enforced by the contract itself: the delegated signer can only ever tighten what the curve authorizes, never exceed it (`executedAmount <= totalBudget` is the on-chain invariant).
- **Keeper service**: reads positions on-chain, recomputes the curve-authorized increment from the shared reference model, requests the signature through Privy, and self-broadcasts the raw transaction. Deterministic failures (policy denials, authorization-signature failures, skipped fills) park the position on the first occurrence instead of retrying.
- **Indexed by The Graph on Subgraph Studio** (Base Sepolia, `startBlock 46418713`): positions, fills (with the `impactChecked` flag), skips with reasons, and the as-of-last-fill linear-TWAP benchmark snapshot computed in the mapping. Versioned query endpoint pinned in [`docs/SUBGRAPH.md`](docs/SUBGRAPH.md). Verified live: position #10 fully settled through **57 delegated fills** and indexed with benchmark `+33.62 bps` versus linear TWAP at the same observed prices.
- **Live end-to-end proof**: position **#8 fully settled through the delegated path** (three on-chain fills, `PositionCompleted` emitted, the session key's aggregation window recycled afterwards), position **#10 filling through the same path**, and a `TRANSFER_FAILED` skip parking the keeper with an actionable owner-side message — the skip-not-revert design holding up live.

Currently committed docs:

- [`docs/spec/SPEC.md`](docs/spec/SPEC.md) — the complete product and protocol specification: hard hackathon rules, the locked tech stack, the detailed project spec (position mechanics, curve formulas, execution flow, subgraph schema, UI screens, testing standard, priority order), a numbered CHANGELOG (Revision 1: `maxAmountIn` on `AdaptiveExecute`; Revision 2: pull-per-fill custody, `minFillAmount`, dual-quote price impact, decimal normalization, terminal clamp, permissionless execution), a Decision Log, and verified implementation notes.
- [`docs/RESEARCH-NOTES.md`](docs/RESEARCH-NOTES.md) — our own conclusions from primary-source research (RPC-verified deployment facts, the official quote surface, policy-engine constraints, tooling limits), with links to official sources. Third-party documentation and whitepapers are deliberately **not** committed to this repository; we link instead.
- [`docs/HACKATHON_PLAN.md`](docs/HACKATHON_PLAN.md) — the mission, definition of success, frozen MVP scope, curve semantics summary, architecture, correctness gates, sponsor strategy, time-boxed build order, stop-loss rules, demo storyboard, and submission checklist.
- [`docs/IMPLEMENTATION_ORDER.md`](docs/IMPLEMENTATION_ORDER.md) — the dependency-ordered development sequence with per-unit exit gates, intended commit messages, and commit discipline.
- [`docs/ETHGLOBAL_RULES_COMPLIANCE.md`](docs/ETHGLOBAL_RULES_COMPLIANCE.md) — the page-by-page rules audit: Start Fresh compliance, version-control policy, AI-tools disclosure, demo-video rules, the partner-prize eligibility matrix (1inch / The Graph / Privy), and the public-demo topology gate.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the normative end-to-end implementation map: product boundary, system map, sources of truth, on-chain/TypeScript/service bricks, the 1inch integration surface, The Graph read path, end-to-end flows, security and verification bricks, deployment operations, sponsor mapping, and the MVP definition of done.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — the live deployment record: Base Sepolia addresses with deployment transaction hashes, source provenance (pinned submodules and package versions), bytecode verification evidence, the stage-by-stage runbook, and the on-chain fill evidence.
- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — the product-facing protocol specification: schedule family, authorization semantics, custody model, impact measurement, execution flow, lifecycle, delegated authority, benchmark, modules, and the demo definition of done.
- [`docs/MATH_SPEC.md`](docs/MATH_SPEC.md) — the normative mathematical kernel: units, the integer arithmetic contract, the progress schedule with exactness proofs, authorized amounts, price normalization and dual-quote impact, benchmark definitions, reference-model parity, numerical safety, and required mathematical tests.
- `.gitignore` — repository hygiene from the first commit.

Not yet implemented (the implementation order is fixed in SPEC.md, section 9): the full three-screen **frontend** experience and the hosted **public demo**. This Status section and the docs index below are updated at major milestones.

## Live Demo

Will be linked here once deployed — application, subgraph, and hosted endpoints, public URLs only.

## Docs

- [`docs/spec/SPEC.md`](docs/spec/SPEC.md) — the normative specification (see its CHANGELOG and Decision Log for every design decision and its date).
- [`docs/RESEARCH-NOTES.md`](docs/RESEARCH-NOTES.md) — primary-source research conclusions and verification methods.
- [`docs/HACKATHON_PLAN.md`](docs/HACKATHON_PLAN.md) — mission, definition of success, frozen MVP scope, curve semantics, architecture, correctness gates, sponsor strategy, time-boxed build order, stop-loss rules, demo storyboard, and submission checklist.
- [`docs/IMPLEMENTATION_ORDER.md`](docs/IMPLEMENTATION_ORDER.md) — the dependency-ordered development sequence with per-unit exit gates and intended commit messages.
- [`docs/ETHGLOBAL_RULES_COMPLIANCE.md`](docs/ETHGLOBAL_RULES_COMPLIANCE.md) — the rules audit, partner-prize eligibility matrix, and public-demo topology gate.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the normative end-to-end implementation map (bricks, sources of truth, flows, security, definition of done).
- `docs/WIRE_FORMAT.md` — normative order/program encoding, event contract, units, and test vectors *(added with the Aqua integration milestone)*.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — the deployment/seed/verification runbook with the live addresses, provenance, and on-chain evidence.
- `docs/DEMO_VIDEO_SCRIPT.md` — the submission recording sequence *(added before recording)*.
- [`prompts/`](prompts/README.md) — the material AI-assisted specifications and prompts: the initial handoff, each implementation-step directive, and every human review that produced a numbered design revision — committed chronologically per the ETHGlobal transparency requirement.
- [`FEEDBACK-PRIVY.md`](FEEDBACK-PRIVY.md) — our builder feedback for the Privy track, from deep production usage of conditional signers, key quorums, and the policy engine during this hackathon.

## Planned Workspace

```
contracts/   Foundry workspace for the SlopePosition contract and tests
frontend/    React + Vite + TypeScript application
keeper/      Node.js + TypeScript execution service
subgraph/    The Graph indexing (AssemblyScript mappings + schema.graphql)
shared/      TypeScript types and the high-precision curve reference model shared across packages
docs/        Specifications, deployment runbooks, and research notes
prompts/     AI-assisted development artifacts (spec-driven development)
```

## Prerequisites (target stack)

- Node.js 22+
- pnpm 10+
- Foundry 1.8.1 (on Windows hosts, runs inside WSL2)
- Solidity 0.8.30 (installed automatically by Foundry)

## AI-Assisted Development

This project is built spec-driven with AI assistance, per the ETHGlobal Online rules:

- The architecture, product decisions, and every material design decision were made by the project creator and are recorded — with dates and rationale — in the SPEC.md CHANGELOG and Decision Log.
- Implementation is AI-assisted against that specification; the material prompts and planning artifacts are committed under `prompts/` and `docs/spec/` rather than hidden.
- All AI-assisted output is reviewed and modified by the project creator before it is committed.

## Partner Integrations

- **1inch Aqua / SwapVM** — settlement of every fill through the official shared-liquidity layer and its bytecode strategy engine. Slope self-deploys the official contracts (tag `v1.0.2`) to Base Sepolia, a redeployment path the prize explicitly allows, and settles through it on-chain.
- **Privy** — embedded-wallet onboarding (email/social, no seed phrase) and bounded delegation: a scoped per-position session signer whose policy — target-contract allowlist, the single permitted function, binding to the signer's own `positionId`, a per-transaction input cap, and an expiry — is evaluated by Privy's infrastructure at signing time. Privy enforces the **scope** of delegated authority; the **budget and schedule** are enforced by the contract (the `executedAmount <= totalBudget` invariant and the curve), so delegation can only tighten, never loosen, what the position allows.
- **The Graph** — a Subgraph Studio deployment on Base Sepolia indexing positions and fills; the keeper consumes this live, API-key-authenticated data to rank routes and decide execution windows, and the dashboard benchmarks realized execution against the linear-TWAP baseline.

## Security

This is hackathon software and is not production-ready or audited. Do not use it with assets of value.

## License And Attribution

Original Slope code is intended to be licensed under the MIT License; the LICENSE file is added with the first code commit. A `LICENSES/` directory preserves the full Aqua-Source-1.1 and SwapVM-1.1 license texts and the upstream third-party notices verbatim; components derived from Aqua/SwapVM (such as a modified router) remain governed by those licenses, while independent Slope code that merely calls or interfaces with them stays under MIT. Aqua and SwapVM are deployed from their official source per the 1inch prize's explicit allowance.

**Powered by Aqua — © Degensoft Ltd 2025**

**Powered by SwapVM — © Degensoft Ltd 2025**

These are factual integration attributions and do not imply endorsement.
