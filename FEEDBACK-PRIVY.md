# Privy Track Feedback — Slope (ETHGlobal Online 2026)

Slope is a non-custodial taker-side execution product: it splits a large swap across **time** along a user-chosen curve, executed by a delegated keeper service against a per-position signing policy. We used Privy's embedded wallets (`@privy-io/react-auth` 3.40), the Node SDK (`@privy-io/node` 0.34), and the REST policy/quorum/aggregation APIs heavily during the hackathon — email-only onboarding, per-position 1-of-1 key quorums, per-position override policies evaluated on `eth_signTransaction`, and (attempted) aggregation-based spend tracking. Everything below was verified against live behavior on Base Sepolia, not documentation assumptions. Our deployment is public and every claim here is reproducible from the tx hashes and policy IDs in this repository.

## Finding 1 (blocking, most important): an aggregation-reference condition denies every `eth_signTransaction` it appears in

We built our delegated-authority design around a rolling spend limit: an aggregation summing the decoded `maxAmountIn` calldata parameter over a 72h window, referenced from each position's policy. Every sign request through such a policy was denied with `400 {"code":"policy_violation"}` — reproducibly, across:

- both comparison operators (`lte` and `lt`),
- both value formats for the reference cap (hex and decimal),
- fresh (empty) windows and reused windows,
- policies whose every other condition was independently verified as passing.

The decisive experiment: an otherwise-identical policy **without** the reference condition signed, broadcast, and filled on-chain immediately — same wallet, same quorum, same calldata, minutes apart. With the reference present, the denial was unconditional. Because the denial response does not say *which* condition rejected the request, this cost a full diagnostic cycle (three-candidate bisection across expiry, aggregation, and signer binding) to isolate.

Two details that made it worse:

- **The docs recipe implies this should work.** The stateful-policies documentation shows exactly this shape (`field_source: "reference"`, `field: "aggregation.<id>"`, `operator: "lte"`, hex value) and states that an empty window is treated as a zero baseline. Live behavior contradicts both.
- **Sign-time recording compounded the debugging.** We initially (incorrectly) attributed the denials to a shared window being exhausted, because denied attempts appear to consume the recorded sum. If the engine records metrics for requests it then denies, a policy that always denies will always look like an exhausted cap — an invariant worth reconsidering on its own.

We removed aggregation references entirely and shipped scope-first policies (see below). A fix or a documented "reference conditions are not supported for `eth_signTransaction`" would have saved us the better part of a day, and would restore a genuinely useful pattern: the docs' own rate-limiting recipe, on the method that backend signers actually use for raw transactions.

## Finding 2 (design-relevant even after a fix): sign-time cumulative caps and failure patterns don't mix

We measured the sum of signed `maxAmountIn` values against what the position actually executed:

- **179.98%** of a position's budget, from a *single* broadcast-failure retry (the sign succeeded, the raw tx was rejected for a stale nonce, the retry re-signed the same amount — both recorded).
- **1500%+** during a keeper bug that repeatedly signed against a position whose fills were being skipped on-chain (a successful transaction is not a successful fill — see below).

Both positions were completely healthy; the inflation came from retry/skip patterns that any long-running executor will hit. A cumulative cap tight enough to be a meaningful rate limit (we sized 2× budget) would have bricked both positions mid-flight. Unless the aggregation can (a) record only *executed* spend rather than *signed* spend, or (b) let the integrator release/correct recorded values, a sum-based cap on a signing method cannot be sized safely for automated executors — it will always be either too tight (strangles healthy positions) or so loose it is decorative. We would love to be wrong here; if there is a supported pattern (e.g., metric extraction from the transaction *receipt*, or manual sum correction), it deserves a prominent place in the docs.

## Operational notes (smaller, but each cost real time)

- **Key quorums**: `POST https://api.privy.io/v1/key_quorums` with body `{public_keys: [key], authorization_threshold: 1}` works well. The key format must be **base64-encoded SPKI/PKCS8 without PEM headers** — the SDK's `generateP256KeyPair()` output plugs in directly; a PEM-formatted key registers fine but produces `401 No valid authorization signatures` on every use, which reads like a binding problem rather than a format problem.
- **Name length limits**: policy names and rule names silently fail validation above ~50 characters. The error surfaces as a generic 400; a per-field message would help.
- **Aggregations have no list endpoint**: only create / get-by-id / delete (a collection `GET` returns HTTP 405), and the recorded sum is **not readable** through the API at all. Debugging "why was this denied" is impossible without dashboard access; even a read-only `currentValue` field on `GET /v1/aggregations/:id` would change the debugging experience completely.
- **Policy PATCH semantics**: `PATCH /v1/policies/:id` accepts `{name, rules}` only — rule objects carry server-assigned `id`s that must be stripped, and top-level `version`/`chain_type` are rejected. The error message enumerates the offending keys (good!), but the accepted schema is not in the API reference.
- **`signTransaction` parameter shape**: the SDK expects snake_case (`chain_id`, `gas_limit`, `max_fee_per_gas`, `max_priority_fee_per_gas` — `gas` does not work), and signs the parameters **as given**: nonce, gas, and fees must be supplied by the caller or the raw transaction fails at broadcast with `intrinsic gas too low`, one RPC hop away from where the mistake was made.

## What we shipped instead (and why we're happy with it)

With references unusable, our policies enforce **scope**: a target-contract allowlist, a single permitted function (`adaptiveExecute`), a binding to the signer's **own** position (a decoded-calldata `positionId` equality condition), a per-transaction input cap, and an expiry — all of which worked flawlessly once the reference was removed. Budget and schedule enforcement lives in our contract (`executedAmount <= totalBudget` plus the execution curve), which is the stronger guarantee anyway: the delegated signer can only tighten what the position authorizes, never exceed it. For rate limiting, our keeper signs only the curve-authorized increment and parks deterministically on the first policy denial, auth failure, or on-chain skip. One prompt-driven debugging session (committed under `prompts/08-step4-privy.md`) narrowed the cause from "every request denied" to "the reference condition itself" in three steps.

## What worked exceptionally well

- Email-only embedded-wallet onboarding and the headless `useWallets`/`useSigners` flow — position creation and delegation consent in one pass, no seed phrases anywhere.
- The `addSigners` consent flow for registering our server-side quorum on a user's embedded wallet: clean UX for a genuinely hard delegation problem.
- Wallet-scoped signing through the Node SDK with authorization keys: once the key format and parameter shapes were right, it was fully deterministic.
- Per-signer override policies as a concept are exactly right for session-scoped delegation — the allowlist/selector/expiry mechanics are precise and fast.

## Reproducibility

All observations were made on Base Sepolia against app `cmtov09n701ee0bl8rms412tb` during 5–7 September 2026. On-chain evidence (delegated fills through `SlopePosition` `0xC7c6…B8Cc`), the final policy shape, and the diagnostic prompts are committed in this repository (`README.md`, `docs/spec/SPEC.md` verified notes, `prompts/08-step4-privy.md`). We're glad to share policy IDs, tx hashes, and the exact request/response pairs for any of the above.
