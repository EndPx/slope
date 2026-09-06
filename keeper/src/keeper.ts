/**
 * Keeper polling loop (run: pnpm --filter @slope/keeper keeper).
 *
 * For every delegated position in the keystore:
 *   1. read the on-chain position (authoritative state);
 *   2. skip if inactive or already executed;
 *   3. compute authorizedNow from the shared curve model — the SAME formula
 *      the contract enforces — and send it as maxAmountIn (the contract
 *      executes min(authorizedNow, maxAmountIn), so the keeper can only
 *      tighten, never exceed, the schedule);
 *   4. sign via Privy (eth_signTransaction — policy + aggregation evaluated
 *      at signing) and self-broadcast the raw transaction;
 *   5. log executed/skipped with the on-chain skip reason; park positions
 *      with persistent failures.
 *
 * Serialization: one in-flight promise per OWNER WALLET — never two parallel
 * transactions from the same wallet (shared nonce sequence), and never two
 * parallel transactions for the same position.
 */
import {createPublicClient, decodeEventLog, encodeFunctionData, http, toHex} from "viem";
import {baseSepolia} from "viem/chains";
import {PrivyClient} from "@privy-io/node";
import {readFileSync} from "node:fs";
import {loadConfig, requireCredentials} from "./config.ts";
import {getEntry, loadKeystore, recordSign, disableEntry, KeystoreEntry} from "./keystore.ts";
import {isDeterministicPrivyError as isDeterministic} from "./errors.ts";
import {listDelegatedWallets, deleteAggregation} from "./privy-rest.ts";
import {progress, Shape} from "../../shared/src/curve.ts";

const cfg = loadConfig();
requireCredentials(cfg);
const privy = new PrivyClient({appId: cfg.appId, appSecret: cfg.appSecret});

// The raw transaction is already signed by the user's embedded wallet —
// self-broadcast needs only an RPC connection, no gas-payer account.
const publicClient = createPublicClient({chain: baseSepolia, transport: http(cfg.rpcUrl)});

const ABI = [
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
      {type: "tuple", components: [{type: "address", name: "router"}, {type: "tuple", components: [{type: "address", name: "maker"}, {type: "uint256", name: "traits"}, {type: "bytes", name: "data"}], internalType: "struct IAquaSwapVMRouter.Order", name: "order"}, {type: "bytes", name: "takerTraitsAndData"}], internalType: "struct AquaRoute", name: "route"},
    ],
  },
  {
    type: "function",
    name: "adaptiveExecute",
    stateMutability: "nonpayable",
    inputs: [
      {type: "uint256", name: "positionId"},
      {type: "uint256", name: "maxAmountIn"},
    ],
    outputs: [{type: "bool"}],
  },
] as const;

const inFlight = new Map<string, Promise<void>>();
const failures = new Map<string, number>();
const PARK_AFTER = 3;

const SKIP_ABI = [
  {
    type: "event",
    name: "PositionSkipped",
    inputs: [
      {type: "uint256", indexed: true, name: "positionId"},
      {type: "uint8", name: "reason"},
    ],
  },
] as const;
const SKIP_REASONS = ["NOT_DUE", "MIN_FILL", "BOUNDS", "IMPACT", "QUOTE_INVALID", "TRANSFER_FAILED"];

/** A tx can succeed while the FILL is skipped (skip-not-revert design) —
 *  that is no progress, not success (live: a TRANSFER_FAILED skip loop
 *  burned 15 signs before this check existed). */
class FillSkippedError extends Error {
  constructor(readonly reason: string) {
    super(`fill skipped on-chain: ${reason}`);
  }
}

function decodeSkipReason(receipt: {logs: Array<{data: `0x${string}`; topics: string[]}>}): string | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: SKIP_ABI,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      if (decoded.eventName === "PositionSkipped") {
        const index = Number((decoded.args as unknown as {reason: bigint}).reason);
        return SKIP_REASONS[index] ?? `UNKNOWN(${index})`;
      }
    } catch {
      // log from another contract (router/tokens) — not ours
    }
  }
  return null;
}

