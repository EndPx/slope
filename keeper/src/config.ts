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
  /** Extra seconds past the position window before the policy expires. */
  settlementBufferSeconds: bigint;
  /** Live subgraph consumption (track requirement): the VERSIONED Studio
   *  query endpoint, pinned at v0.0.1 — not a generic URL. */
  graphApiKey: string;
  graphQueryUrl: string;
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
    settlementBufferSeconds: 86_400n, // one day past the window for terminal settles
    graphApiKey: process.env.GRAPH_API_KEY ?? "",
    // Pinned versioned deployment (docs/SUBGRAPH.md); GRAPH_QUERY_URL can
    // point at a newer version after a redeploy — never a generic URL.
    graphQueryUrl:
      process.env.GRAPH_QUERY_URL ??
      "https://api.studio.thegraph.com/query/1758808/slope-base-sepolia/v0.0.1",
  };
}

export function requireCredentials(cfg: KeeperConfig): void {
  if (!cfg.appId || !cfg.appSecret) {
    throw new Error("PRIVY_APP_ID / PRIVY_APP_SECRET missing (set them in the gitignored .env)");
  }
}
