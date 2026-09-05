# 06 — Step 3: Real Aqua Integration (implementation directive)

Called out as the heaviest, most decisive step — the five steps after it all wait on contracts that are live with seeded liquidity. Work A → E in order, reporting each sub-step before continuing.

## A. Deploy Aqua infrastructure to Base Sepolia

Self-deploy the Aqua registry and AquaSwapVMRouter from the official source at **git tag `v1.0.2`** — never the `main` branch (an undeployed refactor, not the deterministic addresses). Build config mandatory per the verified notes: solc 0.8.30, `via_ir = true`, `evm_version = cancun` — without IR codegen the SwapVM function-pointer opcode table breaks. Reference setup: `1inch/swap-vm-template`. Context: Base Sepolia has no official Aqua deployment (RPC-verified empty bytecode); Base mainnet does; the prize explicitly permits redeployment of a modified SwapVM contract, so self-deployment is the correct and only path for a future custom opcode.

## B. Deployment scripts in `contracts/script/`

1. Deploy two demo ERC20 tokens with different decimals (18 and 6) — this tests price normalization in real conditions, not just mocks. 2. Mint and seed maker balances. 3. Ship an **UNGATED** strategy to Aqua. 4. Deploy `SlopePosition`. 5. Approve the router from the maker wallet.

The ungated strategy is critical: 1inch's own strategies embed the KYC-gate opcode (`onlyTxOriginTokenBalanceNonZero`, KycNFT `0x26FF…a468`) passable only by KYB resolvers. Slope MUST ship its own strategy without that instruction — the officially documented "drop that instruction for a permissionless pool" path. Missing it makes every fill fail with an opaque error.

Hard bound: total shipped ≤ the maker wallet's real balance — Aqua virtual balances are commitments, not escrow; over-shipping makes fills fail confusingly.

Persist ALL results to `deployments/base-sepolia.json` (committed): registry, router, both tokens, SlopePosition, and the block number of the SlopePosition deployment (the subgraph's `startBlock`). Frontend, keeper, and subgraph all read this file — printing to the terminal is not enough. Private keys via `vm.envUint("PRIVATE_KEY")`; never hardcoded; `.env` must be gitignored.

Use the official SDKs to build programs: `@1inch/aqua-sdk` for registry (ship/dock/hash), `@1inch/swap-vm-sdk` for quote/swap/Order/`AquaProgramBuilder`/strategy builders — ALWAYS through `AquaProgramBuilder` (the hand-written TS opcode enum is shifted). viem ≥ 2.48.4. Verified order details: tuple `(maker, traits, data)` with `traits = 1 << 254`; minimal exact-in taker blob flags `0x0041`; `shouldUnwrapWeth` false.

## C. Verify the two OPEN ITEMS against the real router

OI-1: does exact-in always consume the full requested input? (The contract increments `executedAmount` by `fillAmount` on this assumption — if the router can consume less, switch to the returned amount, otherwise the budget invariant accounts unspent tokens.) OI-2: embed a hard minimum-output threshold in `takerTraitsAndData`. Update the SPEC appendix — remove "open" once answered.

## D. Re-validate the probe floor on the real router

The `10^(decimalsIn−4)` floor was only mock-validated. Confirm the real router returns non-zero, meaningful quotes at that notional for both decimals; adjust and record as a SPEC revision if not.

## E. Fork tests

Add tests running against a Base Sepolia fork using the deployed addresses, proving `createPosition` → real fill end-to-end through the real router — this becomes the 1inch evidence that on-chain execution really happens. Keep the mocks for unit tests (forced edge conditions like zero quotes and failed transfers are not reproducible on-chain).

## Work rules

Granular commits as before. If real router behavior differs from SPEC assumptions, REPORT FIRST before changing the contract — never unilaterally adjust the contract to match unconfirmed behavior. Report each sub-step A–E before moving on.
