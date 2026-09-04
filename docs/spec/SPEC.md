# Slope — ETHOnline2026 Submission Spec

> **DOCUMENT NOTE**: This is the canonical spec for Slope. The body below is the original handoff, preserved as written; every decision made after the handoff is recorded as a numbered REVISION (marked inline with `[REVISION n]` at the point of change) and summarized in the **CHANGELOG** below. All locked design decisions are recorded in the **APPENDIX: DECISION LOG** at the end of this document. All submission artifacts (this spec, README, FEEDBACK files, public code comments) are written in English.

## CHANGELOG

### REVISION 2 — 2026-09-05: Position mechanics — gaps closed before step 1
Six issues found in the Position struct and AdaptiveExecute logic. Items 1, 2, 3 and 5 are BLOCKING for step 1 (contract + test suite); item 4 blocks once Aqua integration starts; item 6 must be decided before the keeper is built; item 7 is non-blocking.

1. **Token custody model — DECIDED: pull-per-fill, NOT escrow.** At Create Order the user grants an ERC20 approval to SlopePosition for at least totalBudget (additional transaction in the Create Order flow, or combined via permit if the token supports it). On each fill the contract pulls exactly fillAmount from the owner's wallet via transferFrom at execution time. The contract NEVER holds user funds between fills — no escrow balance, no refund path; cancelling just sets isActive = false and the user's tokens were never moved. This makes the non-custodial claim literally true and matches the Privy bounded-delegation mental model. Do NOT switch to escrow without confirmation — it would make the product custodial and require a refund path that does not exist in the spec. transferFrom failure at fill time (insufficient balance, revoked approval) MUST be treated as a skip (return-early pattern, never a hard revert) with a distinguishable event/custom error so the keeper can log the reason and stop retrying a persistently failing position. Unit tests required for both failure cases.
2. **Minimum fill size — new struct field `minFillAmount` (uint256).** With short polling intervals, authorizedNow (the curve delta since the last fill) authorizes tiny amounts → dozens of micro-fills whose gas cost exceeds the slippage savings, and it burns Privy aggregation headroom unnecessarily (REVISION 1 Caveat 1). In AdaptiveExecute, after fillAmount = min(authorizedNow, maxAmountIn): return early without executing if fillAmount < minFillAmount, UNLESS this is the final settlement case (item 5), where the remainder must be allowed through even below the minimum. MVP default: a percentage of totalBudget (1–5%) computed at creation, exposed in Screen 1 as an advanced setting with a sane default; document the chosen default and reasoning in the README.
3. **Slippage reference price — defined explicitly as PRICE IMPACT from dual quotes.** A single quote taken just before the check makes "slippage" zero by construction — the check would look like it works while checking nothing. Definition: reference quote = `quote(...)` for a very small probe amount (e.g. 0.1% of fillAmount or a fixed small notional) approximating the marginal/spot price; execution quote = `quote(...)` for the actual fillAmount; both are static calls against the same router in the same transaction, so they are consistent with each other. priceImpactBps = ((referencePrice - executionPrice) / referencePrice) * 10000. Skip the fill if priceImpactBps > maxSlippageBps. The [minPrice, maxPrice] bounds check uses the execution quote's resulting price directly (absolute bounds) — a different check, both must be applied; they are not redundant. Document this definition in the README and code comments — judges may ask what slippage is measured against.
4. **Decimal normalization — price convention defined once, mirrored exactly.** Price is tokenOut per 1 whole tokenIn, normalized to 18 decimals: price = (amountOut * 10^(18 - decimalsOut) * 1e18) / (amountIn * 10^(18 - decimalsIn)). Store decimalsIn/decimalsOut (uint8) in the Position struct at creation (read once via IERC20Metadata) rather than per fill. The TypeScript reference model must use the identical formula; a test must assert contract and model agree on a WETH(18)/USDC(6)-shaped asymmetric-decimals case — mismatched normalizations would produce false cross-validation failures.
5. **Dust residual — position may never close.** Integer division means accumulated executedAmount can stop a few wei short of totalBudget and `executedAmount >= totalBudget` never fires. Fixes: (a) terminal clamp — if elapsed >= duration, set authorizedCumulative = totalBudget directly, bypassing the curve formula, guaranteeing the final fill authorizes the exact remainder; (b) dust threshold on close — treat the position as complete if totalBudget - executedAmount <= dustThreshold (small constant; zero is acceptable once the terminal clamp is in place). The final settlement fill MUST bypass the minFillAmount check (item 2), otherwise a remainder below the minimum would hang the position forever. Explicit unit tests: full lifecycle reaching exactly totalBudget with isActive flipping to false; remainder smaller than minFillAmount still settling.
6. **Access control on AdaptiveExecute — DECIDED: permissionless (adopting the creator's recommendation; can be vetoed).** Anyone may trigger fills. Rationale: the contract is authoritative on every constraint that matters (curve schedule, price bounds, price impact, budget), and liveness beats restricting who can pay gas to trigger. Consequence: the Privy policy and aggregation constrain ONLY our delegated keeper signer, not other callers — the README must NOT claim Privy rate-limits execution overall, only that it constrains the delegated signer. State this plainly in the README as a design choice.
7. **Non-blocking note:** the generic positioning in section 10 stays in this spec; concrete competitive research is kept in separate internal pitch-preparation notes (not in this spec).

**Struct changes:** add `minFillAmount` (uint256), `decimalsIn` (uint8), `decimalsOut` (uint8). No escrow balance field — pull-per-fill means the contract never holds funds.

### REVISION 1 — 2026-09-05: `maxAmountIn` on AdaptiveExecute (DECISION: Option 1)
**What changed**: The `AdaptiveExecute` signature changed from the original spec. Original spec (Section 3): "The AdaptiveExecute instruction (execution function) accepts positionId as its parameter." Revised:

```solidity
AdaptiveExecute(uint256 positionId, uint256 maxAmountIn)
```

**Section 3 step 4 is revised**: after computing `authorizedNow = authorizedCumulative - executedAmount`, the amount actually executed is `fillAmount = min(authorizedNow, maxAmountIn)`. If `fillAmount <= 0`, return early without doing anything. All remaining steps (price validation, slippage, execution via Aqua, executedAmount update, event emission) stay the same, using `fillAmount` instead of `authorizedNow`.

**Keeper behavior (Section 5)**: the keeper computes `authorizedNow` itself using the curve formula from the `shared/` package and sends it as `maxAmountIn`. Because both sides use the same formula, the keeper's value and the contract's value should be identical under normal conditions — `min()` is only a safety net for divergence caused by block-timestamp differences between when the keeper computed the value and when the transaction lands in a block.

**Rationale** (not just about the Privy integration):
1. It makes the keeper's intent explicit in calldata, so it can be audited directly from a block explorer without re-simulating the curve formula.
2. It is an additional guard against keeper bugs: the contract executes `min(authorizedNow, maxAmountIn)`, so the keeper can never force a fill larger than the curve allows, and if the keeper miscalculates too high, the contract still holds execution at the curve boundary. The contract remains authoritative under all conditions.

**Caveat 1 — Skipped fills still count against the Privy aggregation.** The Privy aggregation is updated after a request is successfully signed (not after on-chain execution succeeds), so a transaction that the contract skips (e.g. slippage out of bounds at block inclusion) STILL consumes aggregation headroom equal to `maxAmountIn` even though zero tokens left the wallet. Mandatory mitigations:
1. The keeper MUST run an off-chain slippage pre-check before sending (already part of the Section 5 flow) — with a correct pre-check, contract-level skips should be rare (state changing between pre-check and block inclusion), not the normal case.
2. Configure the aggregation cap with headroom above `totalBudget`, not at exactly the same number.
3. If testing shows skips happening frequently, that is a signal the keeper's pre-check logic is too loose — fix the pre-check logic; do NOT solve it by repeatedly raising the cap.

**Caveat 2 — The 72-hour maximum rolling window is not budget enforcement.** What enforces the total budget is the Solidity contract via the invariant `executedAmount <= totalBudget` (authoritative, independent of any external infrastructure). The Privy aggregation is a rate limit and blast-radius control in case the keeper is compromised. Do NOT write in the README or pitch materials that the Privy aggregation enforces the budget — that claim is inaccurate and easily dismantled by attentive judges. Correct framing: the contract enforces the budget; Privy enforces rate limits and scope (target allowlist, allowed function, per-transaction cap, expiry). For this hackathon demo this is a non-issue because order durations are accelerated to minutes. For production, the 72-hour window limitation goes into the roadmap notes in the README.

---

## PART 1 — ETHONLINE2026 RULES (MUST BE FOLLOWED)

### Timeline
- Hacking Begins: Friday, September 4, 2026, 23:00 WIB
- Submission Deadline: Sunday, September 13, 2026, 12:00 PM EDT = 23:00 WIB (HARD DEADLINE, late submissions are not accepted)
- Effective window: about 9 days
- Judging: two rounds. Round 1 async (screening, only top 20% advance to live judging). Round 2 live judging directly with judges. Partner prizes are NOT affected by round 1 — the majority of partner prizes are awarded to projects that do not even make live judging.

### Track: Start Fresh (Classic)
- All project-specific code/design/assets MUST be started after hacking officially begins (September 4, 23:00 WIB). Open-source libraries and public starter kits are allowed. Code written before kickoff does NOT qualify for partner prizes or Finalist.

### Version Control — MUST BE OBSERVED
- Use git with granular commit history per feature/change.
- FORBIDDEN: a single large commit at the end containing "implement everything", or missing/incomplete commit history. This can lead to disqualification.
- Commit progressively throughout development, not piled up at the end.

### AI Tool Usage — MUST BE DOCUMENTED
- Claude Code, ZCode, GLM, Cursor, Copilot, etc. are allowed.
- The README must explicitly explain where and how AI tools were used (which files/sections of code/assets were generated or AI-assisted).
- AI must assist the development process, NOT build the entire project without meaningful human contribution. Submissions that rely entirely on AI without meaningful team contribution may be ineligible for partner prizes or Finalist.
- If spec-driven development is used (like this handoff document), ALL spec files, prompts, and planning artifacts MUST be included in the submission repository — not hidden or gitignored. Judges need to see how the AI was directed, not just the final result.
- Recommended safe framing for the README: explain that the architecture and core technical decisions were designed by the project creator, implementation was AI-assisted based on the prepared spec, and the result was reviewed and modified by the project creator.

### Submission Requirements
- Submit via the Hacker Dashboard: project title, description, repository link.
- Demo video is mandatory, 2-4 minutes, minimum 720p resolution (upload fails automatically below that or above 4 minutes).
- Hard rules for the demo video: DO NOT speed up the video to fit the duration. DO NOT use AI voiceover or text-to-speech. DO NOT record with a phone. DO NOT use music+text without speaking directly. Self-introduction maximum 20 seconds, focus on showing the project working.
- The repository (GitHub) must prove the work was done during the hackathon, with a clear separation between what is new and what is reused from starter kits/libraries.

### Partner Prizes — Maximum 3
- In the final step of the submission form, select a maximum of 3 Partner Prizes to apply for.
- If one partner has multiple tracks, all tracks from that partner count as 1 Partner Prize slot.
- For each partner prize, you must explain how their tool was integrated/used, plus feedback.
- Final choices for Slope: 1inch (Build an Aqua App), Privy (Best Financial Flow), The Graph (Best AI Tooling or AI Use Case — From Scratch).

### Judging Criteria (5 categories)
1. Technicality — how complex is the problem solved, how sophisticated is the solution
2. Originality — does the project introduce a new idea or solve an old problem creatively
3. Practicality — how complete and functional is the project, can the target audience use it today
4. Usability (UI/UX/DX) — how intuitive and easy to use
5. WOW Factor — the lasting impression, something unique/impressive beyond the other 4 categories

### Live Presentation (if advancing to Finalist judging)
- 7 minutes total: 4 minutes demo, 3 minutes Q&A.
- Common questions to prepare: what inspired this project, what tools were used and why, what challenges were solved and how.

---

## PART 2 — TECH STACK (LOCKED)

| Layer | Technology | Notes |
|---|---|---|
| Smart Contracts | Solidity 0.8.30, Foundry | Build/test/deploy/fuzz framework |
| Frontend | React + Vite + TypeScript, viem, Tailwind CSS | Vite chosen over Next.js because this app is a SPA with lots of client-side real-time state (not a use case that needs SSR). viem chosen over ethers — more modern and TypeScript-native |
| Backend/Keeper Service | Node.js + TypeScript, viem, `@privy-io/node` | Language chosen to match the frontend (TypeScript) for consistency and to allow sharing types via the `shared/` package in the monorepo. DO NOT use Go — the Privy Go SDK is still at version 0.1.0 (initial release), risking feature gaps or unflagged bugs; the Node SDK is far more mature |
| Subgraph | AssemblyScript | MANDATORY, this is The Graph's own technical requirement for mapping logic, cannot be replaced with another language |
| Package manager | pnpm | Standard for modern TypeScript monorepos |
| Curve charting | Native Canvas API | NOT Chart.js/Recharts — chosen for smooth curved lines with gradient fills and full rendering control |
| Frontend hosting | Vercel | |
| Backend/keeper hosting | Own VPS or Railway/Render | Separate process from the frontend, runs as a polling loop |

Repo structure (monorepo): one repository with separate folders — `contracts/` (Foundry project), `frontend/` (Vite app), `keeper/` (Node.js service), `subgraph/` (AssemblyScript mappings + schema.graphql), `shared/` (TypeScript types shared between frontend and keeper).

---

## PART 3 — PROJECT SPEC: SLOPE (DETAILED)

### 0. MANDATORY READING BEFORE WRITING ANY CODE — SOURCE LIST

Before writing a single line of code, study the following documentation in order. Do not assume APIs/data structures not explained here — if there is an information gap, ask the project creator instead of guessing.

1. SwapVM whitepaper (opcode/instruction mechanism) — https://github.com/1inch/swap-vm/blob/release/1.1/docs/whitepaper-swap-vm-1.0.pdf
2. Aqua whitepaper (shared-liquidity settlement layer) — https://github.com/1inch/aqua/blob/main/docs/whitepaper-aqua-1.0.pdf
3. SwapVM smart contracts (official source code, MUST be used; redeploying a modified version is allowed but writing from scratch outside this base is not) — https://github.com/1inch/swap-vm/tree/main
4. Aqua smart contracts (official source code) — https://github.com/1inch/aqua
5. Aqua TypeScript SDK — https://github.com/1inch/sdks/tree/master/typescript/aqua
6. Privy documentation index (fetch this first to see all relevant pages) — https://docs.privy.io/llms.txt
7. Privy quickstart (basic SDK setup, embedded wallet) — https://docs.privy.io/basics/get-started/quickstart
8. Privy — Choose your platform (confirm using the Node.js server SDK `@privy-io/node`, not another language's SDK) — https://docs.privy.io/basics/get-started/platforms
9. Privy — Policy engine overview (core mechanism used for bounded delegation) — https://docs.privy.io/controls/policies/overview
10. Privy — Session signers for server-side execution (the pattern Slope uses: the app executes transactions on behalf of the user even while the user is offline; used as the limit-order example use case) — https://docs.privy.io/recipes/wallets/user-and-server-signers.md and https://docs.privy.io/recipes/wallets/session-signer-use-cases/server-side-access.md
11. Privy — end-to-end session signers example implementation in the official starter repo — https://github.com/privy-io/examples/blob/main/privy-next-starter/src/components/sections/session-signers.tsx
12. Privy Node SDK package (`@privy-io/node`) — https://www.npmjs.com/package/@privy-io/node
13. Privy GitHub (official repos, SDKs for various platforms) — https://github.com/privy-io
14. The Graph — Subgraph MCP (if the natural-language query layer is used, optional) — https://thegraph.com/docs/en/subgraphs/tooling/subgraph-mcp/introduction/
15. The Graph — Subgraph development docs (find via the official docs index at thegraph.com/docs)
16. Base — Connect to Base (official RPC endpoint and chain ID) — https://docs.base.org/get-started/connect-to-base.md
17. Base Sepolia official network faucets (for testnet ETH) — https://docs.base.org/base-chain/network-information/network-faucets
18. Foundry Book (for project setup, testing, fuzzing) — find via https://book.getfoundry.sh

### 1. Target Privy Track — Best Financial Flow ($2,500)

Privy has two separate tracks at ETHOnline2026 — Best B2B Financial Product (for organization/business use cases: treasury, payroll, org wallets — NOT relevant to Slope) and **Best Financial Flow** (for seamless funding/moving/trading/spending of digital assets — THIS is what Slope targets, because its requirements explicitly list "swaps" as an eligible flow, and its official description is "simplify a real financial flow and hide unnecessary onchain complexity from the user" — exactly what Slope's bounded delegation does).

Mandatory requirements to qualify for Best Financial Flow:
- Privy must be a core part of the product (automatically satisfied because bounded delegation is Slope's second core mechanic)
- MUST create or use at least one Privy wallet — not optional. This means users MUST be able to onboard via a Privy embedded wallet (email/social login, no seed phrase), not only via an external wallet like MetaMask
- At least one functional financial flow using a generally available Privy feature — the swap Slope executes falls into this category
- Working demo plus source code access
- The README must clearly explain how Privy improves the product's UX

### 2. The Correct Privy Mechanism (Native Policy Engine, Not On-Chain Smart Account)

The NATIVE Privy mechanism used for the MVP: Privy has a **policy engine** composed of three primitives — **policies**, **rules**, and **conditions** — defined at the key/signer level. When a signer (the session key owned by the Slope backend) attempts to send a transaction, **Privy's own infrastructure evaluates whether the transaction satisfies the defined policy** before Privy will sign it. If it does not comply, Privy rejects the signing request. This is enforcement at Privy's infrastructure/API level, NOT automatically an on-chain smart contract validator, unless the project explicitly combines Privy with smart account abstraction (ZeroDev or equivalent) as a separate additional step — for this MVP that is NOT used, to keep scope simple.

Setup flow, using `@privy-io/node`:
1. User onboards via a Privy embedded wallet (email/social login, Privy provisions the wallet automatically without a seed phrase) — this MUST happen at least once in the product flow to satisfy the track requirement.
2. The user (wallet owner) creates an authorization key/session signer in Privy when creating a position (Create Order).
3. Define a policy with rules restricting: destination contract (must be only the SlopePosition/Aqua router contract owned by Slope), maximum transfer amount per transaction and/or in total (spend cap matching the user's declared budget), and ideally a time window (expiry) matching the order duration.
4. This signer is registered onto the user's embedded wallet in Privy with that policy attached.
5. The Slope backend (Keeper Service, Node.js) holds the app authorization key and uses `@privy-io/node` to execute transactions on the user's behalf without manual user approval each time, BUT every request must still pass Privy's policy evaluation before being signed.
6. The user can remove/deactivate this signer at any time via the app dashboard (revoke).

If stronger on-chain enforcement is needed (defense-in-depth, not relying on Privy infrastructure alone), it can be added as a second layer inside the SlopePosition contract itself — the SlopePosition contract MUST still re-validate bounds (budget, price bounds, expiry) at the Solidity level, and MUST NOT assume the Privy policy alone is sufficient as the only security layer. This is the defense-in-depth principle: the Privy policy prevents the signer from sending the wrong transaction, the Solidity contract prevents wrong execution even if the first layer is somehow bypassed.

`[VERIFIED 2026-09-05]` Privy cumulative spend caps (aggregations) are tracked at SIGN level only: they apply to `eth_signTransaction` / `eth_signUserOperation` requests, and `eth_sendTransaction` spend is invisible to them (per the official stateful-policies docs and recipe). Therefore the keeper signs via `eth_signTransaction` and self-broadcasts the raw transaction to an RPC node. Aggregations use rolling windows of 1h–72h only (no lifetime cap), support max 10 per app, are created via REST (the Node SDK does not yet expose `create`), and are explicitly "disaster prevention, not strict real-time enforcement" (concurrent requests can pass before values are recorded). See REVISION 1 in the CHANGELOG for how `maxAmountIn` gives the aggregation a real upper bound to sum, and the two caveats (skipped fills still consume aggregation headroom; the 72h window is a rate limit, not budget enforcement). `[REVISION 2 / DECISION 12]` Because AdaptiveExecute is permissionless, the Privy policy and aggregation constrain ONLY our delegated keeper signer, not execution in general — the README must NOT claim Privy rate-limits execution overall, only that it constrains the delegated signer.

### 3. Contract Structure — SlopePosition and AdaptiveExecute

The core contract is named SlopePosition. Token custody follows the **pull-per-fill** model `[REVISION 2]`: at Create Order the user grants an ERC20 approval to SlopePosition for at least totalBudget; on each fill the contract pulls exactly fillAmount from the owner's wallet via transferFrom at execution time. The contract NEVER holds user funds between fills — there is no escrow balance and no refund path; cancelling simply sets isActive = false and the user's tokens were never moved. Do not switch to an escrow model without explicit confirmation — it would make the product custodial and require a refund path that does not exist in this spec.

Each position (order) created by a user is stored as a struct with at least the following fields:

- owner (address) — the user's wallet that created the position, owner of the funds
- tokenIn (address) — the token being sold
- tokenOut (address) — the token being bought
- decimalsIn (uint8) and decimalsOut (uint8) — token decimals cached at creation via IERC20Metadata, read once rather than per fill (saves gas and avoids inconsistency if a token misreports) `[REVISION 2]`
- totalBudget (uint256) — the declared amount of tokenIn to be executed in total
- executedAmount (uint256) — the amount of tokenIn executed so far, starting at 0
- minFillAmount (uint256) — minimum executable fill size; fills below it are skipped except on final settlement `[REVISION 2]`
- startTimestamp (uint256) — when the position was created
- duration (uint256) — maximum duration in seconds; the position cannot be executed after startTimestamp + duration has passed
- curveShape (enum or uint8) — AGGRESSIVE, NEUTRAL, or CONSERVATIVE (see section 4 for the mathematical definitions)
- minPrice and maxPrice (uint256, standard 18-decimal fixed-point convention where 1e18 represents 1.0) — acceptable absolute price bounds, in the price convention defined in step 6
- maxSlippageBps (uint16) — per-fill price-impact limit in basis points, default 500 (i.e. 5%)
- isActive (bool) — position status, false once finished/cancelled

The AdaptiveExecute instruction (execution function) is **permissionless — anyone may call it** `[REVISION 2 / DECISION 12]` (liveness over caller restriction; the contract itself is authoritative on every constraint — see the decision log for the README wording consequence). It accepts `positionId` and `maxAmountIn` as parameters `[REVISION 1 — see CHANGELOG; the original spec only accepted positionId]`, and performs the following steps inside the contract:
1. Load the position by positionId, revert if isActive is false or startTimestamp + duration has passed.
2. Compute elapsed = block.timestamp - startTimestamp.
3. Compute authorizedCumulative = totalBudget * curveFunction(elapsed, duration, curveShape) — curveFunction returns a fraction (0 to 1e18 as fixed-point representation of 0.0 to 1.0) representing what percentage of totalBudget SHOULD have been executed at this point in time according to the selected curve. `[REVISION 2 — terminal clamp]` If elapsed >= duration, set authorizedCumulative = totalBudget directly, bypassing the curve formula entirely — guaranteeing the final fill authorizes the exact remainder with no rounding drift.
4. Compute authorizedNow = authorizedCumulative - executedAmount. If authorizedNow <= 0, revert or return without doing anything (not yet time to execute the next portion according to the curve schedule). `[REVISION 1]` Next compute fillAmount = min(authorizedNow, maxAmountIn). If fillAmount <= 0, return early without doing anything. `[REVISION 2]` If fillAmount < minFillAmount AND elapsed < duration, return early — except on final settlement (elapsed >= duration), where the remainder is allowed through even below the minimum. All subsequent steps use fillAmount, not authorizedNow.
5. Read the current price from Aqua using TWO quotes on the official router within the same transaction `[REVISION 2 — replaces the single quote of the original spec]`: (a) reference quote — `quote(...)` for a very small probe amount (e.g. 0.1% of fillAmount, or a fixed small notional), approximating the marginal/spot price with negligible impact; (b) execution quote — `quote(...)` for the actual fillAmount. `[VERIFIED 2026-09-05]` No separate Lens/Quoter contract exists — the official quote surface is `AquaSwapVMRouter.quote(...)` (static-call semantics, same program execution as swap). This satisfies the original spec's "read price from official Aqua, NOT computed ourselves" requirement.
6. Price convention `[REVISION 2]`: price is tokenOut per 1 whole tokenIn, normalized to 18 decimals — price = (amountOut * 10^(18 - decimalsOut) * 1e18) / (amountIn * 10^(18 - decimalsIn)). This exact formula must be mirrored identically in the TypeScript reference model, and a test must assert both sides agree on an asymmetric-decimals case shaped like WETH(18)/USDC(6). Then apply TWO distinct checks: (a) **price impact of this fill** — priceImpactBps = ((referencePrice - executionPrice) / referencePrice) * 10000; skip if priceImpactBps > maxSlippageBps. A single-quote "slippage" check would be zero by construction and meaningless; the probe-vs-execution pair is what makes the check real. Document this definition in the README and code comments — judges may ask exactly what slippage is measured against. (b) **absolute bounds** — the execution quote's resulting price must lie within [minPrice, maxPrice]. Both checks are applied; they are not redundant. If either fails, SKIP — do not execute, do not revert the whole transaction when called from the automated keeper (use a return-early pattern or a catchable custom error, not a hard revert that wastes the keeper's gas with no useful information).
7. Pull tokenIn from the owner: transferFrom(owner, address(this)/router path, fillAmount). `[REVISION 2 — pull-per-fill]` If the transfer fails (insufficient balance or revoked approval), treat it as a skip — the same return-early pattern as above, NEVER a hard revert — and emit a distinguishable event or custom error so the keeper can log the reason and, if the failure is persistent, stop retrying that position.
8. If validation passes, execute the fill via Aqua for fillAmount (exact-input) `[REVISION 1: previously authorizedNow]`, update executedAmount += fillAmount.
9. Emit event FillExecuted(positionId, amountIn, amountOut, executionPrice, timestamp) — this event is what The Graph indexes.
10. `[REVISION 2]` Completion: if executedAmount >= totalBudget, or the remaining dust (totalBudget - executedAmount) is at or below the contract's dust threshold (a small constant; zero is acceptable because the terminal clamp makes the exact remainder reachable), set isActive = false and emit event PositionCompleted(positionId).

### 4. Curve Formula — MUST Be Defined With Precision, Not Left to AI Tool Interpretation

Define the function curveFunction(elapsed, duration, shape) returning a progress fraction in the range 0 to 1e18 (18-decimal fixed-point, consistent with common Solidity conventions), as follows:

For shape = NEUTRAL (linear/flat, equivalent to classic TWAP): progress = elapsed * 1e18 / duration. This is the base/special case that must be exactly identical to a standard linear TWAP — also used as the baseline benchmark in the performance dashboard (section 7).

For shape = AGGRESSIVE and CONSERVATIVE, use a simple power function with fixed exponents determined up front (not custom user parameters, for MVP scope simplicity): progress = (elapsed / duration) ^ exponent, multiplied by 1e18. For AGGRESSIVE use an exponent less than 1 (example 0.5, meaning the curve rises fast early then slows — a large portion of the budget executes early). For CONSERVATIVE use an exponent greater than 1 (example 2, meaning the curve rises slowly early then fast late — a large portion executes later, allowing more time to wait for market conditions to improve before committing heavily).

SOLIDITY IMPLEMENTATION NOTE: computing fractional exponents (like 0.5) in Solidity CANNOT use the standard power operator because Solidity does not natively support fixed-point exponentiation with fractional base and exponent. Use a battle-tested fixed-point math library (e.g. PRBMath or solmate FixedPointMathLib, do NOT write your own sqrt/pow implementation from scratch unless thoroughly fuzz-tested) for this operation. For exponent = 0.5 specifically, this is equivalent to the sqrt function which already has battle-tested implementations in many libraries — consider using that directly instead of a generic power function to reduce bug risk and gas cost.

MANDATORY VALIDATION: at elapsed = 0, progress must be 0. At elapsed = duration, progress must be exactly 1e18 (100%). This must be explicitly unit-tested, not assumed correct from the formula.

Include an independent reference model outside Solidity (TypeScript, separate from the contract, consistent with the language used elsewhere in the stack) that computes curveFunction with high precision, used to cross-validate the Solidity contract's output via tests. Cross-validating financial math against an independent high-precision implementation in a second language is a rigor requirement for this project — subtle fixed-point rounding bugs must be catchable by a model that does not share the contract's implementation.

### 5. Full Execution Flow (Keeper Service Implementation Details — Node.js/TypeScript)

Slope needs a backend component that runs periodically (Keeper Service, written in Node.js + TypeScript) whose job is to trigger AdaptiveExecute on active positions. For the MVP and demo purposes, run it as a simple polling loop (not decentralized keeper infrastructure like Chainlink Automation or Gelato — that is outside the 9-day time budget), with a configurable interval (for the demo, the interval is accelerated as needed for the presentation, e.g. every few seconds instead of every few hours).

For each active position in each polling cycle, the Keeper Service:
1. Queries The Graph subgraph for the currently available Aqua liquidity/curve data for this position's token pair, sorted by best marginal price.
2. Takes the best route candidate from the query results.
3. Re-verifies that candidate's state directly on-chain via Aqua's official Lens/Quoter contract (using viem), MANDATORY because subgraph data has indexing lag and must not be the final source of truth for financial execution decisions.
4. Sends the transaction calling AdaptiveExecute(positionId, maxAmountIn) using the Privy session signer (`@privy-io/node`) scoped to this position `[REVISION 1]`: the keeper computes authorizedNow from the curve formula in `shared/` and sends it as maxAmountIn; the contract executes min(authorizedNow, maxAmountIn). The transaction is sent via `eth_signTransaction` (signed by Privy, where policy + aggregation are evaluated) and the keeper then broadcasts the raw transaction itself to an RPC node. The keeper's off-chain pre-check (steps 1–3) must apply the same price-impact definition as the contract (probe quote vs execution quote) `[REVISION 2]`, so contract-level skips stay rare.
5. The contract itself performs the final price-impact, bounds, budget and transfer validation (see section 3 steps 6–7) — the Keeper Service does not need to duplicate this logic, just trigger the call; the contract decides whether execution actually happens or is skipped. Note AdaptiveExecute is permissionless `[REVISION 2]`: if our keeper ever goes down, anyone can still advance positions.
6. Log the result (executed or skipped, with skip reason from the event/custom error) for debugging purposes, move on to the next position. A persistent per-position failure (e.g. revoked approval) should stop retries for that position.

### 6. The Graph Subgraph Structure

Define the subgraph schema with at least the following entities:

- Position: id (positionId), owner, tokenIn, tokenOut, totalBudget, curveShape, startTimestamp, duration, minPrice, maxPrice, isActive, executedAmount (this field is updated every time a Fill related to this position occurs)
- Fill: id (transaction hash + log index), position (relation to Position), amountIn, amountOut, executionPrice, timestamp
- BenchmarkComparison (computed in the subgraph mapping, not stored directly from on-chain events): for each Position that is completed or in progress, compute what executedAmount SHOULD have been under pure linear TWAP (curveFunction with shape NEUTRAL) at the same elapsed time, and compare it with the actual weighted-average executionPrice of all Fills that have occurred on that position, versus the hypothetical weighted-average price if execution had followed the linear TWAP schedule at the same points in time. This field is what the performance dashboard uses to overlay the two lines (section 7).

`[VERIFIED 2026-09-05]` Subgraph mappings only run on events (or blocks) — there is no "now" at query time. BenchmarkComparison is therefore stored as an as-of-last-fill snapshot computed in the mapping; the live planned-vs-actual curves are computed in the frontend from Position params + Fill records. (DECISION 4 in the appendix.)

Deploy this subgraph to The Graph's Subgraph Studio (not a locally-run Graph Node for the demo — use the official hosted service so the "consume live data from a Graph provider" requirement of the chosen track is satisfied; mock/local/static data does NOT qualify for the partner prize). Mapping logic is written in AssemblyScript per The Graph's technical requirement.

### 7. Screen/UI Specification (React + Vite + TypeScript)

Screen 1 — Create Order: the first step is onboarding via the Privy embedded wallet (email or social login, Privy provisions the wallet automatically without a seed phrase) — this MUST appear as the primary path, not optional, to satisfy the Best Financial Flow track requirement. External wallets (MetaMask etc.) may be supported as an additional option but are not the primary demo path. Once the wallet is ready: form inputs totalBudget, tokenIn/tokenOut (supported-pairs dropdown, for the MVP one or two pairs is enough, e.g. WETH/USDC on Base Sepolia), duration, curveShape selection (three buttons/radio: Aggressive/Neutral/Conservative with a visual preview of each curve shape using the formulas in section 4), minPrice and maxPrice, maxSlippageBps (default 500, adjustable), and minFillAmount as an advanced setting with a sane default of 1–5% of totalBudget computed at creation `[REVISION 2]`. The flow includes the ERC20 approval step granting SlopePosition an allowance of at least totalBudget before position creation — or a combined flow if the token supports permit `[REVISION 2 — pull-per-fill custody, see section 3]`. The submit button calls the create-position function on the contract (via viem), then triggers the Privy session signer setup with the policy matching the just-submitted parameters (see section 2).

Screen 2 — Execution Progress: for an active position, show a dual-line chart — the first line is the planned curve (from curveFunction, the plan), the second is actual cumulative executed (from Fill data that has occurred, fetched from the subgraph). X axis is time since position creation, Y axis is percentage of totalBudget executed. Below the chart, a table of each Fill (time, amountIn, amountOut, executionPrice). Also show remaining budget status, remaining time, and a Revoke button that calls the cancel/deactivate function on the contract and/or removes the session signer in Privy.

Screen 3 — Performance Dashboard: for completed (or in-progress) positions, show an overlay chart of actual weighted-average execution price versus the hypothetical linear-TWAP benchmark price over the same window and budget (data from BenchmarkComparison in the subgraph). Also show the list of all the user's historical positions with each one's performance summary (percentage improvement or underperformance versus the benchmark).

Visual aesthetic: dark theme, card/panel-based layout, live status indicator (blinking green dot for "live"), monospace font for numeric values. Curve charts are rendered with the native Canvas API (not Chart.js/Recharts) to achieve smooth curved lines with gradient fills and full rendering control. Styling uses Tailwind CSS. `[LICENSE]` The UI footer displays the attribution required by the Aqua/SwapVM licenses (§2.4/§3.1: attribution in README **and UI**): "Powered by Aqua — © Degensoft Ltd 2025" and "Powered by SwapVM — © Degensoft Ltd 2025".

### 8. Testing — MANDATORY, Not Optional

The SlopePosition contract MUST meet a high testing rigor standard:
- Foundry unit tests for curveFunction on all three shapes, verifying boundary conditions (elapsed=0 yields 0, elapsed=duration yields exactly 1e18).
- Foundry fuzz tests for curveFunction with random elapsed and duration in reasonable ranges, verifying progress is always monotonically non-decreasing (never decreases) and always within [0, 1e18].
- Unit tests for AdaptiveExecute verifying: execution is rejected/skipped if slippage exceeds maxSlippageBps, execution is rejected if price is outside [minPrice, maxPrice], execution is rejected if the position is past duration, executedAmount updates correctly after a successful execution, isActive flips to false after executedAmount reaches totalBudget.
- An integration test simulating the full cycle: create position, call AdaptiveExecute repeatedly with simulated elapsed time advancing, verify the final result matches curve expectations.
- `[REVISION 2]` Pull-per-fill failure tests: a fill is skipped (not reverted) when the owner's balance is insufficient, and when the approval has been revoked — each with a distinguishable event/custom error the keeper can key on.
- `[REVISION 2]` minFillAmount tests: a fill below the minimum is skipped mid-curve (elapsed < duration); the final-settlement remainder below minFillAmount still settles (terminal-clamp bypass).
- `[REVISION 2]` Lifecycle completion tests: a position reaches exactly totalBudget and isActive flips to false (terminal clamp guarantees exact completion); the dust-threshold close path.
- `[REVISION 2]` Price-impact tests: with the probe-vs-execution dual-quote definition, a fill whose priceImpactBps exceeds maxSlippageBps is skipped, and one within bounds executes; absolute [minPrice, maxPrice] bounds are enforced independently of impact.
- `[REVISION 2]` Decimal-normalization cross-validation test: the Solidity price convention and the TypeScript reference model produce identical prices on a WETH(18)/USDC(6)-shaped asymmetric-decimals case.
- An independent TypeScript reference model (separate from the contract, in the `shared/` folder or `contracts/test-utils/`) computing curveFunction with high precision to cross-validate the Solidity contract's output, run as part of the test suite or as a separate script whose results are compared manually before final submission.

### 9. Implementation Priority Order — Realistic for a Solo Dev, 9 Days

Work in order, do not start UI before the core contracts and their tests are solid:
1. SlopePosition contract and AdaptiveExecute with curveFunction for shape NEUTRAL only first (pure linear/TWAP), plus a complete test suite for this shape.
2. Add AGGRESSIVE and CONSERVATIVE shapes after NEUTRAL is solid and tested.
3. Aqua integration for fill settlement (following the official patterns from the sources in section 0).
4. Privy embedded wallet integration (onboarding) and session signer with policy engine per sections 1 and 2, using `@privy-io/node`.
5. The Graph subgraph per section 6, deployed to Subgraph Studio.
6. Keeper Service (Node.js/TypeScript) per section 5.
7. Frontend three screens per section 7, starting from Screen 1 (simplest) to Screen 3 (most complex, needs historical data).
8. Demo video and documentation (README, FEEDBACK.md for each partner prize, AI tool usage disclosure) — reserve dedicated time for this, do not rush it in the final hours because there are strict technical requirements (video resolution, duration, no AI voiceover) that can cause automatic submission rejection at upload if violated.

If time gets really tight, what MAY be sacrificed (in order, most cuttable first): AGGRESSIVE/CONSERVATIVE shapes (NEUTRAL alone is fine with a README explanation that the other shapes are roadmap), Screen 3 detail (can be simplified to summary numbers without a fancy overlay chart), full automated keeper (demoing with a manual single-call trigger is acceptable if honestly explained in the README that production would use an automated keeper).

What may NOT be sacrificed at all: the test suite for the core contract (the 1inch requirement explicitly states on-chain execution must be shown in the demo, and testing quality affects scoring), Privy embedded wallet onboarding (a hard requirement of the Best Financial Flow track), granular commit history throughout development (a hard ETHOnline2026 requirement, disqualification risk), and the AI tools disclosure documentation in the README plus including the spec/prompt files (hard ETHOnline2026 requirements).

### 10. Positioning — Taker-Side Execution

Existing curve-based liquidity designs in DeFi focus on the maker — the party providing liquidity, configuring price curves (bid/ask) across price levels along a range. Slope focuses on the taker — the party wanting to execute one large order, configuring the execution curve along TIME (not along price). Two fundamentally different roles in the order book/DEX ecosystem, even though both can settle through the same SwapVM/Aqua infrastructure. Slope is a genuinely different category of DeFi position, not a variation of maker-side curve design.

### 11. Competitive Landscape (For Positioning Reference, Not to Copy Blindly)

CEXs (Binance, OKX, Bybit) already have TWAP/algo order features, but usually reserved for institutional users or behind advanced trading APIs, and they are custodial (the exchange controls the funds) — a completely different trust category from Slope which is non-custodial.

CoW Swap is the philosophically closest DEX competitor (non-custodial, batch auction, solver competition). Academic research shows CoW Swap consistently improves execution welfare versus plain AMMs for large trades — validating that smart execution splitting is genuinely valuable empirically.

UniswapX uses third-party fillers in an execution competition, but the same research shows it underperforms CEX benchmarks for large trades — indicating an unsolved gap in this space, supporting why Slope is worth building.

Orbs Agentic is the conceptually CLOSEST potential overlap with Slope — TWAP-style execution infrastructure for DeFi agents with defined slippage and max price impact, operating on many EVM chains including Base, explicitly positioning itself as execution infrastructure, not a new wallet, not custodial, not "AI trading". Likely differentiators from Slope: Orbs is infrastructure-as-a-service for developers, while Slope is an end-user consumer product with visual UX (curve preview, performance dashboard) AND Privy embedded wallet onboarding making it accessible to non-technical users. Slope's curve shape is also explicitly user-defined with several presets, versus possibly standard linear TWAP at Orbs. IMPORTANT: re-check Orbs documentation before final submission to make sure this differentiation is still accurate and can be explained confidently if judges ask.

Academic note: tightly-scoped session key patterns are already a widely known architecture pattern in agent-blockchain research, not something unique to Privy or Slope. Slope's differentiation must still be emphasized on the combination of adaptive curves plus verifiable benchmarks plus onboarding accessibility, not on the delegation mechanism itself which is already an industry standard.

### 12. Realistic Estimates for Demo/Pitch

Realistic estimate for adaptive curve improvement versus a single swap or naive TWAP: only a few percent (range 3-8%, per institutional execution algorithm literature), NOT orders of magnitude. Avoid overly dramatic demo numbers — they are mathematically unrealistic and risk damaging credibility in front of judges with deep DeFi knowledge.

Chain: Base Sepolia, testnet — not mainnet. Consistent with the 1inch requirement that explicitly allows local forks for the demo, and standard hackathon practice. `[VERIFIED 2026-09-05]` Aqua/SwapVM have NO deployment on Base Sepolia (verified via RPC: empty bytecode); they are deployed on Base mainnet (and 12 other chains) at deterministic vanity addresses: Aqua registry `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`, AquaSwapVMRouter `0x111111338c5091e8440b67b168bae16a668ac0de` (git tag `v1.0.2` — do NOT use the `main` branch, it is an undeployed refactor). Per DECISION 1, Slope self-deploys the official Aqua registry + SwapVM router from the `v1.0.2` source to Base Sepolia — the 1inch prize explicitly allows "redeployments of a modified SwapVM contract", and we need custom code anyway.

Demo strategy: contracts genuinely deployed and called (not fake/mock), but order durations accelerated for demo purposes. This is standard hackathon demo practice, not cheating, because the contract is honest.

### Working Instructions for the AI Coding Tool

Build in the priority order in section 9, using the stack fixed in PART 2 (do not switch languages/frameworks without confirmation). Every significant architectural decision made outside this spec must be confirmed with the project creator first, not decided unilaterally by the AI tool. Commit granularly per completed unit of work, not piled up at the end. If any part of this spec is ambiguous or unclear when starting implementation, ask first rather than guess — especially for details marked as mandatory reading above.

---

## APPENDIX: DECISION LOG (all decisions confirmed by the project creator)

**DECISION 1 — Aqua deployment strategy (2026-09-05)**: Self-deploy the official Aqua registry + SwapVM router from source (git tag `v1.0.2`) to Base Sepolia. Rationale: the prize explicitly allows it ("Official Aqua/SwapVM contracts must be used; redeployments of a modified SwapVM contract is allowed") and Slope needs custom code anyway. Context: Base Sepolia has no official Aqua deployment (verified via RPC on 2026-09-05); Base mainnet does.

**DECISION 2 — Custom opcode scope (2026-09-05)**: Baseline first — call the official router unmodified. A custom `_slopeXD` opcode (ported from the unregistered `_twap` instruction in `1inch/swap-vm` `src/instructions/TWAPSwap.sol`) on a redeployed router is a stretch goal AFTER the baseline is solid. Note: the 1inch prize scores modified opcodes higher.

**DECISION 3 — Keeper signing method (2026-09-05, verified against Privy docs)**: Cumulative spend caps (aggregations) in Privy are tracked at SIGN level only (`eth_signTransaction` / `eth_signUserOperation`; `eth_sendTransaction` is invisible to them). The keeper therefore signs via `eth_signTransaction` and self-broadcasts the raw transaction. Combined with REVISION 1: `AdaptiveExecute(uint256 positionId, uint256 maxAmountIn)` gives the aggregation a real upper bound to sum (keeper computes authorizedNow from the shared curve formula and sends it as maxAmountIn; the contract executes min(authorizedNow, maxAmountIn) and remains authoritative). See REVISION 1 caveats: skipped fills still consume aggregation headroom (mitigations: keeper slippage pre-check, cap headroom above totalBudget, fix pre-check logic rather than raising the cap); the 72h max rolling window is a rate limit / blast-radius control, NOT budget enforcement (the contract enforces the budget via `executedAmount <= totalBudget`; never claim otherwise in the README/pitch).

**DECISION 4 — BenchmarkComparison design (2026-09-05)**: Stored as an as-of-last-fill snapshot computed in the subgraph mapping (mappings run on events only, no "now" at query time). Live planned-vs-actual curves are computed in the frontend from Position params + Fill records.

**DECISION 5 — Dev environment (2026-09-05)**: WSL2 is available on the Windows host; Foundry runs inside WSL. Note: `graph test` (Matchstick) also requires WSL/Docker.

**DECISION 6 — The Graph prize track (2026-09-05)**: NO MCP server, NO track switch. The submission as-is qualifies under "Best AI Tooling or AI Use Case — From Scratch" as an AI USE CASE (an application performing meaningful automated work with subgraph data), not as tooling, so the "reusable infrastructure" requirement for tooling submissions does not apply. README MUST explicitly explain: (a) the meaningful work with the data — the keeper's automated decisions (ranking candidate routes by marginal price queried from the subgraph, deciding execution windows, skipping on stale/off-bound prices) plus the benchmark comparison reasoning — not just printing raw query results; (b) live data consumption — the subgraph is deployed to Subgraph Studio and queried with an official API key; a local Graph Node, mocked, static, or local-only datasets do not qualify.

**DECISION 12 — Permissionless AdaptiveExecute (REVISION 2, 2026-09-05 — adopting the creator's recommendation)**: anyone may call AdaptiveExecute. Rationale: the contract is authoritative on every constraint that matters (curve schedule, price bounds, price impact, budget) and liveness beats restricting who can pay gas to trigger a fill. Consequence: the Privy policy and aggregation constrain ONLY our delegated keeper signer — README must not claim Privy rate-limits execution overall, only that it constrains the delegated signer; state the permissionless choice plainly as a design decision.

**DECISION 7 — Token custody: pull-per-fill (REVISION 2, 2026-09-05)**: ERC20 approval to SlopePosition (≥ totalBudget) at Create Order; transferFrom per fill at execution time; the contract never holds funds between fills; no escrow balance, no refund path; cancel just deactivates. transferFrom failure = skip (return-early, distinguishable event/custom error, keeper stops retrying persistent failures). Escrow switching is forbidden without explicit confirmation (custodial + needs a refund path).

**DECISION 8 — Minimum fill size (REVISION 2, 2026-09-05)**: new struct field minFillAmount; fills below it are skipped except on final settlement. MVP default: 1–5% of totalBudget computed at creation, exposed in Screen 1 as an advanced setting; document the default and reasoning in the README.

**DECISION 9 — Slippage = price impact from dual quotes (REVISION 2, 2026-09-05)**: reference quote (small probe ≈ spot price) vs execution quote (actual fillAmount), both via `AquaSwapVMRouter.quote(...)` in the same transaction; priceImpactBps = ((referencePrice - executionPrice) / referencePrice) * 10000; skip if > maxSlippageBps. The absolute [minPrice, maxPrice] bounds check on the execution price is separate and both are applied. Definition documented in README + code comments.

**DECISION 10 — Price convention (REVISION 2, 2026-09-05)**: price = tokenOut per 1 whole tokenIn, 18-decimal normalized: price = (amountOut * 10^(18 - decimalsOut) * 1e18) / (amountIn * 10^(18 - decimalsIn)). decimalsIn/decimalsOut cached in the struct at creation (IERC20Metadata). TypeScript reference model must use the identical formula; cross-validation test on a WETH(18)/USDC(6)-shaped case required.

**DECISION 11 — Terminal clamp + dust close (REVISION 2, 2026-09-05)**: elapsed >= duration ⇒ authorizedCumulative = totalBudget (bypass curve); final settlement bypasses minFillAmount; completion when executedAmount >= totalBudget or remaining dust ≤ dustThreshold (constant, zero acceptable given the clamp); explicit lifecycle unit tests required.

**NOTE (REVISION 2, item 7)**: concrete competitive research is maintained in separate internal pitch-preparation notes, not in this spec — but a specific "how is this different from X?" answer must be ready for live-judging Q&A.

**VERIFIED IMPLEMENTATION NOTES (2026-09-05 research)**:
- There is no separate Lens/Quoter contract in Aqua — the official price/quote surface is `AquaSwapVMRouter.quote(order, tokenIn, tokenOut, amount, takerTraitsAndData)` (static eth_call, selector `0x44aa5f14`), executing the same program as `swap`. This satisfies Section 3 step 5's "read price from official Aqua" requirement.
- 1inch's own shipped strategies embed a KYC gate opcode (`onlyTxOriginTokenBalanceNonZero(KycNFT)`, KycNFT `0x26FFc7D378E8e49Be2c483295A3e3E511F96a468`) — only KYB-verified resolvers hold it. Slope must ship its OWN ungated strategies (documented path: "drop that instruction for a permissionless pool"); smart-contract takers work (template ships a `MockTaker`).
- Aqua mechanics: maker `ship(app, strategy, tokens, amounts)` creates virtual balances (tokens stay in the maker wallet); taker approves the router and calls `router.swap(...)` (pull+push atomically). Aqua order tuple `(maker, traits, data=program)` with `traits = 1 << 254` (`useAquaInsteadOfSignature`); minimal exact-in taker blob flags `0x0041`; `shouldUnwrapWeth` must be false.
- When seeding liquidity on Base Sepolia: total shipped amounts must stay ≤ the maker wallet's real balance (Aqua virtual balances are commitments, not escrow, per the official Aqua documentation).
- Build requirements for the Aqua/SwapVM contracts: solc 0.8.30, `via_ir = true`, EVM target cancun (transient-storage reentrancy locks; the function-pointer opcode table breaks without IR codegen). Reference: `1inch/swap-vm-template`.
- SDKs: `@1inch/aqua-sdk` 0.3.0 (registry: ship/dock/hash — no quote), `@1inch/swap-vm-sdk` 0.4.0 (quote/swap/Order/AquaProgramBuilder/strategy builders). Always build programs via `AquaProgramBuilder` (the hand-maintained TS opcode enum is shifted). viem `^2.48.4` required.
- Subgraph Studio supports Base Sepolia (`network: base-sepolia`); limits: 3 deployed subgraphs per account, redeploys auto-archive the previous version (pin the versioned query URL), dev endpoint ~3,000 queries/day, API key required to query.
- **Licensing (`[LICENSE]`, verified 2026-09-05 from the license texts):** Aqua and SwapVM use twin custom licenses — `LicenseRef-Degensoft-Aqua-Source-1.1` and `LicenseRef-Degensoft-SwapVM-1.1` (© Degensoft Ltd, New York law). Unmodified use/copy/distribution is permitted; **non-commercial use including hackathons is explicitly free**. Modifications are **strong copyleft**: derivative portions (broadly defined — linking, proxy/delegatecall composition, bundled adapters, artifacts deployed together) must be published under the same license at no charge, with changes and dates marked, build/deployment instructions, and the "Powered by Aqua/SwapVM — © Degensoft Ltd 2025" attribution in README **and UI**. Independent code that merely calls or interfaces with the work is carved out (§3.3) — so `SlopePosition` stays MIT, while a modified router (the `_slopeXD` stretch) must be committed under `LicenseRef-Degensoft-SwapVM-1.1`. Commercial triggers (charged fees > US$100k or liquidity under control > US$10M in any rolling 12 months; a revocable waiver currently covers volume activities) are far outside hackathon scope but belong in production roadmap notes. Compliance artifacts for this repo: a `LICENSES/` directory preserving both license texts and both upstream THIRD_PARTY_NOTICES files verbatim.
