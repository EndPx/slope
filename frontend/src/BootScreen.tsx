/**
 * Boot gate — the honest loading screen.
 *
 * Same ethos as the header's live indicator: it names the real state or it
 * does not show at all.
 *  - Reveals only if boot is still pending after 300 ms; a faster load goes
 *    straight to the content and this screen never mounts.
 *  - No artificial minimum hold: the moment the wallet layer and the
 *    subgraph check settle, the overlay fades and unmounts.
 *  - The status line says what is actually happening (wallet start /
 *    subgraph read), never a generic "loading".
 *  - A check that fails or stalls for 6 s stops the sweep and explains what
 *    failed, with a retry (reload when the wallet layer is the failure).
 *  - prefers-reduced-motion swaps the sweep for a static indicator.
 *
 * The mark is a placeholder until the generated logo lands: swap the SVG
 * for the real asset and nothing else here changes.
 */
import {useEffect, useState} from "react";
import {fetchHeadBlock} from "./lib/subgraph";

const SHOW_AFTER_MS = 300;
const STALL_MS = 6000;

export type SubgraphState = "pending" | "ok" | "failed";

export function useBoot(privyReady: boolean) {
  const [subgraph, setSubgraph] = useState<SubgraphState>("pending");
  const [subgraphNote, setSubgraphNote] = useState("");
  const [walletStalled, setWalletStalled] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // One cheap head-block query proves the live index answers.
  useEffect(() => {
    let stop = false;
    setSubgraph("pending");
    setSubgraphNote("");
    (async () => {
      const stall = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`no answer within ${STALL_MS / 1000} s`)), STALL_MS),
      );
      try {
        await Promise.race([fetchHeadBlock(), stall]);
        if (!stop) setSubgraph("ok");
      } catch (e) {
        if (!stop) {
          setSubgraph("failed");
          setSubgraphNote(e instanceof Error ? e.message : "unreachable");
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [attempt]);

  // The wallet layer gets the same stall budget before we say so.
  useEffect(() => {
    if (privyReady) {
      setWalletStalled(false);
      return;
    }
    const t = setTimeout(() => setWalletStalled(true), STALL_MS);
    return () => clearTimeout(t);
  }, [privyReady]);

  const done = privyReady && subgraph === "ok";

  // The 300 ms rule: reveal only if boot is still pending when it fires.
  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setRevealed(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [done]);

  // No forced hold — on done the overlay fades for a beat and unmounts.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setLeaving(true), revealed ? 200 : 0);
    return () => clearTimeout(t);
  }, [done, revealed]);

  return {
    done,
    revealed,
    leaving,
    subgraph,
    subgraphNote,
    walletStalled,
    privyReady,
    retry: () => setAttempt((n) => n + 1),
  };
}

export function BootScreen(props: {
  privyReady: boolean;
  subgraph: SubgraphState;
  subgraphNote: string;
  walletStalled: boolean;
  onRetry: () => void;
  leaving?: boolean;
}) {
  const walletFailed = props.walletStalled && !props.privyReady;
  const subgraphFailed = props.subgraph === "failed";

  let statusLine = "";
  if (walletFailed || subgraphFailed) {
    const failures: string[] = [];
    if (walletFailed) {
      failures.push("the wallet layer didn't start within 6 s — creating or signing a schedule would not work yet");
    }
    if (subgraphFailed) {
      failures.push(
        `the live subgraph didn't answer (${props.subgraphNote}) — every screen reads it directly, nothing is shown from cache in its place`,
      );
    }
    statusLine = failures.join(" · ");
  } else {
    const pending: string[] = [];
    if (!props.privyReady) pending.push("starting the wallet layer");
    if (props.subgraph === "pending") pending.push("reading live testnet data from the subgraph (Base Sepolia)");
    statusLine = pending.length ? pending.join(" · ") + "…" : "";
  }

  return (
    <div className={`boot-screen${props.leaving ? " leaving" : ""}`} role="status" aria-live="polite">
      <div className="boot-box">
        {/* Placeholder mark — three slices falling along the curve, the fill
          * ball at the end. Replace with the generated logo asset. */}
        <svg className="boot-mark" viewBox="0 0 72 72" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="boot-mark-g" x1="10" y1="14" x2="60" y2="58" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--patina)" />
              <stop offset="1" stopColor="var(--blue)" />
            </linearGradient>
          </defs>
          <path
            d="M12 14 C 32 18, 44 34, 58 56"
            stroke="url(#boot-mark-g)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray="24 10 14 10"
          />
          <circle cx="58" cy="56" r="4.5" fill="var(--paper)" />
        </svg>
        <p className="boot-name">slope</p>
        {statusLine && <p className="boot-status">{statusLine}</p>}
        {!walletFailed && !subgraphFailed ? (
          <div className="boot-bar" aria-hidden="true">
            <span />
          </div>
        ) : (
          walletFailed && (
            <button className="boot-retry" onClick={() => window.location.reload()}>
              Reload the app
            </button>
          )
        )}
        {subgraphFailed && !walletFailed && (
          <button className="boot-retry" onClick={props.onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
