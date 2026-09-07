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
    <section className="flex flex-col gap-8">
      <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:gap-12 items-center lg:min-h-[480px]">
        <div>
          <h1 className="display" style={{fontSize: "clamp(2.1rem, 4.2vw, 3.2rem)"}}>
            Split one large swap across time.
          </h1>
          <p className="note" style={{fontSize: "0.98rem", marginTop: "1rem", maxWidth: 460, lineHeight: 1.55}}>
            A big order into a thin pool is price impact you pay for. Slope runs it as a schedule — slices over
            minutes, on the curve you choose, inside rails you set.
          </p>
          <button className="act primary" style={{marginTop: "1.6rem", maxWidth: 280}} onClick={() => navigate("/create")}>
            Set a schedule
          </button>
          <p className="note" style={{marginTop: "0.8rem"}}>
            Live on Base Sepolia{" "}
            <a href={`${M.explorerUrl}/address/${M.slopePosition}`} target="_blank" rel="noreferrer">
              contract
            </a>
            {fillCount !== null && (
              <>
                {" "}
                with <span className="num">{fillCount}</span> fills executed
              </>
            )}
            , no custody.
          </p>
        </div>
        <CurvePreview selected={1} durationSeconds={900} intro />
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
