# 08 — Step 4: Privy Integration (Embedded Wallets, Bounded Delegation, Keeper) and the `policy_violation` Diagnosis

Issued as the step-4 directive, followed by mid-step UX corrections and a three-round, human-steered diagnosis of universal sign denials. The diagnosis rounds are the most instructive part: they show the cause being narrowed by a human steering the investigation, not by the model running loose.

## 1. The step-4 directive — prove delegation end-to-end against the live deployment

The goal for step 4 is not code that compiles; it is a **proven loop against the positions already live on Base Sepolia**: a brand-new embedded wallet onboarded through the frontend, a position created from it, execution delegated to a scoped session signer, and then the **keeper triggering `adaptiveExecute` without any manual approval from the user**.

Design constraints set up front:

- Email-only onboarding; embedded wallets only. The keeper is a plain Node/TypeScript service.
- **One key quorum and one override policy PER POSITION** (Privy allows a single override policy per signer binding, so per-position scoping requires per-position signers — which also yields per-position key isolation).
- Policies are DENY-by-default: a single `eth_signTransaction` ALLOW rule scoping `to` (SlopePosition only), the function (`adaptiveExecute` only), a per-transaction cap on the decoded `maxAmountIn` calldata parameter, an aggregation reference as a rolling spend limit, and a per-position expiry. Framing rule stated at design time: **the aggregation is a rate limit, not budget enforcement** — budget is the on-chain `executedAmount <= totalBudget` invariant. (This framing survives; the aggregation itself does not — see round 3.)
- The delegated key is a per-position P-256 key generated server-side, registered as a 1-of-1 quorum via REST, never shown to the user, and bound to the wallet through the frontend `addSigners` consent flow.
- Keeper loop: read positions on-chain, recompute the authorized amount from the **shared** curve reference model (the same formula the contract enforces), request the signature through Privy, self-broadcast the raw transaction, park on persistent failures.

## 2. Mid-step corrections — login UX

After a first custom email-OTP screen had layout bugs (the submit button covering the email input) and was briefly rebuilt, the correction reverted it: **restore the official Privy modal with `loginMethods: ['email']`** — it handles OTP resend, rate limiting, and accessibility for free, and tracks product depth. Keep the earlier scoped-CSS fix (no bare element selectors leaking into the modal). Test the modal with that CSS active; if the overlap persists, **report with a screenshot rather than switching approach** — do not swap mechanisms unilaterally.

## 3. Diagnosis round 1 — "run these checks, change nothing"

After every sign request started failing with `policy_violation` (including healthy, freshly delegated positions sending amounts far below every cap), the directive was to diagnose with **three named candidates, in order, and report before changing anything**:

1. **Expiry (check first, one command)**: compare the policy's `current_unix_timestamp` bound against the live clock in WSL. If the clock is past it, that is the answer and nothing else needs checking.
2. **Aggregation cap exhausted**: with three of five policy conditions already human-verified as passing, only two candidates remained. The directive flagged a reporting discrepancy to explain (a `25e18` cap figure vs. the `100e18` actually set in the live policy — resolved: two template generations, plus a stale config comment), and required querying the aggregation's recorded usage through the REST pattern the setup script already used — **without guessing endpoints**. Explicit reminder of the sign-time accounting caveat: requests consume the rolling sum when they are signed, including requests that are later skipped. (Also corrected by the response: MIN_FILL skips happen client-side *before* any sign request, so they never burned anything.)
3. **Signer binding** (only if both above are clean): verify in the dashboard that the policy is bound to the right key quorum and that the quorum's key matches the keystore entry the keeper actually uses.

Plus a separate, standing order (a finding in its own right, independent of the outage): **the policy never constrained `positionId`** — a session signer could technically drive `adaptiveExecute` for *any* position. Harmless for this demo (the contract still enforces per-position authorization) but fatal to the README's "session key scoped to this position" claim, and Privy judges are the most likely people to read the policy. Order: add an `adaptiveExecute.positionId` equality condition to the template for new positions; no backfill.

