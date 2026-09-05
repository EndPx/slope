import test from "node:test";
import assert from "node:assert/strict";
import { normalizePrice, priceImpactBps } from "../src/price.ts";

test("normalizes WETH(18) -> USDC(6) prices", () => {
  // 1 WETH in, 2500.123456 USDC out -> 2500.123456 * 1e18.
  const { ok, price } = normalizePrice(2500123456n, 6, 10n ** 18n, 18);
  assert.equal(ok, true);
  assert.equal(price, 2500123456n * 10n ** 12n);
});

test("normalizes USDC(6) -> WETH(18) prices", () => {
  // 3000 USDC in, 1 WETH out -> (1/3000) * 1e18, floored.
  const { ok, price } = normalizePrice(10n ** 18n, 18, 3000000000n, 6);
  assert.equal(ok, true);
  assert.equal(price, (10n ** 18n * 10n ** 18n) / (3000000000n * 10n ** 12n));
  assert.equal(price, 333333333333333n);
});

test("normalization floors on rounding-sensitive cases", () => {
  const { ok, price } = normalizePrice(1n, 18, 3n, 18);
  assert.equal(ok, true);
  assert.equal(price, 333333333333333333n);
});

test("degenerate quotes report ok=false instead of throwing", () => {
  assert.equal(normalizePrice(0n, 6, 10n ** 18n, 18).ok, false);
  assert.equal(normalizePrice(10n ** 18n, 18, 0n, 6).ok, false);
});

test("price impact rounds up at the boundary", () => {
  // (3000 - 2980) * 10000 / 3000 = 66.67 -> ceil 67 bps.
  assert.equal(priceImpactBps(3000n * 10n ** 18n, 2980n * 10n ** 18n), 67n);
});

test("price impact is zero for favorable or flat executions", () => {
  assert.equal(priceImpactBps(3000n * 10n ** 18n, 3100n * 10n ** 18n), 0n);
  assert.equal(priceImpactBps(3000n * 10n ** 18n, 3000n * 10n ** 18n), 0n);
});

test("price impact ceil matches exact division + one when not divisible", () => {
  const ref = 10n ** 21n + 7n;
  const exec = 10n ** 21n;
  const floored = ((ref - exec) * 10000n) / ref;
  const ceil = (ref - exec) * 10000n % ref === 0n ? floored : floored + 1n;
  assert.equal(priceImpactBps(ref, exec), ceil);
});
