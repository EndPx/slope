# 04 — Step 2: AGGRESSIVE and CONSERVATIVE Shapes (implementation directive)

Scope directive for the second implementation step — only the two remaining shapes, nothing more.

## Implementation

- `curveFunction` for AGGRESSIVE (exponent < 1, e.g. 0.5) and CONSERVATIVE (exponent > 1, e.g. 2) in `CurveMath`, per SPEC section 4.
- Remove the `UnsupportedShape` creation guard for these two shapes.
- For exponent 0.5: prefer a direct sqrt from a tested library (solmate `FixedPointMathLib` or PRBMath) over a generic pow — cheaper and less bug-prone. For exponent 2: plain multiplication, no library. **Never write sqrt/pow from scratch.**

## Required tests

- Boundaries for both shapes: `elapsed = 0 → 0`; `elapsed = duration → exactly 1e18`.
- Monotonicity and `[0, 1e18]` range fuzz for both shapes.
- Assert the curves genuinely differ in direction: at `elapsed = duration/2`, AGGRESSIVE > NEUTRAL > CONSERVATIVE — if that does not hold, the formulas are backwards.
- Cross-validation vectors against the TypeScript reference model for both shapes, same as NEUTRAL.
- Update the reference model in `shared/` to cover both shapes.

The terminal clamp keeps applying identically to every shape (`scheduleElapsed == duration` authorizes `totalBudget` directly, bypassing the formula) — no regression allowed in the existing lifecycle tests.

Granular commits as before; run the full suite and report before step 3.
