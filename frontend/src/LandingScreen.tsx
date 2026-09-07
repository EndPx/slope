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
import {fetchPositions} from "./lib/subgraph";
import {usePageTitle} from "./lib/usePageTitle";

const M = {slopePosition: "0xC7c6FaD1C2A0e8961E34D40c39C059ECE6dBB8Cc", explorerUrl: "https://sepolia.basescan.org"};

export function LandingScreen() {
  usePageTitle(null);
  const navigate = useNavigate();
  const [fillCount, setFillCount] = useState<number | null>(null);

  // Live evidence, from the subgraph so it is always true.
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const list = await fetchPositions();
        if (!stop) setFillCount(list.reduce((acc, p) => acc + p.fills.length, 0));
      } catch {
        if (!stop) setFillCount(null); // silent here: the numbers are a bonus, not the message
      }
    };
    load();
    return () => {
      stop = true;
    };
  }, []);

  return (
    <section className="flex flex-col">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
        <div style={{maxWidth: 620}}>
          <h1 className="display" style={{fontSize: "clamp(1.9rem, 3.4vw, 2.7rem)"}}>
            Split one large swap across time.
          </h1>
          <p className="note" style={{fontSize: "0.95rem", marginTop: "0.7rem", lineHeight: 1.55}}>
            A big order into a thin pool is price impact you pay for. Slope runs it as a schedule — slices over
            minutes, on the curve you choose, inside rails you set.
          </p>
        </div>
        <div style={{marginLeft: "auto"}}>
          <button className="act primary" style={{padding: "0.6rem 1.4rem"}} onClick={() => navigate("/create")}>
            Set a schedule
          </button>
          <p className="note num" style={{marginTop: "0.55rem", textAlign: "right"}}>
            live · {fillCount !== null ? `${fillCount} fills` : "…"} ·{" "}
            <a href={`${M.explorerUrl}/address/${M.slopePosition}`} target="_blank" rel="noreferrer">
              contract
            </a>
          </p>
        </div>
      </div>

      <div style={{marginTop: "1.4rem"}}>
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
