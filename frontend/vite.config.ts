import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import {nodePolyfills} from "vite-plugin-node-polyfills";

// envDir points at the repo root so VITE_PRIVY_APP_ID comes from the
// gitignored root .env (the app id stays out of the repository per the
// creator's instruction, even though Privy app ids are public identifiers).
export default defineConfig({
  plugins: [react(), nodePolyfills()],
  envDir: "../",
  server: {port: 5173},
});
