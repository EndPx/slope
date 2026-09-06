/**
 * Per-position authorization key store. Each delegated position gets its OWN
 * P-256 keypair + key quorum + policy: Privy allows a single override policy
 * per signer binding, so per-position scoping (expiry per order, budget cap
 * per order) requires per-position signers. The private keys live ONLY in
 * this gitignored file.
 */
import {readFileSync, writeFileSync, existsSync} from "node:fs";

const PATH = ".keystore.json";

export interface KeystoreEntry {
  positionId: string;
  owner: string;
  privateKeyB64: string;
  publicKeyB64: string;
  keyQuorumId: string;
  policyId: string;
  aggregationId?: string;
  createdAt: string;
  /** Set on positions that can never fill (broken quorum/route): the keeper skips them. */
  disabled?: string;
  /** Rolling total of maxAmountIn values signed via Privy (raw units).
   *  Privy consumes the aggregation window at sign time regardless of
   *  broadcast outcome, so the ledger is the source of truth for validating
   *  the 2x-budget aggregation cap against real behavior. */
  signedSum?: string;
  /** Number of sign requests recorded into the aggregation window. */
  signCount?: number;
}

export function loadKeystore(): Record<string, KeystoreEntry> {
  if (!existsSync(PATH)) return {};
  return JSON.parse(readFileSync(PATH, "utf8"));
}

export function saveKeystore(store: Record<string, KeystoreEntry>): void {
  writeFileSync(PATH, JSON.stringify(store, null, 2));
}

export function getEntry(positionId: string): KeystoreEntry | undefined {
  return loadKeystore()[positionId];
}

export function putEntry(entry: KeystoreEntry): void {
  const store = loadKeystore();
  store[entry.positionId] = entry;
  saveKeystore(store);
}

/** Ledgers a sign attempt (call right after Privy returns a signature). */
export function recordSign(positionId: string, amount: bigint): {signedSum: bigint; signCount: number} {
  const store = loadKeystore();
  const entry = store[positionId];
  if (!entry) throw new Error(`no keystore entry for position ${positionId}`);
  const signedSum = BigInt(entry.signedSum ?? "0") + amount;
  const signCount = (entry.signCount ?? 0) + 1;
  entry.signedSum = signedSum.toString();
  entry.signCount = signCount;
  saveKeystore(store);
  return {signedSum, signCount};
}

/** Permanently parks a position (completed, cancelled, or broken). */
export function disableEntry(positionId: string, reason: string): void {
  const store = loadKeystore();
  if (!store[positionId]) return;
  store[positionId].disabled = reason;
  saveKeystore(store);
}
