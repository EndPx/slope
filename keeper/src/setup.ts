/**
 * One-time Privy setup (run: pnpm --filter @slope/keeper setup).
 *
 * Creates the app-wide SPEND-TRACKING AGGREGATION via REST — the rolling
 * 72h sum of the `maxAmountIn` calldata param over adaptiveExecute calls to
 * SlopePosition. The Node SDK does not yet expose aggregation creation.
 *
 * The aggregation id is written to keeper/.privy-aggregation-id (gitignored)
 * and consumed by the delegate endpoint when it builds per-position policies.
 */
import {writeFileSync, readFileSync, existsSync} from "node:fs";
import {loadConfig, requireCredentials} from "./config.ts";
import {createAggregation} from "./privy-rest.ts";
import {buildAggregationBody} from "./policy-template.ts";

const cfg = loadConfig();
requireCredentials(cfg);

const ID_PATH = ".privy-aggregation-id";
if (existsSync(ID_PATH)) {
  const existing = readFileSync(ID_PATH, "utf8").trim();
  console.log(`aggregation already exists: ${existing}`);
  console.log("(delete .privy-aggregation-id to create a new one — max 10 per app)");
  process.exit(0);
}

const aggregation = await createAggregation(cfg, buildAggregationBody(cfg.slopePosition));
writeFileSync(ID_PATH, aggregation.id);
console.log("aggregation created:", aggregation.id);
console.log("window: rolling 72h, metric: sum(adaptiveExecute.maxAmountIn)");
console.log("scope: to == " + cfg.slopePosition);
