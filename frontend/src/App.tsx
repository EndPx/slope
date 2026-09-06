/**
 * App shell — wayfinding, auth gate, attribution footer. Screen 1 is live;
 * Positions and Performance are honest invitations until their commits land
 * (implementation order: one screen per review round).
 */
import {useEffect, useState} from "react";
import {useLogin, usePrivy, useWallets} from "@privy-io/react-auth";
import "./style.css";
import {CreateScreen} from "./CreateScreen";
import {ExecutionScreen} from "./ExecutionScreen";
import {FaucetPanel} from "./FaucetPanel";

type Tab = "create" | "positions" | "performance";

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

  // Returning to Create with a live schedule shows its id as context.
  useEffect(() => {
    if (livePositionId !== null && tab === "create") return;
  }, [livePositionId, tab]);

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
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
            <button key={key} aria-current={tab === key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
        <span style={{marginLeft: "auto"}} />
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
        {tab === "positions" &&
          (livePositionId !== null ? (
            <ExecutionScreen positionId={livePositionId} />
          ) : (
            <div className="empty">
              <h2 className="display">No schedules yet</h2>
              <p className="note" style={{marginTop: "0.5rem"}}>
                Set how much and how fast — your schedules and every slice they execute will appear here.
              </p>
              <button className="act" style={{marginTop: "1.1rem", maxWidth: 260}} onClick={() => setTab("create")}>
                Set a schedule
              </button>
            </div>
          ))}
        {tab === "performance" && (
          <div className="empty">
            <h2 className="display">Performance appears after the first slice</h2>
            <p className="note" style={{marginTop: "0.5rem"}}>
              Realized execution is graded against a plain linear schedule at the same prices — including the cases
              where the curve loses. Nothing is hidden.
            </p>
            <button className="act" style={{marginTop: "1.1rem", maxWidth: 260}} onClick={() => setTab("create")}>
              Set a schedule
            </button>
          </div>
        )}
      </div>

      <footer className="attribution">
        <span>
          <code>Powered by Aqua — © Degensoft Ltd 2025</code> · <code>Powered by SwapVM — © Degensoft Ltd 2025</code>
        </span>
        <span>
          powered by privy · the graph ·{" "}
          {!ready ? null : (
            <button className="linklike" onClick={() => login({})} hidden>
              sign in
            </button>
          )}
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
