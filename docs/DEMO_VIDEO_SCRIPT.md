# Demo Video Script — Slope (final, synced to the 8-slide deck)

Target: **3:40**, one take per slide, stitched in the editor. Structure follows the proven
ETHGlobal winner pattern (web3torrent): team intro → what we built → how it works → live
demo → how it's made → future work → live URL → close.

## Recording prerequisites (do these in order)

1. **Quota**: make sure the Studio daily bucket is fresh (resets ±22:04 WIB). Stop the
   local keeper; the VPS keeper stays up at 120 s polls. Close every spare browser tab.
2. **Clean browser** at 1920×1080 — sign in with email and faucet the wallet to ≥ 10 dETH
   plus gas **before** recording, so the mint stage is skipped during the demo.
3. **The deck**: 8 slides per the agreed content. Slide 4 uses `docs/data-flow.png`.
4. **The 15-minute window trick**: create the schedule live on camera, then jump cut with a
   "15 minutes later" caption to the execution page already filled in.
5. **Record per slide** (one take each) and stitch. Narration is in English; speak to the
   bullets on screen.

## Voice script, synced to video time

### SLIDE 1 — Title (0:00 – 0:08)

> Hi, we're team Slope, and this is what we built for ETHGlobal Online.

### SLIDE 2 — Who are we (0:08 – 0:33)

> I'm Muhammad Meidy Noor Al Barry, fullstack developer, and I built the entire stack —
> the contracts, the keeper, the subgraph, and the frontend. The whole thing runs without a
> seed phrase and without holding user funds anywhere — that constraint drove every design
> decision you are about to see.

*(Read the name once, then the claim. This doubles as the custody statement.)*

### SLIDE 3 — What We Built (0:33 – 0:58)

> One large swap, executed as scheduled slices over time. Non custodial, enforced on chain.
> Instead of one market order that eats the full price impact, the user declares a budget,
> a duration, and a pace, plus hard price rails. The curve decides how much may sell at
> each moment, and the contract refuses anything outside it.

### SLIDE 4 — How It Works (0:58 – 1:23)

> Four moving parts. A curve on chain authorizes each slice. A delegated keeper on a VPS
> executes every fill. Every fill settles through the 1inch Aqua router. And signing uses
> a Privy scoped session key, enforced by the contract — so the keeper can trigger fills
> forever but can never exceed what the schedule authorizes.

### DEMO — live app (1:23 – 2:58)

> Let's jump into the demo.

*(1:23 — Landing. Point at the live-testnet line; those numbers are real indexed data.)*

> This is the live app on Base Sepolia. Everything you see here is real indexed data.

*(1:38 — Create. Fill the form: 10 dETH, 15 min, aggressive, rails 100/10000, impact 5%.)*

> I'll sell ten dETH over fifteen minutes at an aggressive pace, with price rails and a
> five percent impact limit. The estimated output here is a real quote from the Aqua router
> — not a made-up rate.

*(1:53 — Click Deploy. The stepper runs: approve → create → delegate; answer three wallet
popups.)*

> Deploy. Every stage is visible — approve the spending, create the schedule on-chain, and
> delegate execution to the keeper. Each one is signed in the wallet, and delegation
> happens automatically.

*(2:13 — Redirect to /positions/14.)*

> And we land on the schedule's own page. It is live on-chain, and the keeper picks it up on
> its next tick.

*(2:18 — CUT with a "15 minutes later" caption. Show the filled staircase, the colored
vs-benchmark column, the Aqua trace.)*

> Here is that same window a few minutes in. Every step is a real fill through the Aqua
> router — the staircase is the actual execution, the dashed line is the linear-TWAP
> benchmark, and the table shows each fill's deviation in basis points. Below it, the Aqua
> protocol trace of the latest fill, decoded from the receipt with the official SDK.

*(2:48 — Activity.)*

> And in Activity, the whole indexed event stream — holds included, each with its reason —
> exportable as CSV.

### SLIDE 6 — How It's Made (2:58 – 3:18)

> Three key pieces — the contract, the keeper, and the subgraph. A fixed point curve
> kernel, fuzz tested and cross validated against a TypeScript reference model. A fail
> closed keeper — if the subgraph is unreachable it skips a tick and logs it, cached data
> never makes a financial decision. And every fill settles through the official 1inch Aqua
> router, self deployed on Base Sepolia.

### SLIDE 7 — Future Work (3:18 – 3:30)

> Next up: price driven execution, where the duration becomes optional. Account
> abstraction, so external wallets like MetaMask can delegate through smart accounts. And
> mainnet, with more pairs and pace shapes.

### SLIDE 8 — Check it out live (3:30 – 3:40)

> You can try it right now at slope-beta.vercel.app, and read the full source at
> github.com/EndPx/slope. We had a lot of fun building this — thank you so much for your
> time.

## Production notes

- The numbers spoken in the demo (dETH executed, fills, bps) **must match the screen** —
  re-check them right before recording and speak what is shown, never what is written here.
- Wallet popups during the demo: approve (1), create (2), delegate consent (3). The mint
  stage is skipped because the wallet was pre-funded.
- Slide 2 is the only slide without a claim — deliver it as a plain introduction, then let
  slide 3 carry the product statement.
- If the subgraph 429s during recording: stop, do not record the boot-error screen, resume
  after the bucket resets or fall back to b-roll from a completed schedule.
- After recording: upload (YouTube unlisted is fine) → replace the **Demonstration link** in
  the submission form → submit before September 13, 23:00 WIB.
