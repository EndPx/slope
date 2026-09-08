/**
 * Portfolio — the connected wallet's own schedules: four summary cards and
 * the owned-schedule table. Public screens stay public; this one is gated
 * by the wallet (a calm invitation, never an error) and only appears in
 * the navigation once a wallet is connected.
 */
import {useEffect, useState} from "react";
import {useWallets} from "@privy-io/react-auth";
import {useNavigate} from "react-router-dom";
import {fetchPositionsByOwner, type Position} from "./lib/subgraph";
import {startPolling} from "./lib/poll";
import {useWalletBalances} from "./lib/useWalletBalances";
import {fmtToken} from "./lib/format";
import {SHAPE_COLOR, SHAPE_NAME} from "./CurvePreview";
import {usePageTitle} from "./lib/usePageTitle";

function summarize(positions: Position[]) {
  const owned = positions;
  const active = owned.filter((p) => p.isActive);
  return {
    activeCount: active.length,
    executed: owned.reduce((acc, p) => acc + p.executedAmount, 0n),
    remaining: active.reduce((acc, p) => acc + (p.totalBudget - p.executedAmount), 0n),
    fills: owned.reduce((acc, p) => acc + p.fills.length, 0),
    shown: owned.length,
  };
}

function StatCard(props: {label: string; value: string; sub: string; color?: string}) {
  return (
    <div className="metric-card">
      <span>{props.label}</span>
      <strong style={props.color ? {color: props.color} : undefined}>{props.value}</strong>
      <small>{props.sub}</small>
    </div>
  );
}

