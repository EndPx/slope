/**
 * Screen 2 — execution progress for one schedule. The ruler carries the
 * story; below it the event log gives FILLED and HELD rows the same
 * typographic rank (skips are evidence, not errors), and the delegation
 * panel states custody plainly: pull-per-fill means an unexecuted budget
 * never left the wallet.
 */
import {useEffect, useState} from "react";
import {useLocation} from "react-router-dom";
import {useWallets} from "@privy-io/react-auth";
import {createWalletClient, custom, encodeFunctionData, http, parseAbi, createPublicClient} from "viem";
import {baseSepolia} from "viem/chains";
import MANIFEST from "./manifest.json";
import {RulerChart} from "./RulerChart";
import {AquaTrace} from "./AquaTrace";
import {SHAPE_COLOR, SHAPE_NAME} from "./CurvePreview";
import {PlotMeta} from "./PlotMeta";
import {fetchPosition, type Position} from "./lib/subgraph";
import {fmtClock, fmtDuration, fmtToken, reasonCopy} from "./lib/format";
import {usePageTitle} from "./lib/usePageTitle";
import {startPolling} from "./lib/poll";

const M = MANIFEST as {slopePosition: `0x${string}`; chainId: number; publicRpcUrl: string; explorerUrl: string};
const KEEPER_URL = (import.meta.env.VITE_KEEPER_URL as string | undefined) ?? "http://localhost:8787";
const KEEPER_TOKEN = (import.meta.env.VITE_KEEPER_TOKEN as string | undefined) ?? "";
const ABI = parseAbi(["function cancel(uint256 positionId)"]);

interface DelegationInfo {
  keyQuorumId: string;
  policyId: string;
}

