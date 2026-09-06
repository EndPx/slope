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
 * Serialization: one in-flight promise per positionId — never two parallel
 * transactions for the same position (Privy aggregations update after
 * signing, so concurrent requests can both pass evaluation).
 */
import {createPublicClient, encodeFunctionData, http} from "viem";
import {baseSepolia} from "viem/chains";
import {PrivyClient} from "@privy-io/node";
import {readFileSync} from "node:fs";
import {loadConfig, requireCredentials} from "./config.ts";
import {getEntry, loadKeystore} from "./keystore.ts";
import {listDelegatedWallets} from "./privy-rest.ts";
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

function adaptiveExecuteCalldata(positionId: bigint, maxAmountIn: bigint): `0x${string}` {
  return encodeFunctionData({abi: ABI, functionName: "adaptiveExecute", args: [positionId, maxAmountIn]});
}

async function signAndBroadcast(
  positionId: string,
  maxAmountIn: bigint,
  privateKeyPem: string,
): Promise<void> {
  // Discover the delegated wallet's Privy wallet id for the position owner.
  const entry = getEntry(positionId);
  if (!entry) throw new Error(`no keystore entry for position ${positionId}`);
  const delegated = (await listDelegatedWallets(cfg)).find(
    (w) => w.address.toLowerCase() === entry.owner.toLowerCase(),
  );
  if (!delegated) throw new Error(`no delegated wallet found for owner ${entry.owner}`);

  const signed = await privy.wallets().ethereum().signTransaction(delegated.walletId, {
    // eth_signTransaction path: policy + aggregation are evaluated here.
    params: {
      transaction: {
        to: cfg.slopePosition as `0x${string}`,
        chain_id: Number(cfg.chainId),
        value: "0x0",
        data: adaptiveExecuteCalldata(BigInt(positionId), maxAmountIn),
      },
    },
    authorization_context: {authorization_private_keys: [privateKeyPem]},
  });

  const broadcastable = (signed as {signed_transaction?: string; rawTransaction?: string; signedTransaction?: string});
  const raw = (broadcastable.signed_transaction ?? broadcastable.rawTransaction ?? broadcastable.signedTransaction) as `0x${string}`;
  const hash = await publicClient.sendRawTransaction({serializedTransaction: raw});
  console.log(`[${positionId}] broadcast ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({hash});
  console.log(`[${positionId}] status: ${receipt.status} (block ${receipt.blockNumber})`);
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
  if (!position.isActive) {
    console.log(`[${positionId}] inactive — nothing to do`);
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
    if (inFlight.has(positionId)) continue; // serialization per position
    const job = processPosition(positionId)
      .catch((e) => console.error(`[${positionId}] error:`, e.message ?? e))
      .finally(() => inFlight.delete(positionId));
    inFlight.set(positionId, job);
    jobs.push(job);
  }
  await Promise.allSettled(jobs);
}

console.log("keeper polling loop started");
for (;;) {
  await tick();
  await new Promise((r) => setTimeout(r, 15_000));
}
