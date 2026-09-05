/** Lists delegated wallets registered on the app (keeper diagnostics). */
import {loadConfig, requireCredentials} from "./config.ts";
import {listDelegatedWallets} from "./privy-rest.ts";

const cfg = loadConfig();
requireCredentials(cfg);
const wallets = await listDelegatedWallets(cfg);
console.log(JSON.stringify(wallets, null, 2));
