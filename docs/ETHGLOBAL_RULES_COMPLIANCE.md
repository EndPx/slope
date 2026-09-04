# ETHGlobal Online 2026 — Rules Compliance Audit

A page-by-page audit of Slope against the ETHOnline 2026 rules we commit to, plus the partner-prize eligibility matrix and the public-demo topology gate. Updated at every milestone; the final pass happens before submission (internal target: 12 September 2026, 20:00 WIB).

## 1. Track — Start Fresh (Classic)

| Requirement | Our compliance | Status |
|---|---|---|
| All project-specific code/design/assets created after hacking began (4 Sep 2026, 23:00 WIB) | Repository first commit: 5 Sep 2026. All project code originates in this repository after kickoff. | ✅ by construction |
| Public open-source libraries and starter kits allowed | Only public official sources are used: 1inch Aqua/SwapVM (deployed from their official repo, tag `v1.0.2`), Privy SDKs, The Graph tooling, Foundry, solmate/PRBMath. Each dependency lands in its own commit with the reason recorded. | ✅ maintained per commit |
| Reused vs. new code clearly separated | Third-party material is consumed as external dependencies or official deployments — never vendored — so the separation is visible in the dependency manifests and commit history. | ✅ maintained per commit |

## 2. Version control

| Requirement | Our compliance | Status |
|---|---|---|
| Granular commit history per feature/change | Commit discipline fixed in `IMPLEMENTATION_ORDER.md`: one logical change per commit, conventional prefixes. | ✅ in progress |
| No single "implement everything" commit | Enforced by the unit/gate structure — no unit may land as one blob. | ✅ enforced |
| History proves work happened during the hackathon | Every completed unit is pushed directly to `main` immediately; the public history on GitHub is the evidence. | ✅ in progress |

## 3. AI tools disclosure

| Requirement | Our compliance | Status |
|---|---|---|
| README explicitly documents where/how AI tools were used | README "AI-Assisted Development" section: creator-made architecture and decisions (see SPEC.md CHANGELOG + Decision Log with dates), AI-assisted implementation against the spec, creator review before commit. | ✅ in place, updated as work lands |
| All spec/prompt/planning artifacts committed (not gitignored) | `docs/spec/SPEC.md`, `docs/RESEARCH-NOTES.md`, `docs/HACKATHON_PLAN.md`, `docs/IMPLEMENTATION_ORDER.md`, this file committed; `prompts/` committed as material prompts are produced. | ✅ in progress |
| Meaningful human contribution (AI assists, does not author the project) | Every design decision in the Decision Log is creator-approved; implementation is reviewed and modified before commit. | ✅ maintained |

## 4. Demo video

| Requirement | Our compliance | Status |
|---|---|---|
| 2–4 minutes, minimum 720p | Recording checklist in `DEMO_VIDEO_SCRIPT.md` (added before recording); runtime rehearsed in M8. | ☐ M8–M9 |
| No speed-up, no AI voiceover / TTS, not recorded on a phone, no music+text without live narration | Hard rules carried into the recording script; screen recording + live human narration on a computer. | ☐ M9 |
| Self-introduction ≤ 20 seconds; focus on the project working | Script structure fixed at ≤ 20 s intro, remaining time on live execution. | ☐ M9 |

## 5. Partner prize eligibility (max 3 — our exact three)

### 1inch — Build an Aqua App

| Requirement | Our plan | Status |
|---|---|---|
| Official Aqua/SwapVM contracts used (modified redeployments allowed) | Official registry + router deployed from source tag `v1.0.2` to Base Sepolia. | ☐ M3 |
| Sophisticated DeFi position | Adaptive time-based execution curves over shared liquidity — a taker-side position category the settlement layer does not natively express. | ☐ M1–M3 |
| On-chain token transfers in the final demo | Real `transferFrom` pulls and Aqua `pull`/`push` settlements on Base Sepolia in the demo. | ☐ M6/M8 |
| Proper git history (no single-commit entries) | Covered by section 2. | ✅ in progress |

### Privy — Best Financial Flow

| Requirement | Our plan | Status |
|---|---|---|
| Privy as a core integration; create/use at least one Privy wallet | Embedded-wallet onboarding (email/social, no seed phrase) is the primary path in Screen 1. | ☐ M4 |
| At least one functional financial flow with a generally available feature (swaps qualify) | The delegated keeper executes real swaps within policy bounds — bounded delegation is the product's core mechanic. | ☐ M4 |
| Working demo + source code | Hosted public app + this repository. | ☐ M7 |
| README explains how Privy improves the UX | Wording rule locked in SPEC.md: Privy constrains the delegated signer (scope, caps, expiry); the contract enforces the budget — no overclaiming. | ☐ M9 |

### The Graph — Best AI Tooling or AI Use Case (From Scratch)

| Requirement | Our plan | Status |
|---|---|---|
| Consume live data from a Graph provider (Subgraph Studio query with API key); mocked/local/static data does not qualify | Subgraph deployed to Subgraph Studio on Base Sepolia; keeper and frontend query it live with an API key. No local Graph Node in the demo. | ☐ M5 |
| Meaningful work with the data (reasoning, decisions, automation — not printing raw query results) | The keeper is the automation: it ranks candidate routes by marginal price from subgraph data, re-verifies on-chain, decides execution windows, and skips on stale/off-bound prices; the dashboard derives planned-vs-actual and benchmark comparisons from indexed fills. | ☐ M6/M7 |
| Open source + README/SKILL.md describing the work | Repository public; README documents the data flow and the automation decisions. | ☐ M9 |

## 6. Submission logistics

| Item | Value | Status |
|---|---|---|
| Via Hacker Dashboard: title, description, repo link | Repo: this repository. | ☐ M9 |
| Max 3 partner prizes, each with integration explanation + feedback | Exactly: 1inch, Privy, The Graph; FEEDBACK documents per partner in M9. | ☐ M9 |
| Deadline | Hard: 13 Sep 2026, 23:00 WIB. Internal: 12 Sep 2026, 20:00 WIB. | ☐ |

## 7. Public-demo topology gate (zero localhost)

Everything a judge can click must be public:

- Frontend: Vercel HTTPS URL (not localhost, not a private IP)
- Subgraph: versioned Subgraph Studio query URL, queried with an API key server-side where required
- Chain: Base Sepolia public RPC + explorer links for every demo transaction
- `IMPLEMENTATION_STATUS.md` records exactly what is implemented vs. missing; the demo shows only what exists

Verified by a final pass in M9 from a clean browser profile.