function adaptiveExecuteCalldata(positionId: bigint, maxAmountIn: bigint): `0x${string}` {
  return encodeFunctionData({abi: ABI, functionName: "adaptiveExecute", args: [positionId, maxAmountIn]});
}

async function signAndBroadcast(
  positionId: string,
  maxAmountIn: bigint,
  privateKeyB64: string,
): Promise<void> {
  // Discover the delegated wallet's Privy wallet id for the position owner.
  const entry = getEntry(positionId);
  if (!entry) throw new Error(`no keystore entry for position ${positionId}`);
  const delegated = (await listDelegatedWallets(cfg)).find(
    (w) => w.address.toLowerCase() === entry.owner.toLowerCase(),
  );
  if (!delegated) throw new Error(`no delegated wallet found for owner ${entry.owner}`);

  // eth_signTransaction signs the params AS GIVEN: nonce/gas/fees must be
  // supplied here or the broadcast fails with "intrinsic gas too low".
  const data = adaptiveExecuteCalldata(BigInt(positionId), maxAmountIn);
  const [nonce, gasEstimate, fees] = await Promise.all([
    publicClient.getTransactionCount({address: entry.owner as `0x${string}`}),
    publicClient.estimateGas({
      account: entry.owner as `0x${string}`,
      to: cfg.slopePosition as `0x${string}`,
      data,
    }),
    publicClient.estimateFeesPerGas(),
  ]);

  const signed = await privy.wallets().ethereum().signTransaction(delegated.walletId, {
    // eth_signTransaction path: policy + aggregation are evaluated here.
    params: {
      transaction: {
        to: cfg.slopePosition as `0x${string}`,
        chain_id: Number(cfg.chainId),
        value: "0x0",
        data,
        nonce: toHex(nonce),
        gas_limit: toHex((gasEstimate * 120n) / 100n),
        max_fee_per_gas: toHex(fees.maxFeePerGas),
        max_priority_fee_per_gas: toHex(fees.maxPriorityFeePerGas ?? 100_000_000n),
      },
    },
    authorization_context: {authorization_private_keys: [privateKeyB64]},
  });

  // Privy consumed the aggregation window at sign time, so ledger the
  // amount even if the broadcast later fails — the ledger must mirror what
  // the aggregation recorded (validates the 2x-budget cap against reality).
  const ledger = recordSign(positionId, maxAmountIn);
  console.log(`[${positionId}] signed maxAmountIn=${maxAmountIn} (Σ ${ledger.signedSum} over ${ledger.signCount} sign(s))`);

  const broadcastable = (signed as {signed_transaction?: string; rawTransaction?: string; signedTransaction?: string});
  const raw = (broadcastable.signed_transaction ?? broadcastable.rawTransaction ?? broadcastable.signedTransaction) as `0x${string}`;
  const hash = await publicClient.sendRawTransaction({serializedTransaction: raw});
  console.log(`[${positionId}] broadcast ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({hash});
  if (receipt.status !== "success") throw new Error(`fill tx reverted: ${hash}`);
  const skipped = decodeSkipReason(receipt);
  if (skipped) throw new FillSkippedError(skipped);
  console.log(`[${positionId}] filled (block ${receipt.blockNumber})`);
}

/** Terminal positions never sign again: recycle their aggregation slot
 *  (the app owns at most 10) and park the entry. */
async function finalizePosition(
  positionId: string,
  position: {executedAmount: bigint; totalBudget: bigint},
  entry: KeystoreEntry,
): Promise<void> {
  const completed = position.executedAmount >= position.totalBudget;
  const reason = completed ? "completed" : "cancelled/inactive";
  if (entry.aggregationId) {
    try {
      await deleteAggregation(cfg, entry.aggregationId);
      console.log(`[${positionId}] ${reason} — aggregation ${entry.aggregationId} deleted (slot recycled)`);
    } catch (e) {
      // Not fatal: the slot is reclaimed before the next delegation.
      console.error(`[${positionId}] aggregation deletion failed (retried on next delegation):`, (e as Error).message);
    }
  }
  const signed = BigInt(entry.signedSum ?? "0");
  const pct = position.totalBudget > 0n ? (signed * 100n) / position.totalBudget : 0n;
  console.log(
    `[${positionId}] ${reason}: executed ${position.executedAmount}/${position.totalBudget}; Σ signed ${signed} over ${entry.signCount ?? 0} sign(s) = ${pct}% of budget (aggregation cap 200%)`,
  );
  disableEntry(positionId, `${reason} at ${new Date().toISOString()}`);
}

async function processPosition(positionId: string): Promise<void> {
  const entry = getEntry(positionId);
  if (!entry) return;
  const id = BigInt(positionId);
  const [position] = await publicClient.readContract({
    address: cfg.slopePosition as `0x${string}`,
    abi: ABI,
    functionName: "getPosition",
    args: [id],
  });
  if (!position.isActive || position.executedAmount >= position.totalBudget) {
    await finalizePosition(positionId, position, entry);
    return;
  }
  const elapsed = BigInt(Math.floor(Date.now() / 1000)) - position.startTimestamp;
  const scheduleElapsed = elapsed > position.duration ? position.duration : elapsed;
  // NEUTRAL only in this milestone's keeper; the shared model already covers
  // all three shapes for step 5.
  const progress_ = progress(scheduleElapsed, position.duration, Shape.NEUTRAL);
  const authorizedCumulative = (position.totalBudget * progress_) / 10n ** 18n;
  const authorizedNow = authorizedCumulative - position.executedAmount;
  if (authorizedNow <= 0n) {
    console.log(`[${positionId}] NOT_DUE (authorizedNow = ${authorizedNow})`);
    return;
  }
  if (authorizedNow < position.minFillAmount && scheduleElapsed < position.duration) {
    console.log(`[${positionId}] MIN_FILL (authorizedNow = ${authorizedNow})`);
    return;
  }
  console.log(`[${positionId}] executing fill up to ${authorizedNow}`);
  await signAndBroadcast(positionId, authorizedNow, entry.privateKeyB64);
}

async function tick(): Promise<void> {
  const store = loadKeystore();
  const jobs: Promise<void>[] = [];
  for (const positionId of Object.keys(store)) {
    const entry = store[positionId];
    if (entry.disabled) continue; // can never fill; reason logged at startup
    // Serialization per OWNER WALLET, not per position: positions sharing a
    // wallet share one nonce sequence (live: two parallel same-wallet fills
    // raced nonces and rejected each other with "replacement underpriced").
    const walletKey = entry.owner.toLowerCase();
    if (inFlight.has(walletKey)) continue;
    const failuresBefore = failures.get(positionId) ?? 0;
    if (failuresBefore >= PARK_AFTER) continue; // parked: stop retrying
    const job = processPosition(positionId)
      .then((r) => {
        failures.delete(positionId);
        return r;
      })
      .catch((e) => {
        if (e instanceof FillSkippedError && e.reason === "TRANSFER_FAILED") {
          // Deterministic: only an owner-side action (tokenIn balance +
          // approval) can change it — the keeper is scoped out of both.
          failures.set(positionId, PARK_AFTER);
          console.error(`[${positionId}] PARKED (TRANSFER_FAILED): owner wallet needs tokenIn balance + approval — fund/approve from the frontend, then restart the keeper`);
          return;
        }
        if (isDeterministic(e)) {
          failures.set(positionId, PARK_AFTER);
          console.error(`[${positionId}] PARKED (deterministic, no retry):`, String((e as Error)?.message ?? e).slice(0, 300));
          return;
        }
        const count = failuresBefore + 1;
        failures.set(positionId, count);
        console.error(`[${positionId}] error (${count}/${PARK_AFTER}):`, e.message ?? e);
        if (count >= PARK_AFTER) console.warn(`[${positionId}] PARKED — fix the cause and restart the keeper`);
      })
      .finally(() => inFlight.delete(walletKey));
    inFlight.set(walletKey, job);
    jobs.push(job);
  }
  await Promise.allSettled(jobs);
}

console.log("keeper polling loop started");
for (const [id, e] of Object.entries(loadKeystore())) {
  if (e.disabled) console.warn(`[${id}] disabled: ${e.disabled}`);
}
for (;;) {
  await tick();
  await new Promise((r) => setTimeout(r, 15_000));
}
