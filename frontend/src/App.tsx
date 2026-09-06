/**
 * App shell — wayfinding, header chrome, attribution footer.
 *
 * Access pattern: every screen is viewable WITHOUT login (the data is
 * public and on-chain); signing in is only required to transact. The live
 * indicator states the truth — keeper server reachability and the
 * subgraph's actual lag behind the chain head.
 */
import {useEffect, useState} from "react";
import {useLogin, usePrivy, useWallets} from "@privy-io/react-auth";
import {createPublicClient, http} from "viem";
import {baseSepolia} from "viem/chains";
import "./style.css";
import {CreateScreen} from "./CreateScreen";
import {PositionsScreen} from "./PositionsScreen";
import {ExecutionScreen} from "./ExecutionScreen";
import {FaucetPanel} from "./FaucetPanel";
import {fetchHeadBlock} from "./lib/subgraph";
import MANIFEST from "./manifest.json";

const MANIFEST_APP = MANIFEST as {publicRpcUrl: string};

type Tab = "create" | "positions" | "performance" | "activity";

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
    const t = setInterval(load, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
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

export default function App() {
  const {ready, logout} = usePrivy();
  const {login} = useLogin();
  const {wallets} = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const [tab, setTab] = useState<Tab>("create");
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
        <span className="wordmark">
          slope<span className="livedot">●</span>
        </span>
        <nav aria-label="Screens">
          {(
            [
              ["create", "Create"],
              ["positions", "Positions"],
              ["performance", "Performance"],
              ["activity", "Activity"],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
            <button key={key} aria-current={tab === key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
        <span style={{marginLeft: "auto"}} />
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
          <>
            <span className="note num" style={{margin: 0}}>
              {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
            </span>
            <button className="linklike" onClick={() => logout()}>
              sign out
            </button>
          </>
        ) : (
          <button className="act" style={{padding: "0.3rem 0.8rem", width: "auto"}} onClick={() => login({})}>
            sign in
          </button>
        )}
      </header>

      <div className="work">
        {tab === "create" && (
          <>
            {livePositionId !== null && (
              <p className="note ok num" style={{marginBottom: "1rem"}}>
                schedule #{livePositionId.toString()} is live — create another below, or watch it under Positions
              </p>
            )}
            <CreateScreen onCreated={(id) => setLivePositionId(id)} />
          </>
        )}
        {tab === "positions" && <PositionsScreen initialSelected={livePositionId} onGoCreate={() => setTab("create")} />}
        {tab === "performance" && (
          <div className="empty">
            <h2 className="display" style={{fontSize: "1.4rem"}}>
              Performance grading lands with the next screen
            </h2>
            <p className="note" style={{marginTop: "0.5rem"}}>
              Realized execution is graded against a plain linear schedule at the same observed prices — including the
              cases where the curve loses.
            </p>
          </div>
        )}
        {tab === "activity" && (
          <div className="empty">
            <h2 className="display" style={{fontSize: "1.4rem"}}>
              The live event stream lands here
            </h2>
            <p className="note" style={{marginTop: "0.5rem"}}>
              Every indexed event — fills, holds, schedules — with transaction links you can check yourself.
            </p>
          </div>
        )}
      </div>

      <footer className="attribution">
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
      </footer>
    </main>
  );
}
