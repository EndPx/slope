/**
 * Screen 1 — set how much, how fast, and within which rails; then create the
 * schedule on-chain and delegate its execution. Copy speaks the user's
 * language ("allocate", "pace", "rails") — internal names appear only in the
 * small print and the explorer link.
 */
import {useEffect, useMemo, useState} from "react";
import {useLogin, useSigners, useWallets} from "@privy-io/react-auth";
import {createWalletClient, custom, encodeFunctionData, formatUnits, http, parseAbi, parseUnits, createPublicClient} from "viem";
import {baseSepolia} from "viem/chains";
import MANIFEST from "./manifest.json";
import {CurvePreview, SHAPE_COLOR, SHAPE_NAME} from "./CurvePreview";
import {useCustody} from "./lib/useCustody";
import {estimateSchedule} from "./lib/schedule-estimate";
import {fmtToken} from "./lib/format";
import type {Shape} from "./lib/curve";

const M = MANIFEST as {
  slopePosition: `0x${string}`;
  dETH: `0x${string}`;
  chainId: number;
  publicRpcUrl: string;
};
const KEEPER_URL = "http://localhost:8787";

const ABI = parseAbi([
  "function mint(address to,uint256 amount)",
  "function createPosition((address tokenIn,address tokenOut,uint256 totalBudget,uint256 minFillAmount,uint256 duration,uint8 curveShape,uint256 minPrice,uint256 maxPrice,uint16 maxSlippageBps) params,(address router,(address maker,uint256 traits,bytes data) order,bytes takerTraitsAndData) route)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
]);

// Ungated seeded strategy (manifest provenance): maker + salted program.
const SEED_MAKER = "0xc82f469Aa95a2f7792300c8d11230e9023A98600";
const AQUA_ORDER_TRAITS = 1n << 254n;
const SEED_PROGRAM = "0x110014084093baa817bb0fde";
const TAKER_BLOB = "0x00000000000000000000000000000000000000000041"; // 22-byte header, flags 0x0041

const DURATIONS = [
  {label: "5 min", seconds: 300},
  {label: "15 min", seconds: 900},
  {label: "30 min", seconds: 1800},
];

