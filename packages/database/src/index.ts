import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "@neondatabase/serverless";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type Database = Pool;

export function createDatabase(connectionString = process.env.DATABASE_URL): Database {
  if (!connectionString?.trim()) throw new Error("DATABASE_URL is required");
  return new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000 });
}

export function requireUserId(userId: string | undefined | null): string {
  if (!userId?.trim()) throw new Error("Authenticated user identity is required");
  return userId;
}

/** Every request gets its own transaction. SET LOCAL cannot leak to another request. */
export async function withTenant<T>(db: Database, userId: string | undefined | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const identity = requireUserId(userId);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [identity]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function encryptionKey(): Buffer {
  const value = process.env.LAVEGA_ENCRYPTION_KEY;
  if (!value) throw new Error("LAVEGA_ENCRYPTION_KEY is required");
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("LAVEGA_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

/** Versioned AES-256-GCM envelope. Key never enters PostgreSQL. */
export function encryptBlob(value: unknown): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1, iv.length]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBlob<T>(blob: Buffer | Uint8Array): T {
  const bytes = Buffer.from(blob);
  if (bytes[0] !== 1 || bytes[1] !== 12 || bytes.length < 30) throw new Error("Invalid encrypted blob");
  const iv = bytes.subarray(2, 14);
  const tag = bytes.subarray(14, 30);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(30)), decipher.final()]).toString("utf8")) as T;
}

export type VaultRepository = {
  get<T>(): Promise<T | null>;
  put(value: unknown): Promise<void>;
};

export function createVaultRepository(db: Database, userId: string | undefined | null): VaultRepository {
  return {
    async get<T>() {
      return withTenant(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>("SELECT vault_blob FROM personal.vaults");
        return result.rows[0] ? decryptBlob<T>(result.rows[0].vault_blob as Buffer) : null;
      });
    },
    async put(value) {
      const blob = encryptBlob(value);
      await withTenant(db, userId, async (client) => {
        await client.query("INSERT INTO personal.vaults (user_id, vault_blob) VALUES (current_setting('app.user_id'), $1) ON CONFLICT (user_id) DO UPDATE SET vault_blob = EXCLUDED.vault_blob, updated_at = CURRENT_TIMESTAMP", [blob]);
      });
    },
  };
}

export type EncryptedBrokerRepository = {
  get<T>(broker: string): Promise<{ credentials: T; snapshot: unknown | null } | null>;
  put(broker: string, credentials: unknown, snapshot?: unknown): Promise<void>;
};

export function createBrokerRepository(db: Database, userId: string | undefined | null): EncryptedBrokerRepository {
  return {
    async get<T>(broker: string) {
      return withTenant(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>("SELECT credentials_blob, snapshot_blob FROM investing.broker_vaults WHERE broker = $1", [broker]);
        const row = result.rows[0];
        return row ? { credentials: decryptBlob<T>(row.credentials_blob as Buffer), snapshot: row.snapshot_blob ? decryptBlob(row.snapshot_blob as Buffer) : null } : null;
      });
    },
    async put(broker: string, credentials: unknown, snapshot?: unknown) {
      const credentialsBlob = encryptBlob(credentials);
      const snapshotBlob = snapshot === undefined ? null : encryptBlob(snapshot);
      await withTenant(db, userId, async (client) => {
        await client.query("INSERT INTO investing.broker_vaults (user_id, broker, credentials_blob, snapshot_blob) VALUES (current_setting('app.user_id'), $1, $2, $3) ON CONFLICT (user_id, broker) DO UPDATE SET credentials_blob = EXCLUDED.credentials_blob, snapshot_blob = COALESCE(EXCLUDED.snapshot_blob, investing.broker_vaults.snapshot_blob), updated_at = CURRENT_TIMESTAMP", [broker, credentialsBlob, snapshotBlob]);
      });
    },
  };
}

export type { PoolClient, QueryResult };

/* Investing tables. Every repository is bound to one user and runs inside
 * withTenant, so `app.user_id` is set and the RLS policy in 0001_lavega.sql
 * decides what the statement can see. The explicit tenant checks below are
 * belt-and-braces: they turn a caller passing the wrong user into an error
 * here rather than a silent write under the bound one. */

