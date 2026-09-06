/**
 * Display formatting and the human reason map. Skip copy speaks first in the
 * user's language; the on-chain enum name is the secondary annotation.
 */
import {formatUnits} from "viem";

export function fmtToken(raw: bigint, decimals: number, maxFrac = 4): string {
  const n = Number(formatUnits(raw, decimals));
  return n.toLocaleString("en-US", {maximumFractionDigits: maxFrac});
}

export function fmtPrice(raw18: bigint | null): string {
  if (raw18 === null) return "—";
  const n = Number(formatUnits(raw18, 18));
  return n.toLocaleString("en-US", {maximumFractionDigits: 2, minimumFractionDigits: 2});
}

/** Subgraph BigDecimal strings are plain decimals, not raw units. */
export function fmtDecimal(value: string | null): string {
  if (value === null) return "—";
  const n = Number(value);
  return n.toLocaleString("en-US", {maximumFractionDigits: 2, minimumFractionDigits: 2});
}

export function fmtBps(bps: string | null): string {
  if (bps === null) return "—";
  const n = Number(bps);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)} bps`;
}

export function fmtClock(unix: bigint): string {
  return new Date(Number(unix) * 1000).toLocaleTimeString("en-GB", {hour12: false});
}

export function fmtDuration(seconds: bigint): string {
  const s = Number(seconds);
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

/** [human headline, what it means / what happens next] — enum secondary. */
export const REASON_COPY: Record<string, [string, string]> = {
  NOT_DUE: ["Not due yet", "The schedule hasn't authorized this slice"],
  MIN_FILL: ["Below minimum size", "Waiting for slices to accumulate — the final one always settles"],
  BOUNDS: ["Price left your rails", "The execution price fell outside the band you set"],
  IMPACT: ["Price impact too high", "This slice would move the price beyond your limit — waiting for liquidity"],
  QUOTE_INVALID: ["Price unreadable", "No valid quote right now — waiting for one"],
  TRANSFER_FAILED: ["Token couldn't be pulled", "Wallet balance or allowance ran out — approve again to resume"],
};

export function reasonCopy(reason: string): [string, string] {
  return REASON_COPY[reason] ?? ["Held", "A guard rail held this slice back"];
}
