/**
 * Thin REST client for the Privy endpoints the Node SDK does not expose
 * (aggregation creation, key quorum creation) plus user listing for
 * delegated-wallet discovery. Auth: Basic appId:appSecret + privy-app-id.
 */

export interface PrivyRestConfig {
  appId: string;
  appSecret: string;
}

function headers(cfg: PrivyRestConfig): Record<string, string> {
  const credentials = Buffer.from(`${cfg.appId}:${cfg.appSecret}`).toString("base64");
  return {
    "Content-Type": "application/json",
    "privy-app-id": cfg.appId,
    Authorization: `Basic ${credentials}`,
  };
}

async function post<T>(cfg: PrivyRestConfig, path: string, body: unknown): Promise<T> {
  const response = await fetch(`https://api.privy.io/v1${path}`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Privy REST POST ${path} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function get<T>(cfg: PrivyRestConfig, path: string): Promise<T> {
  const response = await fetch(`https://api.privy.io/v1${path}`, {
    method: "GET",
    headers: headers(cfg),
  });
  if (!response.ok) {
    throw new Error(`Privy REST GET ${path} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export interface Aggregation {
  id: string;
  name?: string;
}

export function createAggregation(cfg: PrivyRestConfig, body: object): Promise<Aggregation> {
  return post<Aggregation>(cfg, "/aggregations", body);
}

export interface KeyQuorum {
  id: string;
  authorization_threshold?: number;
}

export function createKeyQuorum(
  cfg: PrivyRestConfig,
  publicKeyB64Spki: string,
): Promise<KeyQuorum> {
  // 1-of-1 quorum: this single authorization key signs API requests on
  // behalf of the app for wallets it is registered on as a signer. The key
  // format is base64-encoded SPKI with no PEM headers (the SDK's own
  // P256KeyPair.publicKey format).
  return post<KeyQuorum>(cfg, "/key_quorums", {
    public_keys: [publicKeyB64Spki.trim()],
    authorization_threshold: 1,
  });
}


export function createPolicy(cfg: PrivyRestConfig, policy: object): Promise<{id: string}> {
  return post<{id: string}>(cfg, "/policies", policy);
}

export interface DelegatedWallet {
  walletId: string;
  address: string;
  userDid: string;
}

/**
 * Scans app users for delegated embedded wallets (wallets where the app's
 * key quorum was registered as a signer via the frontend consent flow).
 */
export async function listDelegatedWallets(cfg: PrivyRestConfig): Promise<DelegatedWallet[]> {
  const out: DelegatedWallet[] = [];
  let cursor: string | undefined;
  do {
    const page = await get<{
      data?: Array<{
        id?: string;
        did?: string;
        linked_accounts?: Array<{
          type?: string;
          address?: string;
          delegated?: boolean;
          id?: string;
        }>;
      }>;
      next_cursor?: string;
    }>(cfg, `/users${cursor ? `?cursor=${cursor}` : ""}`);
    for (const user of page.data ?? []) {
      for (const account of user.linked_accounts ?? []) {
        if (account.type === "wallet" && account.delegated === true && account.address) {
          out.push({
            walletId: account.id ?? account.address,
            address: account.address,
            userDid: user.did ?? user.id ?? "",
          });
        }
      }
    }
    cursor = page.next_cursor;
  } while (cursor);
  return out;
}
