/**
 * App shell — chrome, live status, and the route table.
 *
 * Every screen has its own URL (/, /create, /positions, /positions/:id,
 * /performance, /activity): deep links work for demos and evidence, back
 * and refresh behave, and the document title names the open screen.
 * Signing in is only required to transact — all screens render for
 * strangers, and no auth watcher ever forces a redirect.
 */
import {useEffect, useState} from "react";
import {NavLink, Route, Routes, useNavigate, useParams} from "react-router-dom";
import {useLogin, usePrivy, useWallets} from "@privy-io/react-auth";
import {createPublicClient, http} from "viem";
import {baseSepolia} from "viem/chains";
import "./style.css";
import {LandingScreen} from "./LandingScreen";
import {CreateScreen} from "./CreateScreen";
import {PositionsScreen} from "./PositionsScreen";
import {ExecutionScreen} from "./ExecutionScreen";
import {PerformanceScreen} from "./PerformanceScreen";
import {ActivityScreen} from "./ActivityScreen";
import {FaucetPanel} from "./FaucetPanel";
import {StatusBar} from "./StatusBar";
import {fetchHeadBlock} from "./lib/subgraph";
import {startPolling} from "./lib/poll";
import {usePageTitle} from "./lib/usePageTitle";
import MANIFEST from "./manifest.json";

const MANIFEST_APP = MANIFEST as {publicRpcUrl: string};

/** Honest live indicator: it says the keeper is running only when the
 *  keeper server answers, and names the subgraph's actual lag. */
function LiveStatus() {
  const [keeper, setKeeper] = useState<boolean | null>(null);
  const [lag, setLag] = useState<number | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      let k: boolean;
      try {
        const r = await fetch("http://localhost:8787/health");
        k = r.ok;
      } catch {
        k = false;
      }
      try {
        const head = await createPublicClient({chain: baseSepolia, transport: http(MANIFEST_APP.publicRpcUrl)}).getBlockNumber();
        const indexed = await fetchHeadBlock();
        if (!stop) setLag(Number(head - indexed));
      } catch {
        if (!stop) setLag(null);
      }
      if (!stop) setKeeper(k);
    };
    load();
    const stopPolling = startPolling(load, 60_000);
    return () => {
      stop = true;
      stopPolling();
    };
  }, []);

  const healthy = keeper === true && lag !== null && lag <= 50;
  return (
    <span className={`livestatus ${healthy ? "ok" : "warn"}`} title="keeper server on this machine, and how far the subgraph trails the chain head">
      <span className="livedot">●</span> keeper {keeper === null ? "…" : keeper ? "live" : "offline"}
      {lag !== null && <> · subgraph {lag <= 0 ? "synced" : `−${lag} blocks`}</>}
    </span>
  );
}

/** /positions/:id — the deep-linkable evidence view. */
function ScheduleDetail() {
  const {id} = useParams();
  const numeric = Number(id);
  usePageTitle(Number.isInteger(numeric) && numeric > 0 ? `Schedule #${numeric}` : "Schedule not found");
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return (
      <div className="empty">
        <h2 className="display" style={{fontSize: "1.4rem"}}>
          "{id}" is not a schedule id
        </h2>
        <p className="note" style={{marginTop: "0.5rem"}}>
          Open the positions list and pick one — every schedule has its own link.
        </p>
        <NavLink className="act" style={{marginTop: "1rem", maxWidth: 220, textAlign: "center"}} to="/positions">
          All positions
        </NavLink>
      </div>
    );
  }
  return (
    <section className="flex flex-col gap-4">
      <StatusBar />
      <NavLink to="/positions" className="linklike" style={{alignSelf: "flex-start"}}>
        all positions
      </NavLink>
      <ExecutionScreen positionId={BigInt(numeric)} />
    </section>
  );
}

const NAV: Array<[string, string]> = [
  ["/create", "Create"],
  ["/positions", "Positions"],
  ["/performance", "Performance"],
  ["/activity", "Activity"],
];

export default function App() {
  const {ready, logout} = usePrivy();
  const {login} = useLogin();
  const {wallets} = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const [showFaucet, setShowFaucet] = useState(false);
  const [livePositionId, setLivePositionId] = useState<bigint | null>(
    localStorage.getItem("positionId") ? BigInt(localStorage.getItem("positionId")!) : null,
  );

  if (!ready) {
    return (
      <main>
        <div className="work">
          <p className="note">loading…</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <header className="chrome">
        <div className="container">
          <NavLink to="/" className="wordmark" aria-label="Slope home">
            slope<span className="livedot">●</span>
          </NavLink>
        <nav aria-label="Screens">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} className={({isActive}) => (isActive ? "active" : undefined)}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="chrome-right">
          <LiveStatus />
          {wallet && (
            <span style={{position: "relative"}}>
              <button className="linklike" onClick={() => setShowFaucet((v) => !v)}>
                faucet
              </button>
              {showFaucet && <FaucetPanel onClose={() => setShowFaucet(false)} />}
            </span>
          )}
          <a className="linklike" href="https://github.com/EndPx/slope" target="_blank" rel="noreferrer">
            docs
          </a>
          {wallet ? (
            <span className="account" title="Privy embedded wallet — the schedule pulls slices from here">
              <span className="account-dot" />
              <span className="num">
                {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
              </span>
              <button className="linklike account-out" onClick={() => logout()}>
                sign out
              </button>
            </span>
          ) : (
            <button className="act" style={{padding: "0.3rem 0.8rem", width: "auto"}} onClick={() => login({})}>
              sign in
            </button>
          )}
        </div>
        </div>
      </header>

      <div className="work">
        <div className="container">
          <Routes>
          <Route path="/" element={<LandingScreen />} />
          <Route
            path="/create"
            element={
              <>
                <CreateRouteHeader livePositionId={livePositionId} />
                <CreateScreen onCreated={setLivePositionId} />
              </>
            }
          />
          <Route path="/positions" element={<PositionsScreen />} />
          <Route path="/positions/:id" element={<ScheduleDetail />} />
          <Route path="/performance" element={<PerformanceScreen />} />
          <Route path="/activity" element={<ActivityScreen />} />
          <Route path="*" element={<LandingScreen />} />
        </Routes>
        </div>
      </div>

      <footer className="attribution">
        <div className="container attribution-row">
          <span>
            <code>Powered by Aqua — © Degensoft Ltd 2025 · Powered by SwapVM — © Degensoft Ltd 2025</code>
          </span>
          <span>
            powered by privy · the graph ·{" "}
            <a
              className="linklike"
              href="https://sepolia.basescan.org/address/0xC7c6FaD1C2A0e8961E34D40c39C059ECE6dBB8Cc"
              target="_blank"
              rel="noreferrer"
            >
              contract
            </a>
          </span>
        </div>
      </footer>
    </main>
  );
}

function CreateRouteHeader(props: {livePositionId: bigint | null}) {
  usePageTitle("Create a schedule");
  return props.livePositionId !== null ? (
    <p className="note ok num" style={{marginBottom: "1rem"}}>
      schedule #{props.livePositionId.toString()} is live — create another below, or watch it under Positions
    </p>
  ) : null;
}
