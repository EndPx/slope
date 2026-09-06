/**
 * Privy policy + aggregation template builders (pure, unit-testable).
 *
 * Design rules (SPEC.md section 2 + Decision 3 + REVISION 1/2):
 *  - DENY-by-default: the policy allows ONLY eth_signTransaction; every other
 *    method (including exportPrivateKey) is implicitly denied by Privy.
 *  - Scope: target allowlist (SlopePosition only) + function selector
 *    (adaptiveExecute only) + per-transaction cap on the maxAmountIn calldata
 *    param + a rolling aggregation cap (blast-radius limit) + expiry.
 *  - The aggregation is REST-only (Node SDK has no `create`); it sums the
 *    decoded `maxAmountIn` calldata param over a rolling window. One
 *    aggregation PER POSITION, created fresh at delegation time.
 *  - Framing rule: the aggregation is a RATE LIMIT / blast-radius control,
 *    NOT budget enforcement — budget enforcement is the on-chain invariant
 *    `executedAmount <= totalBudget`.
 */

export interface PrivyCondition {
  field_source: string;
  field: string;
  operator: string;
  value?: unknown;
  abi?: unknown[];
}

export interface PrivyRule {
  name: string;
  method: string;
  conditions: PrivyCondition[];
  action: "ALLOW" | "DENY";
}

export interface PrivyPolicy {
  version: string;
  name: string;
  chain_type: string;
  rules: PrivyRule[];
}

export const ADAPTIVE_EXECUTE_ABI = [
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
];

/** Max aggregation window Privy supports (docs): 72 hours. */
export const MAX_AGGREGATION_WINDOW_SECONDS = 259_200;

/**
 * Builds the aggregation body: sums the decoded `maxAmountIn` calldata param
 * of every adaptiveExecute call to SlopePosition over a rolling 72h window.
 *
 * One aggregation PER POSITION, created fresh at delegation: Privy records
 * the metric at SIGN time, so denied attempts still consume the rolling sum.
 * An app-wide window let a broken position's retries starve every other
 * delegation (live incident 2026-09-06: 12 failed signs x 10 dETH exceeded
 * the 100 dETH cap and denied all new signs with policy_violation). A fresh
 * per-position window bounds that blast radius to the position's own
 * headroom.
 *
 * The tracking conditions must stay in sync with the policy's allow
 * conditions (docs: divergence silently resets the cap).
 */
export function buildAggregationBody(slopePosition: string, positionId?: bigint): object {
  return {
    name:
      positionId === undefined
        ? "Slope adaptiveExecute maxAmountIn rolling sum (72h)"
        : `Slope pos ${positionId} maxAmountIn rolling sum (72h)`,
    method: "eth_signTransaction",
    metric: {
      field: "adaptiveExecute.maxAmountIn",
      field_source: "ethereum_calldata",
      function: "sum",
      abi: ADAPTIVE_EXECUTE_ABI,
    },
    window: {type: "rolling", seconds: MAX_AGGREGATION_WINDOW_SECONDS},
    conditions: [
      {
        field_source: "ethereum_transaction",
        field: "to",
        operator: "eq",
        value: slopePosition,
      },
      {
        field_source: "ethereum_calldata",
        field: "function_name",
        operator: "eq",
        value: "adaptiveExecute",
        abi: ADAPTIVE_EXECUTE_ABI,
      },
    ],
  };
}

/**
 * Builds the per-position signer override policy. One key quorum + one
 * policy PER POSITION: Privy allows a single override policy per signer
 * binding, so per-position scoping requires per-position signers — which
 * also gives per-position key isolation.
 *
 * @param params.slopePosition   SlopePosition contract address (allowlist)
 * @param params.budgetRaw       the position's totalBudget in raw units —
 *                               per-transaction cap on maxAmountIn
 * @param params.aggregationId   Privy aggregation id (rate limit reference)
 * @param params.aggregationCapRaw  rolling-sum cap in raw units: 2x the
 *                               position budget. Legitimate fills sum to
 *                               exactly budgetRaw over the position's life
 *                               (the keeper signs the due increment); the
 *                               2x headroom absorbs signs that consumed
 *                               aggregation but failed to broadcast — skipped
 *                               fills consume too, because Privy records at
 *                               sign time, not at execution success
 * @param params.expirySeconds   unix timestamp after which Privy stops
 *                               signing: position start + duration + a
 *                               settlement buffer (the terminal clamp may
 *                               legitimately settle slightly after the window)
 */
export function buildPositionPolicy(params: {
  positionId: bigint;
  slopePosition: string;
  budgetRaw: bigint;
  aggregationId: string;
  aggregationCapRaw: bigint;
  expirySeconds: bigint;
  policyName: string;
}): PrivyPolicy {
  const hex = (n: bigint) => `0x${n.toString(16)}`;
  return {
    version: "1.0",
    name: params.policyName,
    chain_type: "ethereum",
    rules: [
      {
        name: "adaptiveExecute scope",
        method: "eth_signTransaction",
        action: "ALLOW",
        conditions: [
          {
            field_source: "ethereum_transaction",
            field: "to",
            operator: "eq",
            value: params.slopePosition,
          },
          {
            field_source: "ethereum_calldata",
            field: "function_name",
            operator: "eq",
            value: "adaptiveExecute",
            abi: ADAPTIVE_EXECUTE_ABI,
          },
          {
            field_source: "ethereum_calldata",
            field: "adaptiveExecute.positionId",
            operator: "eq",
            // Bind the signer to ITS OWN position: without this, the session
            // key could drive adaptiveExecute for ANY position (the contract
            // still enforces per-position authorization, but the policy-level
            // claim is "scoped to this position").
            value: params.positionId.toString(),
            abi: ADAPTIVE_EXECUTE_ABI,
          },
          {
            field_source: "ethereum_calldata",
            field: "adaptiveExecute.maxAmountIn",
            operator: "lte",
            // Decoded calldata args are compared against DECIMAL strings
            // (the conditional-signer doc example uses parseUnits().toString());
            // a hex string here denied every request in live testing.
            value: params.budgetRaw.toString(),
            abi: ADAPTIVE_EXECUTE_ABI,
          },
          {
            field_source: "reference",
            field: `aggregation.${params.aggregationId}`,
            operator: "lte",
            // Aggregation reference caps use hex per the docs recipe.
            value: hex(params.aggregationCapRaw),
          },
          {
            field_source: "system",
            field: "current_unix_timestamp",
            operator: "lt",
            value: params.expirySeconds.toString(),
          },
        ],
      },
    ],
  };
}
