# Aqua (1inch) Track Feedback — Slope (ETHGlobal Online 2026)

Slope is a non-custodial taker-side execution product: it splits a large swap across **time** along a user-chosen curve, executed by a delegated keeper. Every fill swaps through the Aqua SwapVM router (`quote` → `swap`) against a docked ferrum strategy — the same maker/order/traits triple across the contract, the keeper, and the browser. On top of that we consume `@1inch/aqua-sdk` (0.2.0, then 0.3.1) in the frontend to decode the protocol layer of every executed fill. Everything below was verified against live behavior on Base Sepolia; our deployment is public and every claim is reproducible from the tx hashes, block numbers and the manifest in this repository.

## What worked — and what we shipped with it

- **`PushedEvent` / `PulledEvent` decode live fills perfectly.** Every fill transaction emits Aqua's `Pushed` (slice in) and `Pulled` (output back) events, and the SDK's topics matched our receipts byte-for-byte on both 0.2.0 and 0.3.1. Our Execution screen shows the protocol layer of the latest fill, decoded with `fromLog` from the live receipt (see `frontend/src/AquaTrace.tsx`): e.g. `push 0.04 dETH · pull 113.0062 dUSD — strategy 0x4a4ffe…c8db`. We have pointed the panel at fills across all four schedules — sixty-plus fills exist — and have not seen a single decode mismatch.
- **`router.quote` powers the honest pre-trade estimate.** The Create screen's `EST. OUT` runs the exact `quote(order, tokenIn, tokenOut, budget, takerTraitsAndData)` call the contract makes before a fill, debounced against the browser — so the user sees the router's real answer, not an invented rate.
- **Small dependency footprint.** `viem` (already our stack) + `@1inch/sdk-core`; the 0.2.0 → 0.3.1 upgrade was a zero-diff non-event for us.

## Finding 1 (blocking for provenance features): the testnet registry's `Docked` events don't match the SDK's signature

`DockedEvent.TOPIC` (`0xd173a1d1…`) **never appears** on the Base Sepolia registry our contracts use (`0xd2A8f6D7…`, deployed with the app). What the registry *does* emit inside the deployment window (blocks 46418713–46426713, 5 events total) are **anonymous-layout events** — a single topic (the signature hash) with every argument in `data`:

| observed topic0 | matches the SDK's |
| --- | --- |
| `0xdc3622e0…` | `ShippedEvent.TOPIC` ✔ |
| `0x3f18354a…` | `PushedEvent.TOPIC` ✔ |
| `0x3ad61047…` | `PulledEvent.TOPIC` ✔ |
| `0xd173a1d1…` (`DockedEvent.TOPIC`) | **never observed** |

The strategy demonstrably works — four schedules, sixty-plus fills, every one pushing and pulling through this registry — so docking happened. The likely explanation is a version skew between the SDK's event definitions and the testnet registry's deployed ABI (the anonymous layout, in particular, is a different encoding than the SDK's indexed-args classes assume). Request: publish the testnet deployment addresses *and* their exact event ABIs (a `testnets` entry in `AQUA_CONTRACT_ADDRESSES` plus a per-deployment ABI), so an integrator can decode protocol events on testnet without reverse-engineering topics from receipts.

## Finding 2 (dangerous default): `fromLog` decodes without validating `topics[0]`

`DockedEvent.fromLog()` happily accepted `Pushed`/`Pulled` logs and returned plausible-looking `{maker, app, strategyHash}` values — a positional decode of unrelated events. We briefly shipped a "strategy docked at block N" UI claim from exactly this false positive before catching it. Request: have `fromLog` check `topics[0] === TOPIC` and throw on mismatch (or offer `fromLogUnchecked`), since the decoded output *looks* authoritative even when the source event is a different one.

## Finding 3 (silent failure): `HexString` instances are dropped from viem `getLogs` topics

Passing an SDK `HexString` as a topic through viem's `getLogs` sends `"topics": []` — the array is silently emptied (viem requires primitive `` `0x${string}` ``), so the query returns **every** log instead of the filtered ones. The request succeeds; the result just quietly means something different. We burned a debugging round on "the event doesn't exist" when the truth was "the filter never left the client" (captured by wrapping `fetch` and comparing request bodies). Request: brand `HexString` as a primitive-compatible type (or expose `HexLike = Hex | HexString` helpers for filter construction), and/or document that SDK hex wrappers must be converted before entering viem filter objects. `hexString` being a private field makes the workaround (`String(topic)`) feel like reaching into internals.

## Finding 4 (DX): `AQUA_ABI`'s readonly item types don't satisfy viem's `getLogs {abi, eventName}` overload

`client.getLogs({address, abi: ABI.AQUA_ABI, eventName: "Docked", …})` fails to typecheck (viem can't match the SDK's readonly item shapes against its `Abi`), forcing a raw `client.request("eth_getLogs")` plus per-log casts. Since `viem ^2.48.4` is already a direct dependency of the SDK, exporting a viem-`Abi`-compatible constant (or a sibling) would let integrators stay on the typed path.

## Finding 5 (docs): `rawBalances` / `safeBalances` semantics are undocumented

For our `maker + app + strategyHash + token` we read ~1030.5 (18-dec) dETH and ~2.9M (6-dec) dUSD raw from the registry, while the same maker's wallet held ~6,000 dETH and ~40 dETH were ever executed across all schedules. Without units or an accounting description (cumulative pushes? pushes minus pulls? some multiplier?), the numbers can't be used in any UI — we chose to leave them out rather than display something we can't explain. A short doc tying `rawBalances` to an observable push/pull history would change that.

## What we'd love next

- **A testnet track in the SDK**: addresses + ABIs + a smoke example for a Base Sepolia deployment, so the event-decoding layer we built works out of the box for the next hackathon team.
- **`fromLog` strictness** (Finding 2) — one comparison, and an entire class of silent false positives disappears.
- Long-shot, but: a frontend-oriented quote/swap helper for the SwapVM router (order struct + takerTraits construction from a seeded strategy) would replace the hand-rolled constants every integrator on a custom strategy currently maintains. We ship `maker + traits (1<<254) + program bytes + a 22-byte taker blob` as literal constants in three places (contract tests, keeper, frontend) — an SDK builder for that shape would be the single biggest DX win we can imagine for this stack.
