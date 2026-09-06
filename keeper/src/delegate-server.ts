/**
 * Delegation endpoint (run: pnpm --filter @slope/keeper delegate).
 *
 * POST /delegate {positionId, owner, budgetRaw, expirySeconds}
 *   -> generates a per-position P-256 authorization key,
 *      registers it as a 1-of-1 key quorum (REST),
 *      creates a FRESH per-position aggregation (empty 72h rolling window)
 *      and the per-position policy via REST (scope + per-tx cap +
 *      aggregation reference + per-order expiry),
 *      stores the private key in the gitignored keystore,
 *      returns {signerId, policyId} for the frontend `addSigners` consent.
 *
 * GET /delegations -> current keystore entries (for the keeper loop and UI).
 */
import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {cors} from "hono/cors";
import {generateP256KeyPair} from "@privy-io/node";
import {loadConfig, requireCredentials} from "./config.ts";
import {createAggregation, createKeyQuorum, createPolicy, deleteAggregation, listDelegatedWallets} from "./privy-rest.ts";
import {buildAggregationBody, buildPositionPolicy} from "./policy-template.ts";
import {putEntry, loadKeystore, saveKeystore} from "./keystore.ts";

const cfg = loadConfig();
requireCredentials(cfg);

const app = new Hono();

// The frontend (localhost:5173) calls this endpoint cross-origin.
app.use("*", cors());

app.get("/health", (c) => c.json({ok: true}));

app.get("/delegations", (c) =>
  c.json(
    Object.entries(loadKeystore()).map(([positionId, e]) => ({
      positionId,
      owner: e.owner,
      keyQuorumId: e.keyQuorumId,
      policyId: e.policyId,
    })),
  ),
);

/** The app owns at most 10 aggregations. Terminal positions are disabled by
 *  the keeper after deleting theirs; any deletion that failed is retried
 *  here so a new delegation never silently starves on the slot limit. */
function reclaimAggregationSlots(): void {
  const store = loadKeystore();
  for (const [positionId, entry] of Object.entries(store)) {
    if (!entry.disabled || !entry.aggregationId) continue;
    deleteAggregation(cfg, entry.aggregationId)
      .then(() => {
        console.log(`reclaimed aggregation ${entry.aggregationId} (position ${positionId})`);
        const fresh = loadKeystore();
        if (fresh[positionId]) {
          delete fresh[positionId].aggregationId;
          saveKeystore(fresh);
        }
      })
      .catch((e: Error) =>
        console.error(`slot reclaim failed for position ${positionId} (kept for retry):`, e.message),
      );
  }
}

app.post("/delegate", async (c) => {
  let positionLabel = "unknown";
  try {
    const body = (await c.req.json()) as {
      positionId: string;
      owner: string;
      budgetRaw: string;
      expirySeconds: string;
    };
    positionLabel = body.positionId;
    const positionId = BigInt(body.positionId);
    const budgetRaw = BigInt(body.budgetRaw);
    const expirySeconds = BigInt(body.expirySeconds);
    if (budgetRaw <= 0n || expirySeconds <= 0n) {
      return c.json({error: "budgetRaw and expirySeconds must be positive"}, 400);
    }

    reclaimAggregationSlots();

    // Per-position P-256 authorization key in Privy's native format
    // (base64 SPKI/PKCS8, no PEM headers). Privy never sees the private key.
    const keypair = await generateP256KeyPair();

    const quorum = await createKeyQuorum(cfg, keypair.publicKey);

    // Fresh aggregation per delegation: the 72h rolling window starts empty
    // for THIS position. Denied attempts still record into the sum at sign
    // time, so a shared window lets one broken position's retries starve
    // every other delegation — per-position windows bound that blast radius.
    const aggregation = await createAggregation(cfg, buildAggregationBody(cfg.slopePosition, positionId));

    const policy = buildPositionPolicy({
      positionId,
      slopePosition: cfg.slopePosition,
      budgetRaw,
      aggregationId: aggregation.id,
      // Rate limit, not budget: legitimate fills sum to exactly budgetRaw
      // over the position's life (the keeper signs the due increment); 2x
      // covers signs that consumed the window but failed to broadcast.
      aggregationCapRaw: budgetRaw * 2n,
      expirySeconds,
      policyName: `Slope pos ${positionId}`,
    });
    const created = await createPolicy(cfg, policy);

    putEntry({
      positionId: positionId.toString(),
      owner: body.owner,
      privateKeyB64: keypair.privateKey,
      publicKeyB64: keypair.publicKey,
      keyQuorumId: quorum.id,
      policyId: created.id,
      aggregationId: aggregation.id,
      createdAt: new Date().toISOString(),
    });

    console.log(`delegated position ${positionId}: quorum ${quorum.id} policy ${created.id} aggregation ${aggregation.id}`);
    return c.json({signerId: quorum.id, policyId: created.id});
  } catch (e) {
    // Delegation must fail LOUDLY (returned to the frontend + logged), never
    // silently — a half-created delegation is confusing during a demo.
    console.error(`delegation failed (position ${positionLabel}):`, (e as Error).message);
    return c.json({error: `delegation failed: ${(e as Error).message}`}, 503);
  }
});

app.get("/delegated-wallets", async (c) => c.json(await listDelegatedWallets(cfg)));

serve({fetch: app.fetch, port: 8787}, (info) => {
  console.log(`delegate endpoint on http://localhost:${info.port}`);
});
