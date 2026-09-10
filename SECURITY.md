# Security Policy

## Project context

Slope is a **hackathon project** (ETHGlobal Online 2026) running on **Base Sepolia testnet**. The `dETH` and `dUSD` tokens are demo tokens with no real value, minted by a public faucet function. There is no mainnet deployment and no real funds at risk.

That said, the contract, keeper, and frontend are built to production-grade invariants — reports are welcome and will be credited.

## Supported versions

| version | supported |
| --- | --- |
| `main` branch | ✔ |

## How to report

Email **albary6700@gmail.com** with `[SLOPE-SECURITY]` in the subject, or open a GitHub security advisory via the repository's *Security → Report a vulnerability* flow.

Please include: a description, reproduction steps (tx hashes / RPC calls are ideal), and the component affected (contract / keeper / frontend / subgraph). We aim to acknowledge reports within 48 hours.

## Scope notes (what we already know — no need to report)

- **Testnet-only deployment.** All funds are demo tokens; the faucet mints them publicly by design.
- **The keeper's `/delegate` endpoint has no authentication.** It is intended to run on the position owner's own machine; do not expose it publicly without adding an owner-signature check.
- **The frontend bundles the Studio query API key.** It is rotatable by design and gates only read access to public on-chain data.
- **Session signer keys live in the keeper's gitignored `.keystore.json`.** Compromise of that file compromises execution for delegated positions (scoped: the keys can only spend within each position's on-chain authorization — the contract is the enforcement layer).

## Enforcement layer

Regardless of keeper or frontend behavior, the `SlopePosition` contract is the authority: no movement outside `authorizedNow` per the schedule curve, prices inside rails, and impact bounds is possible — every execution path re-quotes on-chain. Reports about bypassing *contract-level* invariants are the highest-priority class for us.
