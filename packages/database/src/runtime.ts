import { AsyncLocalStorage } from "node:async_hooks";
import { createDatabase, type Database } from "./index.js";

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

export function runtimeDatabase(): Database | null {
  return databaseScope.getStore() ?? null;
}

/**
 * Current request's Neon pool. Throws outside a request or without a database:
 * route factories run at module load must call this inside handlers, because
 * `runtimeDatabase()` is `null` at load time.
 */
export function requireRuntimeDatabase(): Database {
  const database = runtimeDatabase();
  if (!database) throw new Error("geen database in dit verzoek");
  return database;
}

export function credentialsArePerTenant(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
