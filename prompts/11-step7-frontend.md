# Step 7 — Frontend

Directive (reconstructed; session logistics removed; the visual system went through several human review rounds, each recorded as a numbered revision in the spec).

Build the application on top of the deployed contracts, the keeper, and the subgraph:

- Six screens, all public without login (signing in is required only to transact): Landing, Create (the parameter matrix with the schedule preview), Execution (planned-versus-actual ruler, fill and hold journal, delegation panel), Portfolio, Performance, Activity.
- The plotting-table visual system: an ink-on-graph-paper palette, rounded elevated panels, and hand-drawn Canvas charts driven by the app's own curve model rather than a charting library, so the time ruler, the planned-versus-actual divergence, and the fill and skip marks are one consistent instrument.
- The create flow as a visible step machine: mint when inventory is short, approve when allowance is short, create, delegate. Each stage is separately visible and retryable (wallet popups fail sometimes); delegation runs automatically after creation; success redirects to the schedule's own page.
- Honest states everywhere: a boot gate that names what is actually loading, an awaiting-index state for freshly created schedules, per-fill deviation against the benchmark with negatives shown as-is, transaction hashes on every event row, and an Aqua protocol trace decoded per fill with @1inch/aqua-sdk.
- Deploy the frontend to Vercel; the keeper runs on a separate VPS behind HTTPS with token authentication.

Outcome: live at `https://slope-beta.vercel.app`, with the full end-to-end loop demonstrated on Base Sepolia: a schedule created from the browser, delegated to the VPS keeper, executed through Aqua, and presented from the subgraph.
