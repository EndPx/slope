/**
 * Reference model of the execution schedule (docs/MATH_SPEC.md sections 3-4).
 *
 * This is the single source of truth for the schedule outside Solidity: the
 * UI curve preview, the keeper's `authorizedNow` computation, and the
 * cross-validation vectors all run this exact code. Integer semantics mirror
 * the contract: non-negative BigInt floor division only.
 */

export const WAD = 10n ** 18n;

export const Shape = { AGGRESSIVE: 0, NEUTRAL: 1, CONSERVATIVE: 2 } as const;
export type Shape = (typeof Shape)[keyof typeof Shape];

export class ElapsedExceedsDurationError extends Error {
  constructor() {
    super("elapsed exceeds duration");
  }
}

/** Newton's method integer square root, floored, for the AGGRESSIVE shape. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("isqrt of a negative number");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * Fraction of the budget authorized at `elapsed`, in WAD (1e18 = 100%).
 * Exact at both boundaries by construction: progress(0) = 0 and
 * progress(duration) = 1e18 with zero rounding error for every shape.
 */
export function progress(elapsed: bigint, duration: bigint, shape: Shape): bigint {
  if (duration <= 0n) throw new RangeError("duration must be positive");
  if (elapsed > duration) throw new ElapsedExceedsDurationError();
  if (elapsed === 0n) return 0n;
  if (elapsed === duration) return WAD;
  const r = (elapsed * WAD) / duration; // floor
  if (shape === Shape.NEUTRAL) return r;
  if (shape === Shape.AGGRESSIVE) return isqrt(r * WAD);
  if (shape === Shape.CONSERVATIVE) return (r * r) / WAD;
  throw new Error("unsupported shape");
}

/** totalBudget * progress / 1e18, floored — never over-authorizes. */
export function authorizedCumulative(totalBudget: bigint, progressValue: bigint): bigint {
  return (totalBudget * progressValue) / WAD;
}

/** The contract executes min(authorizedNow, maxAmountIn). */
export function fillAmount(authorizedNow: bigint, maxAmountIn: bigint): bigint {
  return authorizedNow < maxAmountIn ? authorizedNow : maxAmountIn;
}
