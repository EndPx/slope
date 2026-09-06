/**
 * Compact live-status strip above the execution screen: what the schedule
 * population looks like right now, and how far the subgraph trails the
 * chain head — shown openly, because that lag is exactly why execution
 * decisions are verified on-chain (SPEC section 5).
 */
import {useEffect, useState} from "react";
import {createPublicClient, http} from "viem";
import {baseSepolia} from "viem/chains";
import MANIFEST from "./manifest.json";
import {fetchSummary} from "./lib/subgraph";
import {fmtToken} from "./lib/format";

const M = MANIFEST as {publicRpcUrl: string};

export function StatusBar() {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof fetchSummary>> | null>(null);
  const [lag, setLag] = useState<number | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const [s, head] = await Promise.all([
          fetchSummary(),
          createPublicClient({chain: baseSepolia, transport: http(M.publicRpcUrl)}).getBlockNumber(),
        ]);
        if (!stop) {
          setSummary(s);
          setLag(Number(head - s.indexedBlock));
        }
      } catch {
        /* keep the last reading; the strip is informative, not critical */
      }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="statusbar">
      <span>
        active schedules <b className="num">{summary ? summary.activeCount : "…"}</b>
      </span>
      <span>
        total executed <b className="num">{summary ? `${fmtToken(summary.executedVolume, 18)} dETH` : "…"}</b>
      </span>
      <span>
        fills in 24h <b className="num">{summary ? summary.fills24h : "…"}</b>
      </span>
      <span>
        indexed block <b className="num">{summary ? summary.indexedBlock.toString() : "…"}</b>
      </span>
      <span>
        subgraph lag{" "}
        <b className={`num ${lag !== null && lag > 50 ? "warn" : ""}`}>
          {lag === null ? "…" : lag <= 0 ? "synced" : `${lag} blocks`}
        </b>
      </span>
    </div>
  );
}
