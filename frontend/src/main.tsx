import React from "react";
import ReactDOM from "react-dom/client";
import {PrivyProvider} from "@privy-io/react-auth";
import {baseSepolia} from "viem/chains";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID as string}
      config={{
        // Embedded wallet on login is the PRIMARY path (Best Financial Flow
        // requirement): email/social login, no seed phrase, wallet provisioned
        // automatically. External wallets are an additional option only.
        embeddedWallets: {
          ethereum: {createOnLogin: "users-without-wallets"},
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
