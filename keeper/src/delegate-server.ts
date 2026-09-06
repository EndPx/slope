/**
 * Delegation endpoint (run: pnpm --filter @slope/keeper delegate).
 *
 * POST /delegate {positionId, owner, budgetRaw, expirySeconds}
 *   -> generates a per-position P-256 authorization key,
 *      registers it as a 1-of-1 key quorum (REST),
 *      creates the per-position policy via REST (scope + per-tx cap +
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
import {createKeyQuorum, createPolicy, listDelegatedWallets} from "./privy-rest.ts";
import {buildPositionPolicy} from "./policy-template.ts";
import {readFileSync} from "node:fs";
import {putEntry, loadKeystore} from "./keystore.ts";

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

app.post("/delegate", async (c) => {
  const body = (await c.req.json()) as {
    positionId: string;
    owner: string;
    budgetRaw: string;
    expirySeconds: string;
  };
  const positionId = BigInt(body.positionId);
  const budgetRaw = BigInt(body.budgetRaw);
  const expirySeconds = BigInt(body.expirySeconds);
  if (budgetRaw <= 0n || expirySeconds <= 0n) {
    return c.json({error: "budgetRaw and expirySeconds must be positive"}, 400);
  }

  // Per-position P-256 authorization key in Privy's native format
  // (base64 SPKI/PKCS8, no PEM headers). Privy never sees the private key.
  const keypair = await generateP256KeyPair();

  const quorum = await createKeyQuorum(cfg, keypair.publicKey);

  const policy = buildPositionPolicy({
    positionId,
    slopePosition: cfg.slopePosition,
    budgetRaw,
    aggregationId: readAggregationId(),
    aggregationCapRaw: cfg.aggregationCapRaw,
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
    createdAt: new Date().toISOString(),
  });

  console.log(`delegated position ${positionId}: quorum ${quorum.id} policy ${created.id}`);
  return c.json({signerId: quorum.id, policyId: created.id});
});

app.get("/delegated-wallets", async (c) => c.json(await listDelegatedWallets(cfg)));

function readAggregationId(): string {
  try {
    return readFileSync(".privy-aggregation-id", "utf8").trim();
  } catch {
    throw new Error("aggregation id missing — run `pnpm --filter @slope/keeper setup` first");
  }
}

serve({fetch: app.fetch, port: 8787}, (info) => {
  console.log(`delegate endpoint on http://localhost:${info.port}`);
});
