# 03 — Review: Execution Mechanics (two rounds, produced REVISION 3)

Human review of the step-1 contract implementation. Scope assessment: correctly scoped, no over-engineering. The issues below were correctness problems — and round 1 contained one blocker.

## Round 1 — blocking: the terminal clamp was unreachable

The code reverted at `elapsed > duration`, so the terminal-clamp branch (`elapsed ≥ duration` ⇒ authorized = `totalBudget`) was reachable only at the exact second `elapsed == duration`. A polling keeper misses that window almost every run — the remainder could never be filled, `PositionCompleted` never fired, and the position hung forever. This was precisely the dust-residual problem REVISION 2 introduced the clamp to solve: the fix was present but unreachable. Passing lifecycle tests were landing on the exact second by construction or not asserting completion — "re-check the test, not just the contract".

Preferred fix (adopted): **remove the hard expiry revert** — `duration` is the execution schedule, not a forfeiture deadline; after the window the schedule is clamped at 100% and the position completes when the budget is exhausted. Alternative (rejected): a hard stop pushed out by an explicit settlement window, which would need documented forfeiture semantics.

Also round 1:
- **Probe amount can strand positions**: on 6-decimal tokens the floored probe (fill/1000) collapses to 1 wei → zero quote → a permanent, misleading skip. Fix: a meaningful probe floor derived from `decimalsIn`, plus a **separate skip reason** (`QUOTE_INVALID`) so quote-quality failures never masquerade as impact failures.
- **`quotedIn` vs `fillAmount` (deferred to step 3, decided now)**: `executedAmount` assumes exact-in consumes the full input — verify on the real router; if partial, increment by the swap-returned amount. Plus: the independent minimum-output guard belongs in `takerTraitsAndData` as a hard swap-level floor. Registered as open items OI-1/OI-2.
- Notes (documentation only): `_sweep` transfers the whole tokenOut balance (state the invariant and the donation edge case); unlimited router allowance to an owner-supplied address (state it is deliberate and bounded to one fill in flight).

## Round 2 — one new bug from the probe fix, plus follow-ups

- **BUG: the probe floor silently disabled the impact check for small fills.** With the floor at 0.01 units, every fill below it became its own probe — `referencePrice == executionPrice`, impact always zero, and the check inert for an entire normal class of fills. Fixes: (1) lower the floor to `10^(decimalsIn − 4)`, validated against both 18- and 6-decimal shapes; (2) stop claiming the case is negligible — the comment must state plainly that the impact check does not apply below the floor and absolute bounds remain the only protection; (3) a distinct signal — `impactChecked` on `FillExecuted` — so logs and the Subgraph never present an unchecked fill as verified. Whatever floor is chosen gets recorded in SPEC REVISION 3, and no README may claim "every fill is price-impact checked".
- **Lifecycle test must advance well past `duration`** — a test landing exactly at `elapsed == duration` proves nothing about the clamp fix. Required: advance beyond it, assert `executedAmount == totalBudget` exactly, `isActive == false`, `PositionCompleted` emitted, and a sub-`minFillAmount` remainder still settling.
- **OI-2 registered** in the SPEC appendix and annotated at the `swap` call site; OI-1 confirmed present in the appendix (no dangling references).

Priorities as issued: probe floor and its honesty signal first, lifecycle test second, OI-2 documentation in the same commit as the SPEC update.
