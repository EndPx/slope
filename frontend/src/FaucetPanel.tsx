/**
 * Faucet — a small panel from the header. New embedded wallets start at
 * zero balance, so this is the first-run condition, not an edge case. The
 * panel also shows the allowance to SlopePosition: the two facts always
 * asked about together when a fill stops. Honest about what these tokens
 * are: demo tokens on a testnet.
 */
import {useState} from "react";
import {useWallets} from "@privy-io/react-auth";
import {createWalletClient, custom, encodeFunctionData, formatUnits, parseAbi} from "viem";
import {baseSepolia} from "viem/chains";
import MANIFEST from "./manifest.json";
import {useCustody} from "./lib/useCustody";

const M = MANIFEST as {slopePosition: `0x${string}`; dETH: `0x${string}`; chainId: number; explorerUrl: string};
const MINT_AMOUNT = 10n * 10n ** 18n;
const ABI = parseAbi(["function mint(address to,uint256 amount)"]);

export function FaucetPanel({onClose}: {onClose: () => void}) {
  const {wallets} = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const custody = useCustody(wallet?.address);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mint() {
    if (!wallet) return;
    setBusy(true);
    setError(null);
    try {
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
        to: M.dETH,
        data: encodeFunctionData({abi: ABI, functionName: "mint", args: [address, MINT_AMOUNT]}),
      });
      setTxHash(hash);
      custody.reload();
    } catch (e: any) {
      setError(`Mint didn't go through — ${e.shortMessage ?? e.message}. The network may be busy; try again in a moment.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="faucet" role="dialog" aria-label="Faucet">
      <p className="label">Demo tokens</p>
      <p className="note" style={{marginTop: 0}}>
        These are testnet tokens minted for trying Slope out — there is no real liquidity behind them.
      </p>
      <p className="note">
        Inventory <span className="num">{custody.balance !== null ? formatUnits(custody.balance, 18) : "…"}</span> dETH
        &nbsp;&nbsp;Allowance to the contract{" "}
        <span className="num">{custody.allowance !== null ? formatUnits(custody.allowance, 18) : "…"}</span> dETH
      </p>
      <button className="act" disabled={busy || !wallet} onClick={mint}>
        {busy ? "Minting…" : "Mint 10 dETH"}
      </button>
      {error && <p className="note err">{error}</p>}
      {txHash && (
        <p className="note ok">
          Minted. <a href={`${M.explorerUrl}/tx/${txHash}`} target="_blank" rel="noreferrer">View the transaction</a> — the
          balance above updates as the block lands.
        </p>
      )}
      <button className="linklike" onClick={onClose}>
        close
      </button>
    </div>
  );
}