export function CreateScreen(props: {onCreated: (id: bigint) => void}) {
  const {login} = useLogin();
  const {addSigners} = useSigners();
  const {wallets} = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const authenticated = Boolean(wallet);

  const [amount, setAmount] = useState("10");
  const [duration, setDuration] = useState(DURATIONS[1]);
  const [pace, setPace] = useState(1);
  const [floor, setFloor] = useState("100");
  const [ceiling, setCeiling] = useState("10000");
  const [slippagePct, setSlippagePct] = useState("5.00");
  const [minSlicePct, setMinSlicePct] = useState("2");
  const [status, setStatus] = useState<{kind: "idle" | "busy" | "ok" | "err"; text: string}>({
    kind: "idle",
    text: "",
  });
  const [createdId, setCreatedId] = useState<bigint | null>(null);
  // Custody preview: the contract pulls each slice from the wallet, so both
  // inventory and allowance decide whether execution can even start. Live
  // read, polled — the same facts a stale approval turns into TRANSFER_FAILED.
  const custody = useCustody(wallet?.address);

  const budget = useMemo(() => {
    try {
      const v = Number(amount);
      return v > 0 ? parseUnits(amount, 18) : 0n;
    } catch {
      return 0n;
    }
  }, [amount]);
  const floorRaw = useMemo(() => {
    try {
      return Number(floor) > 0 ? parseUnits(floor, 18) : 0n;
    } catch {
      return 0n;
    }
  }, [floor]);
  const ceilingRaw = useMemo(() => {
    try {
      return Number(ceiling) > 0 ? parseUnits(ceiling, 18) : 0n;
    } catch {
      return 0n;
    }
  }, [ceiling]);
  const slippageBps = useMemo(() => {
    const v = Number(slippagePct);
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
  }, [slippagePct]);
  const minFill = (budget * BigInt(Math.round(Number(minSlicePct) * 100 || 0))) / 10_000n;

  const railsInvalid = floorRaw !== 0n && ceilingRaw !== 0n && floorRaw >= ceilingRaw;
  const inputsValid = budget > 0n && floorRaw > 0n && ceilingRaw > 0n && slippageBps > 0 && !railsInvalid;
  // Derived schedule numbers — what this pace means in practice, computed
  // from the form parameters and the shared curve model. No chain touched.
  const estimate = useMemo(
    () => estimateSchedule(budget, BigInt(duration.seconds), pace as Shape, minFill),
    [budget, duration.seconds, pace, minFill],
  );

  const walletClient = async () => {
    const eth = (await wallet!.getEthereumProvider()) as any;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{chainId: `0x${M.chainId.toString(16)}`}],
      });
    } catch {
      /* already on the chain */
    }
    return createWalletClient({chain: baseSepolia, transport: custom(eth)});
  };
  const publicClient = createPublicClient({chain: baseSepolia, transport: http(M.publicRpcUrl)});

  async function createSchedule() {
    if (!wallet || !inputsValid) return;
    try {
      const wc = await walletClient();
      const [address] = await wc.getAddresses();
      setStatus({kind: "busy", text: `Minting ${amount} dETH of demo inventory for this wallet…`});
      await wc.sendTransaction({
        account: address,
        to: M.dETH,
        data: encodeFunctionData({abi: ABI, functionName: "mint", args: [address, budget]}),
      });

      if (custody.allowance === null || custody.allowance < budget) {
        setStatus({kind: "busy", text: "Approving the contract to pull slices as scheduled…"});
        await wc.sendTransaction({
          account: address,
          to: M.dETH,
          data: encodeFunctionData({abi: ABI, functionName: "approve", args: [M.slopePosition, budget]}),
        });
      }

      setStatus({kind: "busy", text: "Recording the schedule on-chain…"});
      const hash = await wc.sendTransaction({
        account: address,
        to: M.slopePosition,
        data: encodeFunctionData({
          abi: ABI,
          functionName: "createPosition",
          args: [
            {
              tokenIn: M.dETH,
              tokenOut: "0x06A41268C8cA9d5ADa19b02a8E2f37A0195dC49c",
              totalBudget: budget,
              minFillAmount: minFill,
              duration: BigInt(duration.seconds),
              curveShape: pace,
              minPrice: floorRaw,
              maxPrice: ceilingRaw,
              maxSlippageBps: slippageBps,
            },
            {
              router: "0x054F6A7CE03fdEB7814977B0FE7017cc5B2d7DA2",
              order: {maker: SEED_MAKER as `0x${string}`, traits: AQUA_ORDER_TRAITS, data: SEED_PROGRAM as `0x${string}`},
              takerTraitsAndData: TAKER_BLOB,
            },
          ],
        }),
      });
      const receipt = await publicClient.waitForTransactionReceipt({hash});
      const created = receipt.logs.find((l) => l.address.toLowerCase() === M.slopePosition.toLowerCase());
      if (!created) throw new Error("ScheduleCreated event not found in receipt");
      const id = BigInt(created.topics[1] as string);
      setCreatedId(id);
      localStorage.setItem("positionId", id.toString());
      props.onCreated(id);
      setStatus({kind: "ok", text: `Schedule #${id} is live.`});
    } catch (e: any) {
      setStatus({kind: "err", text: `The schedule wasn't recorded — ${e.shortMessage ?? e.message}. Nothing was delegated; try again.`});
    }
  }

  async function delegateExecution() {
    if (createdId === null || !wallet) return;
    try {
      setStatus({kind: "busy", text: "Requesting a scoped signing key for this schedule…"});
      const response = await fetch(`${KEEPER_URL}/delegate`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          positionId: createdId.toString(),
          owner: wallet.address,
          budgetRaw: budget.toString(),
          expirySeconds: (Math.floor(Date.now() / 1000) + duration.seconds + 86_400).toString(),
        }),
      });
      const {signerId, policyId} = (await response.json()) as {signerId: string; policyId: string};
      setStatus({kind: "busy", text: "Confirm the signing consent to hand execution to the keeper…"});
      await addSigners({
        address: wallet.address as `0x${string}`,
        signers: [{signerId, policyIds: [policyId]}],
      });
      setStatus({kind: "ok", text: "Delegated — the keeper executes slices as scheduled. No further approvals needed."});
    } catch (e: any) {
      setStatus({kind: "err", text: `Delegation didn't complete — ${e.shortMessage ?? e.message}. The schedule is safe on-chain; you can retry.`});
    }
  }

  const busy = status.kind === "busy";

  return (
    <section className="grid gap-8 lg:grid-cols-[400px_1fr] lg:gap-10">
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="display">Set a schedule</h2>
          <p className="note">Split one large swap across time, on your terms.</p>
        </div>

        <div>
          <p className="label">You allocate (dETH)</p>
          <input
            className="field"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Amount of dETH to allocate"
          />
        </div>

        <div>
          <p className="label">Over</p>
          <div className="seg" role="group" aria-label="Schedule duration">
            {DURATIONS.map((d) => (
              <button key={d.seconds} aria-pressed={duration.seconds === d.seconds} onClick={() => setDuration(d)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="label">Pace</p>
          <div className="seg" role="group" aria-label="Execution pace">
            {[0, 1, 2].map((s) => (
              <button
                key={s}
                style={{"--seg-color": SHAPE_COLOR[s]} as React.CSSProperties}
                aria-pressed={pace === s}
                onClick={() => setPace(s)}
              >
                <span className="dot" />
                {SHAPE_NAME[s]}
              </button>
            ))}
          </div>
          <p className="note">
            {pace === 0 && "Front-loaded — most of the budget goes early."}
            {pace === 1 && "Even — the budget leaves at a constant rate."}
            {pace === 2 && "Held back — the budget catches up late."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="label">Sell no lower than</p>
            <input className="field" inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value)} aria-label="Floor price" />
          </div>
          <div>
            <p className="label">or higher than</p>
            <input className="field" inputMode="decimal" value={ceiling} onChange={(e) => setCeiling(e.target.value)} aria-label="Ceiling price" />
          </div>
        </div>
        {railsInvalid && <p className="note warn">The floor must stay below the ceiling — right now no price would pass both rails.</p>}

        <div>
          <p className="label">Accept up to (impact, %)</p>
          <input className="field" inputMode="decimal" value={slippagePct} onChange={(e) => setSlippagePct(e.target.value)} aria-label="Maximum price impact percent" />
        </div>

        <details>
          <summary className="label" style={{cursor: "pointer"}}>
            Advanced
          </summary>
          <div className="mt-3">
            <p className="label">Smallest slice (% of budget)</p>
            <input
              className="field"
              inputMode="decimal"
              value={minSlicePct}
              onChange={(e) => setMinSlicePct(e.target.value)}
              aria-label="Minimum slice size percent"
            />
            <p className="note">
              Slices smaller than this wait to accumulate — except the final one, which always settles.
            </p>
          </div>
        </details>

        {authenticated && custody.balance !== null && (
          <div>
            <p className="label">Custody check</p>
            <p className="note">
              Wallet inventory <span className="num">{formatUnits(custody.balance, 18)}</span> dETH. Contract
              allowance <span className="num">{formatUnits(custody.allowance ?? 0n, 18)}</span> dETH —{" "}
              {custody.allowance !== null && custody.allowance >= budget
                ? "already covers this schedule."
                : `Create includes a fresh approval of ${amount} dETH.`}
            </p>
            <p className="note">
              Approvals are exact: the final slice consumes them, so the next schedule needs a fresh one.
            </p>
          </div>
        )}

        <div className="mt-1">
          {authenticated ? (
            createdId === null ? (
              <button className="act primary" disabled={!inputsValid || busy} onClick={createSchedule}>
                {busy ? "Working…" : "Create schedule"}
              </button>
            ) : (
              <button className="act primary" disabled={busy} onClick={delegateExecution}>
                Delegate execution
              </button>
            )
          ) : (
            <button className="act primary" onClick={() => login({})}>
              Sign in with email — no seed phrase
            </button>
          )}
          {status.text && (
            <p className={`note ${status.kind === "err" ? "err" : status.kind === "ok" ? "ok" : ""}`}>{status.text}</p>
          )}
        </div>
      </div>

      <div>
        <p className="label">
          Your pace, on one ruler — {SHAPE_NAME[pace]} is bold
        </p>
        <CurvePreview selected={pace} durationSeconds={duration.seconds} />
        {estimate.slices > 0 && (
          <p className="note num">
            ≈ {estimate.slices} slices, about {fmtToken(estimate.avgSliceRaw, 18, 3)} dETH each, every ~
            {estimate.intervalSeconds ?? duration.seconds}s
          </p>
        )}
        <p className="note">
          % of your budget spent as the window runs. Front-loaded goes early, even leaves steadily, held-back catches up
          late. Every slice is guarded by your rails and impact limit.
        </p>
      </div>
    </section>
  );
}
