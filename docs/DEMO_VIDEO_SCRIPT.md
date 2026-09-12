# Demo Video Script — Slope

Target: 2.5–3 minutes, single continuous screen recording at 1920×1080 with occasional full-screen cuts to the repository.

## Recording prerequisites (do these first)

- **Quota**: confirm the Studio daily bucket is fresh (check `x-ratelimit-remaining` with a single probe, or verify the site loads data in a clean browser). Stop the local keeper if it is running; the VPS keeper at `keeper.endpx.cloud` stays up at 120 s polls.
- **Browser**: clean profile at 1920×1080, bookmarks bar hidden, signed out (the sign-in flow itself is part of the demo).
- **On-chain**: at least one active delegated schedule already running (so fills land on camera), and the Create form numbers decided in advance (10 dETH / 15 min / aggressive).
- **Safety**: if the subgraph 429s mid-recording, stop and resume after the bucket resets. Never record the boot-error screen.

## Shot list

| time | shot | what happens |
| --- | --- | --- |
| 0:00–0:15 | Hook | Landing page. Read the headline once. Point at the live-testnet line: the fill count and executed volume are real, indexed data. |
| 0:15–0:45 | The instrument | Switch paces on the pace ruler; the curves re-draw through the schedule model. One sentence: the curve decides how much of the budget may sell at each moment. |
| 0:45–1:15 | Create | Fill the matrix (10 dETH, 15 min, aggressive, rails). Point at the custody check (live balance and allowance) and `EST. OUT` (a real router quote, not a made-up rate). Click Deploy. |
| 1:15–1:50 | The step machine | The deployment stepper runs visibly: mint (if short), approve, create, delegate — each stage confirmed, wallet popups answered on camera. On success the app redirects to the new schedule's own page. |
| 1:50–2:30 | Execution live | The execution page: the staircase fills in as the delegated keeper executes (the VPS keeper, `keeper.endpx.cloud`). Point at per-fill deviation vs the TWAP benchmark, the Aqua protocol trace decoded with `@1inch/aqua-sdk`, and the event log with tx links to Basescan. |
| 2:30–2:50 | Audit trail | Activity stream (full event history, CSV export) and Performance: the benchmark columns, including negative bps shown as-is. |
| 2:50–3:00 | Close | Repository view: the README status section (deployed and verified contracts, spec-driven history, sponsor integrations). End card: repo URL and live app URL. |

## After recording

- Upload (YouTube unlisted is fine), add the link to the submission form's Demonstration field.
- If a fill does not land on camera inside the window, use b-roll from a schedule that completed earlier the same day and say so plainly ("recorded earlier today").
- The step machine and the boot gate are honest by design; do not cut around their failure states. If something fails on camera, the retry is part of the story.
