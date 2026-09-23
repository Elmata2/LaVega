import { createDatabase, createBrokerRepository, type Database } from "@lavega/database";
import { AsyncLocalStorage } from "node:async_hooks";
import { createFileCredentialStore, type ServerVaultStatus } from "./fileCredentialStore.js";
import { createNeonCredentialStore, type BrokerReadability } from "./neonCredentialStore.js";
import type { CredentialStore } from "@lavega/core";
import type { RuntimeBrokerDataSnapshot } from "./runtimeBrokerData.js";

export type RuntimeCredentialStore = CredentialStore & {
  status(): Promise<ServerVaultStatus>;
  setup(passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<boolean>;
  lock(): void;
  /** Null when the vault holds nothing it can read: empty, or still locked. */
  getBrokerData(): Promise<RuntimeBrokerDataSnapshot | null>;
  putBrokerData(snapshot: RuntimeBrokerDataSnapshot): Promise<void>;
  brokerReadability?(): Promise<BrokerReadability>;
};

const databaseScope = new AsyncLocalStorage<Database | null>();

/**
 * Run one request with one Neon pool. Vercel can freeze an invocation after a
 * response, which makes a retained WebSocket stale on its next request.
 */
export async function withRuntimeDatabase<T>(fn: () => Promise<T>): Promise<T> {
  if (databaseScope.getStore() !== undefined) return fn();
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return databaseScope.run(null, fn);
  const database = createDatabase(connectionString);
  try {
    return await databaseScope.run(database, fn);
  } finally {
    await database.end();
  }
}

/** Neon pool belonging to current request, or `null` when Neon is unavailable. */
export function runtimeDatabase(): Database | null {
  return databaseScope.getStore() ?? null;
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
