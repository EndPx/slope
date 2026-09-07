/**
 * Landing — one job: a stranger understands what Slope does within seconds.
 * The right side is the FIELD INSTRUMENT (the reference's landing-stage
 * structure): an animated canvas where the three paces glow and glowing
 * slices ride the selected pace's own schedule. Choosing a pace re-routes
 * the balls — Aggressive rushes early, Conservative hugs the floor then
 * sprints. The chosen pace carries over to Create.
 */
import {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";
import {HeroFieldCanvas, PACE_COLOR, PACE_NAME, PACE_NOTE} from "./HeroFieldCanvas";
import {fetchPositions} from "./lib/subgraph";
import {usePageTitle} from "./lib/usePageTitle";

const M = {slopePosition: "0xC7c6FaD1C2A0e8961E34D40c39C059ECE6dBB8Cc", explorerUrl: "https://sepolia.basescan.org"};

export function LandingScreen() {
  usePageTitle(null);
  const navigate = useNavigate();
  const [stats, setStats] = useState<{fills: number; volume: number} | null>(null);
  const [pace, setPace] = useState<number>(() => {
    const stored = Number(localStorage.getItem("pace"));
    return [0, 1, 2].includes(stored) ? stored : 1;
  });

  function selectPace(next: number) {
    setPace(next);
    localStorage.setItem("pace", String(next)); // carries into Create's default
  }

  // Live evidence, from the subgraph so it is always true.
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const list = await fetchPositions();
        if (!stop)
          setStats({
            fills: list.reduce((acc, p) => acc + p.fills.length, 0),
            volume: list.reduce((acc, p) => acc + Number(p.executedAmount) / 1e18, 0),
          });
      } catch {
        if (!stop) setStats(null); // silent here: the numbers are a bonus, not the message
      }
    };
    load();
    return () => {
      stop = true;
    };
  }, []);

  return (
    <section className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12 items-center">
      <div>
        <p className="meta">Time-distributed execution</p>
        <h1 className="display" style={{fontSize: "clamp(2.4rem, 4.6vw, 3.6rem)", lineHeight: 1.02}}>
          Shape the <span className="grad">schedule.</span>
        </h1>
        <p className="note" style={{fontSize: "1rem", marginTop: "1.1rem", lineHeight: 1.6, maxWidth: 470}}>
          Liquidity is no longer a single violent swap. Shape a schedule, publish its geometry, and let every slice
          fill through it — inside rails you set.
        </p>
        <button className="act primary" style={{marginTop: "1.7rem", maxWidth: 260}} onClick={() => navigate("/create")}>
          Set a schedule
        </button>
        <p className="note" style={{marginTop: "0.9rem"}}>
          Live testnet: {stats !== null ? stats.volume.toFixed(0) : "…"} dETH routed across{" "}
          <span className="num">{stats?.fills ?? "…"}</span> fills —{" "}
          <a href={`${M.explorerUrl}/address/${M.slopePosition}`} target="_blank" rel="noreferrer">
            view contract
          </a>
        </p>
      </div>

      <div className="landing-stage">
        <div className="hero-orbit hero-orbit-a" />
        <div className="hero-orbit hero-orbit-b" />
        <article className="hero-field-card">
          <header>
            <div className="field-title">
              <strong>SLOPE FIELD</strong>
              <small>PARAMETRIC EXECUTION ENGINE</small>
            </div>
            <span className="hero-live">
              <i /> ENGINE ACTIVE
            </span>
          </header>
          <div className="hero-canvas-wrap">
            <HeroFieldCanvas pace={pace} />
            <span className="hero-field-label buy" style={{top: "auto", bottom: "10%", left: "4%"}}>
              0% · START
            </span>
            <span className="hero-field-label sell" style={{top: "9%", right: "4%"}}>
              100% · DONE
            </span>
            <span className="hero-mid-label">
              SLOPE / PACE {PACE_NAME[pace].toUpperCase()}
            </span>
          </div>
          <footer>
            <div className="hero-pace-readout">
              <span>PACE</span>
              <strong style={{color: PACE_COLOR[pace]}}>{PACE_NAME[pace]}</strong>
            </div>
            <div className="pace-seg" role="group" aria-label="Execution pace">
              {[0, 1, 2].map((s) => (
                <button
                  key={s}
                  style={{"--seg-color": PACE_COLOR[s]} as React.CSSProperties}
                  aria-pressed={pace === s}
                  onClick={() => selectPace(s)}
                >
                  {PACE_NAME[s]}
                </button>
              ))}
            </div>
          </footer>
        </article>
        <div className="hero-floating-stat">
          <span>SELECTED PACE</span>
          <strong style={{color: PACE_COLOR[pace]}}>{PACE_NOTE[pace].split(" —")[0]}</strong>
        </div>
      </div>

      <div className="pillars">
        <div>
          <h3>The schedule is the only authority</h3>
          <p>Nothing moves unless the curve authorizes it. The contract computes every allowed slice; the delegated
            keeper can only tighten it, never exceed it.</p>
        </div>
        <div>
          <h3>Your tokens never leave your wallet</h3>
          <p>Each slice is pulled at fill time, not parked in escrow. An unexecuted budget is simply still yours —
            there is nothing to withdraw.</p>
        </div>
        <div>
          <h3>It holds back when it should</h3>
          <p>Out-of-band prices, excessive impact, an empty allowance: the system refuses to act — and every refusal
            is recorded with its reason.</p>
        </div>
      </div>
    </section>
  );
}
