/**
 * Aqua protocol trace — the @1inch/aqua-sdk layer of a fill.
 *
 * Every fill's transaction pushes the slice into the docked strategy and
 * pulls the output back through the Aqua protocol; the SDK's event classes
 * decode those events from the live receipt (one RPC call, cached per
 * fill). Nothing here is simulated: if the receipt can't be read, the
 * panel says so instead of inventing a trace.
 */
import {useEffect, useState} from "react";
import {createPublicClient, http} from "viem";
import {baseSepolia} from "viem/chains";
import {PushedEvent, PulledEvent} from "@1inch/aqua-sdk";
import MANIFEST from "./manifest.json";
import {fmtToken} from "./lib/format";

const M = MANIFEST as {dETH: `0x${string}`; dUSD: `0x${string}`; publicRpcUrl: string; strategyHash: string};

function symbol(token: string): string {
  const t = token.toLowerCase();
  if (t === M.dETH.toLowerCase()) return "dETH";
  if (t === M.dUSD.toLowerCase()) return "dUSD";
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

type Trace =
  | {kind: "loading"}
  | {kind: "empty"}
  | {kind: "failed"; reason: string}
  | {kind: "ok"; legs: Array<{direction: "push" | "pull"; token: string; amount: bigint}>};

export function AquaTrace(props: {
  txHash: string;
  label: string;
  decimalsIn: number;
  decimalsOut: number;
}) {
  const [trace, setTrace] = useState<Trace>({kind: "loading"});

  useEffect(() => {
    let stop = false;
    setTrace({kind: "loading"});
    (async () => {
      try {
        const client = createPublicClient({chain: baseSepolia, transport: http(M.publicRpcUrl)});
        const receipt = await client.getTransactionReceipt({hash: props.txHash as `0x${string}`});
        const legs: Array<{direction: "push" | "pull"; token: string; amount: bigint}> = [];
        for (const log of receipt.logs) {
          try {
            if (log.topics[0] === String(PushedEvent.TOPIC)) {
              const ev = PushedEvent.fromLog(log);
              legs.push({direction: "push", token: ev.token.toString(), amount: ev.amount});
            } else if (log.topics[0] === String(PulledEvent.TOPIC)) {
              const ev = PulledEvent.fromLog(log);
              legs.push({direction: "pull", token: ev.token.toString(), amount: ev.amount});
            }
          } catch {
            /* a topic collision that doesn't decode — skip that log */
          }
        }
        if (!stop) setTrace(legs.length > 0 ? {kind: "ok", legs} : {kind: "empty"});
      } catch (e) {
        if (!stop) setTrace({kind: "failed", reason: e instanceof Error ? e.message : "receipt unavailable"});
      }
    })();
    return () => {
      stop = true;
    };
  }, [props.txHash]);

  const decimalsFor = (token: string) =>
    token.toLowerCase() === M.dUSD.toLowerCase() ? props.decimalsOut : props.decimalsIn;

  return (
    <div className="strip">
      <div className="grow">
        <p className="label">{props.label} — Aqua protocol trace</p>
        {trace.kind === "loading" && <p className="note num" style={{margin: 0}}>decoding the receipt…</p>}
        {trace.kind === "empty" && (
          <p className="note" style={{margin: 0}}>
            No Aqua protocol events in this transaction.
          </p>
        )}
        {trace.kind === "failed" && (
          <p className="note" style={{margin: 0}}>
            Trace unavailable — {trace.reason}.
          </p>
        )}
        {trace.kind === "ok" && (
          <p className="note num" style={{margin: 0}}>
            {trace.legs
              .map((leg) => {
                const decimals = decimalsFor(leg.token);
                return `${leg.direction === "push" ? "push" : "pull"} ${fmtToken(leg.amount, decimals)} ${symbol(leg.token)}`;
              })
              .join("  ·  ")}
            {"  —  strategy "}
            <span className="num">
              {M.strategyHash.slice(0, 6)}…{M.strategyHash.slice(-4)}
            </span>
          </p>
        )}
      </div>
      <span className="chip muted">decoded with @1inch/aqua-sdk</span>
    </div>
  );
}
