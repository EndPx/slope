import {describe, expect, it} from "vitest";
import {
  ADAPTIVE_EXECUTE_ABI,
  buildPositionPolicy,
} from "../src/policy-template.ts";

const SLOPE = "0xC7c6FaD1C2A0e8961E34D40c39C059ECE6dBB8Cc";

describe("position policy", () => {
  const policy = buildPositionPolicy({
    positionId: 2n,
    slopePosition: SLOPE,
    budgetRaw: 10n * 10n ** 18n,
    expirySeconds: 1_800_000_000n,
    policyName: "test policy",
  }) as Record<string, any>;

  it("is DENY-by-default: a single eth_signTransaction ALLOW rule", () => {
    expect(policy.rules).toHaveLength(1);
    expect(policy.rules[0].method).toBe("eth_signTransaction");
    expect(policy.rules[0].action).toBe("ALLOW");
  });

  it("allowlists the SlopePosition target", () => {
    const conditions = policy.rules[0].conditions;
    expect(conditions).toContainEqual({
      field_source: "ethereum_transaction",
      field: "to",
      operator: "eq",
      value: SLOPE,
    });
  });

  it("scopes the signer to its own positionId", () => {
    const conditions = policy.rules[0].conditions;
    const scope = conditions.find((c: any) => c.field === "adaptiveExecute.positionId");
    expect(scope.operator).toBe("eq");
    // Decoded calldata args are DECIMAL strings (live-tested: hex denied all)
    expect(scope.value).toBe("2");
    expect(scope.abi).toEqual(ADAPTIVE_EXECUTE_ABI);
  });

  it("restricts the function to adaptiveExecute and caps maxAmountIn per transaction", () => {
    const conditions = policy.rules[0].conditions;
    const cap = conditions.find((c: any) => c.field === "adaptiveExecute.maxAmountIn");
    expect(cap.operator).toBe("lte");
    // Decoded calldata caps are DECIMAL strings (live-tested: hex denied all)
    expect(cap.value).toBe("10000000000000000000");
    expect(cap.abi).toEqual(ADAPTIVE_EXECUTE_ABI);
  });

  it("contains NO aggregation-reference condition (live-verified: reference conditions deny every eth_signTransaction)", () => {
    const conditions = policy.rules[0].conditions;
    expect(conditions.filter((c: any) => c.field_source === "reference")).toHaveLength(0);
  });

  it("encodes the per-order expiry as a system-time bound", () => {
    const time = policy.rules[0].conditions.find(
      (c: any) => c.field_source === "system" && c.field === "current_unix_timestamp",
    );
    expect(time.operator).toBe("lt");
    expect(time.value).toBe("1800000000");
  });
});
