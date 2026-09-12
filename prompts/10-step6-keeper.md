# Step 6 — Delegated Keeper

Directive (reconstructed; session logistics removed).

Build the delegated keeper service that executes the schedules, and run it as production infrastructure:

- Poll the subgraph as the decision layer: candidates, indexed executed amounts as the due-increment basis, and skip history for parking and diagnosis. Re-verify execution-critical state on-chain before signing; indexing lag must never be the final authority on a financial decision. Fail-closed on unreachability with no local fallback.
- Per-position session signers: P-256 keypairs registered as 1-of-1 Privy key quorums, bound to policies that allowlist the exact contract, the exact selector, the position id, a per-transaction cap, and an expiry. Private keys stay in a gitignored keystore.
- Sign via `eth_signTransaction` and broadcast the raw transaction. Serialise the nonce sequence per owner wallet. Skip (do not revert) on transfer failure, bounds, impact, or quote quality; every skip is recorded with its reason and fed back into candidacy.
- A small HTTP delegate endpoint for the frontend to request a delegation (key generation, quorum, policy); the browser confirms consent through Privy.
- Operations: configurable poll interval, progressive 429 back-off, per-tick staleness warning; deployment under systemd on a public VPS with a token-authenticated delegate API behind HTTPS.

Boundary note from the step-4 review: cumulative spend aggregations are tracked at sign level only. Rate limiting lives in the keeper; the budget invariant lives in Solidity where it belongs.
