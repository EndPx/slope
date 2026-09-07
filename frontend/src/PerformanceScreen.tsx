/**
 * Screen 3 — performance grading. One horizontal bar per position: realized
 * VWAP versus the linear-TWAP reference at the same observed prices. Minus
 * protrudes LEFT of the zero line, visible and annotated — a dashboard that
 * is always green would be a red flag.
 */
import {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";
import {fetchPositions, type Position} from "./lib/subgraph";
import {usePageTitle} from "./lib/usePageTitle";
import {StatusBar} from "./StatusBar";
import {startPolling} from "./lib/poll";
import {fmtBps, fmtToken, fmtVwap} from "./lib/format";
import {SHAPE_COLOR, SHAPE_NAME} from "./CurvePreview";

export function PerformanceScreen() {
  usePageTitle("Performance");
  const navigate = useNavigate();
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const list = await fetchPositions();
        if (!stop) {
          setPositions(list);
          setFailed(false);
        }
      } catch {
        if (!stop) setFailed(true);
      }
    };
    load();
    const stopPolling = startPolling(load, 30_000);
    return () => {
      stop = true;
      stopPolling();
    };
  }, []);

  if (failed) {
    return (
      <div className="empty">
        <p className="note warn" style={{marginTop: 0}}>
          Live data unreachable — retrying every 15 seconds. Nothing is shown from cache.
        </p>
      </div>
    );
  }
  if (positions === null) return <p className="note">loading…</p>;

  const graded = positions.filter((p) => p.benchmark?.improvementBps != null);
  const maxAbs = Math.max(1, ...graded.map((p) => Math.abs(Number(p.benchmark!.improvementBps))));
  const negWidth = `${(Math.max(0, ...graded.map((p) => -Number(p.benchmark!.improvementBps))) / maxAbs) * 50}%`;
  const posWidth = `${(Math.max(0, ...graded.map((p) => Number(p.benchmark!.improvementBps))) / maxAbs) * 50}%`;

  return (
    <section className="flex flex-col gap-5">
      <StatusBar />
      <div>
        <p className="meta">| METRICS AGGREGATED // BENCHMARK: LINEAR AT OBSERVED PRICES</p>
        <h2 className="display num" style={{fontSize: "1.3rem", fontWeight: 600, letterSpacing: 0}}>
          Execution benchmark: schedule delta vs linear TWAP
        </h2>
        <p className="note">
          Net basis point gain (patina) versus slippage loss (ember) across executed schedules. Negative numbers
          appear as they are.
        </p>
      </div>

      {graded.length === 0 && (
        <div className="empty">
          <p className="note" style={{marginTop: 0}}>
            Grading appears once a schedule has filled at two different moments of its window.
          </p>
        </div>
      )}

      {graded.length > 0 && (
        <div className="bench-head num">
          <span>SLIPPAGE DRAG / COST (−BPS)</span>
          <span>0.00 ZERO LINE</span>
          <span>POSITIVE ALPHA / SAVED (+BPS)</span>
        </div>
      )}
      <div className="bench">
        {graded.map((p) => {
          const bps = Number(p.benchmark!.improvementBps);
          const positive = bps >= 0;
          const widthPct = (Math.abs(bps) / maxAbs) * 50;
          const terminal = p.benchmark!.elapsedAtLastFill >= p.duration;
          return (
            <div key={p.id} className="bench-row" onClick={() => navigate(`/positions/${p.id}`)}>
              <div className="bench-label num">
                <span className="dot" style={{"--seg-color": SHAPE_COLOR[p.curveShape]} as React.CSSProperties} />#{p.id}
              </div>
              <div className="bench-track">
                <div className="bench-zero" style={{left: negWidth}} />
                {positive ? (
                  <div
                    className="bench-bar"
                    style={{left: negWidth, width: `${widthPct}%`, background: "var(--patina)"}}
                    title={`${fmtBps(p.benchmark!.improvementBps)} vs linear TWAP`}
                  />
                ) : (
                  <div
                    className="bench-bar"
                    style={{right: posWidth, width: `${widthPct}%`, background: "var(--ember)"}}
                    title={`${fmtBps(p.benchmark!.improvementBps)} vs linear TWAP`}
                  />
                )}
              </div>
              <div className="bench-num num">{fmtBps(p.benchmark!.improvementBps)}</div>
              <div className="bench-meta">
                {p.fills.length} fill{p.fills.length === 1 ? "" : "s"}, VWAP {fmtVwap(p.benchmark!.actualVWAP)} vs
                reference {fmtVwap(p.benchmark!.twapVWAP)}
                {bps < 0 && (
                  <span className="note">
                    {" "}
                    — {terminal
                      ? "settled through the terminal clamp: large final fills met momentary prices"
                      : "the curve trailed linear TWAP at these observed prices"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {graded.length > 0 && (
          <p className="note num" style={{marginTop: "0.2rem"}}>
            DOMAIN: [−{maxAbs.toFixed(1)}, +{maxAbs.toFixed(1)} BPS] &nbsp;|&nbsp; NORMALIZATION: LINEAR CARTESIAN SNAP
          </p>
        )}
      </div>

      <table className="log">
        <thead>
          <tr>
            <th>schedule</th>
            <th>pace</th>
            <th className="r">executed</th>
            <th className="r">actual VWAP</th>
            <th className="r">TWAP reference</th>
            <th className="r">improvement</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const b = p.benchmark;
            return (
              <tr key={p.id} tabIndex={0} className="clickable" onClick={() => navigate(`/positions/${p.id}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/positions/${p.id}`)}>
                <td className="num">#{p.id}</td>
                <td>
                  <span className="dot" style={{"--seg-color": SHAPE_COLOR[p.curveShape]} as React.CSSProperties} />
                  {SHAPE_NAME[p.curveShape]}
                </td>
                <td className="num r">{fmtToken(p.executedAmount, 18)} dETH</td>
                <td className="num r">{b ? fmtVwap(b.actualVWAP) : "—"}</td>
                <td className="num r">{b?.twapVWAP ? fmtVwap(b.twapVWAP) : "—"}</td>
                <td className={`num r ${b?.improvementBps && Number(b.improvementBps) < 0 ? "neg" : "pos"}`}>
                  {b ? fmtBps(b.improvementBps) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
