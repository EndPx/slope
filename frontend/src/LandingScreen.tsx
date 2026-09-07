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
    <section className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:gap-10 items-start">
      <div>
        <p className="meta">| EXECUTION BENCH // BASE SEPOLIA TESTNET</p>
        <h1
          className="num"
          style={{fontSize: "clamp(1.7rem, 3vw, 2.4rem)", fontWeight: 600, lineHeight: 1.15, margin: 0}}
        >
          Discrete execution curves for scheduled high-volume swaps.
        </h1>
        <p className="note" style={{fontSize: "0.9rem", marginTop: "0.9rem", lineHeight: 1.55, maxWidth: 470}}>
          Slope partitions one large swap order into scheduled slices along configurable geometric paths. Execution
          disperses price impact across time, inside rails you set.
        </p>
        <button className="act act-ember" style={{marginTop: "1.5rem", maxWidth: 300}} onClick={() => navigate("/create")}>
          Initialize execution curve
        </button>
        <p className="note" style={{marginTop: "0.8rem"}}>
          Live testnet: {stats !== null ? stats.volume.toFixed(0) : "…"} routed across{" "}
          <span className="num">{stats?.fills ?? "…"}</span> fills —{" "}
          <a href={`${M.explorerUrl}/address/${M.slopePosition}`} target="_blank" rel="noreferrer">
            view contract
          </a>
        </p>
      </div>

      <div className="plot" style={{padding: 0}}>
        <PlotMeta
          surface="THREE-CURVE BENCH"
          axis="CUMULATIVE_FILL / TIME"
          legend={[
            {color: "#ff7a45", label: "AGGRESSIVE"},
            {color: "#eae5d6", label: "NEUTRAL"},
            {color: "#4fb8a9", label: "CONSERVATIVE"},
          ]}
        />
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
