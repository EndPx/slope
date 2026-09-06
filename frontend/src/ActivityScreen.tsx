/**
 * Activity — the live subgraph event stream, open to everyone: creations,
 * fills, holds (with reasons), cancellations, completions — one flow, one
 * rank, with transaction links a judge can check themselves. CSV export for
 * anyone who wants the numbers in their own tool.
 */
import {useEffect, useMemo, useState} from "react";
import {fetchPositions, type Position} from "./lib/subgraph";
import {fmtClock, fmtToken, reasonCopy} from "./lib/format";
import {StatusBar} from "./StatusBar";
import MANIFEST from "./manifest.json";

const M = MANIFEST as {explorerUrl: string};

interface Event {
  kind: "created" | "filled" | "held" | "cancelled" | "completed";
  label: string;
  at: bigint;
  positionId: string;
  block: bigint;
  tx: string;
  flow: string | null;
}

function buildStream(positions: Position[]): Event[] {
  const out: Event[] = [];
  for (const p of positions) {
    out.push({kind: "created", label: "Created", at: p.startTimestamp, positionId: p.id, block: p.creationBlock, tx: p.creationTx, flow: null});
    for (const f of p.fills) {
      out.push({
        kind: "filled",
        label: "Filled",
        at: f.timestamp,
        positionId: p.id,
        block: f.blockNumber,
        tx: f.txHash,
        flow: `${fmtToken(f.amountIn, 18)} dETH in, ${fmtToken(f.amountOut, 6)} dUSD out`,
      });
    }
    for (const s of p.skips) {
      out.push({
        kind: "held",
        label: `Held — ${reasonCopy(s.reason)[0]}`,
        at: s.timestamp,
        positionId: p.id,
        block: s.blockNumber,
        tx: s.txHash,
        flow: null,
      });
    }
    if (p.cancelledAt !== null) {
      out.push({kind: "cancelled", label: "Cancelled", at: p.cancelledAt, positionId: p.id, block: 0n, tx: "", flow: null});
    }
    if (p.completedAt !== null) {
      out.push({kind: "completed", label: "Completed", at: p.completedAt, positionId: p.id, block: 0n, tx: "", flow: null});
    }
  }
  return out.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0));
}

function toCsv(events: Event[]): string {
  const rows = [["kind", "position", "timestamp_unix", "time_utc", "block", "tx", "flow"]];
  for (const e of events) {
    rows.push([
      e.kind,
      e.positionId,
      e.at.toString(),
      new Date(Number(e.at) * 1000).toISOString(),
      e.block.toString(),
      e.tx,
      e.flow ?? "",
    ]);
  }
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function ActivityScreen() {
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
    const t = setInterval(load, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  const events = useMemo(() => (positions ? buildStream(positions) : []), [positions]);
  const counts = useMemo(() => {
    const c = {filled: 0, held: 0};
    for (const e of events) {
      if (e.kind === "filled") c.filled += 1;
      if (e.kind === "held") c.held += 1;
    }
    return c;
  }, [events]);

  function downloadCsv() {
    const blob = new Blob([toCsv(events)], {type: "text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "slope-activity.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex flex-col gap-5">
      <StatusBar />
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="display" style={{fontSize: "1.6rem"}}>
          Activity
        </h2>
        <span className="note num" style={{marginLeft: "auto"}}>
          {events.length} indexed events, {counts.filled} fills, {counts.held} holds
        </span>
        {events.length > 0 && (
          <button className="act" style={{width: "auto", padding: "0.3rem 0.8rem"}} onClick={downloadCsv}>
            Export CSV
          </button>
        )}
      </div>

      {failed && (
        <div className="empty">
          <p className="note warn" style={{marginTop: 0}}>
            Live data unreachable — retrying every 15 seconds. Nothing is shown from cache.
          </p>
        </div>
      )}

      {positions !== null && events.length === 0 && !failed && (
        <div className="empty">
          <p className="note" style={{marginTop: 0}}>
            No events indexed yet — they appear here the moment a schedule is created.
          </p>
        </div>
      )}

      {events.length > 0 && (
        <table className="log">
          <thead>
            <tr>
              <th>time</th>
              <th>event</th>
              <th>schedule</th>
              <th>flow</th>
              <th className="r">block</th>
              <th className="r">tx</th>
            </tr>
          </thead>
          <tbody>
            {events.slice(0, 400).map((e, i) => (
              <tr key={`${e.kind}-${e.positionId}-${i}`} className={e.kind === "held" ? "held" : ""}>
                <td className="num">{fmtClock(e.at)}</td>
                <td>
                  {e.kind === "held" ? <span className="held-head">{e.label}</span> : e.label}
                </td>
                <td className="num">#{e.positionId}</td>
                <td>{e.flow ?? "—"}</td>
                <td className="num r">{e.block.toString()}</td>
                <td className="r">
                  {e.tx ? (
                    <a href={`${M.explorerUrl}/tx/${e.tx}`} target="_blank" rel="noreferrer">
                      {e.tx.slice(0, 10)}…
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {events.length > 400 && <p className="note">Showing the newest 400 of {events.length} events — export CSV for the full set.</p>}
    </section>
  );
}
