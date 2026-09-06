/**
 * One-off live-policy rebuild (run: pnpm --filter @slope/keeper patch-aggregations).
 *
 * Two generations of live policies predate the final template:
 *  - gen 1 (positions 5/6): hex per-tx cap + aggregation reference;
 *  - gen 2 (positions 8/9): decimal per-tx cap + aggregation reference.
 * Live testing proved that aggregation-reference conditions deny EVERY
 * eth_signTransaction (see policy-template.ts VERIFIED NOTE), so this
 * rebuilds every active entry's policy to the final shape — allowlist +
 * selector + positionId binding + per-tx cap (the ON-CHAIN totalBudget) +
 * expiry — WITHOUT re-delegation (quorum and wallet consent stay valid),
 * and deletes the stale per-position aggregation windows (the app owns at
 * most 10).
 */
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {createPublicClient, http} from "viem";
import {baseSepolia} from "viem/chains";
import {loadConfig, requireCredentials} from "./config.ts";
import {getPolicy, updatePolicy, deleteAggregation} from "./privy-rest.ts";
import {buildPositionPolicy} from "./policy-template.ts";
import {loadKeystore, saveKeystore} from "./keystore.ts";

/** Positions whose quorum/route can never produce a successful fill. */
const DISABLED: Record<string, string> = {
  "5":
    "quorum registered with a PEM-format public key — Privy rejects every authorization signature (401); route also predates the 22-byte taker blob",
  "6":
    "route predates the 22-byte taker blob fix — every fill would revert on-chain (TakerTraitsMissingTraits); recover funds via cancelPosition by the owner",
};

/** Window created by the first migration attempt; never referenced by a policy. */
const ORPHANED_AGGREGATIONS = ["ofyemc1jg8uvq3fpe2nean1o"];

const cfg = loadConfig();
requireCredentials(cfg);
const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "../contracts/deployments/base-sepolia.json"), "utf8"),
);
const client = createPublicClient({chain: baseSepolia, transport: http(cfg.rpcUrl)});
const POSITION_ABI = [
  {
    type: "function",
    name: "getPosition",
    stateMutability: "view",
    inputs: [{type: "uint256", name: "positionId"}],
    outputs: [
      {
        type: "tuple",
        components: [
          {type: "address", name: "owner"},
          {type: "address", name: "tokenIn"},
          {type: "address", name: "tokenOut"},
          {type: "uint8", name: "decimalsIn"},
          {type: "uint8", name: "decimalsOut"},
          {type: "uint256", name: "totalBudget"},
          {type: "uint256", name: "executedAmount"},
          {type: "uint256", name: "minFillAmount"},
          {type: "uint256", name: "startTimestamp"},
          {type: "uint256", name: "duration"},
          {type: "uint8", name: "curveShape"},
          {type: "uint256", name: "minPrice"},
          {type: "uint256", name: "maxPrice"},
          {type: "uint16", name: "maxSlippageBps"},
          {type: "bool", name: "isActive"},
        ],
        internalType: "struct Position",
      },
    ],
  },
] as const;

const store = loadKeystore();

for (const [positionId, entry] of Object.entries(store)) {
  if (DISABLED[positionId] !== undefined) {
    entry.disabled ??= DISABLED[positionId];
    console.log(`[${positionId}] disabled — ${entry.disabled}`);
    continue;
  }

  const res: unknown = await client.readContract({
    address: manifest.slopePosition,
    abi: POSITION_ABI,
    functionName: "getPosition",
    args: [BigInt(positionId)],
  });
  const position = (Array.isArray(res) ? res[0] : res) as {totalBudget: bigint};
  const budgetRaw = position.totalBudget;

  const policy = await getPolicy(cfg, entry.policyId);
  const oldExpiry = policy.rules?.[0]?.conditions?.find(
    (c) => c["field"] === "current_unix_timestamp",
  )?.["value"];
  const expirySeconds = BigInt(String(oldExpiry));

  const rebuilt = buildPositionPolicy({
    positionId: BigInt(positionId),
    slopePosition: cfg.slopePosition,
    budgetRaw,
    expirySeconds,
    policyName: policy.name ?? `Slope pos ${positionId}`,
  });
  await updatePolicy(cfg, entry.policyId, {name: rebuilt.name, rules: rebuilt.rules});
  console.log(
    `[${positionId}] policy ${entry.policyId} rebuilt: allowlist + selector + positionId ${positionId} + per-tx cap ${budgetRaw} + expiry ${expirySeconds}`,
  );
}

// Recycle stale aggregation windows.
const stale = [...ORPHANED_AGGREGATIONS];
for (const entry of Object.values(store)) {
  if (entry.aggregationId) stale.push(entry.aggregationId);
}
for (const id of [...new Set(stale)]) {
  try {
    await deleteAggregation(cfg, id);
    console.log(`deleted stale aggregation ${id}`);
  } catch (e) {
    console.error(`deleting stale aggregation ${id} failed:`, (e as Error).message);
  }
}
for (const entry of Object.values(store)) {
  delete entry.aggregationId;
}

saveKeystore(store);
console.log("rebuild done");
