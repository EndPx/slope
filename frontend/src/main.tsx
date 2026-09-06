import React from "react";
import ReactDOM from "react-dom/client";
import {PrivyProvider} from "@privy-io/react-auth";
import {baseSepolia} from "viem/chains";
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID as string}
      config={{
        // Embedded wallet on login is the PRIMARY path (Best Financial Flow
        // requirement): email login, no seed phrase, wallet provisioned
        // automatically. External-wallet login is disabled for the demo:
        // Privy session signers only control Privy-managed wallets, so an
        // external wallet is a dead end for delegation.
        loginMethods: ["email"],
        embeddedWallets: {
          // 'all-users': every account gets an embedded wallet, so every
          // position can be delegated to the keeper.
          ethereum: {createOnLogin: "all-users"},
        },
        appearance: {theme: "dark"},
        supportedChains: [baseSepolia],
        defaultChain: baseSepolia,
      }}
    >
      <App />
    </PrivyProvider>
  </React.StrictMode>,
);
