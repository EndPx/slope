/**
 * Live dETH custody for the connected wallet — inventory and allowance to
 * SlopePosition, polled. Both the Create custody check and the faucet panel
 * read the same hook: these two facts are always asked about together when
 * a fill stops.
 */
import {useEffect, useState} from "react";
import {createPublicClient, http} from "viem";
import {baseSepolia} from "viem/chains";
import MANIFEST from "../manifest.json";

const M = MANIFEST as {slopePosition: `0x${string}`; dETH: `0x${string}`; publicRpcUrl: string; chainId: number};
const ERC20 = [
  {type: "function", name: "balanceOf", stateMutability: "view", inputs: [{type: "address", name: "a"}], outputs: [{type: "uint256"}]},
  {type: "function", name: "allowance", stateMutability: "view", inputs: [{type: "address", name: "o"}, {type: "address", name: "s"}], outputs: [{type: "uint256"}]},
] as const;

export interface Custody {
  balance: bigint | null;
  allowance: bigint | null;
  reload: () => void;
}

export function useCustody(address: string | undefined): Custody {
  const [state, setState] = useState<{balance: bigint | null; allowance: bigint | null}>({
    balance: null,
    allowance: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!address) return;
    let stop = false;
    const client = createPublicClient({chain: baseSepolia, transport: http(M.publicRpcUrl)});
    const read = async () => {
      try {
        const [balance, allowance] = await Promise.all([
          client.readContract({address: M.dETH, abi: ERC20, functionName: "balanceOf", args: [address as `0x${string}`]}),
          client.readContract({address: M.dETH, abi: ERC20, functionName: "allowance", args: [address as `0x${string}`, M.slopePosition]}),
        ]);
        if (!stop) setState({balance, allowance});
      } catch {
        /* rpc hiccup — keep the last reading */
      }
    };
    read();
    const t = setInterval(read, 12_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [address, nonce]);

  return {...state, reload: () => setNonce((n) => n + 1)};
}
