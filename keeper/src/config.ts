/** Shared keeper configuration: env + the committed deployment manifest. */
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import dotenv from "dotenv";

// The keeper's .env lives at the repository root (gitignored).
dotenv.config({path: resolve(process.cwd(), "../.env")});

export interface KeeperConfig {
  appId: string;
  appSecret: string;
  rpcUrl: string;
  chainId: bigint;
  slopePosition: string;
  manifestPath: string;
  keystorePath: string;
  /** Aggregation cap in raw units: headroom above the demo position budget. */
  aggregationCapRaw: bigint;
  /** Extra seconds past the position window before the policy expires. */
  settlementBufferSeconds: bigint;
}

function manifest(): {
  slopePosition: string;
  dETH: string;
  dUSD: string;
  aquaRouter: string;
  chainId: number;
} {
  const p = resolve(process.cwd(), "../contracts/deployments/base-sepolia.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

export function loadConfig(): KeeperConfig {
  const m = manifest();
  return {
    appId: process.env.PRIVY_APP_ID ?? "",
    appSecret: process.env.PRIVY_APP_SECRET ?? "",
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
    chainId: BigInt(m.chainId),
    slopePosition: m.slopePosition,
    manifestPath: "deployments/base-sepolia.json",
    keystorePath: ".keystore.json",
    // REVISION 1 Caveat 1: skipped fills still consume aggregation headroom,
    // and the app-wide aggregation is shared across positions — cap at
    // 2.5x a single 10e18 budget instead of a tight value.
    aggregationCapRaw: 100_000_000_000_000_000_000n, // 100 tokens raw: 10x headroom — denied attempts still consume the sum
    settlementBufferSeconds: 86_400n, // one day past the window for terminal settles
  };
}

export function requireCredentials(cfg: KeeperConfig): void {
  if (!cfg.appId || !cfg.appSecret) {
    throw new Error("PRIVY_APP_ID / PRIVY_APP_SECRET missing (set them in the gitignored .env)");
  }
}
