import {describe, expect, it} from "vitest";
import {estimatedDue, selectCandidates} from "../src/candidates.ts";
import type {SubgraphCandidate} from "../src/subgraph.ts";

const NOW = 1_800_000_000n;
const DURATION = 1_000n;

function candidate(overrides: Partial<SubgraphCandidate> = {}): SubgraphCandidate {
  return {
    positionId: "1",
    indexedExecutedAmount: 0n,
    totalBudget: 10n * 10n ** 18n,
    startTimestamp: NOW - 500n, // half-window
    duration: DURATION,
    curveShape: 1, // NEUTRAL
    lastFillTimestamp: null,
    recentSkips: [],
    ...overrides,
  };
}

const KEYSTORE = (ids: string[], disabled: string[] = []) =>
  Object.fromEntries(ids.map((id) => [id, disabled.includes(id) ? {disabled: "broken"} : {}]));

describe("estimatedDue", () => {
  it("computes the NEUTRAL due increment from the indexed executedAmount", () => {
    // half-window, nothing executed: due = 5 dETH
    expect(estimatedDue(candidate(), NOW)).toBe(5n * 10n ** 18n);
  });

  it("respects the indexed executedAmount (already-executed does not re-accumulate)", () => {
    const c = candidate({indexedExecutedAmount: 5n * 10n ** 18n});
    expect(estimatedDue(c, NOW)).toBe(0n);
  });

  it("clamps past the window (schedule, not forfeiture)", () => {
    const c = candidate({startTimestamp: NOW - 10n * DURATION});
    expect(estimatedDue(c, NOW)).toBe(10n * 10n ** 18n);
  });

  it("applies the position's own shape (AGGRESSIVE frontloads)", () => {
    // r = 0.5 -> sqrt(0.5) ~ 0.7071 of budget, nothing executed
    const c = candidate({curveShape: 0});
    const due = estimatedDue(c, NOW);
    expect(due).toBeGreaterThan(7n * 10n ** 18n);
    expect(due).toBeLessThan(71n * 10n ** 17n);
  });
});

describe("selectCandidates", () => {
  it("ranks by estimated due, largest first", () => {
    const snapshot = {
      candidates: [
        candidate({positionId: "small", startTimestamp: NOW - 100n}),
        candidate({positionId: "big", startTimestamp: NOW - 900n}),
      ],
    };
    const plan = selectCandidates({snapshot, keystore: KEYSTORE(["small", "big"]), nowSeconds: NOW});
    expect(plan.ranked.map((r) => r.positionId)).toEqual(["big", "small"]);
  });

  it("drops not-due positions without an RPC call", () => {
    const snapshot = {candidates: [candidate({indexedExecutedAmount: 5n * 10n ** 18n})]};
    const plan = selectCandidates({snapshot, keystore: KEYSTORE(["1"]), nowSeconds: NOW});
    expect(plan.ranked).toHaveLength(0);
    expect(plan.notDue).toEqual(["1"]);
  });

  it("skips positions without a delegation and disabled delegations", () => {
    const snapshot = {candidates: [candidate({positionId: "1"}), candidate({positionId: "2"})]};
    const plan = selectCandidates({snapshot, keystore: KEYSTORE(["1", "2"], ["2"]), nowSeconds: NOW});
    expect(plan.notDelegated).toEqual([]);
    expect(plan.ranked.map((r) => r.positionId)).toEqual(["1"]);
  });

  it("fast-parks on a recent indexed TRANSFER_FAILED skip", () => {
    const snapshot = {
      candidates: [candidate({recentSkips: [{reason: "TRANSFER_FAILED", timestamp: NOW - 60n}]})],
    };
    const plan = selectCandidates({snapshot, keystore: KEYSTORE(["1"]), nowSeconds: NOW});
    expect(plan.ranked).toHaveLength(0);
    expect(plan.fastParks).toEqual([{positionId: "1", note: expect.stringContaining("owner wallet")}]);
  });

  it("does NOT fast-park on an old TRANSFER_FAILED skip (owner may have fixed custody)", () => {
    const snapshot = {
      candidates: [candidate({recentSkips: [{reason: "TRANSFER_FAILED", timestamp: NOW - 3600n}]})],
    };
    const plan = selectCandidates({snapshot, keystore: KEYSTORE(["1"]), nowSeconds: NOW});
    expect(plan.fastParks).toHaveLength(0);
    expect(plan.ranked).toHaveLength(1);
  });

  it("degrades priority after a streak of impact/bounds/quote skips", () => {
    const skips = [
      {reason: "IMPACT", timestamp: NOW - 30n},
      {reason: "BOUNDS", timestamp: NOW - 60n},
      {reason: "QUOTE_INVALID", timestamp: NOW - 90n},
    ];
    const snapshot = {candidates: [candidate({recentSkips: skips})]};
    const plan = selectCandidates({snapshot, keystore: KEYSTORE(["1"]), nowSeconds: NOW});
    expect(plan.ranked[0].degraded).toBe(true);
  });

  it("does not degrade on a broken streak (a healthy fill inside the window)", () => {
    const skips = [
      {reason: "MIN_FILL", timestamp: NOW - 30n},
      {reason: "IMPACT", timestamp: NOW - 60n},
      {reason: "BOUNDS", timestamp: NOW - 90n},
    ];
    const snapshot = {candidates: [candidate({recentSkips: skips})]};
    const plan = selectCandidates({snapshot, keystore: KEYSTORE(["1"]), nowSeconds: NOW});
    expect(plan.ranked[0].degraded).toBe(false);
  });
});
