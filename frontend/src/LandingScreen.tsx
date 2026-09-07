/**
 * Landing — one job: a stranger understands what Slope does within seconds.
 * Hero: the ruler draws first, then the three curves draw themselves in
 * sequence (the shared Screen-1 canvas component, intro mode) — then
 * everything stops moving. Below: three simultaneous properties, no
 * numbering, and live evidence pulled from the subgraph.
 */
import {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";
import {CurvePreview} from "./CurvePreview";
import {PlotMeta} from "./PlotMeta";
import {fetchPositions} from "./lib/subgraph";
import {usePageTitle} from "./lib/usePageTitle";

const M = {slopePosition: "0xC7c6FaD1C2A0e8961E34D40c39C059ECE6dBB8Cc", explorerUrl: "https://sepolia.basescan.org"};

export function LandingScreen() {
  usePageTitle(null);
  const navigate = useNavigate();
  const [stats, setStats] = useState<{fills: number; volume: number} | null>(null);

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
    <section className="grid gap-8 lg:grid-cols-[1fr_auto] lg:gap-10 items-center">
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

      <div className="plot" style={{padding: 0}}>
        <div className="plot-meta" style={{borderBottom: "1px solid var(--hairline-soft)"}}>
          <span style={{color: "var(--paper)", fontWeight: 700, fontSize: "0.82rem", textTransform: "none", letterSpacing: 0}}>
            Slope field
          </span>
          <span>PARAMETRIC EXECUTION ENGINE &nbsp;//&nbsp; AXIS: CUMULATIVE_FILL / TIME</span>
          <span className="legend" style={{color: "var(--patina)"}}>
            <span className="livedot">●</span> ENGINE ACTIVE
          </span>
        </div>
        <CurvePreview selected={1} durationSeconds={900} intro />
      </div>

      <div className="pillars" style={{marginTop: "2.2rem"}}>
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
