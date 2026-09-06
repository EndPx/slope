/**
 * Candidate selection and ranking — pure, unit-testable.
 *
 * The subgraph decides WHAT to work on: which active positions to tick, in
 * which order, and which to leave alone this tick. This module turns a
 * SubgraphSnapshot into that plan WITHOUT any RPC call:
 *
 *  - estimated due increment from the indexed executedAmount + the shared
 *    curve model (the keeper only ever tightens what the curve authorizes;
 *    the final authorization is re-verified on-chain before signing);
 *  - skip history for parking and diagnosis: a recent TRANSFER_FAILED parks
 *    immediately (only an owner-side fund+approve can change it), repeated
 *    quote-quality/impact skips degrade priority for review instead of
 *    blocking (market conditions can recover);
 *  - ranking by estimated due, largest first.
 */
import {Shape, progress} from "../../shared/src/curve.ts";
import type {SubgraphCandidate} from "./subgraph.ts";

export const TRANSFER_FAILED_PARK_SECONDS = 900n; // 15 minutes
const DEGRADE_STREAK = 3;
const DEGRADE_REASONS = new Set(["IMPACT", "BOUNDS", "QUOTE_INVALID"]);

export interface RankedCandidate {
  positionId: string;
  estimatedDue: bigint;
  /** Repeated impact/bounds/quote skips: run last, log the diagnosis. */
  degraded: boolean;
}

export interface CandidatePlan {
  ranked: RankedCandidate[];
  notDue: string[];
  notDelegated: string[];
  fastParks: Array<{positionId: string; note: string}>;
}

export function estimatedDue(candidate: SubgraphCandidate, nowSeconds: bigint): bigint {
  const elapsed = nowSeconds > candidate.startTimestamp ? nowSeconds - candidate.startTimestamp : 0n;
  const scheduleElapsed = elapsed < candidate.duration ? elapsed : candidate.duration;
  const progress_ = progress(scheduleElapsed, candidate.duration, candidate.curveShape as Shape);
  const authorized = (candidate.totalBudget * progress_) / 10n ** 18n;
  const due = authorized - candidate.indexedExecutedAmount;
  return due > 0n ? due : 0n;
}

export function selectCandidates(params: {
  snapshot: {candidates: SubgraphCandidate[]};
  keystore: Record<string, {disabled?: string}>;
  nowSeconds: bigint;
}): CandidatePlan {
  const plan: CandidatePlan = {ranked: [], notDue: [], notDelegated: [], fastParks: []};
  for (const candidate of params.snapshot.candidates) {
    const entry = params.keystore[candidate.positionId];
    if (!entry) {
      plan.notDelegated.push(candidate.positionId);
      continue;
    }
    if (entry.disabled) {
      // Parked for a known permanent cause — the reason is already logged
      // at startup; do not spend anything on it.
      continue;
    }

    const recent = candidate.recentSkips.filter(
      (s) => params.nowSeconds - s.timestamp <= TRANSFER_FAILED_PARK_SECONDS,
    );
    if (recent[0]?.reason === "TRANSFER_FAILED") {
      plan.fastParks.push({
        positionId: candidate.positionId,
        note: "indexed skip TRANSFER_FAILED within 15 min — owner wallet needs tokenIn balance + approval",
      });
      continue;
    }

    const due = estimatedDue(candidate, params.nowSeconds);
    if (due === 0n) {
      plan.notDue.push(candidate.positionId);
      continue;
    }

    // Degraded priority: the newest DEGRADE_STREAK skips are all
    // quote-quality/impact/bounds — execution would likely skip again.
    const degraded =
      candidate.recentSkips.length >= DEGRADE_STREAK &&
      candidate.recentSkips.slice(0, DEGRADE_STREAK).every((s) => DEGRADE_REASONS.has(s.reason));

    plan.ranked.push({positionId: candidate.positionId, estimatedDue: due, degraded});
  }
  plan.ranked.sort((a, b) => (a.estimatedDue > b.estimatedDue ? -1 : a.estimatedDue < b.estimatedDue ? 1 : 0));
  return plan;
}
