import {describe, expect, it} from "vitest";
import {isDeterministicPrivyError} from "../src/errors.ts";

// Exact error shapes observed live from Privy signTransaction.
const POLICY_VIOLATION_400 =
  '400 {"error":"RPC request denied due to policy violation","code":"policy_violation"}';
const AUTH_SIGNATURES_401 =
  '401 {"error":"No valid authorization signatures were provided for this wallet"}';

describe("isDeterministicPrivyError", () => {
  it("parks on policy denials (400)", () => {
    expect(isDeterministicPrivyError(new Error(POLICY_VIOLATION_400))).toBe(true);
  });

  it("parks on authorization-signature failures (401)", () => {
    expect(isDeterministicPrivyError(new Error(AUTH_SIGNATURES_401))).toBe(true);
  });

  it("accepts the raw message string, not just Error objects", () => {
    expect(isDeterministicPrivyError(POLICY_VIOLATION_400)).toBe(true);
    expect(isDeterministicPrivyError(AUTH_SIGNATURES_401)).toBe(true);
  });

  it("does NOT park on transient failures (these keep the 3-strike budget)", () => {
    expect(isDeterministicPrivyError(new Error("fetch failed"))).toBe(false);
    expect(isDeterministicPrivyError(new Error("nonce has already been used"))).toBe(false);
    expect(isDeterministicPrivyError(new Error("intrinsic gas too low"))).toBe(false);
    // Reverts are state-dependent: a later attempt with a larger
    // authorizedNow can succeed, so they stay on the 3-strike path.
    expect(isDeterministicPrivyError(new Error("Transaction has been reverted"))).toBe(false);
  });

  it("treats unknown shapes as transient (never parks by accident)", () => {
    expect(isDeterministicPrivyError(undefined)).toBe(false);
    expect(isDeterministicPrivyError({code: 429})).toBe(false);
  });
});