const sameTenant = (bound: string, candidate: string) => {
  if (candidate !== bound) throw new Error("Row belongs to another tenant");
};

const isoDate = (value: unknown): string | null =>
  value == null ? null : value instanceof Date ? value.toISOString() : String(value);

export type PriceBarRepository = {
  getRange(symbol: string, from: string, to: string): Promise<PriceBarRow[]>;
  lastDate(symbol: string): Promise<string | null>;
  upsert(bars: readonly PriceBarRow[]): Promise<void>;
  purgeAll(): Promise<void>;
};

export type PriceBarRow = { tenantId: string; symbol: string; date: string; close: number; currency: string };

/**
 * Daily bars for one user. `provider` records where a bar came from; the bar
 * itself does not carry that, so the caller names its provider once.
 */
export function createPriceBarRepository(db: Database, userId: string | undefined | null, provider = "yahoo"): PriceBarRepository {
  const tenantId = requireUserId(userId);
  return {
    async getRange(symbol, from, to) {
      return withTenant(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT symbol, to_char(date, 'YYYY-MM-DD') AS date, close, currency FROM investing.price_bars WHERE symbol = $1 AND date BETWEEN $2 AND $3 ORDER BY date",
          [symbol, from, to],
        );
        // NUMERIC arrives as a string; a bar with a string close silently breaks every sum downstream.
        return result.rows.map((row) => ({ tenantId, symbol: row.symbol as string, date: row.date as string, close: Number(row.close), currency: row.currency as string }));
      });
    },
    async lastDate(symbol) {
      return withTenant(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT to_char(max(date), 'YYYY-MM-DD') AS date FROM investing.price_bars WHERE symbol = $1",
          [symbol],
        );
        return (result.rows[0]?.date as string | null) ?? null;
      });
    },
    async upsert(bars) {
      if (bars.length === 0) return;
      for (const bar of bars) sameTenant(tenantId, bar.tenantId);
      await withTenant(db, tenantId, async (client) => {
        await client.query(
          "INSERT INTO investing.price_bars (user_id, symbol, date, close, currency, provider) SELECT current_setting('app.user_id'), * FROM unnest($1::text[], $2::date[], $3::numeric[], $4::text[], $5::text[]) ON CONFLICT (user_id, symbol, date) DO UPDATE SET close = EXCLUDED.close, currency = EXCLUDED.currency, provider = EXCLUDED.provider, updated_at = CURRENT_TIMESTAMP",
          [
            bars.map((bar) => bar.symbol),
            bars.map((bar) => bar.date),
            bars.map((bar) => bar.close),
            bars.map((bar) => bar.currency.toUpperCase()),
            bars.map(() => provider),
          ],
        );
      });
    },
    async purgeAll() {
      await withTenant(db, tenantId, async (client) => {
        await client.query("DELETE FROM investing.price_bars");
      });
    },
  };
}

export type PreferencesRepository = {
  getBenchmarkSymbols(): Promise<string[]>;
  setBenchmarkSymbols(symbols: readonly string[]): Promise<void>;
  getMarketDataConsent(): Promise<unknown | null>;
  setMarketDataConsent(decision: unknown): Promise<void>;
};

