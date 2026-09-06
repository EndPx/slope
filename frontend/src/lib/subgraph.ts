/**
 * Live Subgraph Studio client for the UI — the same versioned endpoint the
 * keeper consumes (track requirement: live Graph data, not mock/local).
 * Failures throw loudly; the caller shows them instead of substituting
 * cached or fake data.
 */
const QUERY_URL =
  (import.meta.env.VITE_GRAPH_QUERY_URL as string | undefined) ??
  "https://api.studio.thegraph.com/query/1758808/slope-base-sepolia/v0.0.1";
const API_KEY = (import.meta.env.VITE_GRAPH_API_KEY as string | undefined) ?? "";

export async function gql<T>(query: string): Promise<T> {
  if (!API_KEY) throw new Error("VITE_GRAPH_API_KEY missing — the UI consumes live subgraph data; set it in .env");
  const response = await fetch(`${QUERY_URL}?key=${API_KEY}`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({query}),
  });
  if (!response.ok) throw new Error(`subgraph HTTP ${response.status}`);
  const body: any = await response.json();
  if (body.errors?.length) throw new Error(body.errors[0]?.message ?? "subgraph query error");
  if (!body.data) throw new Error("subgraph returned no data");
  return body.data as T;
}

export interface Fill {
  id: string;
  amountIn: bigint;
  amountOut: bigint;
  executionPrice: bigint;
  timestamp: bigint;
  impactChecked: boolean;
}

export interface Skip {
  id: string;
  reason: string;
  timestamp: bigint;
}

export interface Benchmark {
  fillCount: number;
  elapsedAtLastFill: bigint;
  plannedExecuted: string;
  actualExecuted: string;
  actualVWAP: string;
  twapVWAP: string | null;
  improvementBps: string | null;
}

export interface Position {
  id: string;
  owner: string;
  tokenIn: string;
  tokenOut: string;
  decimalsIn: number;
  decimalsOut: number;
  totalBudget: bigint;
  minFillAmount: bigint;
  curveShape: number;
  startTimestamp: bigint;
  duration: bigint;
  minPrice: bigint;
  maxPrice: bigint;
  maxSlippageBps: number;
  isActive: boolean;
  executedAmount: bigint;
  fills: Fill[];
  skips: Skip[];
  benchmark: Benchmark | null;
}

const POSITION_FIELDS = `
  id owner tokenIn tokenOut decimalsIn decimalsOut
  totalBudget minFillAmount curveShape startTimestamp duration
  minPrice maxPrice maxSlippageBps isActive executedAmount
  fills(orderBy: timestamp, orderDirection: asc) {
    id amountIn amountOut executionPrice timestamp impactChecked
  }
  skips(orderBy: timestamp, orderDirection: asc) { id reason timestamp }
  benchmark {
    fillCount elapsedAtLastFill plannedExecuted actualExecuted
    actualVWAP twapVWAP improvementBps
  }`;

function parsePosition(raw: any): Position {
  return {
    id: raw.id,
    owner: raw.owner,
    tokenIn: raw.tokenIn,
    tokenOut: raw.tokenOut,
    decimalsIn: Number(raw.decimalsIn),
    decimalsOut: Number(raw.decimalsOut),
    totalBudget: BigInt(raw.totalBudget),
    minFillAmount: BigInt(raw.minFillAmount),
    curveShape: Number(raw.curveShape),
    startTimestamp: BigInt(raw.startTimestamp),
    duration: BigInt(raw.duration),
    minPrice: BigInt(raw.minPrice),
    maxPrice: BigInt(raw.maxPrice),
    maxSlippageBps: Number(raw.maxSlippageBps),
    isActive: raw.isActive,
    executedAmount: BigInt(raw.executedAmount),
    fills: (raw.fills ?? []).map((f: any) => ({
      id: f.id,
      amountIn: BigInt(f.amountIn),
      amountOut: BigInt(f.amountOut),
      executionPrice: BigInt(f.executionPrice),
      timestamp: BigInt(f.timestamp),
      impactChecked: f.impactChecked,
    })),
    skips: (raw.skips ?? []).map((s: any) => ({id: s.id, reason: s.reason, timestamp: BigInt(s.timestamp)})),
    benchmark: raw.benchmark
      ? {
          fillCount: raw.benchmark.fillCount,
          elapsedAtLastFill: BigInt(raw.benchmark.elapsedAtLastFill),
          plannedExecuted: raw.benchmark.plannedExecuted,
          actualExecuted: raw.benchmark.actualExecuted,
          actualVWAP: raw.benchmark.actualVWAP,
          twapVWAP: raw.benchmark.twapVWAP,
          improvementBps: raw.benchmark.improvementBps,
        }
      : null,
  };
}

export async function fetchPosition(id: string): Promise<Position | null> {
  const data = await gql<{positions: any[]}>(`{ positions(where: { id: "${id}" }) { ${POSITION_FIELDS} } }`);
  return data.positions[0] ? parsePosition(data.positions[0]) : null;
}

export async function fetchPositionsByOwner(owner: string): Promise<Position[]> {
  const data = await gql<{positions: any[]}>(
    `{ positions(where: { owner: "${owner.toLowerCase()}" }, orderBy: id, orderDirection: desc) { ${POSITION_FIELDS} } }`,
  );
  return data.positions.map(parsePosition);
}

/** All indexed positions — public on-chain data, viewable without login. */
export async function fetchPositions(): Promise<Position[]> {
  const data = await gql<{positions: any[]}>(`{ positions(orderBy: id, orderDirection: desc) { ${POSITION_FIELDS} } }`);
  return data.positions.map(parsePosition);
}

/** Compact aggregate: active count, executed volume, fills in 24h, head. */
export interface ChainSummary {
  activeCount: number;
  executedVolume: bigint;
  fills24h: number;
  indexedBlock: bigint;
}

export async function fetchSummary(): Promise<ChainSummary> {
  const cutoff = Math.floor(Date.now() / 1000) - 86_400;
  const data = await gql<{positions: any[]; _meta: any}>(
    `{ positions(orderBy: id) { isActive executedAmount fills(where: { timestamp_gt: "${cutoff}" }) { id } } _meta { block { number } } }`,
  );
  let activeCount = 0;
  let executedVolume = 0n;
  let fills24h = 0;
  for (const p of data.positions) {
    if (p.isActive) activeCount += 1;
    executedVolume += BigInt(p.executedAmount);
    fills24h += (p.fills ?? []).length;
  }
  return {activeCount, executedVolume, fills24h, indexedBlock: BigInt(data._meta.block.number)};
}

export async function fetchHeadBlock(): Promise<bigint> {
  const data = await gql<{_meta: any}>(`{ _meta { block { number } } }`);
  return BigInt(data._meta.block.number);
}
