/**
 * One-off migration (run: pnpm --filter @slope/keeper patch-aggregations).
 *
 * Context: the original app-wide aggregation accumulated sign-time records
 * from broken positions — denied attempts consume the rolling sum — until
 * the 100 dETH cap denied EVERY new sign with policy_violation, including
 * healthy delegations. Aggregations are now created per position at
 * delegation time; this script migrates positions delegated before that
 * change WITHOUT re-delegation (quorum and wallet consent stay valid):
 *
 *   1. mark permanently-broken positions disabled (keeper skips them);
 *   2. for every other entry: create a FRESH per-position aggregation
 *      (empty 72h window), point the policy's aggregation reference at it
 *      with a 2x-budget cap, record the id in the keystore.
 *
 * The old app-wide aggregation stays behind in the Privy dashboard,
 * unreferenced by any active policy.
 */
import {loadConfig, requireCredentials} from "./config.ts";
import {createAggregation, getPolicy, updatePolicy} from "./privy-rest.ts";
import {buildAggregationBody} from "./policy-template.ts";
import {loadKeystore, saveKeystore} from "./keystore.ts";

/** Positions whose quorum/route can never produce a successful fill. */
const DISABLED: Record<string, string> = {
  "5":
    "quorum registered with a PEM-format public key — Privy rejects every authorization signature (401); route also predates the 22-byte taker blob",
  "6":
    "route predates the 22-byte taker blob fix — every fill would revert on-chain (TakerTraitsMissingTraits); recover funds via cancelPosition by the owner",
};

const cfg = loadConfig();
requireCredentials(cfg);
const store = loadKeystore();
const hex = (n: bigint) => `0x${n.toString(16)}`;

for (const [positionId, entry] of Object.entries(store)) {
  if (DISABLED[positionId] !== undefined) {
    entry.disabled = DISABLED[positionId];
    console.log(`[${positionId}] disabled — ${DISABLED[positionId]}`);
    continue;
  }

  const policy = await getPolicy(cfg, entry.policyId);
  const conditions = policy.rules?.[0]?.conditions ?? [];
  const capCondition = conditions.find((c) => c["field"] === "adaptiveExecute.maxAmountIn");
  if (!capCondition) throw new Error(`[${positionId}] per-tx cap condition not found in policy ${entry.policyId}`);
  const budgetRaw = BigInt(String(capCondition["value"]));

  const aggregation = await createAggregation(
    cfg,
    buildAggregationBody(cfg.slopePosition, BigInt(positionId)),
  );
  const rules = structuredClone(policy.rules!);
  rules[0].conditions = rules[0].conditions!.map((c) =>
    String(c["field"] ?? "").startsWith("aggregation.")
      ? {
          field_source: "reference",
          field: `aggregation.${aggregation.id}`,
          operator: "lte",
          value: hex(budgetRaw * 2n),
        }
      : c,
  );
  // PATCH takes {name, rules} only: rule ids are server-assigned and
  // version/chain_type are not patchable (live-tested).
  await updatePolicy(cfg, entry.policyId, {
    name: policy.name,
    rules: rules.map(({id: _ruleId, ...rule}) => rule),
  });
  entry.aggregationId = aggregation.id;
  console.log(
    `[${positionId}] policy ${entry.policyId} -> fresh aggregation ${aggregation.id} (cap ${budgetRaw * 2n})`,
  );
}

saveKeystore(store);
console.log("migration done");
