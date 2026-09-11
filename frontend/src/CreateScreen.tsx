/**
 * Screen 1 — set how much, how fast, and within which rails; then create the
 * schedule on-chain and delegate its execution. Copy speaks the user's
 * language ("allocate", "pace", "rails") — internal names appear only in the
 * small print and the explorer link.
 */
import {useEffect, useMemo, useRef, useState, Fragment} from "react";
import {useNavigate} from "react-router-dom";
import {useLogin, useSigners, useWallets} from "@privy-io/react-auth";
import {createWalletClient, custom, encodeFunctionData, formatUnits, http, parseAbi, parseUnits, createPublicClient} from "viem";
import {baseSepolia} from "viem/chains";
import MANIFEST from "./manifest.json";
import {CurvePreview, SHAPE_COLOR, SHAPE_NAME} from "./CurvePreview";
import {PlotMeta} from "./PlotMeta";
import {useCustody} from "./lib/useCustody";
import {estimateSchedule} from "./lib/schedule-estimate";
import {fmtAmount, fmtToken} from "./lib/format";
import {usePageTitle} from "./lib/usePageTitle";
import type {Shape} from "./lib/curve";

const M = MANIFEST as {
  slopePosition: `0x${string}`;
  dETH: `0x${string}`;
  dUSD: `0x${string}`;
  aquaRouter: `0x${string}`;
  chainId: number;
  publicRpcUrl: string;
};
// The keeper runs on the position owner's machine during the demo; a
// hosted deployment can point this at its tunnel/URL via env.
const KEEPER_URL = (import.meta.env.VITE_KEEPER_URL as string | undefined) ?? "http://localhost:8787";

const ABI = parseAbi([
  "function mint(address to,uint256 amount)",
  "function createPosition((address tokenIn,address tokenOut,uint256 totalBudget,uint256 minFillAmount,uint256 duration,uint8 curveShape,uint256 minPrice,uint256 maxPrice,uint16 maxSlippageBps) params,(address router,(address maker,uint256 traits,bytes data) order,bytes takerTraitsAndData) route)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
]);

// The same quote call the contract makes before every fill, run from the
// browser: the estimate shows what the router really answers, not a made-up
// rate. Second return value is amountOut.
const QUOTE_ABI = parseAbi([
  "function quote((address,uint256,bytes) order,address tokenIn,address tokenOut,uint256 amountIn,bytes takerTraitsAndData) view returns (uint256,uint256,uint256)",
  "function decimals() view returns (uint8)",
]);

function trimZeros(value: string): string {
  const trimmed = value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return trimmed === "" ? "0" : trimmed;
}

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

type StepKey = "faucet" | "approve" | "create" | "delegate";
type StepState = "idle" | "active" | "done" | "failed";

const STEP_LABEL: Record<StepKey, string> = {
  faucet: "Mint demo inventory",
  approve: "Approve dETH spending",
  create: "Create the schedule on-chain",
  delegate: "Delegate execution to the keeper",
};