/** Benchmarks and market-data consent share one row, so each write names its own column. */
export function createPreferencesRepository(db: Database, userId: string | undefined | null): PreferencesRepository {
  const tenantId = requireUserId(userId);
  const read = async <T>(column: string, fallback: T): Promise<T> =>
    withTenant(db, tenantId, async (client) => {
      const result = await client.query<QueryResultRow>(`SELECT ${column} FROM investing.preferences`);
      const value = result.rows[0]?.[column];
      return value == null ? fallback : value as T;
    });
  const write = async (column: string, value: unknown) => {
    await withTenant(db, tenantId, async (client) => {
      await client.query(
        `INSERT INTO investing.preferences (user_id, ${column}) VALUES (current_setting('app.user_id'), $1::jsonb) ON CONFLICT (user_id) DO UPDATE SET ${column} = EXCLUDED.${column}, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify(value)],
      );
    });
  };
  return {
    getBenchmarkSymbols: () => read<string[]>("benchmark_symbols", []),
    setBenchmarkSymbols: (symbols) => write("benchmark_symbols", [...symbols]),
    getMarketDataConsent: () => read<unknown | null>("market_data_consent", null),
    setMarketDataConsent: (decision) => write("market_data_consent", decision),
  };
}

export type SyncStateRow = { lastSyncedAt: string | null; retryAfter?: string | null };

export type SyncStateRepository = {
  get(broker: string): Promise<SyncStateRow>;
  put(broker: string, state: SyncStateRow): Promise<void>;
};

export function createSyncStateRepository(db: Database, userId: string | undefined | null): SyncStateRepository {
  const tenantId = requireUserId(userId);
  return {
    async get(broker) {
      return withTenant(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>("SELECT state FROM investing.sync_state WHERE broker = $1", [broker]);
        const state = result.rows[0]?.state as SyncStateRow | undefined;
        return state ?? { lastSyncedAt: null, retryAfter: null };
      });
    },
    async put(broker, state) {
      await withTenant(db, tenantId, async (client) => {
        /* `status` is the table's own vocabulary for a run's outcome, which this
         * store does not track — it records when a sync last succeeded and when
         * a provider will talk to us again. 'idle' is the honest value. */
        await client.query(
          "INSERT INTO investing.sync_state (user_id, broker, status, state, last_succeeded_at) VALUES (current_setting('app.user_id'), $1, 'idle', $2::jsonb, $3) ON CONFLICT (user_id, broker) DO UPDATE SET state = EXCLUDED.state, last_succeeded_at = EXCLUDED.last_succeeded_at, updated_at = CURRENT_TIMESTAMP",
          [broker, JSON.stringify(state), state.lastSyncedAt],
        );
      });
    },
  };
}

export type AgentRunRow = { id: string; startedAt: string; finishedAt: string | null; status: "running" | "done" | "error"; summary: string | null; error: string | null };

const AGENT_STATUS_TO_COLUMN = { running: "running", done: "succeeded", error: "failed" } as const;
const AGENT_STATUS_FROM_COLUMN: Record<string, AgentRunRow["status"]> = { running: "running", queued: "running", succeeded: "done", failed: "error", cancelled: "error" };

/** Only the latest run per user is kept; this is operational state, not history. */
export function createAgentRunRepository(db: Database, userId: string | undefined | null) {
  const tenantId = requireUserId(userId);
  return {
    async get(): Promise<AgentRunRow | null> {
      return withTenant(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>("SELECT run_id, status, run_result, started_at, finished_at FROM investing.agent_runs");
        const row = result.rows[0];
        if (!row) return null;
        const runResult = (row.run_result ?? {}) as { summary?: string | null; error?: string | null };
        return {
          id: row.run_id as string,
          startedAt: isoDate(row.started_at) ?? new Date(0).toISOString(),
          finishedAt: isoDate(row.finished_at),
          status: AGENT_STATUS_FROM_COLUMN[row.status as string] ?? "error",
          summary: runResult.summary ?? null,
          error: runResult.error ?? null,
        };
      });
    },
    async put(record: AgentRunRow): Promise<void> {
      await withTenant(db, tenantId, async (client) => {
        await client.query(
          "INSERT INTO investing.agent_runs (user_id, run_id, status, run_result, started_at, finished_at) VALUES (current_setting('app.user_id'), $1, $2, $3::jsonb, $4, $5) ON CONFLICT (user_id) DO UPDATE SET run_id = EXCLUDED.run_id, status = EXCLUDED.status, run_result = EXCLUDED.run_result, started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at, updated_at = CURRENT_TIMESTAMP",
          [record.id, AGENT_STATUS_TO_COLUMN[record.status], JSON.stringify({ summary: record.summary, error: record.error }), record.startedAt, record.finishedAt],
        );
      });
    },
  };
}
