import type { CredentialStore } from "@lavega/core";
import { createEncryptedStorage, type VaultStorage } from "../storage/encryptedStorage.js";

/** Local credentials use existing encrypted vault storage. */
export function createLocalCredentialStore(dbName?: string): VaultStorage & CredentialStore {
  return createEncryptedStorage(dbName);
}