The response rules: **report findings before changing anything; do not fix an exhausted aggregation by raising the cap (explicitly forbidden) — fix the pre-check/retry behavior so quota is not burned on guaranteed skips; if it is expiry, widen the buffer and justify the new value.**

Response (reported before any change): expiry clean (~24 h remaining); signer binding clean — byte-exact quorum-key comparison against the keystore plus the error-class asymmetry (401 authorization failures on one position vs. 400 policy violations on the healthy ones); the aggregation was the only remaining condition, and the arithmetic put recorded attempts well past the cap. Proposed fix — per-position fresh windows plus immediate parking on deterministic errors — staged in the working tree, nothing applied.

## 4. Diagnosis round 2 — approval with reordered priorities and three notes

Approval to proceed, but with the priority inverted and three notes:

- **Priority: deterministic parking is the root cause, not per-position windows.** Three retries against a deterministic denial is what burns any cap, however sized. Implement that first and prove it correct (it got its own unit tests against the exact live error shapes).
- **Note 1 — the 10-aggregations-per-app limit must be handled explicitly**: with one aggregation per delegation the limit gets hit within a few demo positions. Delete/recycle windows of terminal positions, delete the orphaned one, and make sure nothing **fails silently during the demo recording**.
- **Note 2 — validate the 2× cap claim, do not assume it**: the claim was "the keeper signs the due increment, so legitimate fills sum to exactly 1× budget". Run one position to completion and sum every signed `maxAmountIn`. If it exceeds 1×, the cap is wrong and must be adjusted before the demo.
- Fix the stale `2.5x` comment while at it — a comment whose number differs from the value in use is a trap.

Then: fix the PATCH body, migrate the live policies, disable the permanently-broken positions, granular commits, and report when the live positions have filled.

## 5. What the diagnosis actually found — the model was wrong twice, the human steering was right

The approved fixes worked as designed (deterministic failures parked on first occurrence; no retry burning), **but the fills were still denied** — on brand-new, empty, per-position windows, with amounts far below every cap. The human-steered experiments then isolated the truth:

- A small-value sign against a guaranteed-fresh window: **denied**. A re-sign on the same window: **denied** (so denied attempts do not even record).
- Byte-exact quorum verification: keys matched; binding fine.
- The decisive bisect on the live policy: the identical policy **without** the aggregation reference signed, broadcast, and **filled on-chain immediately**; re-adding the reference — under either operator, either value format — denied everything.

Root cause: **Privy aggregation-reference conditions deny every `eth_signTransaction` carrying them**, regardless of window state or formatting — the docs' rate-limiting recipe does not hold for this method. The earlier "exhausted shared aggregation" hypothesis (round 1's accepted answer) was wrong; the correct cause had been masked because the one historically successful sign happened while a bisected-minimal policy without the reference was temporarily installed.

Shipped as a consequence: policies rebuilt **without** references, with the human's `positionId`-binding order included; per-delegation aggregation creation removed entirely (making the 10-per-app limit moot for new delegations; stale windows deleted via the REST DELETE); `eth_signTransaction` calls fixed to carry explicit nonce/gas/fees (signs-as-given semantics); receipt-level detection of `PositionSkipped` — **a successful transaction is not a successful fill** — with immediate parking on `TRANSFER_FAILED`; and in-flight work serialized per **owner wallet** (two positions sharing a wallet share a nonce sequence and had been rejecting each other's broadcasts).

## 6. Closure

Position **#8 fully settled end-to-end through the delegated path** (three on-chain fills, `PositionCompleted` emitted); position **#10 filling through the same path**; the `TRANSFER_FAILED` skip path demonstrated live with an actionable owner-side message. The framing lesson, carried into the README and feedback: **Privy enforces scope** (target, function, position binding, per-tx cap, expiry); **the contract enforces budget and schedule**. No rolling-window or blast-radius claims on the Privy side. The builder findings (the reference-condition denial and the sign-time sum inflation under retry/skip patterns) are committed as our Privy track feedback: [`FEEDBACK-PRIVY.md`](../FEEDBACK-PRIVY.md).
