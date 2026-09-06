/**
 * Failure classification for the keeper loop.
 *
 * Deterministic failures can never succeed on retry, and every sign attempt
 * — denied ones included — is recorded into the position's aggregation
 * window at sign time (REVISION 1 Caveat 1). Retrying them is exactly how
 * the app-wide window was exhausted (live incident 2026-09-06: 12 failed
 * signs x 10 dETH exceeded the 100 dETH cap), so the keeper parks on the
 * FIRST deterministic failure instead of burning its 3-strike budget.
 */
export function isDeterministicPrivyError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  return (
    // 400 from Privy: the authorization signature verified but the wallet's
    // policy denied the request (scope, per-tx cap, aggregation cap, expiry).
    msg.includes('"policy_violation"') ||
    // 401 from Privy: the authorization signature did not verify against
    // the registered key quorum (e.g. malformed quorum key).
    msg.includes("No valid authorization signatures")
  );
}
