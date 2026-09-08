/**
 * The wallet's own money, read live from the chain: native ETH (gas),
 * dETH (the schedule input — what the faucet mints) and dUSD (what fills
 * receive). One RPC round per tick; failures keep the last reading.
 */
import {useEffect, useState} from "react";
import {createPublicClient, http} from "viem";
import {baseSepolia} from "viem/chains";
import MANIFEST from "../manifest.json";

const M = MANIFEST as {
  dETH: `0x${string}`;
  dUSD: `0x${string}`;
  publicRpcUrl: string;
};
const ERC20 = [
  {type: "function", name: "balanceOf", stateMutability: "view", inputs: [{type: "address", name: "a"}], outputs: [{type: "uint256"}]},
] as const;

export interface WalletBalances {
  eth: bigint | null;
  deth: bigint | null;
  dusd: bigint | null;
}

export function useWalletBalances(address: string | undefined): WalletBalances {
  const [state, setState] = useState<WalletBalances>({eth: null, deth: null, dusd: null});

  useEffect(() => {
    if (!address) return;
    let stop = false;
    const client = createPublicClient({chain: baseSepolia, transport: http(M.publicRpcUrl)});
    const read = async () => {
      try {
        const [eth, deth, dusd] = await Promise.all([
          client.getBalance({address: address as `0x${string}`}),
          client.readContract({address: M.dETH, abi: ERC20, functionName: "balanceOf", args: [address as `0x${string}`]}),
          client.readContract({address: M.dUSD, abi: ERC20, functionName: "balanceOf", args: [address as `0x${string}`]}),
        ]);
        if (!stop) setState({eth, deth, dusd});
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
  }, [address]);

  return state;
}
