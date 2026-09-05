# Prompts — Material AI-Assisted Development Artifacts

Slope is built with a **spec-driven, AI-assisted workflow**. This folder contains the material prompts — the instructions that actually directed the architecture and design decisions — committed per the ETHGlobal transparency requirement, so a judge can see how the AI was directed, not only what it produced.

## How the workflow works

1. **The specification was written first.** The full handoff (hackathon rules, locked tech stack, product and protocol spec) was committed before any implementation code existed — see [`00-handoff-spec.md`](00-handoff-spec.md) and the normative [`docs/spec/SPEC.md`](../docs/spec/SPEC.md).
2. **Implementation is AI-assisted against that spec**, step by step, each step scoped explicitly (contracts → shapes → Aqua integration → Privy → subgraph → keeper → frontend) with hard rules: granular commits pushed to `main`, no scope drift, and *ask, don't guess* on ambiguities.
3. **Every output is reviewed by the project creator before it counts.** Reviews are not rubber stamps — they are the source of every material design change.
4. **Every review-produced design change is recorded as a numbered revision** in the SPEC.md CHANGELOG (Revision 1–3 to date), with rationale and date, and propagated to the affected documents and tests in the same change.

## Index (chronological)

| File | What it directed | Outcome |
| --- | --- | --- |
| [`00-handoff-spec.md`](00-handoff-spec.md) | Initial handoff: rules, locked stack, full product/protocol spec | SPEC.md committed before any code |
| [`01-review-position-mechanics.md`](01-review-position-mechanics.md) | Pre-implementation review of position mechanics | **REVISION 2**: pull-per-fill custody, `minFillAmount`, dual-quote price impact, decimal normalization, terminal clamp, permissionless execution |
| [`02-step1-contracts.md`](02-step1-contracts.md) | Step 1: monorepo, `CurveMath` (NEUTRAL), `SlopePosition`, reference model, full test suite | 47+ tests green, contracts + `shared/` committed |
| [`03-review-execution-mechanics.md`](03-review-execution-mechanics.md) | Two review rounds on the execution engine | **REVISION 3**: reachable terminal settlement, decimal-derived probe floor, `impactChecked` flag, `QUOTE_INVALID` split; open items OI-1/OI-2 registered |
| [`04-step2-shapes.md`](04-step2-shapes.md) | Step 2: AGGRESSIVE + CONSERVATIVE shapes | OZ `Math.sqrt` (pinned), exact-boundary tests, 96 cross-validation vectors |
| [`05-review-curve.md`](05-review-curve.md) | Curve review + non-NEUTRAL lifecycle coverage question | Distinct `UnsupportedShape` error, exact midpoint assertions, terminal lifecycle tests for all three shapes |
| [`06-step3-aqua.md`](06-step3-aqua.md) | Step 3: real Aqua deployment, seeding, OI closure, fork tests | Live deployment on Base Sepolia, real fills on-chain, OI-1/OI-2 verified and closed |
| [`07-review-deployment-forensics.md`](07-review-deployment-forensics.md) | Deployment forensics + manifest review | State cleanliness proven, natural mid-window fill executed on-chain, bytecode provenance documented, manifest symmetry/provenance fields |

Later steps (Privy, keeper, subgraph, frontend) append their prompts here as they happen — collected at the milestone, not reconstructed at submission time.

## Integrity note

These files are faithful reconstructions of the material instructions as issued by the project creator (session logistics removed; non-English instructions translated for reviewers). The normative text they point to lives in `docs/spec/SPEC.md` and `docs/PRODUCT_SPEC.md` — where a prompt and the spec disagree, the spec's CHANGELOG governs, because the spec records what was finally decided and why.
