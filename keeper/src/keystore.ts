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
  createdAt: string;
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
