import { createDatabase, createBrokerRepository, type Database } from "@lavega/database";
import { createFileCredentialStore, type ServerVaultStatus } from "./fileCredentialStore.js";
import { createNeonCredentialStore } from "./neonCredentialStore.js";
import type { CredentialStore } from "@lavega/core";
import type { RuntimeBrokerDataSnapshot } from "./runtimeBrokerData.js";

export type RuntimeCredentialStore = CredentialStore & {
  status(): Promise<ServerVaultStatus>;
  setup(passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<boolean>;
  lock(): void;
  getBrokerData(): Promise<RuntimeBrokerDataSnapshot>;
  putBrokerData(snapshot: RuntimeBrokerDataSnapshot): Promise<void>;
};

let pool: Database | null = null;

/** The Neon pool for this runtime, or `null` when there is no database configured. */
export function runtimeDatabase(): Database | null {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return null;
  pool ??= createDatabase(connectionString);
  return pool;
}

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

/** True when credentials are stored per user rather than in one local vault. */
export function credentialsArePerTenant(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