export function ExecutionScreen(props: {positionId: bigint}) {
  usePageTitle(`Schedule #${props.positionId.toString()}`);
  const {wallets} = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const [position, setPosition] = useState<Position | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [delegation, setDelegation] = useState<DelegationInfo | null>(null);
  const [note, setNote] = useState<{kind: "idle" | "busy" | "ok" | "err"; text: string}>({kind: "idle", text: ""});
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  // Just-created schedules land here before the subgraph has indexed them —
  // the create flow flags it, and the screen waits (fast-poll) instead of
  // flashing "No schedule".
  const location = useLocation();
  const [awaitingIndex, setAwaitingIndex] = useState(() => {
    if (Boolean((location.state as {awaitIndex?: boolean} | null)?.awaitIndex)) return true;
    try {
      return sessionStorage.getItem("awaitIndex") === props.positionId.toString();
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const p = await fetchPosition(props.positionId.toString());
        if (!stop) {
          setError(null);
          setPosition(p);
          setMissing(p === null);
        }
      } catch (e) {
        if (!stop) setError(String((e as Error).message ?? e));
      }
    };
    load();
    // While waiting for a fresh schedule to index, poll fast; otherwise the
    // regular 60 s cadence applies.
    const stopPolling = startPolling(load, awaitingIndex ? 2_500 : 60_000);
    const clock = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      stop = true;
      stopPolling();
      clearInterval(clock);
    };
  }, [props.positionId, awaitingIndex]);

  // Indexed: drop the waiting state (and its sessionStorage marker).
  useEffect(() => {
    if (position !== null && awaitingIndex) {
      try {
        sessionStorage.removeItem("awaitIndex");
      } catch {
        /* storage unavailable */
      }
      setAwaitingIndex(false);
    }
  }, [position, awaitingIndex]);

  // Honest fallback: if it still hasn't indexed after 45 s, stop fast-polling.
  useEffect(() => {
    if (!awaitingIndex) return;
    const t = setTimeout(() => setAwaitingIndex(false), 45_000);
    return () => clearTimeout(t);
  }, [awaitingIndex]);

  // Delegation facts come from the keeper server (gitignored keystore side).
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const response = await fetch(`${KEEPER_URL}/delegations`, {
          headers: KEEPER_TOKEN ? {Authorization: `Bearer ${KEEPER_TOKEN}`} : {},
        });
        const entries = (await response.json()) as Array<{positionId: string; keyQuorumId: string; policyId: string}>;
        if (!stop) setDelegation(entries.find((e) => e.positionId === props.positionId.toString()) ?? null);
      } catch {
        if (!stop) setDelegation(null);
      }
    };
    load();
    return () => {
      stop = true;
    };
  }, [props.positionId]);

  async function revoke() {
    if (!wallet || !position) return;
    try {
      setNote({kind: "busy", text: "Cancelling the schedule — the keeper stops receiving new authorizations…"});
      const eth = (await wallet.getEthereumProvider()) as any;
      try {
        await eth.request({method: "wallet_switchEthereumChain", params: [{chainId: `0x${M.chainId.toString(16)}`}]});
      } catch {
        /* on chain */
      }
      const wc = createWalletClient({chain: baseSepolia, transport: custom(eth)});
      const [address] = await wc.getAddresses();
      const hash = await wc.sendTransaction({
        account: address,
        to: M.slopePosition,
        data: encodeFunctionData({abi: ABI, functionName: "cancel", args: [BigInt(position.id)]}),
      });
      const publicClient = createPublicClient({chain: baseSepolia, transport: http(M.publicRpcUrl)});
      await publicClient.waitForTransactionReceipt({hash});
      setNote({
        kind: "ok",
        text:
          "Schedule cancelled — execution stops here. The unexecuted budget never left your wallet: the contract pulls each slice at fill time, so there is nothing to withdraw.",
      });
    } catch (e: any) {
      setNote({kind: "err", text: `Cancellation didn't go through — ${e.shortMessage ?? e.message}. The schedule keeps running until it succeeds.`});
    }
  }

  if (error) {
    return (
      <div className="empty">
        <h2 className="display">Live data unreachable</h2>
        <p className="note warn" style={{marginTop: "0.5rem"}}>
          {error} — retrying every 10 seconds. Execution waits for live data; nothing is shown from cache.
        </p>
      </div>
    );
  }
  if (missing && awaitingIndex) {
    return (
      <div className="empty" role="status">
        <p className="meta">| AWAITING INDEX</p>
        <h2 className="display">Schedule #{props.positionId.toString()} is live on-chain</h2>
        <p className="note" style={{marginTop: "0.5rem"}}>
          Waiting for the subgraph to index it — this usually takes a few seconds, and this page opens automatically.
        </p>
        <div className="index-bar" aria-hidden="true">
          <span />
        </div>
      </div>
    );
  }
  if (missing) {
    return (
      <div className="empty">
        <h2 className="display">No schedule #{props.positionId.toString()}</h2>
        <p className="note" style={{marginTop: "0.5rem"}}>
          Nothing is indexed under this id yet — if it was just created, the subgraph needs a moment to catch up.
        </p>
      </div>
    );
  }
  if (!position) {
    return <p className="note">loading schedule…</p>;
  }

  const endTimestamp = position.startTimestamp + position.duration;
  const remainingBudget = position.totalBudget - position.executedAmount;
  const remainingTime = endTimestamp > BigInt(now) ? endTimestamp - BigInt(now) : 0n;
  const windowClosed = BigInt(now) >= endTimestamp;
  // Revoke is an owner action: only the wallet that owns the schedule sees it.
  const own = Boolean(wallet && position.owner.toLowerCase() === wallet.address.toLowerCase());
  const statusLabel = !position.isActive
    ? position.executedAmount >= position.totalBudget
      ? "completed"
      : "cancelled"
    : windowClosed
      ? "window closed"
      : "live";
  const events = [
    ...position.fills.map((f) => ({kind: "fill" as const, at: f.timestamp, fill: f})),
    ...position.skips.map((s) => ({kind: "skip" as const, at: s.timestamp, skip: s})),
  ].sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0));

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-baseline gap-4 flex-wrap">
        <h2 className="display">
          Schedule <span className="num">#{position.id}</span>
        </h2>
        <span className="note ok" aria-label="status">
          ● {statusLabel}
        </span>
        <span className="note" style={{color: SHAPE_COLOR[position.curveShape]}}>
          {SHAPE_NAME[position.curveShape]} pace
        </span>
        <span className="note num">
          {fmtToken(position.totalBudget, 18)} dETH → dUSD over {fmtDuration(position.duration)}
        </span>
        {position.creationTx && (
          <span className="note num">
            created{" "}
            <a
              className="linklike"
              href={`${M.explorerUrl}/tx/${position.creationTx}`}
              target="_blank"
              rel="noreferrer"
              title="View the schedule's creation transaction on Basescan"
            >
              {position.creationTx.slice(0, 10)}…{position.creationTx.slice(-8)}
            </a>
            {position.creationBlock > 0n && <> · block <span>{position.creationBlock.toString()}</span></>}
          </span>
        )}
      </div>

      <div className="plot" style={{padding: 0}}>
        <PlotMeta
          surface="CHART_RECORDER: SCHEDULE_DISPERSION"
          axis="CUMULATIVE_FILL / TIME"
          legend={[
            {color: "#e9edf5", label: "PLANNED (BENCHMARK)", dashed: false},
            {color: "#45c4d8", label: "ACTUAL (EXECUTED)"},
          ]}
        />
        <RulerChart
        startTimestamp={position.startTimestamp}
        duration={position.duration}
        totalBudget={position.totalBudget}
        curveShape={position.curveShape}
        isActive={position.isActive}
        fills={position.fills}
        skips={position.skips}
        />
      </div>

      {position.fills.length > 0 && (
        <AquaTrace
          label={`Latest fill #${position.fills[position.fills.length - 1].id.split("-")[1] ?? ""}`}
          txHash={position.fills[position.fills.length - 1].txHash}
          decimalsIn={position.decimalsIn}
          decimalsOut={position.decimalsOut}
        />
      )}

      <div className="strip">
        <div className="grow">
          <p className="label">Remaining budget</p>
          <p className="num" style={{fontSize: "1.05rem", margin: 0}}>
            {fmtToken(remainingBudget, 18)} dETH
          </p>
        </div>
        <div className="grow">
          <p className="label">Remaining time</p>
          <p className="num" style={{fontSize: "1.05rem", margin: 0}}>
            {windowClosed ? "window closed" : fmtDuration(remainingTime)}
          </p>
          {windowClosed && position.isActive && (
            <p className="note">The remainder stays executable — nothing is forfeited.</p>
          )}
        </div>
        <div className="grow">
          <p className="label">Session signer</p>
          <p className="note num" style={{margin: 0}}>
            {delegation ? (
              <>
                {delegation.keyQuorumId}
                <br />
                policy {delegation.policyId}
              </>
            ) : (
              "not delegated — execution needs the scoped key (delegate from Create)"
            )}
          </p>
        </div>
        {own ? (
          <button className="act" style={{maxWidth: 160}} disabled={!position.isActive || note.kind === "busy"} onClick={revoke}>
            {note.kind === "busy" ? "Cancelling…" : "Revoke"}
          </button>
        ) : (
          <p className="note" style={{maxWidth: 180}}>
            Not yours — read-only. Revoke belongs to the schedule's owner.
          </p>
        )}
      </div>
      {note.text && <p className={`note ${note.kind === "err" ? "err" : note.kind === "ok" ? "ok" : ""}`}>{note.text}</p>}

      <div>
        <p className="label">Event log — fills and holds, same rank</p>
        {events.length === 0 ? (
          <div className="empty">
            <p className="note" style={{marginTop: 0}}>
              Nothing has executed yet — the schedule is waiting for its first slice.
            </p>
          </div>
        ) : (
          <table className="log">
            <thead>
              <tr>
                <th>time</th>
                <th>event</th>
                <th className="r">sold</th>
                <th className="r">received</th>
                <th className="r">price</th>
                <th className="r">vs twap</th>
                <th className="r">impact</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) =>
                ev.kind === "fill" ? (
                  <tr key={ev.fill.id}>
                    <td className="num">
                      {fmtClock(ev.fill.timestamp)}
                      <br />
                      <a
                        className="linklike log-tx"
                        href={`${M.explorerUrl}/tx/${ev.fill.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        title="View this fill on Basescan"
                      >
                        {ev.fill.txHash.slice(0, 6)}…{ev.fill.txHash.slice(-4)}
                      </a>
                    </td>
                    <td>
                      <span className="chip patina">Filled</span>
                    </td>
                    <td className="num r">{fmtToken(ev.fill.amountIn, 18)} dETH</td>
                    <td className="num r">{fmtToken(ev.fill.amountOut, 6)} dUSD</td>
                    <td className="num r">{fmtToken(ev.fill.executionPrice, 18, 2)}</td>
                    <td className="num r">
                      {(() => {
                        const twapVwap = position.benchmark?.twapVWAP;
                        if (!twapVwap) return <span className="num">—</span>;
                        const twap = Number(twapVwap) / 1e18;
                        if (twap <= 0) return <span className="num">—</span>;
                        const exec = Number(ev.fill.executionPrice) / 1e18;
                        const bps = ((exec - twap) / twap) * 10000;
                        const good = bps >= 0;
                        return (
                          <span
                            className="num"
                            style={{color: good ? "var(--patina)" : "var(--ember)"}}
                            title="This fill's realized price vs the window's linear-TWAP benchmark price (same math as the position's improvement figure)"
                          >
                            {good ? "+" : ""}
                            {bps.toFixed(1)} bps
                          </span>
                        );
                      })()}
                    </td>
                    <td className="num r">
                      {ev.fill.impactChecked ? (
                        "measured"
                      ) : (
                        <span className="num" title="Below the probe floor this fill's own price impact cannot be measured — only the absolute price rails guarded it.">
                          not checked*
                        </span>
                      )}
                    </td>
                  </tr>
                ) : (
                  <tr key={ev.skip.id} className="held">
                    <td className="num">
                      {fmtClock(ev.skip.timestamp)}
                      <br />
                      <a
                        className="linklike log-tx"
                        href={`${M.explorerUrl}/tx/${ev.skip.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        title="View this hold on Basescan"
                      >
                        {ev.skip.txHash.slice(0, 6)}…{ev.skip.txHash.slice(-4)}
                      </a>
                    </td>
                    <td className="held-cell" colSpan={6}>
                      <span className="chip ember">Held</span>{" "}
                      <span className="held-head">{reasonCopy(ev.skip.reason)[0]}</span>{" "}
                      <span className="note">{reasonCopy(ev.skip.reason)[1]}</span>{" "}
                      <span className="num held-enum">{ev.skip.reason}</span>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
        <p className="note">
          * below the probe floor a fill is too small to measure its own price impact; the absolute price rails still
          guarded it.
        </p>
      </div>
    </section>
  );
}
