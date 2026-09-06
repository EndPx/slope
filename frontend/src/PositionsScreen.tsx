/**
 * Positions — public list from the subgraph (viewable without login), with
 * the connected wallet's own positions flagged and filterable after login.
 * Selecting a row opens the execution view.
 */
import {useEffect, useState} from "react";
import {useWallets} from "@privy-io/react-auth";
import {fetchPositions, type Position} from "./lib/subgraph";
import {fmtToken} from "./lib/format";
import {SHAPE_COLOR, SHAPE_NAME} from "./CurvePreview";
import {ExecutionScreen} from "./ExecutionScreen";
import {StatusBar} from "./StatusBar";

export function PositionsScreen(props: {initialSelected: bigint | null; onGoCreate: () => void}) {
  const {wallets} = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const ownAddress = wallet?.address?.toLowerCase();

  const [positions, setPositions] = useState<Position[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<"all" | "yours">("all");
  const [selected, setSelected] = useState<bigint | null>(props.initialSelected);

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

  if (selected !== null) {
    return (
      <section className="flex flex-col gap-4">
        <StatusBar />
        <button className="linklike" style={{alignSelf: "flex-start"}} onClick={() => setSelected(null)}>
          all positions
        </button>
        <ExecutionScreen positionId={selected} />
      </section>
    );
  }

  const ownExists = ownAddress ? (positions ?? []).some((p) => p.owner.toLowerCase() === ownAddress) : false;
  const visible = (positions ?? []).filter((p) => filter === "all" || (ownAddress && p.owner.toLowerCase() === ownAddress));

  return (
    <section className="flex flex-col gap-5">
      <StatusBar />
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="display" style={{fontSize: "1.6rem"}}>
          Schedules
        </h2>
        {ownExists && (
          <div className="seg" style={{marginLeft: "auto", maxWidth: 220}}>
            <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              All
            </button>
            <button aria-pressed={filter === "yours"} onClick={() => setFilter("yours")}>
              Yours
            </button>
          </div>
        )}
      </div>

      {failed && (
        <div className="empty">
          <p className="note warn" style={{marginTop: 0}}>
            Live data unreachable — retrying every 15 seconds. Nothing is shown from cache.
          </p>
        </div>
      )}
      {!failed && positions !== null && visible.length === 0 && (
        <div className="empty">
          {filter === "yours" ? (
            <>
              <h2 className="display" style={{fontSize: "1.4rem"}}>
                None of these are yours yet
              </h2>
              <p className="note" style={{marginTop: "0.5rem"}}>
                Create a schedule and it will be flagged here.
              </p>
              <button className="act" style={{marginTop: "1rem", maxWidth: 220}} onClick={props.onGoCreate}>
                Set a schedule
              </button>
            </>
          ) : (
            <>
              <h2 className="display" style={{fontSize: "1.4rem"}}>
                No schedules yet
              </h2>
              <p className="note" style={{marginTop: "0.5rem"}}>
                Set how much and how fast — schedules and every slice they execute will appear here.
              </p>
              <button className="act" style={{marginTop: "1rem", maxWidth: 220}} onClick={props.onGoCreate}>
                Set a schedule
              </button>
            </>
          )}
        </div>
      )}

      {visible.length > 0 && (
        <table className="log">
          <thead>
            <tr>
              <th>schedule</th>
              <th>pace</th>
              <th>status</th>
              <th className="r">executed</th>
              <th className="r">of budget</th>
              <th className="r">fills</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const pct = Number((p.executedAmount * 10000n) / (p.totalBudget || 1n)) / 100;
              const mine = ownAddress && p.owner.toLowerCase() === ownAddress;
              const status = !p.isActive ? (p.executedAmount >= p.totalBudget ? "completed" : "cancelled") : "live";
              return (
                <tr key={p.id} onClick={() => setSelected(BigInt(p.id))} style={{cursor: "pointer"}}>
                  <td className="num">#{p.id}{mine ? " (yours)" : ""}</td>
                  <td>
                    <span className="dot" style={{"--seg-color": SHAPE_COLOR[p.curveShape]} as React.CSSProperties} />
                    {SHAPE_NAME[p.curveShape]}
                  </td>
                  <td className={status === "live" ? "ok" : ""}>{status}</td>
                  <td className="num r">{fmtToken(p.executedAmount, 18)} dETH</td>
                  <td className="num r">{pct.toFixed(1)}%</td>
                  <td className="num r">{p.fills.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
