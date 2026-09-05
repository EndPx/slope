# 00 — Initial Handoff: Hackathon Rules, Locked Stack, Product & Protocol Spec

Issued before any code existed. The full normative text is preserved in [`docs/spec/SPEC.md`](../docs/spec/SPEC.md); this file records the material directives as issued.

## Part 1 — Hackathon rules (hard constraints)

- **Timeline**: hacking began Friday 4 September 2026, 23:00 WIB; submission deadline Sunday 13 September 2026, 23:00 WIB (12:00 PM EDT, hard). Judging is two rounds — async screening (top 20% advance) then live judging; partner prizes are NOT affected by round 1.
- **Track**: Start Fresh (Classic) — all project-specific code/design/assets must be created after kickoff. Public starter kits and libraries allowed.
- **Version control**: git with granular commits per feature. A single "implement everything" commit or incomplete history risks disqualification.
- **AI tools**: allowed, but the README must explicitly document where and how they were used; all spec files, prompts, and planning artifacts must be committed, not gitignored; fully-AI-generated submissions without meaningful human contribution are ineligible for prizes.
- **Submission**: via Hacker Dashboard; demo video 2–4 minutes, ≥720p; no speed-up, no AI voiceover, no phone recording, no music+text without live narration; self-intro ≤ 20 seconds.
- **Partner prizes**: max 3 — chosen: 1inch (Build an Aqua App), Privy (Best Financial Flow), The Graph (Best AI Tooling or AI Use Case — From Scratch). Each requires an integration explanation plus feedback.
- **Judging criteria**: Technicality, Originality, Practicality, Usability (UI/UX/DX), WOW Factor. Live final: 4-minute demo + 3-minute Q&A.

## Part 2 — Tech stack (locked)

Solidity 0.8.30 + Foundry; React + Vite + TypeScript + viem + Tailwind (SPA, not Next.js); keeper in Node.js + TypeScript with `@privy-io/node` (not Go); subgraph mappings in AssemblyScript; pnpm monorepo with `contracts/`, `frontend/`, `keeper/`, `subgraph/`, `shared/`; native Canvas API for curve charts (not Chart.js/Recharts); Vercel for frontend; Base Sepolia target.

## Part 3 — Product spec (directives that shaped the build)

1. **Mandatory reading before coding**: the SwapVM and Aqua whitepapers, the official contract repos and TS SDK, the Privy docs index (policy engine, session signers), The Graph subgraph docs, Base RPC/faucet docs, Foundry book. Gaps in information are questions for the creator, never guesses.
2. **Privy track**: Best Financial Flow — embedded-wallet onboarding (email/social, no seed phrase) is mandatory and primary; at least one GA financial flow (our swaps); policy engine used NATIVELY (policies/rules/conditions at signer level), no smart-account abstraction for the MVP; the Solidity contract must re-validate bounds regardless (defense-in-depth).
3. **Contract**: `SlopePosition` storing owner, tokenIn/Out, totalBudget, executedAmount, startTimestamp, duration, curveShape (AGGRESSIVE/NEUTRAL/CONSERVATIVE), minPrice/maxPrice (1e18 fixed point), maxSlippageBps (default 500), isActive. `AdaptiveExecute` computes the authorized cumulative amount from the curve, reads price from Aqua's official quote surface, skips (not reverts) on out-of-bounds conditions, settles exact-input through Aqua, emits `FillExecuted`/`PositionCompleted`.
4. **Curve formula pinned**: NEUTRAL = exact linear TWAP (`elapsed × 1e18 / duration`); AGGRESSIVE = exponent 0.5 (use a battle-tested sqrt, never hand-rolled); CONSERVATIVE = exponent 2. Boundary obligations: `progress(0) = 0`, `progress(duration) = 1e18` exactly, unit-tested. Independent TypeScript reference model cross-validates Solidity.
5. **Keeper flow**: polling loop queries the subgraph, re-verifies on-chain via the official quote surface, triggers execution through a Privy session signer; the contract, not the keeper, decides.
6. **Subgraph**: Position, Fill, BenchmarkComparison (vs linear TWAP) entities, deployed to Subgraph Studio (live data only — mocked datasets void the prize).
7. **UI**: three screens (Create Order with Privy onboarding primary, Execution Progress, Performance dashboard), dark theme, Canvas curves, monospace numerics.
8. **Testing standard**: unit + fuzz + integration + independent reference model; skip semantics must never hard-revert keeper paths.
9. **Priority order for 9 days**: NEUTRAL first → other shapes → Aqua integration → Privy → subgraph → keeper → frontend → video/docs. Explicit cut list and never-cut list (tests, Privy onboarding, granular history, AI disclosure are non-negotiable).
10. **Honest demo estimates**: improvement vs naive TWAP is a few percent (3–8%), never dramatic numbers; contracts genuinely deployed (accelerated durations are fine, fakes are not).

## Working instructions to the AI tool

Build in the stated priority order with the locked stack; confirm any significant architectural decision outside the spec with the creator first; commit granularly per completed unit; on ambiguity, ask rather than guess.
