import { generateVaultKey, vaultKeyFromBase64 } from "@lavega/adapters";

/**
 * Whose vault this page opens, and so where its key comes from
 * (docs/adr/0009-account-held-vault-key.md).
 *
 * - `account`: a signed-in user. The server holds one key per account, created
 *   on the first request after sign-in, and hands it to the owner's session.
 * - `device`: a deployment with no accounts at all (self-hosted, no
 *   DATABASE_URL). The key is made in this browser and never leaves it.
 */
export type VaultOwner = { kind: "account"; id: string } | { kind: "device" };

export class VaultKeyUnavailable extends Error {
  constructor(readonly reason: "signed-out" | "unreadable" | "unreachable") {
    super(`vault-key-${reason}`);
    this.name = "VaultKeyUnavailable";
  }
}

export function vaultOwnerName(owner: VaultOwner): string {
  return owner.kind === "account" ? `user:${owner.id}` : "device";
}

export async function loadVaultKey(owner: VaultOwner): Promise<CryptoKey> {
  return owner.kind === "account" ? accountKey() : deviceKey();
}

async function accountKey(): Promise<CryptoKey> {
  let response: Response;
  try {
    response = await fetch("/api/vault/key", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch {
    throw new VaultKeyUnavailable("unreachable");
  }
  if (response.status === 401) throw new VaultKeyUnavailable("signed-out");
  const body = (await response.json().catch(() => null)) as {
    key?: unknown;
    code?: unknown;
  } | null;
  if (body?.code === "vault-key-unreadable") throw new VaultKeyUnavailable("unreadable");
  if (!response.ok || typeof body?.key !== "string") throw new VaultKeyUnavailable("unreachable");
  return vaultKeyFromBase64(body.key);
}

const DEVICE_DB = "lavega-device-key";
const DEVICE_STORE = "key";

/* A CryptoKey is structured-cloneable, so IndexedDB stores the key object
 * itself. It stays non-extractable: no script on this page can read its bytes. */
function openDeviceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEVICE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DEVICE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idb<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deviceKey(): Promise<CryptoKey> {
  const db = await openDeviceDb();
  try {
    const stored = (await idb(db.transaction(DEVICE_STORE).objectStore(DEVICE_STORE).get(1))) as
      | CryptoKey
      | undefined;
    if (stored) return stored;
    const fresh = await generateVaultKey();
    await idb(db.transaction(DEVICE_STORE, "readwrite").objectStore(DEVICE_STORE).put(fresh, 1));
    return fresh;
  } finally {
    db.close();
  }
}
