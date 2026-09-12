# Demo Video Script — Slope

Target: **3:35**, one take per segment, stitched in the editor. Structure follows the
proven ETHGlobal winner pattern (web3torrent): team intro → what we built → how it works →
live demo → how it's made → future work → live URL → close.

## Recording prerequisites (do these in order)

1. **Quota**: make sure the Studio daily bucket is fresh (resets ±22:04 WIB). Stop the
   local keeper; the VPS keeper stays up at 120 s polls. Close every spare browser tab.
2. **Clean browser** at 1920×1080 — sign in with email and faucet the wallet to ≥ 10 dETH
   plus gas **before** recording, so the mint stage is skipped during the demo.
3. **Slides** (PPT/Excalidraw): 7 slides per the list below. Slide 4 uses
   `docs/data-flow.png`.
4. **The 15-minute window trick**: Slope is time-based, so do not record fifteen minutes of
   waiting. Two honest options:
   - **(a) recommended** — create the schedule live on camera, then *jump cut* with a
     "15 minutes later" caption to the execution page already filled in;
   - **(b)** create schedule #14 about fourteen minutes before recording — by the time the
     demo segment starts, its latest fills are landing live.
5. **Record per segment** (one take each) and stitch. Narration is in English.

## Slide deck (7 slides)

1. **Title** — logo + "slope" + tagline.
2. **Who are we** — name + "built the entire stack".
3. **What we built** — one-sentence product value.
4. **How it works** — `docs/data-flow.png` (Privy → contract → Aqua → The Graph → keeper).
5. **Demo** — used only as a segment title; the demo itself is the screen recording.
6. **How it's made** — the three layers: contract / keeper / subgraph.
7. **Check it out live** — app URL + repo URL, large.

## Script, synced to video time

### SLIDE 1 — Title (0:00 – 0:12)

> Hi, we're team Slope, and this is what we built for ETHGlobal Online. I'm [NAME], and I
> built the entire stack — the contracts, the keeper, and the frontend.

*(On screen: slide 1.)*

### SLIDE 2 — What we built (0:12 – 0:35)

> Slope is a non-custodial way to sell a large amount of tokens without moving the market
> against yourself. Instead of one market order, you declare a budget, a duration, and a
> pace — aggressive, neutral, or conservative — and the schedule itself lives on-chain: the
> contract decides how much may sell at every moment, and nothing else can.

*(On screen: slide 2.)*

### SLIDE 3 — How it works (0:35 – 1:00)

> Three moving parts. One: the SlopePosition contract on Base Sepolia — it computes the
> authorized amount from the curve, checks price impact with a dual quote, and pulls tokens
> per fill, so there is no escrow. Two: a keeper running on a VPS — it discovers due
> schedules from The Graph, re-verifies on-chain, and signs through a scoped Privy session
> key that can never exceed the schedule. Three: The Graph indexes every fill and computes
> the TWAP benchmark the interface is judged against.

*(On screen: slide 3, then slide 4 — the data-flow diagram.)*

### DEMO — live app (1:00 – 2:40)

> Let's jump into the demo.

*(1:00 — Landing. Point at the live-testnet line; those numbers are real indexed data.)*

> This is the live app on Base Sepolia. Everything you see here is real indexed data.

*(1:15 — Create. Fill the form: 10 dETH, 15 min, aggressive, rails 100/10000, impact 5%.)*

> I'll sell ten dETH over fifteen minutes at an aggressive pace, with price rails and a
> five percent impact limit. The estimated output here is a real quote from the 1inch Aqua
> router — not a made-up rate.

*(1:30 — Click Deploy. The stepper runs: approve → create → delegate; answer three wallet
popups.)*

> Deploy. The stepper shows every stage — approve the spending, create the schedule
> on-chain, and delegate execution to the keeper. Each one is signed in the wallet, and
> delegation happens automatically.

*(1:50 — Redirect to /positions/14.)*

> And we land on the schedule's own page. It is live on-chain, and the keeper picks it up on
> its next tick.

*(1:55 — CUT with a "15 minutes later" caption. Show the filled staircase, the colored
vs-benchmark column, the Aqua trace.)*

> Here is that same window a few minutes in. Every step is a real fill through the 1inch
> Aqua router — the staircase is the actual execution, the dashed line is the linear-TWAP
> benchmark, and the table shows each fill's deviation in basis points. Below it, the Aqua
> protocol trace of the latest fill, decoded from the receipt with the official SDK.

*(2:30 — Activity.)*

> And in Activity, the whole indexed event stream — holds included, each with its reason —
> exportable as CSV.

### SLIDE 6 — How it's made (2:40 – 3:10)

> Under the hood: a Solidity contract with a fixed-point curve kernel, fuzz-tested and
> cross-validated bit-for-bit against a TypeScript reference model. The subgraph computes
> the TWAP benchmark in the mapping. The keeper is fail-closed: if The Graph is unreachable
> it skips a tick and logs it — cached data never makes a financial decision. And Privy's
> policy engine scopes the session signer to exactly one contract, one function, one
> per-transaction cap, and an expiry.

### SLIDE 7 — Future work (3:10 – 3:25)

> Next up: price-driven execution, where the duration becomes optional; more pairs; and
> mainnet.

### SLIDE 7 — Check it out live (3:25 – 3:35)

> You can try it right now at slope-beta.vercel.app, and read the full source at
> github.com/EndPx/slope. We had a lot of fun building this — thank you so much for your
> time.

*(On screen: slide 7 with both URLs, large.)*

## Production notes

- The numbers spoken in the demo (dETH executed, fills, bps) **must match the screen** —
  re-check them right before recording and speak what is shown, never what is written here.
- Wallet popups during the demo: approve (1), create (2), delegate consent (3). The mint
  stage is skipped because the wallet was pre-funded.
- If the subgraph 429s during recording: stop, do not record the boot-error screen, resume
  after the bucket resets or fall back to b-roll from a completed schedule.
- After recording: upload (YouTube unlisted is fine) → replace the **Demonstration link** in
  the submission form → submit before September 13, 23:00 WIB.
