import {describe, expect, it} from "vitest";
import {
  ADAPTIVE_EXECUTE_ABI,
  buildAggregationBody,
  buildPositionPolicy,
} from "../src/policy-template.ts";

const SLOPE = "0xC7c6FaD1C2A0e8961E34D40c39C059ECE6dBB8Cc";

describe("aggregation body", () => {
  const body = buildAggregationBody(SLOPE) as Record<string, any>;

  it("sums the decoded maxAmountIn calldata param", () => {
    expect(body.metric.field).toBe("adaptiveExecute.maxAmountIn");
    expect(body.metric.field_source).toBe("ethereum_calldata");
    expect(body.metric.function).toBe("sum");
    expect(body.metric.abi).toEqual(ADAPTIVE_EXECUTE_ABI);
  });

  it("uses the maximum rolling window (72h)", () => {
    expect(body.window).toEqual({type: "rolling", seconds: 259_200});
  });

  it("tracks only adaptiveExecute calls to SlopePosition (sync with policy)", () => {
    const conditions = body.conditions;
    expect(conditions).toContainEqual({
      field_source: "ethereum_transaction",
      field: "to",
      operator: "eq",
      value: SLOPE,
    });
    expect(conditions).toContainEqual({
      field_source: "ethereum_calldata",
      field: "function_name",
      operator: "eq",
      value: "adaptiveExecute",
      abi: ADAPTIVE_EXECUTE_ABI,
    });
  });
});

describe("position policy", () => {
  const policy = buildPositionPolicy({
    positionId: 2n,
    slopePosition: SLOPE,
    budgetRaw: 10n * 10n ** 18n,
    aggregationId: "agg_123",
    aggregationCapRaw: 25n * 10n ** 18n,
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

  it("restricts the function to adaptiveExecute and caps maxAmountIn per transaction", () => {
    const conditions = policy.rules[0].conditions;
    const cap = conditions.find((c: any) => c.field === "adaptiveExecute.maxAmountIn");
    expect(cap.operator).toBe("lte");
    // 10 tokens raw = 10e18 = 0x8AC7230489E80000
    expect(cap.value).toBe("0x8ac7230489e80000");
    expect(cap.abi).toEqual(ADAPTIVE_EXECUTE_ABI);
  });

  it("references the aggregation as a rolling rate limit", () => {
    const ref = policy.rules[0].conditions.find((c: any) => c.field_source === "reference");
    expect(ref.field).toBe("aggregation.agg_123");
    expect(ref.operator).toBe("lte");
    expect(ref.value).toBe("0x" + (25n * 10n ** 18n).toString(16));
  });

  it("encodes the per-order expiry as a system-time bound", () => {
    const time = policy.rules[0].conditions.find(
      (c: any) => c.field_source === "system" && c.field === "current_unix_timestamp",
    );
    expect(time.operator).toBe("lt");
    expect(time.value).toBe("1800000000");
  });
});
