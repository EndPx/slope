/**
 * Price normalization and dual-quote impact (docs/MATH_SPEC.md section 5).
 * BigInt mirroring of contracts/src/math/PriceMath.sol — bit-exact for the
 * consensus-critical quantities.
 */

import { WAD } from "./curve.ts";

export function normalizePrice(
  amountOut: bigint,
  decimalsOut: number,
  amountIn: bigint,
  decimalsIn: number,
): { ok: boolean; price: bigint } {
  if (amountIn === 0n || amountOut === 0n) return { ok: false, price: 0n };
  const scaleOut = 10n ** BigInt(18 - decimalsOut);
  const scaleIn = 10n ** BigInt(18 - decimalsIn);
  return { ok: true, price: (amountOut * scaleOut * WAD) / (amountIn * scaleIn) };
}

/**
 * Price impact of a fill in basis points, rounded UP (ceil) — at the
 * comparison boundary ambiguity resolves in the user's favor. Favorable
 * execution prices (>= reference) have zero impact.
 */
export function priceImpactBps(referencePrice: bigint, executionPrice: bigint): bigint {
  if (executionPrice >= referencePrice) return 0n;
  return ((referencePrice - executionPrice) * 10000n + referencePrice - 1n) / referencePrice;
}