export function CreateScreen() {
  usePageTitle("Create a schedule");
  const {login} = useLogin();
  const {addSigners} = useSigners();
  const {wallets} = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const authenticated = Boolean(wallet);

  const [amount, setAmount] = useState("10");
  const [duration, setDuration] = useState(DURATIONS[1]);
  // Default pace follows what the visitor explored on the landing field.
  const [pace, setPaceState] = useState<number>(() => {
    const stored = Number(localStorage.getItem("pace"));
    return [0, 1, 2].includes(stored) ? stored : 1;
  });
  const setPace = (next: number) => {
    setPaceState(next);
    localStorage.setItem("pace", String(next));
  };
  const [floor, setFloor] = useState("100");
  const [ceiling, setCeiling] = useState("10000");
  const [slippagePct, setSlippagePct] = useState("5.00");
  const [minSlicePct, setMinSlicePct] = useState("2");
  const navigate = useNavigate();
  const [createdId, setCreatedId] = useState<bigint | null>(null);
  // Sign-in-to-create: the full form works without a wallet; signing in
  // resumes straight into the create flow that was requested.
  const wantCreateRef = useRef(false);
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

  // Live dUSD estimate: the Aqua router quotes the actual schedule size —
  // the same call the contract makes before a fill. Debounced per input
  // change; a failed quote reads "—", never an invented rate.
  const [quoteOut, setQuoteOut] = useState<string | null>(null);
  useEffect(() => {
    if (!inputsValid) {
      setQuoteOut(null);
      return;
    }
    let stop = false;
    const timer = setTimeout(async () => {
      try {
        const client = createPublicClient({chain: baseSepolia, transport: http(M.publicRpcUrl)});
        const [quoted, decimals] = await Promise.all([
          client.readContract({
            address: M.aquaRouter,
            abi: QUOTE_ABI,
            functionName: "quote",
            args: [
              [SEED_MAKER as `0x${string}`, AQUA_ORDER_TRAITS, SEED_PROGRAM as `0x${string}`],
              M.dETH,
              M.dUSD,
              budget,
              TAKER_BLOB,
            ],
          }),
          client.readContract({address: M.dUSD, abi: QUOTE_ABI, functionName: "decimals"}),
        ]);
        if (!stop) setQuoteOut(trimZeros(formatUnits(quoted[1], decimals)));
      } catch {
        if (!stop) setQuoteOut("—");
      }
    }, 350);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [budget, inputsValid]);

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

  // ---- The deployment flow, as visible steps. Wallet popups (Privy sign
  // requests) can fail at any stage, so every stage is separately visible
  // and retryable: mint (when inventory is short), approve (when allowance
  // is short), create, delegate. Each failure freezes the list at the
  // failed step with the reason; retry resumes from there.
  const [steps, setSteps] = useState<Array<{key: StepKey; state: StepState; detail: string}>>([]);
  const [running, setRunning] = useState(false);
  // Local completion markers so a retry skips finished steps without
  // waiting for the custody poll to catch up with the chain.
  const mintedRef = useRef(0n);
  const approvedRef = useRef(0n);

  async function runFlow() {
    if (!wallet || !inputsValid || running) return;
    setRunning(true);
    try {
      const wc = await walletClient();
      const [address] = await wc.getAddresses();

      const plan: StepKey[] = [];
      if (createdId === null) {
        if (mintedRef.current < budget && (custody.balance === null || custody.balance < budget)) plan.push("faucet");
        if (approvedRef.current < budget && (custody.allowance === null || custody.allowance < budget)) plan.push("approve");
        plan.push("create");
      }
      plan.push("delegate");

      // Keep finished steps from a previous attempt visible.
      setSteps((prev) => {
        const doneKeys = new Map(prev.filter((s) => s.state === "done").map((s) => [s.key, s]));
        return plan.map((key) => doneKeys.get(key) ?? {key, state: "idle" as StepState, detail: ""});
      });
      const setStep = (key: StepKey, patch: {state?: StepState; detail?: string}) =>
        setSteps((list) => list.map((s) => (s.key === key ? {...s, ...patch} : s)));
      const activate = (key: StepKey) =>
        setSteps((list) =>
          list.map((s) => (s.key === key ? {...s, state: "active"} : s.state === "active" ? {...s, state: "idle"} : s)),
        );

      let id = createdId;
      for (const key of plan) {
        activate(key);
        try {
          if (key === "faucet") {
            await wc.sendTransaction({
              account: address,
              to: M.dETH,
              data: encodeFunctionData({abi: ABI, functionName: "mint", args: [address, budget]}),
            });
            mintedRef.current = budget;
            custody.reload();
          } else if (key === "approve") {
            const hash = await wc.sendTransaction({
              account: address,
              to: M.dETH,
              data: encodeFunctionData({abi: ABI, functionName: "approve", args: [M.slopePosition, budget]}),
            });
            await publicClient.waitForTransactionReceipt({hash});
            approvedRef.current = budget;
            custody.reload();
          } else if (key === "create") {
            const hash = await wc.sendTransaction({
              account: address,
              to: M.slopePosition,
              data: encodeFunctionData({
                abi: ABI,
                functionName: "createPosition",
                args: [
                  {
                    tokenIn: M.dETH,
                    tokenOut: M.dUSD,
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
            if (!created) throw new Error("ScheduleCreated event not found in the receipt");
            id = BigInt(created.topics[1] as string);
            setCreatedId(id);
          } else {
            const response = await fetch(`${KEEPER_URL}/delegate`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(import.meta.env.VITE_KEEPER_TOKEN
                  ? {Authorization: `Bearer ${import.meta.env.VITE_KEEPER_TOKEN}`}
                  : {}),
              },
              body: JSON.stringify({
                positionId: id!.toString(),
                owner: wallet.address,
                budgetRaw: budget.toString(),
                expirySeconds: (Math.floor(Date.now() / 1000) + duration.seconds + 86_400).toString(),
              }),
            });
            if (!response.ok) throw new Error(`the keeper responded HTTP ${response.status}`);
            const {signerId, policyId} = (await response.json()) as {signerId: string; policyId: string};
            await addSigners({
              address: wallet.address as `0x${string}`,
              signers: [{signerId, policyIds: [policyId]}],
            });
          }
          setStep(key, {state: "done"});
        } catch (e: any) {
          const message = e?.shortMessage ?? e?.message ?? "unknown error";
          const wrap: Record<StepKey, string> = {
            faucet: `Mint didn't go through — ${message}`,
            approve: `The approval didn't complete — ${message}. Nothing was spent.`,
            create: `The schedule wasn't recorded — ${message}.`,
            delegate: `Delegation didn't complete — ${message}. The schedule is safe on-chain — retry below.`,
          };
          setStep(key, {state: "failed", detail: wrap[key]});
          setRunning(false);
          return;
        }
      }

      // Live and delegated — show it on the positions side.
      navigate(`/positions/${id!.toString()}`);
    } catch (e: any) {
      setSteps([{key: "create", state: "failed", detail: `The wallet didn't connect — ${e?.shortMessage ?? e?.message}`}]);
    } finally {
      setRunning(false);
    }
  }

  // Resume into the flow once the requested sign-in has a wallet.
  useEffect(() => {
    if (!authenticated || !wantCreateRef.current) return;
    wantCreateRef.current = false;
    runFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  return (
    <section className="create-screen">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h2 className="display num" style={{fontSize: "1.3rem", fontWeight: 600, letterSpacing: 0, margin: 0}}>
          Schedule parameter matrix
        </h2>
        {estimate.slices > 0 && (
          <p className="note num" style={{margin: 0}}>
            TRANCHE-COUNT: {estimate.slices} &nbsp;|&nbsp; MEAN SLICE: {fmtToken(estimate.avgSliceRaw, 18, 3)} dETH
            &nbsp;|&nbsp; CADENCE: ~{estimate.intervalSeconds ?? duration.seconds}s
            {quoteOut !== null && <> &nbsp;|&nbsp; EST. OUT: ~{quoteOut} dUSD</>}
          </p>
        )}
      </div>

      <div className="create-workspace">
      <div className="panel create-controls">

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
              allowance <span className="num">{fmtAmount(custody.allowance ?? 0n, 18)}</span> dETH —{" "}
              {custody.allowance !== null && custody.allowance >= budget
                ? "already covers this schedule."
                : `Create includes a fresh approval of ${amount} dETH.`}
            </p>
            <p className="note">
              Approvals are exact: the final slice consumes them, so the next schedule needs a fresh one.
            </p>
          </div>
        )}

        {steps.length > 0 && (
          <ol className="steps">
            {steps.map((s) => (
              <Fragment key={s.key}>
                <li className={`step ${s.state}`}>
                  <span className="step-mark">
                    {s.state === "done" ? "✓" : s.state === "failed" ? "✕" : s.state === "active" ? "●" : "○"}
                  </span>
                  <span>
                    {STEP_LABEL[s.key]}
                    {s.state === "active" ? " — confirm in your wallet if asked" : ""}
                  </span>
                </li>
                {s.state === "failed" && s.detail && <li className="step-detail">{s.detail}</li>}
              </Fragment>
            ))}
          </ol>
        )}

        <div style={{marginTop: "auto", paddingTop: "0.6rem"}}>
          {authenticated ? (
            <button className="act act-ember" disabled={!inputsValid || running} onClick={runFlow}>
              {running
                ? "Working…"
                : steps.some((s) => s.state === "failed")
                  ? "Retry from the failed step"
                  : createdId !== null
                    ? "Delegate execution"
                    : "Deploy execution schedule"}
            </button>
          ) : (
            <button
              className="act primary"
              disabled={!inputsValid}
              onClick={() => {
                wantCreateRef.current = true;
                login({});
              }}
            >
              Sign in to create
            </button>
          )}
        </div>
      </div>

      <div className="panel create-stage">
        <PlotMeta
          surface="SCHEDULE_PREVIEW"
          axis="CUMULATIVE_BUDGET / TIME"
          legend={[{color: SHAPE_COLOR[pace], label: SHAPE_NAME[pace].toUpperCase()}]}
        />
        <div className="plot-canvas-fill">
          <CurvePreview
            fill
            solo
            selected={pace}
            durationSeconds={duration.seconds}
            tranches={estimate.slices}
            amount={inputsValid ? Number(amount) : undefined}
          />
        </div>
        <p className="note" style={{padding: "0.45rem 0.9rem", margin: 0}}>
          % of your budget spent as the window runs. Front-loaded goes early, even leaves steadily, held-back catches
          up late. Every slice is guarded by your rails and impact limit.
        </p>
      </div>
      </div>
    </section>
  );
}
