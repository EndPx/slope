import test from "node:test";
import assert from "node:assert/strict";
import { ElapsedExceedsDurationError, WAD, Shape, progress, authorizedCumulative, fillAmount, isqrt } from "../src/curve.ts";

test("progress is exactly 0 at elapsed = 0", () => {
  assert.equal(progress(0n, 1000n, Shape.NEUTRAL), 0n);
  assert.equal(progress(0n, 86400n, Shape.NEUTRAL), 0n);
});

test("progress is exactly 1e18 at elapsed = duration (zero rounding error)", () => {
  for (const d of [1n, 3n, 1000n, 86400n, 2592000n, 10n ** 18n]) {
    assert.equal(progress(d, d, Shape.NEUTRAL), WAD);
  }
});

test("NEUTRAL is the exact linear TWAP", () => {
  assert.equal(progress(500n, 1000n, Shape.NEUTRAL), 5n * 10n ** 17n);
  assert.equal(progress(7n, 1000n, Shape.NEUTRAL), 7n * 10n ** 15n);
});

test("progress floors: it never over-authorizes", () => {
  assert.equal(progress(333n, 1000n, Shape.NEUTRAL), 333000000000000000n);
  assert.equal(progress(1n, 3n, Shape.NEUTRAL), 333333333333333333n);
});

test("progress is monotonically non-decreasing over a full sweep", () => {
  let previous = -1n;
  for (let e = 0n; e <= 1000n; e++) {
    const p = progress(e, 1000n, Shape.NEUTRAL);
    assert.ok(p >= previous);
    assert.ok(p >= 0n && p <= WAD);
    previous = p;
  }
});

test("progress stays within [0, 1e18] on randomized windows", () => {
  const durations = [1n, 7n, 1000n, 86399n, 604800n];
  for (const d of durations) {
    for (let e = 0n; e <= d; e += (d / 50n) + 1n) {
      const p = progress(e, d, Shape.NEUTRAL);
      assert.ok(p >= 0n && p <= WAD);
    }
  }
});

test("isqrt floors correctly", () => {
  assert.equal(isqrt(0n), 0n);
  assert.equal(isqrt(1n), 1n);
  assert.equal(isqrt(3n), 1n);
  assert.equal(isqrt(4n), 2n);
  assert.equal(isqrt(10n ** 36n), 10n ** 18n);
});

test("authorizedCumulative floors", () => {
  assert.equal(authorizedCumulative(100n * 10n ** 18n, 5n * 10n ** 17n), 50n * 10n ** 18n);
  assert.equal(authorizedCumulative(3n, WAD), 3n);
  assert.equal(authorizedCumulative(2n, WAD / 2n), 1n);
});

test("fillAmount is the minimum of authorized and proposed", () => {
  assert.equal(fillAmount(50n, 30n), 30n);
  assert.equal(fillAmount(30n, 50n), 30n);
  assert.equal(fillAmount(30n, 30n), 30n);
});

test("AGGRESSIVE and CONSERVATIVE reference formulas match MATH_SPEC", () => {
  // AGGRESSIVE: (t/d)^(1/2); at t=d it is exactly 1e18; midpoint is sqrt(0.5)*1e18.
  assert.equal(progress(500n, 1000n, Shape.AGGRESSIVE), isqrt((500n * WAD * WAD) / 1000n));
  assert.equal(progress(1000n, 1000n, Shape.AGGRESSIVE), WAD);
  // CONSERVATIVE: (t/d)^2; midpoint is 0.25e18.
  assert.equal(progress(500n, 1000n, Shape.CONSERVATIVE), 25n * 10n ** 16n);
  assert.equal(progress(1000n, 1000n, Shape.CONSERVATIVE), WAD);
});

test("past-duration requests throw", () => {
  assert.throws(() => progress(1001n, 1000n, Shape.NEUTRAL), ElapsedExceedsDurationError);
});