export function PortfolioScreen() {
  usePageTitle("Portfolio");
  const navigate = useNavigate();
  const {wallets} = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const address = wallet?.address;
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The wallet's own tokens: dETH (schedule input) and dUSD (fill output).
  const balances = useWalletBalances(address);

  useEffect(() => {
    if (!address) return;
    let stop = false;
    const load = async () => {
      try {
        const list = await fetchPositionsByOwner(address);
        if (!stop) {
          setPositions(list);
          setFailed(false);
        }
      } catch {
        if (!stop) setFailed(true);
      }
    };
    load();
    // startPolling, not a raw interval: hidden tabs stop querying.
    const stopPolling = startPolling(load, 60_000);
    return () => {
      stop = true;
      stopPolling();
    };
  }, [address]);

  // No wallet yet: a calm invitation, never an error — the data behind this
  // screen is wallet-scoped, so there is nothing to show a stranger.
  if (!address) {
    return (
      <div className="empty" style={{maxWidth: 620}}>
        <p className="meta">| WALLET-SCOPED VIEW</p>
        <h2 className="display" style={{fontSize: "1.6rem"}}>
          Your portfolio gathers here
        </h2>
        <p className="note" style={{marginTop: "0.6rem", maxWidth: 470}}>
          Sign in from the Create screen and every schedule you own — with its fills, remaining budget and pace —
          is collected on this page.
        </p>
        <button className="act primary" style={{marginTop: "1.3rem", maxWidth: 260}} onClick={() => navigate("/create")}>
          Set a schedule
        </button>
      </div>
    );
  }

  const stats = positions === null ? null : summarize(positions);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <p className="meta">| WALLET PORTFOLIO</p>
          <h2 className="display" style={{fontSize: "1.7rem"}}>
            Portfolio
          </h2>
          <p className="note" style={{marginBottom: 0}}>
            Every schedule, fill and remaining budget for <span className="num">{address.slice(0, 6)}…{address.slice(-4)}</span>.
          </p>
        </div>
        <button className="act act-ember" style={{width: "auto", marginLeft: "auto", padding: "0.5rem 1rem"}} onClick={() => navigate("/create")}>
          + New schedule
        </button>
      </div>

      {failed && (
        <div className="empty">
          <p className="note warn" style={{marginTop: 0}}>
            Live data unreachable — retrying every 30 seconds. Nothing is shown from cache.
          </p>
        </div>
      )}

      <div className="statusbar">
        <span>
          dETH balance
          <b>{balances.deth !== null ? fmtToken(balances.deth, 18) : "…"}</b>
          <small>schedule input — what the faucet mints</small>
        </span>
        <span>
          dUSD balance
          <b style={{color: "var(--patina)"}}>{balances.dusd !== null ? fmtToken(balances.dusd, 18) : "…"}</b>
          <small>what your fills receive</small>
        </span>
      </div>

      {stats !== null && (
        <div className="statusbar">
          <span>
            active schedules
            <b>{stats.activeCount}</b>
            <small>currently executing on-chain</small>
          </span>
          <span>
            total executed
            <b>{fmtToken(stats.executed, 18)} dETH</b>
            <small>across every owned schedule</small>
          </span>
          <span>
            remaining budget
            <b style={{color: "var(--patina)"}}>{fmtToken(stats.remaining, 18)} dETH</b>
            <small>pending in active schedules</small>
          </span>
          <span>
            total fills
            <b>{stats.fills}</b>
            <small>slices logged on-chain</small>
          </span>
        </div>
      )}

      <h3 className="label" style={{fontSize: "0.95rem", color: "var(--paper)", marginTop: "0.5rem"}}>
        Your schedules
      </h3>
      {positions !== null && positions.length === 0 && (
        <div className="empty">
          <p className="note" style={{marginTop: 0}}>
            You own no schedules yet — set how much and how fast, and it appears here.
          </p>
          <button className="act" style={{marginTop: "1rem", maxWidth: 240}} onClick={() => navigate("/create")}>
            Set a schedule
          </button>
        </div>
      )}
      {positions !== null && positions.length > 0 && (
        <table className="log">
          <thead>
            <tr>
              <th>schedule</th>
              <th>pair</th>
              <th>pace</th>
              <th>progress / fills</th>
              <th className="r">executed / total</th>
              <th className="r">remaining</th>
              <th>status</th>
              <th className="r">action</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const pct = Number((p.executedAmount * 10000n) / (p.totalBudget || 1n)) / 100;
              const status = !p.isActive ? (p.executedAmount >= p.totalBudget ? "completed" : "cancelled") : "live";
              return (
                <tr key={p.id} tabIndex={0} className="clickable" onClick={() => navigate(`/positions/${p.id}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/positions/${p.id}`)}>
                  <td className="num">
                    <span className="chip">#{p.id}</span>
                  </td>
                  <td>dETH / dUSD</td>
                  <td>
                    <span className={`chip ${p.curveShape === 0 ? "ember" : p.curveShape === 2 ? "patina" : "paper"}`}>
                      {SHAPE_NAME[p.curveShape]}
                    </span>
                  </td>
                  <td className="num" style={{minWidth: 190}}>
                    <div style={{display: "flex", alignItems: "center", gap: 8}}>
                      <div style={{flex: 1, height: 4, background: "var(--hairline-soft)", borderRadius: 2, overflow: "hidden"}}>
                        <div style={{width: `${Math.min(100, pct)}%`, height: "100%", background: "var(--patina)"}} />
                      </div>
                      <span>
                        {p.fills.length} / {Math.max(1, Math.ceil(Number(p.totalBudget) / Number(p.minFillAmount || 1n)))}
                      </span>
                    </div>
                    <div style={{textAlign: "right", color: "var(--muted)", fontSize: "0.68rem"}}>{pct.toFixed(0)}%</div>
                  </td>
                  <td className="num r">
                    {fmtToken(p.executedAmount, 18)} / {fmtToken(p.totalBudget, 18)}
                  </td>
                  <td className="num r" style={{color: "var(--patina)"}}>
                    {fmtToken(p.totalBudget - p.executedAmount, 18)}
                  </td>
                  <td>
                    <span className={`chip ${status === "live" ? "patina" : "muted"}`}>{status}</span>
                  </td>
                  <td className="r">
                    <button
                      className="chip"
                      aria-label={`Open schedule ${p.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/positions/${p.id}`);
                      }}
                    >
                      open →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {positions !== null && positions.length > 0 && (
        <p className="note num">
          {positions.length} OF {positions.length} SCHEDULES DISPLAYED &nbsp;|&nbsp; AUTO-REFRESH EVERY 30 S
        </p>
      )}
    </section>
  );
}
