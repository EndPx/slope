# Slope

Slope is a non-custodial execution product for takers: it splits one large token swap across **time** along a user-chosen execution curve — Aggressive, Neutral, or Conservative — instead of dumping the full size into a single swap or a naive linear TWAP. Positions are created from an embedded wallet in one flow, executed by a delegated keeper within Privy-policy bounds, settled through the official 1inch Aqua/SwapVM shared-liquidity layer, and audited against a verifiable linear-TWAP benchmark indexed by The Graph.

## Status

This repository was initialized from an empty GitHub repository on **5 September 2026**, during ETHGlobal Online. Work is spec-driven: the complete product and protocol specification was written and committed **before** implementation began, and every post-handoff design decision is recorded as a numbered, dated revision inside that document.

Currently committed:

- [`docs/spec/SPEC.md`](docs/spec/SPEC.md) — the complete product and protocol specification: hard hackathon rules, the locked tech stack, the detailed project spec (position mechanics, curve formulas, execution flow, subgraph schema, UI screens, testing standard, priority order), a numbered CHANGELOG (Revision 1: `maxAmountIn` on `AdaptiveExecute`; Revision 2: pull-per-fill custody, `minFillAmount`, dual-quote price impact, decimal normalization, terminal clamp, permissionless execution), a Decision Log, and verified implementation notes.
- [`docs/RESEARCH-NOTES.md`](docs/RESEARCH-NOTES.md) — our own conclusions from primary-source research (RPC-verified deployment facts, the official quote surface, policy-engine constraints, tooling limits), with links to official sources. Third-party documentation and whitepapers are deliberately **not** committed to this repository; we link instead.
- [`docs/HACKATHON_PLAN.md`](docs/HACKATHON_PLAN.md) — the mission, definition of success, frozen MVP scope, curve semantics summary, architecture, correctness gates, sponsor strategy, time-boxed build order, stop-loss rules, demo storyboard, and submission checklist.
- [`docs/IMPLEMENTATION_ORDER.md`](docs/IMPLEMENTATION_ORDER.md) — the dependency-ordered development sequence with per-unit exit gates, intended commit messages, and commit discipline.
- [`docs/ETHGLOBAL_RULES_COMPLIANCE.md`](docs/ETHGLOBAL_RULES_COMPLIANCE.md) — the page-by-page rules audit: Start Fresh compliance, version-control policy, AI-tools disclosure, demo-video rules, the partner-prize eligibility matrix (1inch / The Graph / Privy), and the public-demo topology gate.
- `.gitignore` — repository hygiene from the first commit.

Not yet implemented (the implementation order is fixed in SPEC.md, section 9): contracts, Privy integration, keeper service, subgraph, frontend, deployments, and the public demo. This Status section and the docs index below are updated as each piece lands.

## Live Demo

Will be linked here once deployed — application, subgraph, and hosted endpoints, public URLs only.

## Docs

- [`docs/spec/SPEC.md`](docs/spec/SPEC.md) — the normative specification (see its CHANGELOG and Decision Log for every design decision and its date).
- [`docs/RESEARCH-NOTES.md`](docs/RESEARCH-NOTES.md) — primary-source research conclusions and verification methods.
- [`docs/HACKATHON_PLAN.md`](docs/HACKATHON_PLAN.md) — mission, definition of success, frozen MVP scope, curve semantics, architecture, correctness gates, sponsor strategy, time-boxed build order, stop-loss rules, demo storyboard, and submission checklist.
- [`docs/IMPLEMENTATION_ORDER.md`](docs/IMPLEMENTATION_ORDER.md) — the dependency-ordered development sequence with per-unit exit gates and intended commit messages.
- [`docs/ETHGLOBAL_RULES_COMPLIANCE.md`](docs/ETHGLOBAL_RULES_COMPLIANCE.md) — the rules audit, partner-prize eligibility matrix, and public-demo topology gate.
- `docs/WIRE_FORMAT.md` — normative order/program encoding, event contract, units, and test vectors *(added with the Aqua integration milestone)*.
- `docs/DEPLOYMENT.md` — deployment/seed/verification runbook *(added with the deployment milestone)*.
- `docs/DEMO_VIDEO_SCRIPT.md` — the submission recording sequence *(added before recording)*.
- `prompts/` — the material AI-assisted specifications and prompts used during development *(committed as they are produced)*.

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
- **Privy** — embedded-wallet onboarding (email/social, no seed phrase) and bounded delegation: a scoped session signer whose policy (target allowlist, per-transaction cap, rolling spend limit, expiry) is evaluated by Privy's infrastructure at signing time.
- **The Graph** — a Subgraph Studio deployment on Base Sepolia indexing positions and fills; the keeper consumes this live, API-key-authenticated data to rank routes and decide execution windows, and the dashboard benchmarks realized execution against the linear-TWAP baseline.

## Security

This is hackathon software and is not production-ready or audited. Do not use it with assets of value.

## License And Attribution

Original Slope code is intended to be licensed under the MIT License; the LICENSE file is added with the first code commit. Files carrying a different SPDX identifier or their own license remain governed by those terms. Aqua and SwapVM are used under their own terms via the prize's explicit allowance for official-contract deployment.

**Powered by Aqua — © Degensoft Ltd 2025**

**Powered by SwapVM — © Degensoft Ltd 2025**

These are factual integration attributions and do not imply endorsement.
