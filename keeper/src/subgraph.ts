/**
 * Live Subgraph Studio client — the keeper's decision layer.
 *
 * Track requirement: the keeper consumes LIVE indexed data from a Graph
 * provider through the API-key-authenticated VERSIONED query endpoint. There
 * is deliberately NO fallback to local/static data: if the subgraph cannot
 * be reached, the caller must skip the tick and say so loudly — a silent
 * fallback would make the "consumes live Graph data" claim false.
 *
 * Boundary (SPEC section 5): the subgraph decides WHAT to work on
 * (candidates, indexed executedAmount as the due-increment basis, skip
 * history for parking/diagnosis). Execution-critical state — price, quotes,
 * slippage, and the position's final on-chain state — is re-verified
 * on-chain right before any transaction. The subgraph's indexing lag makes
 * it unfit as the final source of truth for financial decisions.
 */
import {loadConfig} from "./config.ts";

export interface SubgraphCandidate {
  positionId: string;
  indexedExecutedAmount: bigint;
  totalBudget: bigint;
  startTimestamp: bigint;
  duration: bigint;
  /** Contract CurveShape: 0 AGGRESSIVE, 1 NEUTRAL, 2 CONSERVATIVE. */
  curveShape: number;
  lastFillTimestamp: bigint | null;
  /** Newest first, as indexed. */
  recentSkips: Array<{reason: string; timestamp: bigint}>;
}

export interface SubgraphSnapshot {
  /** Block the snapshot was indexed at — for the staleness check. */
  indexedBlock: bigint;
  candidates: SubgraphCandidate[];
}

const CANDIDATES_QUERY = `
query Candidates {
  positions(where: { isActive: true }, first: 100, orderBy: id) {
    id
    executedAmount
    totalBudget
    startTimestamp
    duration
    curveShape
    fills(first: 1, orderBy: timestamp, orderDirection: desc) { timestamp }
    skips(first: 5, orderBy: timestamp, orderDirection: desc) { reason timestamp }
  }
  _meta { block { number } }
}`;

export async function fetchSnapshot(apiKey: string, queryUrl: string): Promise<SubgraphSnapshot> {
  if (!apiKey) {
    // Fail loudly at the caller: no key means no live Graph consumption,
    // which means the keeper does not run (no silent local fallback).
    throw new Error("GRAPH_API_KEY missing — the keeper consumes live subgraph data; set it in the gitignored .env");
  }
  const response = await fetch(`${queryUrl}?key=${apiKey}`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({query: CANDIDATES_QUERY}),
  });
  if (!response.ok) {
    throw new Error(`subgraph query failed: HTTP ${response.status} ${await response.text()}`);
  }
  const body: any = await response.json();
  if (body.errors?.length) {
    throw new Error(`subgraph query errored: ${JSON.stringify(body.errors).slice(0, 300)}`);
  }
  const data = body.data;
  if (!data?.positions || !data?._meta?.block?.number) {
    throw new Error("subgraph response missing positions/_meta — is the deployment synced?");
  }
  return {
    indexedBlock: BigInt(data._meta.block.number),
    candidates: data.positions.map((p: any) => ({
      positionId: p.id,
      indexedExecutedAmount: BigInt(p.executedAmount),
      totalBudget: BigInt(p.totalBudget),
      startTimestamp: BigInt(p.startTimestamp),
      duration: BigInt(p.duration),
      curveShape: Number(p.curveShape),
      lastFillTimestamp: p.fills?.[0]?.timestamp != null ? BigInt(p.fills[0].timestamp) : null,
      recentSkips: (p.skips ?? []).map((s: any) => ({reason: s.reason, timestamp: BigInt(s.timestamp)})),
    })),
  };
}
