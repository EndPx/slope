import {useState} from "react";
import {usePrivy, useLogin, useSigners, useWallets} from "@privy-io/react-auth";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  parseAbi,
} from "viem";
import {baseSepolia} from "viem/chains";
import "./style.css";
import MANIFEST from "../public/manifest.json";

/**
 * Minimal onboarding + delegation screen. The full three-screen product UI
 * lands in step 7; this page proves the Best Financial Flow mechanics:
 *   1. Privy embedded-wallet onboarding (email/social, no seed phrase) —
 *      the primary path;
 *   2. one financial flow: approve + createPosition on the live contract;
 *   3. bounded delegation: per-position session signer with a Privy policy
 *      (target allowlist, adaptiveExecute-only, per-tx cap, rolling cap,
 *      per-order expiry), attached to the wallet with explicit user consent
 *      via `addSigners`;
 *   4. the keeper then executes fills without manual approval.
 */

// Demo constants come from the committed deployment manifest.
const M = MANIFEST as {
  slopePosition: `0x${string}`;
  dETH: `0x${string}`;
  dUSD: `0x${string}`;
  chainId: number;
  publicRpcUrl: string;
};
const CHAIN_ID = M.chainId;
const KEEPER_URL = "http://localhost:8787";

const ABI = parseAbi([
  "function mint(address to,uint256 amount)",
  "function createPosition((address tokenIn,address tokenOut,uint256 totalBudget,uint256 minFillAmount,uint256 duration,uint8 curveShape,uint256 minPrice,uint256 maxPrice,uint16 maxSlippageBps) params,(address router,(address maker,uint256 traits,bytes data) order,bytes takerTraitsAndData) route)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);

// Ungated seeded strategy: maker + salted program from the manifest seed.
const SEED_MAKER = "0xc82f469Aa95a2f7792300c8d11230e9023A98600";
const AQUA_ORDER_TRAITS = 1n << 254n;
const SEED_PROGRAM = "0x110014084093baa817bb0fde";

export default function App() {
  const {ready, authenticated, user, logout} = usePrivy();
  // Official pre-built login modal (email-only via config.loginMethods).
  // It handles OTP resend, rate limits, error states, and accessibility —
  // and tracks Privy product depth for the sponsor track. Page styles are
  // scoped under `main` so they cannot bleed into the modal.
  const {login} = useLogin();
  const {addSigners} = useSigners();
  const {wallets} = useWallets();
  // Prefer the PRIVY-MANAGED (embedded) wallet: delegation via session
  // signers only controls Privy-managed keys. External wallets can browse
  // but cannot be delegated.
  const wallet =
    wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const isEmbedded = wallet?.walletClientType === "privy";
  const [status, setStatus] = useState<string>("");
  const [positionId, setPositionId] = useState<bigint | null>(null);
  const [delegated, setDelegated] = useState(false);

  const provider = async () => {
    if (!wallet) throw new Error("wallet not ready");
    // Ensure the embedded wallet is on Base Sepolia.
    const eth = (await wallet.getEthereumProvider()) as any;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{chainId: `0x${CHAIN_ID.toString(16)}`}],
      });
    } catch {
      /* already on the chain */
    }
    return eth;
  };

  const walletClient = async () =>
    createWalletClient({chain: baseSepolia, transport: custom(await provider())});

  const publicClient = createPublicClient({chain: baseSepolia, transport: http(M.publicRpcUrl)});

  async function createDemoPosition() {
    try {
      setStatus("0/4 faucet: minting demo dETH to this wallet…");
      const wc0 = await walletClient();
      const [addr0] = await wc0.getAddresses();
      await wc0.sendTransaction({
        account: addr0 as `0x${string}`,
        to: M.dETH,
        data: encodeFunctionData({
          abi: ABI,
          functionName: "mint",
          args: [addr0 as `0x${string}`, 10n * 10n ** 18n],
        }),
      });

      setStatus("1/4 approving dETH spend…");
      const wc = await walletClient();
      const [address] = await wc.getAddresses();
      await wc.sendTransaction({
        account: address,
        to: M.dETH,
        data: encodeFunctionData({
          abi: ABI,
          functionName: "approve",
          args: [M.slopePosition, 10n * 10n ** 18n],
        }),
      });

      setStatus("2/4 creating position on-chain…");
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
              totalBudget: 10n * 10n ** 18n,
              minFillAmount: 1n * 10n ** 17n,
              duration: 1000n,
              curveShape: 1, // NEUTRAL
              minPrice: 100n * 10n ** 18n,
              maxPrice: 10_000n * 10n ** 18n,
              maxSlippageBps: 500,
            },
            {
              router: "0x054F6A7CE03fdEB7814977B0FE7017cc5B2d7DA2",
              order: {
                maker: SEED_MAKER as `0x${string}`,
                traits: AQUA_ORDER_TRAITS,
                data: SEED_PROGRAM as `0x${string}`,
              },
              takerTraitsAndData: "0x000000000000000000000000000000000000000041",
            },
          ],
        }),
      });
      const receipt = await publicClient.waitForTransactionReceipt({hash});
      // The approve log is on the dETH token; the PositionCreated log is the
      // first (and only) log emitted by the SlopePosition contract itself.
      const createdEvent = receipt.logs.find(
        (l) => l.address.toLowerCase() === MANIFEST.slopePosition.toLowerCase(),
      );
      if (!createdEvent) throw new Error("PositionCreated event not found in receipt");
      const id = BigInt(createdEvent.topics[1] as string);
      setPositionId(id);
      setStatus(`3/4 position ${id} created (tx ${hash.slice(0, 10)}…)`);
    } catch (e: any) {
      setStatus(`error: ${e.shortMessage ?? e.message}`);
    }
  }

  async function delegate() {
    if (positionId === null) return;
    try {
      setStatus("requesting scoped session signer from keeper…");
      const response = await fetch(`${KEEPER_URL}/delegate`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          positionId: positionId.toString(),
          owner: wallet!.address,
          budgetRaw: (10n * 10n ** 18n).toString(),
          // per-order expiry: duration + 1 day settlement buffer
          expirySeconds: (Math.floor(Date.now() / 1000) + 1000 + 86_400).toString(),
        }),
      });
      const {signerId, policyId} = (await response.json()) as {
        signerId: string;
        policyId: string;
      };
      setStatus(`consent required: attaching scoped signer (policy ${policyId.slice(0, 10)}…)`);
      await addSigners({
        address: wallet!.address as `0x${string}`,
        signers: [{signerId, policyIds: [policyId]}],
      });
      setDelegated(true);
      setStatus(
        "delegated — the keeper can now execute fills within the policy bounds, no manual approval needed",
      );
    } catch (e: any) {
      setStatus(`error: ${e.shortMessage ?? e.message}`);
    }
  }

  if (!ready) return <p className="muted">loading…</p>;

  return (
    <main>
      <h1>
        slope<span className="live">●</span>
      </h1>
      <p className="tagline">adaptive execution on base sepolia</p>

      {!authenticated ? (
        <button onClick={() => login({})} disabled={!ready}>
          sign in with email — no seed phrase
        </button>
      ) : (
        <>
          <p className="wallet">
            wallet: <code>{wallet?.address}</code>
          </p>
          <button onClick={createDemoPosition} disabled={positionId !== null}>
            {positionId !== null ? `position #${positionId} live` : "create demo position (10 dETH, NEUTRAL, 1000 s)"}
          </button>
          <button
            onClick={delegate}
            disabled={positionId === null || delegated || !isEmbedded}
            title={isEmbedded ? "" : "delegation requires the Privy embedded wallet — sign out and sign in with email"}
          >
            {delegated ? "delegated to keeper ✓" : "delegate execution to keeper (scoped signer)"}
          </button>
          {positionId !== null && !isEmbedded && (
            <p className="muted">
              this session uses an external wallet — delegation needs the embedded
              wallet. sign out, then sign in with email to get one.
            </p>
          )}
          {delegated && (
            <p className="muted">
              keeper polls this position and fills within the schedule. scope: only
              adaptiveExecute on SlopePosition, per-tx cap = budget, rolling spend limit,
              expires one day after the window.
            </p>
          )}
          <a
            className="muted"
            href={`https://sepolia.basescan.org/address/${M.slopePosition}`}
            target="_blank"
            rel="noreferrer"
          >
            contract on basescan ↗
          </a>
        </>
      )}
      {status && <p className="status">{status}</p>}

      <footer>
        <code>powered by privy · 1inch aqua · the graph</code>
        {authenticated && (
          <button className="link" onClick={logout}>
            sign out
          </button>
        )}
      </footer>
    </main>
  );
}
