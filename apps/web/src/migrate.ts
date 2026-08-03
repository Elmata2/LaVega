import type { VaultStorage } from "@lavega/adapters";
import { createIndexedDbStorage } from "@lavega/adapters";

const LEGACY_DB = "lavega";

/** True if the legacy plaintext DB holds any data worth migrating. */
export async function hasLegacyData(): Promise<boolean> {
  const legacy = createIndexedDbStorage();
  const [a, t] = await Promise.all([legacy.getAccounts(), legacy.getTxs()]);
  return a.length > 0 || t.length > 0;
}

/** Migrate the legacy plaintext DB into the vault under `passphrase`, THEN delete
 *  the plaintext DB — only after the vault verifiably decrypts. Throws (leaving
 *  plaintext intact) on any failure before verification. */
export async function migrateToVault(vault: VaultStorage, passphrase: string): Promise<void> {
  const legacy = createIndexedDbStorage();
  const [accounts, txs, rules] = await Promise.all([legacy.getAccounts(), legacy.getTxs(), legacy.getRules()]);
  await vault.setup(passphrase, { accounts, txs, rules }); // writes + unlocks the vault
  // VERIFY: re-open the vault fresh, unlock, and confirm the data decrypts back.
  vault.lock();
  const ok = await vault.unlock(passphrase);
  if (!ok) throw new Error("kluis-verificatie mislukt — plaintext blijft behouden");
  const back = await vault.getAccounts();
  if (back.length !== accounts.length) throw new Error("kluis-verificatie mislukt — plaintext blijft behouden");
  // Only now is it safe to delete the plaintext DB.
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // deletion proceeds once connections close
  });
}
