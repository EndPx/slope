# Step 5 — The Graph Subgraph

Directive (reconstructed; session logistics removed).

Build the subgraph for the deployed SlopePosition contract, per SPEC section 6:

- Index the contract events into the entities the spec defines: `Position`, `Fill`, `Skip`, and `BenchmarkComparison`.
- Compute the `BenchmarkComparison` in the mapping, per MATH_SPEC section 6: realised VWAP against the linear-TWAP counterfactual, improvement in basis points. The mapping runs on events only; there is no "now" at query time.
- Index the lifecycle fields the interface needs: `creationTx`, `creationBlock`, `cancelledAt`, `completedAt`.
- Deploy to Subgraph Studio (not a hosted service), pin the versioned query URL, and document the deployment in `docs/SUBGRAPH.md`: addresses, manifest, start block, toolchain.
- The subgraph is a production consumer dependency, not a side artifact: the keeper consumes it as its decision layer (fail-closed, no local fallback) and the frontend reads the same versioned endpoint. Manage the query budget accordingly (poll intervals, progressive back-off on 429).
- Granular commits per unit of work, pushed to `main`.
