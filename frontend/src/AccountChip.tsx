/**
 * The signed-in header identity: an avatar pill that opens the wallet
 * popover — address with copy, live dETH custody, the faucet, and log out.
 *
 * Identity is the Privy embedded wallet, full stop. External wallets are
 * disabled at the provider (main.tsx): session signers can only control
 * Privy-managed wallets, so a MetaMask connection would be a dead end for
 * delegation, and the pill never shows one.
 */
import {useEffect, useRef, useState} from "react";
import {formatUnits} from "viem";
import {useWalletBalances} from "./lib/useWalletBalances";
import {FaucetPanel} from "./FaucetPanel";

function trimZeros(value: string): string {
  const trimmed = value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return trimmed === "" ? "0" : trimmed;
}

function Chevron({open}: {open: boolean}) {
  return (
    <svg className={`acct-chevron${open ? " open" : ""}`} viewBox="0 0 12 12" width="11" height="11" fill="none" aria-hidden="true">
      <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 14 14" width="13" height="13" fill="none" aria-hidden="true">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.5 4.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v5A1.5 1.5 0 0 0 3 9.5h1.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ReceiveIcon() {
  return (
    <svg viewBox="0 0 14 14" width="13" height="13" fill="none" aria-hidden="true">
      <path d="M7 1.5v6M4.5 5 7 7.5 9.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 9.5v1.5a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 12 11V9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 14 14" width="13" height="13" fill="none" aria-hidden="true">
      <path d="M6 2H3.5A1.5 1.5 0 0 0 2 3.5v7A1.5 1.5 0 0 0 3.5 12H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M8.5 4.5 11 7l-2.5 2.5M10.5 7H5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AccountChip(props: {
  address: string;
  name: string | null;
  /** True when the connected wallet is NOT the Privy embedded wallet — it
   *  cannot delegate, and the popover says so instead of hiding it. */
  external?: boolean;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [faucetOpen, setFaucetOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  // The profile shows native ETH (gas) — dETH/dUSD live in the Portfolio.
  const balances = useWalletBalances(props.address);

  // Outside click or Escape closes the popover.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const short = `${props.address.slice(0, 6)}…${props.address.slice(-4)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — the address is on screen anyway */
    }
  };

  return (
    <span className="acct-wrap" ref={wrapRef}>
      <button className="acct" aria-expanded={open} aria-label="Account" onClick={() => setOpen((v) => !v)}>
        <span className="acct-avatar" aria-hidden="true" />
        <span>{props.name ?? short}</span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="acct-pop" role="dialog" aria-label="Wallet">
          <div className="acct-row">
            <span className="acct-label">Wallet</span>
            <span className="num">
              {balances.eth !== null ? `${trimZeros(formatUnits(balances.eth, 18))} ETH` : "…"}
            </span>
          </div>
          <div className="acct-addr">
            <span className="num">{short}</span>
            <button className="acct-copy" onClick={copy} aria-label="Copy wallet address">
              {copied ? <span className="acct-copied">copied</span> : <CopyIcon />}
            </button>
          </div>
          <div className="acct-row">
            <span className="acct-label">Chain</span>
            <span className="acct-chain">
              <span className="acct-chain-dot" aria-hidden="true" />
              Base Sepolia
            </span>
          </div>
          <button className="acct-faucet" onClick={() => setFaucetOpen((v) => !v)}>
            <ReceiveIcon /> Faucet
          </button>
          {faucetOpen && <FaucetPanel onClose={() => setFaucetOpen(false)} />}
          {props.external && (
            <p className="note err" style={{margin: 0}}>
              External wallet — it can't delegate. Log out and sign in with email.
            </p>
          )}
          <div className="acct-sep" />
          <button
            className="acct-logout"
            onClick={() => {
              setOpen(false);
              props.onLogout();
            }}
          >
            <LogoutIcon /> Log out
          </button>
        </div>
      )}
    </span>
  );
}
