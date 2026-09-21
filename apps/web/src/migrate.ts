import type { VaultStorage } from "@lavega/adapters";
import { createIndexedDbStorage } from "@lavega/adapters";

const LEGACY_DB = "lavega";

/** True if the legacy plaintext DB holds any data worth migrating. */
export async function hasLegacyData(): Promise<boolean> {
  const legacy = createIndexedDbStorage();
  const [a, t, r] = await Promise.all([legacy.getAccounts(), legacy.getTxs(), legacy.getRules()]);
  return a.length > 0 || t.length > 0 || r.length > 0; // incl. rules, so a rules-only DB still migrates
}

/** Migrate the legacy plaintext DB into the vault under `passphrase`, THEN delete
 *  the plaintext DB — only after the vault verifiably decrypts. Throws (leaving
 *  plaintext intact) on any failure before verification. */
/** The vault was written but would not read back, so the plaintext database
 *  was NOT deleted.
 *
 *  A class and not a Dutch message: this is thrown on the first-run migration
 *  screen and `VaultGate` used to print `err.message` verbatim, which put
 *  "kluis-verificatie mislukt" in front of an English reader at the one moment
 *  they are being asked to trust the app with their data. The sentence lives
 *  in `copy/shell`; what crosses the boundary is the fact that verification
 *  failed. */
export class VaultVerificationFailed extends Error {
  constructor() {
    super("vault-verification-failed");
    this.name = "VaultVerificationFailed";
  }
}

export async function migrateToVault(vault: VaultStorage, passphrase: string): Promise<void> {
  const legacy = createIndexedDbStorage();
  const [accounts, txs, rules] = await Promise.all([
    legacy.getAccounts(),
    legacy.getTxs(),
    legacy.getRules(),
  ]);
  await vault.setup(passphrase, { accounts, txs, rules }); // writes + unlocks the vault
  // VERIFY: re-open the vault fresh, unlock, and confirm the data decrypts back.
  vault.lock();
  const ok = await vault.unlock(passphrase);
  if (!ok) throw new VaultVerificationFailed();
  const back = await vault.getAccounts();
  if (back.length !== accounts.length)
    throw new VaultVerificationFailed();
  // Only now is it safe to delete the plaintext DB.
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // deletion proceeds once connections close
  });
}
