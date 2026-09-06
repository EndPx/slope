/**
 * Privy policy template builder (pure, unit-testable).
 *
 * Design rules (SPEC.md section 2 + Decision 3 + REVISION 1/2):
 *  - DENY-by-default: the policy allows ONLY eth_signTransaction; every other
 *    method (including exportPrivateKey) is implicitly denied by Privy.
 *  - Scope: target allowlist (SlopePosition only) + function selector
 *    (adaptiveExecute only) + binding to the signer's OWN positionId +
 *    per-transaction cap on the maxAmountIn calldata param + expiry.
 *
 * VERIFIED NOTE (2026-09-06, live Base Sepolia): Privy stateful conditions
 * (field_source "reference" to an aggregation) DENY every eth_signTransaction
 * request they appear in — tested with lte/lt, hex/decimal values, fresh and
 * reused windows; the identical policy without the reference passes. The
 * rolling-sum rate limit therefore cannot live in the policy today. It is
 * enforced in depth elsewhere instead: the per-transaction cap + expiry +
 * positionId binding here, the keeper's schedule bound (it only ever signs
 * the curve-authorized increment), and the on-chain invariant
 * `executedAmount <= totalBudget` — which is the real budget enforcement
 * (SPEC Decision 3 framing: the aggregation was always a rate limit, never
 * the budget).
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

/**
 * Builds the per-position signer override policy. One key quorum + one
 * policy PER POSITION: Privy allows a single override policy per signer
 * binding, so per-position scoping requires per-position signers — which
 * also gives per-position key isolation.
 *
 * @param params.slopePosition   SlopePosition contract address (allowlist)
 * @param params.budgetRaw       the position's totalBudget in raw units —
 *                               per-transaction cap on maxAmountIn (lte is
 *                               INCLUSIVE at the boundary: a terminal
 *                               settlement of exactly totalBudget passes a
 *                               cap of totalBudget — live-verified)
 * @param params.expirySeconds   unix timestamp after which Privy stops
 *                               signing: position start + duration + a
 *                               settlement buffer (the terminal clamp may
 *                               legitimately settle slightly after the window)
 */
export function buildPositionPolicy(params: {
  positionId: bigint;
  slopePosition: string;
  budgetRaw: bigint;
  expirySeconds: bigint;
  policyName: string;
}): PrivyPolicy {
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
