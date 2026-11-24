import {
  createBrokerRepository,
  credentialsArePerTenant,
  requireRuntimeDatabase,
  runtimeDatabase,
  withRuntimeDatabase,
} from "@lavega/database";
import { createFileCredentialStore, type ServerVaultStatus } from "./fileCredentialStore.js";
import { createNeonCredentialStore, type BrokerReadability } from "./neonCredentialStore.js";
import type { BrokerId, CredentialStore } from "@lavega/core";
import type { BrokerAccountSnapshot } from "@lavega/adapters";
import type { RuntimeBrokerDataSnapshot } from "./runtimeBrokerData.js";

export { credentialsArePerTenant, requireRuntimeDatabase, runtimeDatabase, withRuntimeDatabase };

export type RuntimeCredentialStore = CredentialStore & {
  status(): Promise<ServerVaultStatus>;
  setup(passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<boolean>;
  lock(): void;
  /** Null when the vault holds nothing it can read: empty, or still locked. */
  getBrokerData(): Promise<RuntimeBrokerDataSnapshot | null>;
  putBrokerData(snapshot: RuntimeBrokerDataSnapshot): Promise<void>;
  /** Write one broker's snapshot, leaving every other broker untouched. A file
   *  import owns its broker's row; a sync is not running for it. */
  putBrokerSnapshot(broker: BrokerId, snapshot: BrokerAccountSnapshot): Promise<void>;
  brokerReadability?(): Promise<BrokerReadability>;
};

/**
 * Where one tenant's broker credentials live.
 *
 * With `DATABASE_URL` set they go to Neon, one row per user and broker, so a
 * hosted runtime keeps them across invocations. Without it — local development
 * and self-hosting — the passphrase-locked file vault is still the store, and
 * the tenant is whichever single one that runtime serves.
 */
export function createRuntimeCredentialStore(tenantId: string): RuntimeCredentialStore {
  const database = runtimeDatabase();
  if (!database) return createFileCredentialStore();
  return createNeonCredentialStore(createBrokerRepository(database, tenantId), tenantId);
}
