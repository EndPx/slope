# 05 — Review: CurveMath and Shape Tests (plus a coverage question)

Verdict issued: the math is correct and the implementation clean. `Math.sqrt` from OpenZeppelin instead of a hand-rolled power is the right call; the WAD dimensional handling is correct (`sqrt(r/WAD)` in WAD equals `sqrt(r × WAD)`); overflow is impossible since `r ≤ 1e18` bounds `r × WAD` at `1e36`; short-circuiting both boundaries means the exact `0`/`1e18` obligation does not depend on rounding; floor division on `r` rounds in the safe direction. The fuzz properties (`p² ≤ r × 1e18` for AGGRESSIVE, `p ≤ r` for CONSERVATIVE) test real invariants, not just range membership.

Three items (none blocking correctness):

1. **Misleading error on the unreachable branch** — `revert ElapsedExceedsDuration()` on the unknown-shape branch reports a false duration problem if a fourth `CurveShape` member is ever added. Add a distinct `UnsupportedShape` error.
2. **Midpoint bounds mixed exponents** (`7e17` and `71e16`) — easy to misread, easy to get wrong later. Better: assert the exact value — `Math.sqrt` is deterministic, so compute `floor(sqrt(5e35))` once and hardcode it; an exact assertion catches an exponent change or library swap immediately. Same for the end-to-end `executedAmount` check.
3. **Missing: full lifecycle for non-NEUTRAL shapes** — every terminal-clamp, minFill-bypass, and completion test ran on NEUTRAL only. The clamp is shape-independent by construction, but that is an assumption until tested: create an AGGRESSIVE (or CONSERVATIVE) position, fill partially inside the window, advance well past `duration`, assert exact completion and the terminal minFill bypass.

Cross-validation vectors for both shapes against the TypeScript model were requested in step 2 and confirmed present — the only closing condition beyond the three items.

## Follow-up (same review thread)

"Full lifecycle for non-NEUTRAL — does it exist for the others?" AGGRESSIVE had landed in the fix above; CONSERVATIVE had not. Closed with an exact-numbers CONSERVATIVE test: mid-window `(0.9)² = 81%` authorizes the only in-window fill above the 80% min-fill, leaving a 19e18 tail below the minimum that the terminal clamp settles long after the window. A first failing run was diagnosed from the trace and turned out to be a test-calibration error (warp beyond the file's 100-second duration had legitimately triggered the terminal clamp) — the contract behaved per spec; the test expectation was fixed.
