# The Graph Track Feedback — Slope (ETHGlobal Online 2026)

The subgraph is the **decision layer** of our product: a delegated keeper consumes a versioned Studio endpoint every tick to pick candidates and read indexed `executedAmount` as its due-increment basis (execution-critical state is re-verified on-chain — SPEC boundary), and every frontend screen reads the same endpoint live. On the indexing side we used immutable entities, a `BenchmarkComparison` entity computed in mappings (VWAP vs TWAP per fill), and `creationTx`/`creationBlock` fields for the Activity stream. Deployment: `slope-base-sepolia` v0.0.3 on Base Sepolia, consuming through the API-key versioned URL; operator guidance lives in our [`docs/SUBGRAPH.md`](docs/SUBGRAPH.md). Everything below was verified against live behavior — mostly by reading response headers, which turned out to be the only source of truth we needed.

## Finding 1 (cost us two debugging rounds): there are TWO quotas, and the dashboard only shows the one that never binds

The dashboard's "Queries made" shows the **monthly plan quota** (100,000 — we never came near it). The limit that actually returns HTTP 429 is a separate **daily request bucket** — `x-ratelimit-limit: 3000` on every response, refilled daily. When it exhausted, the only honest evidence was in the headers:

```
HTTP/1.1 429 Too Many Requests
x-ratelimit-limit: 3000
x-ratelimit-remaining: 0
x-ratelimit-reset: 1788899800        (≈ 9.5 h away)
retry-after: 34169
```

The burn math is easy to hit by accident: a keeper polling every 30 s alone consumes 2,880 of the daily 3,000 (96%), and two browser tabs polling at 20–30 s spend the rest within hours. We first blamed a per-second rate limit, then "quota is exhausted" with the wrong quota — two wrong diagnoses before a single probe with `-D -` surfaced the headers.

Requests, in order of impact:

- **Show the daily bucket in the dashboard** (limit, remaining, reset time) next to the monthly counter — or at minimum name it in the pricing/quota docs. It is real, it binds first for every bot-plus-UI integration, and it is invisible until you read raw headers.
- Document the `x-ratelimit-*` / `retry-after` response headers where the quotas are documented. Our 429 handler now logs them; that one line turns "rate limited" into "locked until <exact timestamp>".
- A dashboard counter that updates near-real-time per endpoint would remove the suspicion that the monthly counter doesn't reflect dev-endpoint traffic at all (ours read 0/100,000 while the key was hard-locked).

## Finding 2 (docs): entity `id` ordering is lexicographic, not numeric

`orderBy: id` returns `"1", "10", "11", "2"`, … because ids are strings. Every list view we have sorts numerically client-side after fetching. A docs warning (or a numeric ordering directive) would save the next builder the "why is schedule 9 after 11" confusion.

## Finding 3 (workflow): redeploys archive the previous version — every consumer must repin in the same change

Versioned query URLs are a *feature* we lean on deliberately (keeper and frontend pin `…/v0.0.3`; judges get deterministic queries). But each redeploy archives the previous version, so a routine fix becomes a cross-cutting change: bump the version label, redeploy, wait for re-index from `startBlock`, then update the pinned URL in the keeper config, the frontend client, and the docs in one commit. An "alias/latest" pinning mode (opt-in, for integrators who prefer continuity over determinism) would make small iterations much cheaper without taking the pinned mode away.

## Finding 4 (builder-side): no native fixed-point in mappings

`BenchmarkComparison` compares realized VWAP against the NEUTRAL counterfactual per fill — the mapping has to carry the math as 18-decimal-scale strings, and the frontend divides. It works, but it is the kind of thing that silently overflows or loses precision in AssemblyScript. An official fixed-point/decimals helper library (documented alongside the indexing best practices) would remove a whole category of hand-rolled bigint care.

## What we'd love next

- **A consumer-side skill/guide.** The published subgraphs-skills are excellent for *authoring* (we used the optimization guidance: immutable entities, Bytes-as-ids), but there is no counterpart for *querying*: rate-limit behavior, header semantics, budget math for pollers, versioned-URL pinning policy. This feedback is half of that guide; we would happily contribute the rest.
- Near-real-time per-endpoint query counters on the Studio dashboard.

## What we shipped on top of the subgraph

- Keeper decision layer (fail-closed: unreachable subgraph ⇒ the tick is skipped and logged, never replaced with local data; `_meta` lag is reported per tick and quantified).
- Every data screen live from the endpoint — Positions, Execution (planned-vs-actual ruler + fill/skip journal), Performance (VWAP-vs-TWAP per position, negative improvements shown, never filtered), Activity (Created/Filled/Held/Completed stream + CSV export), Portfolio.
- Honest 429 handling end to end: progressive keeper back-off (1 → 5 → 15 min), frontend single-flight + request pacing, and a boot screen that names the subgraph state instead of pretending.
