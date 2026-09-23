import {
  neon,
  Pool,
  type NeonQueryFunction,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "@neondatabase/serverless";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** The pool carries multi-statement transactions; `http` carries the rest. */
export type Database = Pool & { readonly http: NeonQueryFunction<false, true> };

export function createDatabase(connectionString = process.env.DATABASE_URL): Database {
  if (!connectionString?.trim()) throw new Error("DATABASE_URL is required");
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  });
  return Object.assign(pool, { http: neon(connectionString, { fullResults: true }) });
}

export function requireUserId(userId: string | undefined | null): string {
  if (!userId?.trim()) throw new Error("Authenticated user identity is required");
  return userId;
}

/** Every request gets its own transaction. SET LOCAL cannot leak to another request. */
export async function withTenant<T>(
  db: Database,
  userId: string | undefined | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
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

export type TenantStatement = {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
};

/**
 * One statement as the tenant, in one round trip.
 *
 * `withTenant` over the pool costs five: connect, BEGIN, set_config, the
 * statement and COMMIT. Neon's HTTP transaction sends set_config and the
 * statement in one request and wraps them in BEGIN and COMMIT on the server, so
 * RLS sees the same `app.user_id` for the same single transaction. The client
 * takes one statement. A second would run outside that transaction, so it
 * throws; code that needs two belongs in `withTenant`.
 */
export async function withTenantStatement<T>(
  db: Database,
  userId: string | undefined | null,
  fn: (client: TenantStatement) => Promise<T>,
): Promise<T> {
  const identity = requireUserId(userId);
  let sent = false;
  return fn({
    async query<R extends QueryResultRow>(text: string, params: unknown[] = []) {
      if (sent) throw new Error("withTenantStatement runs one statement; use withTenant for more");
      sent = true;
      const [, result] = await db.http.transaction([
        db.http.query("SELECT set_config('app.user_id', $1, true)", [identity]),
        db.http.query(text, params),
      ]);
      return result as unknown as QueryResult<R>;
    },
  });
}

function encryptionKey(): Buffer {
  const value = process.env.LAVEGA_ENCRYPTION_KEY;
  if (!value) throw new Error("LAVEGA_ENCRYPTION_KEY is required");
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
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

/**
 * Decrypt, or say it could not be done.
 *
 * A blob sealed under a key that is no longer configured is not corrupt and not
 * absent — it is unreadable, and those three want different answers. Callers
 * that hold a cache can carry on without it; callers that hold the only copy of
 * something must not pretend it was never there.
 */
export function tryDecryptBlob<T>(
  blob: Buffer | Uint8Array,
): { readable: true; value: T } | { readable: false } {
  try {
    return { readable: true, value: decryptBlob<T>(blob) };
  } catch {
    return { readable: false };
  }
}

export function decryptBlob<T>(blob: Buffer | Uint8Array): T {
  const bytes = Buffer.from(blob);
  if (bytes[0] !== 1 || bytes[1] !== 12 || bytes.length < 30)
    throw new Error("Invalid encrypted blob");
  const iv = bytes.subarray(2, 14);
  const tag = bytes.subarray(14, 30);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(30)), decipher.final()]).toString("utf8"),
  ) as T;
}

export type EncryptedBrokerRepository = {
  get<T>(broker: string): Promise<{ credentials: T; credentialGeneration: number } | null>;
  /** Every broker's snapshot in one read. Snapshots are the large part of a
   *  vault row, so `get` leaves them out and only this reads them. */
  snapshots(): Promise<Record<string, unknown> | null>;
  /** Writing credentials starts a new generation: whatever a running sync is
   *  reading belongs to the connection this call replaces. */
  put(broker: string, credentials: unknown, snapshot?: unknown): Promise<void>;
  /** Stores broker data alone. The credential blob is left untouched, so a
   *  reconnect that lands mid-sync is not reverted by the snapshot write that
   *  follows it. False means the credentials moved on and the data was dropped. */
  putSnapshot(broker: string, snapshot: unknown, credentialGeneration: number): Promise<boolean>;
};

export class UnreadableBrokerCredentialsError extends Error {
  constructor() {
    super("Stored broker credentials cannot be read with the current LAVEGA_ENCRYPTION_KEY");
    this.name = "UnreadableBrokerCredentialsError";
  }
}

export function createBrokerRepository(
  db: Database,
  userId: string | undefined | null,
): EncryptedBrokerRepository {
  return {
    async get<T>(broker: string) {
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT credentials_blob, credential_generation FROM investing.broker_vaults WHERE broker = $1",
          [broker],
        );
        const row = result.rows[0];
        if (!row) return null;
        const credentials = tryDecryptBlob<T>(row.credentials_blob as Buffer);
        /* Credentials are the only copy there is. Reporting them as missing
         * would send the user to re-enter their broker tokens, and that write
         * would replace ciphertext a restored key could still have opened. */
        if (!credentials.readable) throw new UnreadableBrokerCredentialsError();
        return {
          credentials: credentials.value,
          credentialGeneration: Number(row.credential_generation ?? 1),
        };
      });
    },
    async snapshots() {
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT broker, snapshot_blob FROM investing.broker_vaults",
        );
        // No row at all is an empty vault, which callers treat unlike one without data yet.
        if (result.rows.length === 0) return null;
        const snapshots: Record<string, unknown> = {};
        for (const row of result.rows) {
          // The snapshot is a cache of broker data. A sync rebuilds it, so an
          // unreadable one is dropped rather than taking the account down.
          if (!row.snapshot_blob) continue;
          const snapshot = tryDecryptBlob(row.snapshot_blob as Buffer);
          if (snapshot.readable) snapshots[row.broker as string] = snapshot.value;
        }
        return snapshots;
      });
    },
    async put(broker: string, credentials: unknown, snapshot?: unknown) {
      const credentialsBlob = encryptBlob(credentials);
      const snapshotBlob = snapshot === undefined ? null : encryptBlob(snapshot);
      await withTenant(db, userId, async (client) => {
        await client.query(
          "INSERT INTO investing.broker_vaults (user_id, broker, credentials_blob, snapshot_blob) VALUES (current_setting('app.user_id'), $1, $2, $3) ON CONFLICT (user_id, broker) DO UPDATE SET credentials_blob = EXCLUDED.credentials_blob, snapshot_blob = EXCLUDED.snapshot_blob, credential_generation = investing.broker_vaults.credential_generation + 1, updated_at = CURRENT_TIMESTAMP",
          [broker, credentialsBlob, snapshotBlob],
        );
        // A new connection must never resume another account's history or lease.
        await client.query("DELETE FROM investing.sync_state WHERE broker = $1", [broker]);
      });
    },
    async putSnapshot(broker: string, snapshot: unknown, credentialGeneration: number) {
      const snapshotBlob = encryptBlob(snapshot);
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query(
          "UPDATE investing.broker_vaults SET snapshot_blob = $2, updated_at = CURRENT_TIMESTAMP WHERE broker = $1 AND credential_generation = $3 RETURNING broker",
          [broker, snapshotBlob, credentialGeneration],
        );
        return result.rows.length > 0;
      });
    },
  };
}

export type DashboardSnapshotRepository = {
  /** The stored dashboard for a query while it is still current, and the
   *  source version a dashboard built now has to be stored under. */
  get(cacheKey: string): Promise<{ version: number; dashboard: unknown | null }>;
  put(cacheKey: string, version: number, dashboard: unknown): Promise<void>;
};

/**
 * Built dashboards, one per query, current while their source version is
 * (see 0010_dashboard_snapshots.sql). The tenant is also named in each
 * statement: a connection that bypasses RLS must still see one user's row.
 */
export function createDashboardSnapshotRepository(
  db: Database,
  userId: string | undefined | null,
): DashboardSnapshotRepository {
  return {
    async get(cacheKey) {
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `SELECT current.version, stored.blob
           FROM (
             SELECT COALESCE(
               (SELECT version FROM investing.dashboard_sources
                WHERE user_id = current_setting('app.user_id')),
               0
             ) AS version
           ) AS current
           LEFT JOIN investing.dashboard_snapshots AS stored
             ON stored.user_id = current_setting('app.user_id')
            AND stored.cache_key = $1
            AND stored.version = current.version
            AND stored.as_of = CURRENT_DATE`,
          [cacheKey],
        );
        const row = result.rows[0];
        const stored = row?.blob ? tryDecryptBlob(row.blob as Buffer) : null;
        return {
          version: Number(row?.version ?? 0),
          dashboard: stored?.readable ? stored.value : null,
        };
      });
    },
    async put(cacheKey, version, dashboard) {
      const blob = encryptBlob(dashboard);
      await withTenantStatement(db, userId, async (client) => {
        await client.query(
          `INSERT INTO investing.dashboard_snapshots (user_id, cache_key, version, as_of, blob)
           VALUES (current_setting('app.user_id'), $1, $2, CURRENT_DATE, $3)
           ON CONFLICT (user_id, cache_key) DO UPDATE
             SET version = EXCLUDED.version, as_of = EXCLUDED.as_of, blob = EXCLUDED.blob,
                 updated_at = CURRENT_TIMESTAMP
             WHERE investing.dashboard_snapshots.version <= EXCLUDED.version`,
          [cacheKey, version, blob],
        );
      });
    },
  };
}

export type FxRateRow = {
  base: string;
  date: string;
  rates: Record<string, number>;
};

export type FxRateRepository = {
  /** Oldest first, starting at the last published date on or before `from`. */
  range(base: string, from: string, to: string): Promise<FxRateRow[]>;
  put(rows: readonly FxRateRow[]): Promise<void>;
};

/** Published exchange rates. They belong to no user, so no tenant is set. */
export function createFxRateRepository(db: Database): FxRateRepository {
  return {
    async range(base, from, to) {
      const result = await db.http.query(
        `SELECT base, to_char(date, 'YYYY-MM-DD') AS date, rates FROM investing.fx_rates
         WHERE base = $1 AND date <= $3::date
           AND date >= COALESCE(
             (SELECT max(date) FROM investing.fx_rates WHERE base = $1 AND date <= $2::date),
             $2::date)
         ORDER BY date`,
        [base, from, to],
      );
      return result.rows as FxRateRow[];
    },
    async put(rows) {
      if (rows.length === 0) return;
      await db.http.query(
        `INSERT INTO investing.fx_rates (base, date, rates)
         SELECT row->>'base', (row->>'date')::date, row->'rates'
         FROM jsonb_array_elements($1::jsonb) AS row
         ON CONFLICT (base, date) DO UPDATE SET rates = EXCLUDED.rates`,
        [JSON.stringify(rows)],
      );
    },
  };
}

export type { PoolClient, QueryResult };

/* Investing tables. Every repository is bound to one user and runs inside
 * withTenant or withTenantStatement, so `app.user_id` is set and the RLS policy in 0001_lavega.sql
 * decides what the statement can see. Rows never name a tenant of their own, so
 * there is no wrong-user value for a caller to pass. */

const isoDate = (value: unknown): string | null =>
  value == null ? null : value instanceof Date ? value.toISOString() : String(value);

export type PriceBarRepository = {
  /** Omitting a bound means no bound. There is no date that stands for "all time". */
  getRange(symbol: string, from?: string, to?: string): Promise<PriceBarRow[]>;
  getRanges(symbols: readonly string[]): Promise<PriceBarRow[]>;
  lastDate(symbol: string): Promise<string | null>;
  upsert(bars: readonly PriceBarRow[]): Promise<void>;
  purgeAll(): Promise<void>;
};

/** The repository is built for one tenant, so a row never names its own. */
export type PriceBarRow = {
  symbol: string;
  date: string;
  close: number;
  currency: string;
};

/**
 * Daily bars for one user. `provider` records where a bar came from; the bar
 * itself does not carry that, so the caller names its provider once.
 */
export function createPriceBarRepository(
  db: Database,
  userId: string | undefined | null,
  provider = "yahoo",
): PriceBarRepository {
  const tenantId = requireUserId(userId);
  return {
    async getRanges(symbols) {
      if (symbols.length === 0) return [];
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT symbol, to_char(date, 'YYYY-MM-DD') AS date, close, currency FROM investing.price_bars WHERE symbol = ANY($1::text[]) ORDER BY date, symbol",
          [[...new Set(symbols)]],
        );
        return result.rows.map((row) => ({
          symbol: row.symbol as string,
          date: row.date as string,
          close: Number(row.close),
          currency: row.currency as string,
        }));
      });
    },
    async getRange(symbol, from, to) {
      /* Built from the bounds actually given. A caller wanting the whole history
       * passes none: spelling it as a wide date range is how '0000-01-01' — a
       * year Postgres does not have — got into this query. */
      const values: unknown[] = [symbol];
      const conditions = ["symbol = $1"];
      if (from !== undefined) conditions.push(`date >= $${values.push(from)}`);
      if (to !== undefined) conditions.push(`date <= $${values.push(to)}`);
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `SELECT symbol, to_char(date, 'YYYY-MM-DD') AS date, close, currency FROM investing.price_bars WHERE ${conditions.join(" AND ")} ORDER BY date`,
          values,
        );
        // NUMERIC arrives as a string; a bar with a string close silently breaks every sum downstream.
        return result.rows.map((row) => ({
          symbol: row.symbol as string,
          date: row.date as string,
          close: Number(row.close),
          currency: row.currency as string,
        }));
      });
    },
    async lastDate(symbol) {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT to_char(max(date), 'YYYY-MM-DD') AS date FROM investing.price_bars WHERE symbol = $1",
          [symbol],
        );
        return (result.rows[0]?.date as string | null) ?? null;
      });
    },
    async upsert(bars) {
      if (bars.length === 0) return;
      await withTenantStatement(db, tenantId, async (client) => {
        await client.query(
          "INSERT INTO investing.price_bars (user_id, symbol, date, close, currency, provider) SELECT current_setting('app.user_id'), * FROM unnest($1::text[], $2::date[], $3::numeric[], $4::text[], $5::text[]) ON CONFLICT (user_id, symbol, date) DO UPDATE SET close = EXCLUDED.close, currency = EXCLUDED.currency, provider = EXCLUDED.provider, updated_at = CURRENT_TIMESTAMP",
          [
            bars.map((bar) => bar.symbol),
            bars.map((bar) => bar.date),
            bars.map((bar) => bar.close),
            /* Stored verbatim. `GBp` and `GBP` differ by case and by a factor
             * of 100, so uppercasing here repriced pence as pounds; providers
             * canonicalise on the way in instead. */
            bars.map((bar) => bar.currency),
            bars.map(() => provider),
          ],
        );
      });
    },
    async purgeAll() {
      await withTenantStatement(db, tenantId, async (client) => {
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
export function createPreferencesRepository(
  db: Database,
  userId: string | undefined | null,
): PreferencesRepository {
  const tenantId = requireUserId(userId);
  const read = async <T>(column: string, fallback: T): Promise<T> =>
    withTenantStatement(db, tenantId, async (client) => {
      const result = await client.query<QueryResultRow>(
        `SELECT ${column} FROM investing.preferences`,
      );
      const value = result.rows[0]?.[column];
      return value == null ? fallback : (value as T);
    });
  const write = async (column: string, value: unknown) => {
    await withTenantStatement(db, tenantId, async (client) => {
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

/** The worker that currently owns a broker's sync, and when it last said so. */
export type SyncLeaseRow = {
  id: string;
  startedAt: string;
  heartbeatAt: string;
};

/** What a status request on any instance reports about the run. */
export type SyncProgressRow = {
  status: "idle" | "running" | "waiting" | "completed" | "problem";
  message: string | null;
  updatedAt: string | null;
  leaseId: string | null;
};

export type SyncStateRow = {
  lastSyncedAt: string | null;
  retryAfter?: string | null;
  lease?: SyncLeaseRow | null;
  progress?: SyncProgressRow | null;
  resume?: {
    ordersNextPagePath?: string | null;
    transactionsNextPagePath?: string | null;
    dividendsNextPagePath?: string | null;
    ordersComplete?: boolean;
    transactionsComplete?: boolean;
    dividendsComplete?: boolean;
  } | null;
};

export type SyncStateRepository = {
  get(broker: string): Promise<SyncStateRow>;
  put(broker: string, state: SyncStateRow): Promise<void>;
};

export function createSyncStateRepository(
  db: Database,
  userId: string | undefined | null,
): SyncStateRepository {
  const tenantId = requireUserId(userId);
  return {
    async get(broker) {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT state FROM investing.sync_state WHERE broker = $1",
          [broker],
        );
        const state = result.rows[0]?.state as SyncStateRow | undefined;
        return state ?? { lastSyncedAt: null, retryAfter: null };
      });
    },
    async put(broker, state) {
      await withTenantStatement(db, tenantId, async (client) => {
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

export type BrokerSyncCommit = {
  leaseId: string;
  state: SyncStateRow;
  progress: SyncProgressRow;
  /** Omitted when a run produced no data worth storing. */
  snapshot?: { value: unknown; credentialGeneration: number };
};

export type BrokerSyncOperationRepository = {
  claim(
    broker: string,
    input: { leaseId: string; staleBefore: string; progress: SyncProgressRow },
  ): Promise<{
    claimed: boolean;
    state: SyncStateRow;
    snapshot: unknown | null;
    credentialGeneration: number;
  }>;
  /** The run is alive and this is what it is doing. Rejected once the lease is gone. */
  publish(broker: string, leaseId: string, progress: SyncProgressRow): Promise<boolean>;
  progress(broker: string): Promise<SyncProgressRow | null>;
  /** Broker data and cursor in one transaction, or neither. */
  commit(broker: string, input: BrokerSyncCommit): Promise<boolean>;
  release(broker: string, leaseId: string, progress: SyncProgressRow): Promise<void>;
};

const EMPTY_SYNC_STATE: SyncStateRow = { lastSyncedAt: null, retryAfter: null };

/** Thrown to roll a commit back; never leaves this module. */
class RejectedCommit extends Error {}

/**
 * Broker synchronization as one durable operation.
 *
 * A run claims the tenant's broker, works, and commits what it read. Both
 * guards are in the WHERE clause rather than in a read the caller did earlier:
 * a worker whose lease expired and was taken over cannot commit, and a run that
 * started before a reconnect cannot write the old account's holdings over the
 * new ones. Snapshot and cursor move together, so a failure leaves neither
 * changed and the next run resumes from what it can prove it stored.
 */
export function createBrokerSyncOperationRepository(
  db: Database,
  userId: string | undefined | null,
): BrokerSyncOperationRepository {
  const tenantId = requireUserId(userId);
  const readState = (value: unknown): SyncStateRow => {
    const state = value as SyncStateRow | undefined;
    return state && Object.keys(state).length > 0 ? state : EMPTY_SYNC_STATE;
  };
  return {
    async claim(broker, input) {
      return withTenant(db, tenantId, async (client) => {
        const lease: SyncLeaseRow = {
          id: input.leaseId,
          startedAt: input.progress.updatedAt ?? new Date().toISOString(),
          heartbeatAt: input.progress.updatedAt ?? new Date().toISOString(),
        };
        const claim = JSON.stringify({ lease, progress: input.progress });
        /* The cursor already in the row is the whole point of resuming, so the
         * claim merges into it instead of replacing it. */
        const result = await client.query<QueryResultRow>(
          `WITH claimed AS (
             INSERT INTO investing.sync_state (user_id, broker, status, state, last_started_at)
             VALUES (current_setting('app.user_id'), $1, 'running', $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id, broker) DO UPDATE
               SET status = 'running',
                   state = investing.sync_state.state || $2::jsonb,
                   last_started_at = CURRENT_TIMESTAMP,
                   updated_at = CURRENT_TIMESTAMP,
                   last_error = NULL
             WHERE investing.sync_state.state->'lease'->>'id' IS NULL
                OR (investing.sync_state.state->'lease'->>'heartbeatAt')::timestamptz < $3::timestamptz
             RETURNING state, true AS claimed
           )
           SELECT state, claimed FROM claimed
           UNION ALL
           SELECT state, false AS claimed
           FROM investing.sync_state
           WHERE broker = $1 AND NOT EXISTS (SELECT 1 FROM claimed)
           LIMIT 1`,
          [broker, claim, input.staleBefore],
        );
        const row = result.rows[0];
        /* The stored broker data is read under the same claim that grants the
         * right to replace it, so the run merges into what it will overwrite. */
        const vault = await client.query<QueryResultRow>(
          "SELECT snapshot_blob, credential_generation FROM investing.broker_vaults WHERE broker = $1",
          [broker],
        );
        const stored = vault.rows[0]?.snapshot_blob
          ? tryDecryptBlob(vault.rows[0].snapshot_blob as Buffer)
          : null;
        return {
          claimed: Boolean(row?.claimed),
          state: readState(row?.state),
          snapshot: stored?.readable ? stored.value : null,
          credentialGeneration: Number(vault.rows[0]?.credential_generation ?? 0),
        };
      });
    },
    async publish(broker, leaseId, progress) {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query(
          `UPDATE investing.sync_state
             SET state = state || jsonb_build_object(
                   'progress', $3::jsonb,
                   'lease', state->'lease' || jsonb_build_object('heartbeatAt', $4::text)
                 ),
                 updated_at = CURRENT_TIMESTAMP
           WHERE broker = $1 AND state->'lease'->>'id' = $2
           RETURNING broker`,
          [
            broker,
            leaseId,
            JSON.stringify(progress),
            progress.updatedAt ?? new Date().toISOString(),
          ],
        );
        return result.rows.length > 0;
      });
    },
    async progress(broker) {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT state->'progress' AS progress FROM investing.sync_state WHERE broker = $1",
          [broker],
        );
        return (result.rows[0]?.progress as SyncProgressRow | null) ?? null;
      });
    },
    async commit(broker, input) {
      const snapshotBlob = input.snapshot ? encryptBlob(input.snapshot.value) : null;
      try {
        return await withTenant(db, tenantId, async (client) => {
          if (input.snapshot) {
            const stored = await client.query(
              "UPDATE investing.broker_vaults SET snapshot_blob = $2, updated_at = CURRENT_TIMESTAMP WHERE broker = $1 AND credential_generation = $3 RETURNING broker",
              [broker, snapshotBlob, input.snapshot.credentialGeneration],
            );
            if (stored.rows.length === 0) throw new RejectedCommit();
          }
          const state = await client.query(
            `UPDATE investing.sync_state
               SET status = $3,
                   state = $4::jsonb,
                   last_succeeded_at = CASE WHEN $5::text IS NULL THEN last_succeeded_at ELSE $5::timestamptz END,
                   last_error = $6,
                   updated_at = CURRENT_TIMESTAMP
             WHERE broker = $1 AND state->'lease'->>'id' = $2
             RETURNING broker`,
            [
              broker,
              input.leaseId,
              input.progress.status === "problem" ? "failed" : "succeeded",
              JSON.stringify({ ...input.state, lease: null, progress: input.progress }),
              input.state.lastSyncedAt,
              input.progress.status === "problem" ? input.progress.message : null,
            ],
          );
          if (state.rows.length === 0) throw new RejectedCommit();
          return true;
        });
      } catch (error) {
        if (error instanceof RejectedCommit) return false;
        throw error;
      }
    },
    async release(broker, leaseId, progress) {
      await withTenantStatement(db, tenantId, async (client) => {
        await client.query(
          `UPDATE investing.sync_state
             SET status = $4,
                 state = (state - 'lease') || jsonb_build_object('progress', $3::jsonb),
                 updated_at = CURRENT_TIMESTAMP
           WHERE broker = $1 AND state->'lease'->>'id' = $2`,
          [
            broker,
            leaseId,
            JSON.stringify(progress),
            progress.status === "problem" ? "failed" : "idle",
          ],
        );
      });
    },
  };
}

export type PriceSyncStateRepository = {
  get(): Promise<unknown | null>;
  put(progress: unknown, status: string, leaseId: string): Promise<boolean>;
  claim(progress: unknown, status: string, staleBefore: string): Promise<unknown | null>;
};

/* Price synchronization is a sync like any other, so it lives in the sync
 * state table under its own name rather than in a table of its own. `broker`
 * is the key of what was synchronized, and 'prices' is what this one reads. */
const PRICE_SYNC_KEY = "prices";
const PRICE_SYNC_STATUS_COLUMN: Record<string, string> = {
  idle: "idle",
  running: "running",
  waiting: "running",
  paused: "partial",
  completed: "succeeded",
  problem: "failed",
};

/** The progress of a price run, readable by whichever instance is asked for it. */
export function createPriceSyncStateRepository(
  db: Database,
  userId: string | undefined | null,
): PriceSyncStateRepository {
  const tenantId = requireUserId(userId);
  return {
    async get() {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT state FROM investing.sync_state WHERE broker = $1",
          [PRICE_SYNC_KEY],
        );
        const state = result.rows[0]?.state as Record<string, unknown> | undefined;
        // A row written before this repository existed holds `{}`, which is not progress.
        return state && Object.keys(state).length > 0 ? state : null;
      });
    },
    async put(progress, status, leaseId) {
      return withTenantStatement(db, tenantId, async (client) => {
        if (!leaseId) throw new Error("Price progress write requires a lease");
        const result = await client.query<QueryResultRow>(
          "UPDATE investing.sync_state SET status = $2, state = $3::jsonb, updated_at = CURRENT_TIMESTAMP, last_succeeded_at = CASE WHEN $2 = 'succeeded' THEN CURRENT_TIMESTAMP ELSE last_succeeded_at END, last_error = CASE WHEN $2 = 'failed' THEN $5 ELSE NULL END WHERE broker = $1 AND state->>'leaseId' = $4 RETURNING state",
          [
            PRICE_SYNC_KEY,
            PRICE_SYNC_STATUS_COLUMN[status] ?? "idle",
            JSON.stringify(progress),
            leaseId,
            (progress as { problems?: unknown }).problems instanceof Array
              ? (progress as { problems: unknown[] }).problems.join("; ")
              : null,
          ],
        );
        return result.rows.length > 0;
      });
    },
    async claim(progress, status, staleBefore) {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `WITH claimed AS (
             INSERT INTO investing.sync_state (user_id, broker, status, state, last_started_at)
             VALUES (current_setting('app.user_id'), $1, $2, $3::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id, broker) DO UPDATE
               SET status = EXCLUDED.status,
                   state = EXCLUDED.state,
                   last_started_at = CURRENT_TIMESTAMP,
                   updated_at = CURRENT_TIMESTAMP,
                   last_error = NULL
             WHERE NOT (
               investing.sync_state.state->>'status' IN ('running', 'waiting')
               AND investing.sync_state.state->>'updatedAt' IS NOT NULL
               AND (investing.sync_state.state->>'updatedAt')::timestamptz >= $4::timestamptz
             )
             RETURNING state, true AS claimed
           )
           SELECT state, claimed FROM claimed
           UNION ALL
           SELECT state, false AS claimed
           FROM investing.sync_state
           WHERE broker = $1 AND NOT EXISTS (SELECT 1 FROM claimed)
           LIMIT 1`,
          [
            PRICE_SYNC_KEY,
            PRICE_SYNC_STATUS_COLUMN[status] ?? "running",
            JSON.stringify(progress),
            staleBefore,
          ],
        );
        const row = result.rows[0];
        return row?.claimed ? null : (row?.state ?? null);
      });
    },
  };
}

export type AgentRunRow = {
  id: string;
  agentId?: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "done" | "error";
  summary: string | null;
  error: string | null;
  result?: unknown;
};

const AGENT_STATUS_TO_COLUMN = { running: "running", done: "succeeded", error: "failed" } as const;
const AGENT_STATUS_FROM_COLUMN: Record<string, AgentRunRow["status"]> = {
  running: "running",
  queued: "running",
  succeeded: "done",
  failed: "error",
  cancelled: "error",
};

/** Only the latest run per user is kept; this is operational state, not history. */
export function createAgentRunRepository(db: Database, userId: string | undefined | null) {
  const tenantId = requireUserId(userId);
  return {
    async get(): Promise<AgentRunRow | null> {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT run_id, status, run_result, started_at, finished_at FROM investing.agent_runs",
        );
        const row = result.rows[0];
        if (!row) return null;
        const runResult = (row.run_result ?? {}) as {
          agentId?: string | null;
          summary?: string | null;
          error?: string | null;
          result?: unknown;
        };
        return {
          id: row.run_id as string,
          agentId: runResult.agentId ?? undefined,
          startedAt: isoDate(row.started_at) ?? new Date(0).toISOString(),
          finishedAt: isoDate(row.finished_at),
          status: AGENT_STATUS_FROM_COLUMN[row.status as string] ?? "error",
          summary: runResult.summary ?? null,
          error: runResult.error ?? null,
          result: runResult.result,
        };
      });
    },
    async start(record: AgentRunRow): Promise<boolean> {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query(
          "INSERT INTO investing.agent_runs (user_id, run_id, status, run_result, started_at, finished_at) VALUES (current_setting('app.user_id'), $1, $2, $3::jsonb, $4, $5) ON CONFLICT (user_id) DO UPDATE SET run_id = EXCLUDED.run_id, status = EXCLUDED.status, run_result = EXCLUDED.run_result, started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at, updated_at = CURRENT_TIMESTAMP WHERE investing.agent_runs.started_at < EXCLUDED.started_at RETURNING run_id",
          [
            record.id,
            AGENT_STATUS_TO_COLUMN[record.status],
            JSON.stringify({
              agentId: record.agentId,
              summary: record.summary,
              error: record.error,
              result: record.result,
            }),
            record.startedAt,
            record.finishedAt,
          ],
        );
        return result.rows.length > 0;
      });
    },
    async finish(record: AgentRunRow): Promise<boolean> {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query(
          "UPDATE investing.agent_runs SET status = $2, run_result = $3::jsonb, finished_at = $4, updated_at = CURRENT_TIMESTAMP WHERE run_id = $1 AND status = 'running' RETURNING run_id",
          [
            record.id,
            AGENT_STATUS_TO_COLUMN[record.status],
            JSON.stringify({
              agentId: record.agentId,
              summary: record.summary,
              error: record.error,
              result: record.result,
            }),
            record.finishedAt,
          ],
        );
        return result.rows.length > 0;
      });
    },
  };
}

export type OpaqueVaultRow = { blob: Buffer; updatedAt: string };

/* The version token a conditional write is compared against.
 *
 * It has to come back out of Postgres at the precision it went in at.
 * `timestamptz` keeps microseconds and `Date.toISOString()` only keeps
 * milliseconds, so reading the column through a JS Date and sending it back
 * lands three digits short of the stored value — and then `updated_at = $2`
 * never matches and every conditional write reads as a conflict. Formatting in
 * SQL keeps it exact, and the client only ever echoes it back. */
const VAULT_VERSION = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;
export type OpaqueVaultWrite = { status: "stored"; updatedAt: string } | { status: "conflict" };

/**
 * The personal vault as bytes the server cannot read.
 *
 * `encryptBlob` uses the SERVER's key, which is right for data the server has to
 * act on — broker credentials it must present to a broker. Personal finances are
 * not that: the browser encrypts them with a key derived from the user's own
 * passphrase, and this only holds the result. There is deliberately no
 * `encryptBlob` here — if a later change needs one, that is a decision to
 * re-open, not a line to add.
 *
 * A `createVaultRepository` that sealed this table with the server's key used to
 * sit above. It was wired to nothing, but an exported function that decrypts
 * personal vaults server-side is one import away from making the promise below
 * false, so it was deleted rather than left for someone to find and use.
 *
 * Writes are conditional on the copy the client last saw. Two devices holding
 * different vaults is a real situation, and last-write-wins would silently
 * destroy one of them, so a stale write is refused instead.
 */
export function createOpaqueVaultRepository(db: Database, userId: string | undefined | null) {
  const tenantId = requireUserId(userId);
  return {
    async get(): Promise<OpaqueVaultRow | null> {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `SELECT vault_blob, ${VAULT_VERSION} FROM personal.vaults`,
        );
        const row = result.rows[0];
        return row
          ? { blob: Buffer.from(row.vault_blob as Buffer), updatedAt: row.updated_at as string }
          : null;
      });
    },
    /** `expectedUpdatedAt` is the copy the client is replacing; `null` means it believes there is none. */
    async put(blob: Buffer, expectedUpdatedAt: string | null): Promise<OpaqueVaultWrite> {
      if (blob.length === 0) throw new Error("Vault blob is empty");
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `INSERT INTO personal.vaults (user_id, vault_blob) VALUES (current_setting('app.user_id'), $1) ON CONFLICT (user_id) DO UPDATE SET vault_blob = EXCLUDED.vault_blob, updated_at = CURRENT_TIMESTAMP WHERE personal.vaults.updated_at = $2::timestamptz RETURNING ${VAULT_VERSION}`,
          [blob, expectedUpdatedAt],
        );
        const row = result.rows[0];
        return row
          ? { status: "stored", updatedAt: row.updated_at as string }
          : { status: "conflict" };
      });
    },
    /** Replace whatever the server holds. Only for a user who has been shown the conflict and chose. */
    async overwrite(blob: Buffer): Promise<{ updatedAt: string }> {
      if (blob.length === 0) throw new Error("Vault blob is empty");
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `INSERT INTO personal.vaults (user_id, vault_blob) VALUES (current_setting('app.user_id'), $1) ON CONFLICT (user_id) DO UPDATE SET vault_blob = EXCLUDED.vault_blob, updated_at = CURRENT_TIMESTAMP RETURNING ${VAULT_VERSION}`,
          [blob],
        );
        return { updatedAt: result.rows[0]?.updated_at as string };
      });
    },
  };
}

/* The nine tables that hold anything belonging to a person. Deliberately a
 * literal list rather than a query over the catalogue: a table added later
 * should have to be considered here by a human, not silently swept up or —
 * worse — silently missed. Order is child-before-parent; nothing here has a
 * foreign key to another, but that stops being true the moment one is added. */
const USER_DATA_TABLES = [
  "personal.eb_sessions",
  "personal.eb_pending_auth",
  "personal.n8n_forwarding",
  "investing.agent_runs",
  "investing.sync_state",
  "investing.preferences",
  "investing.price_bars",
  "investing.broker_vaults",
  // After the tables above: deleting their rows raises this user's dashboard version.
  "investing.dashboard_snapshots",
  "investing.dashboard_sources",
  "personal.vaults",
] as const;

export type ErasureReport = { table: string; rows: number }[];

/**
 * Erase everything this deployment stores about one person (GDPR art. 17).
 *
 * Until this existed there was exactly one `DELETE` in this file and it emptied
 * the price cache. Encryption was doing the privacy work, and encryption is a
 * mitigation, not a lawful basis: a user asking to be forgotten could not be,
 * because nothing could remove their rows.
 *
 * It runs in ONE transaction inside `withTenant`, and every DELETE below
 * carries an explicit `WHERE user_id = $1`. RLS is a second belt, not the
 * only one: `personal.eb_pending_auth` deliberately has no RLS policy at all
 * (`0003_eb_flow.sql`), so an unqualified `DELETE FROM` against it would
 * empty every user's pending bank authorisations, not just this one's.
 * Either all eight tables are cleared or none are; a half-erased account
 * is worse than a failed request, because the caller is told they are gone.
 *
 * It returns what it deleted per table. An erasure you cannot evidence is one
 * you cannot answer a regulator about, and "0 rows" is a legitimate result that
 * needs to be distinguishable from "never ran".
 *
 * NOTE: this clears application data. The Better Auth identity itself (the user
 * and session rows from `0002_auth.sql`) is separate and must be deleted
 * through Better Auth, or the person is forgotten but can still sign in.
 */
export async function eraseUserData(
  db: Database,
  userId: string | undefined | null,
): Promise<ErasureReport> {
  const identity = requireUserId(userId);
  return withTenant(db, identity, async (client) => {
    const report: ErasureReport = [];
    for (const table of USER_DATA_TABLES) {
      const result = await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [identity]);
      report.push({ table, rows: result.rowCount ?? 0 });
    }
    return report;
  });
}

export type PendingEbAuth = { userId: string; name: string; country: string };

/**
 * The Enable Banking authorisation flow's two stores.
 *
 * `pending` is read WITHOUT a tenant, on purpose. The callback is a cross-site
 * redirect from the bank and may arrive with no session cookie; the state is
 * what authenticates it — server-issued, unguessable, single-use, minutes long
 * — and the row is where the user's identity comes back from. It is the one
 * place in this file that queries outside `withTenant`, and it holds nothing
 * financial: a bank name, a country, and who started the flow.
 *
 * `sessions` holds the account list the bank returned, which IS personal data,
 * so it is written under the user the state named and read back inside
 * `withTenant` where RLS applies.
 */
export function createEbFlowRepository(db: Database) {
  return {
    /** Record a started authorisation. Called for an authenticated user. */
    async startAuth(state: string, pending: PendingEbAuth): Promise<void> {
      const identity = requireUserId(pending.userId);
      await withTenantStatement(db, identity, async (client) => {
        await client.query(
          "INSERT INTO personal.eb_pending_auth (state, user_id, aspsp_name, aspsp_country) VALUES ($1, $2, $3, $4)",
          [state, identity, pending.name, pending.country],
        );
      });
    },

    /**
     * Take the pending authorisation, or nothing.
     *
     * One shot: the DELETE ... RETURNING is the read, so two callbacks racing
     * the same state cannot both win — a replay gets nothing rather than a
     * second exchange. Expired rows are refused by the same statement, so a
     * stale state is indistinguishable from an unknown one, which is what a
     * caller should be told anyway.
     */
    async consumeAuth(state: string, ttlMs: number): Promise<PendingEbAuth | null> {
      if (!state.trim()) return null;
      const client = await db.connect();
      try {
        const result = await client.query<QueryResultRow>(
          "DELETE FROM personal.eb_pending_auth WHERE state = $1 AND created_at > CURRENT_TIMESTAMP - ($2::bigint * INTERVAL '1 millisecond') RETURNING user_id, aspsp_name, aspsp_country",
          [state, String(ttlMs)],
        );
        const row = result.rows[0];
        return row
          ? {
              userId: row.user_id as string,
              name: row.aspsp_name as string,
              country: row.aspsp_country as string,
            }
          : null;
      } finally {
        client.release();
      }
    },

    /** Housekeeping: drop authorisations nobody came back for. */
    async sweepAuth(ttlMs: number): Promise<void> {
      const client = await db.connect();
      try {
        await client.query(
          "DELETE FROM personal.eb_pending_auth WHERE created_at <= CURRENT_TIMESTAMP - ($1::bigint * INTERVAL '1 millisecond')",
          [String(ttlMs)],
        );
      } finally {
        client.release();
      }
    },

    /**
     * Housekeeping: drop this user's own stale sessions — ones the app never
     * came back to collect. Unlike `sweepAuth`, this cannot run table-wide:
     * `personal.eb_sessions` carries FORCE ROW LEVEL SECURITY and the runtime
     * role has no BYPASSRLS, so an unscoped DELETE would only ever reach the
     * caller's own rows anyway. Called per-tenant, inside the request that
     * already runs as that user.
     */
    async sweepSessions(userId: string, ttlMs: number): Promise<number> {
      const identity = requireUserId(userId);
      return withTenantStatement(db, identity, async (client) => {
        const result = await client.query(
          "DELETE FROM personal.eb_sessions WHERE created_at <= CURRENT_TIMESTAMP - ($1::bigint * INTERVAL '1 millisecond')",
          [String(ttlMs)],
        );
        return result.rowCount ?? 0;
      });
    },

    /** Stash the bank's account list for the user the state named. */
    async putSession(userId: string, sessionId: string, payload: unknown): Promise<void> {
      const identity = requireUserId(userId);
      const blob = encryptBlob(payload);
      await withTenantStatement(db, identity, async (client) => {
        await client.query(
          "INSERT INTO personal.eb_sessions (session_id, user_id, payload_blob) VALUES ($1, $2, $3) ON CONFLICT (session_id) DO UPDATE SET payload_blob = EXCLUDED.payload_blob",
          [sessionId, identity, blob],
        );
      });
    },

    /** Read it back for its owner. RLS means another user's id finds nothing. */
    async getSession<T>(userId: string, sessionId: string, ttlMs: number): Promise<T | null> {
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT payload_blob FROM personal.eb_sessions WHERE session_id = $1 AND created_at > CURRENT_TIMESTAMP - ($2::bigint * INTERVAL '1 millisecond')",
          [sessionId, String(ttlMs)],
        );
        const row = result.rows[0];
        if (!row) return null;
        const payload = tryDecryptBlob<T>(row.payload_blob as Buffer);
        return payload.readable ? payload.value : null;
      });
    },

    /** Every live connection this user has, newest first.
     *
     *  Exists so the browser never has to hold a session id to refresh: it asks
     *  the server what it is connected to, and the server answers from rows
     *  that RLS already scopes to the caller. */
    async listSessions<T>(
      userId: string,
      ttlMs: number,
      limit = 25,
    ): Promise<Array<{ sessionId: string; payload: T; createdAt: string }>> {
      const identity = requireUserId(userId);
      return withTenantStatement(db, identity, async (client) => {
        /* `user_id = $1` AS WELL AS RLS, and deliberately belt-and-braces —
         * the same call this file's `eraseUserData` makes, for the same
         * reason: RLS is a second belt, not the only one. It matters more here
         * than on `getSession`, which at least needs an unguessable id to say
         * anything: this query returns EVERY row it is allowed to see, so a
         * misconfigured DATABASE_URL naming an owner-class role (which
         * bypasses even FORCE'd RLS) would hand one caller every tenant's bank
         * list in a single request.
         *
         * LIMIT because nothing else bounds this. Every reconnect mints a new
         * session_id and `putSession` upserts on that id alone, so a user who
         * reconnects repeatedly accumulates rows, and the refresh path calls
         * the bank once per account per row. */
        const result = await client.query<QueryResultRow>(
          "SELECT session_id, payload_blob, created_at FROM personal.eb_sessions WHERE user_id = $1 AND created_at > CURRENT_TIMESTAMP - ($2::bigint * INTERVAL '1 millisecond') ORDER BY created_at DESC LIMIT $3",
          [identity, String(ttlMs), limit],
        );
        const out: Array<{ sessionId: string; payload: T; createdAt: string }> = [];
        for (const row of result.rows) {
          const payload = tryDecryptBlob<T>(row.payload_blob as Buffer);
          // An unreadable blob is skipped, not thrown: one row written under a
          // key we no longer hold must not take the whole list down with it.
          if (payload.readable)
            out.push({
              sessionId: String(row.session_id),
              payload: payload.value,
              createdAt: new Date(row.created_at as string).toISOString(),
            });
        }
        return out;
      });
    },

    /** Drop one connection — the owner disconnecting, or a dead consent. */
    async deleteSession(userId: string, sessionId: string): Promise<void> {
      await withTenantStatement(db, userId, async (client) => {
        await client.query("DELETE FROM personal.eb_sessions WHERE session_id = $1", [sessionId]);
      });
    },
  };
}

export type AiUsage = {
  day: string; // "YYYY-MM-DD"
  route: "categorize" | "extract-invoice" | "chat" | "travel" | "portfolio-persona";
  model: string;
  inputTokens: number;
  outputTokens: number;
  pages: number;
  searches: number;
  costCents: number;
};

export type AiBudgetReservation = { ok: true; id: number } | { ok: false; scope: "day" | "month" };

/* How long an unreconciled reservation still counts toward the cap. Wide
 * enough that no call actually in flight can ever age out from under itself —
 * mistral.ts's own SEARCH_TIMEOUT_MS ceiling is 240s, so this clears it with
 * a 2.5x margin — narrow enough that a reservation orphaned by a hard crash
 * (nothing left alive to release it) self-heals well within the same day
 * instead of squatting on the cap until midnight. See 0009_ai_usage_reservation.sql. */
const RESERVATION_FRESH_SQL =
  "(reconciled_at IS NOT NULL OR reserved_at IS NULL OR reserved_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes')";

/**
 * The internal AI-spend ledger (`personal.ai_usage`), read and written by the
 * budget guard in front of the four `/api/agent/*` routes. Not tenant data —
 * one Mistral key, one owner's aggregate spend — so this uses `db.connect()`
 * directly, the same shape as `createEbFlowRepository`'s non-tenant methods.
 */
export function createAiUsageRepository(db: Database) {
  return {
    /** Atomically checks BOTH caps against worst case and, if there is room,
     *  inserts a placeholder row at that worst-case price — the check and the
     *  charge are one statement's transaction, so two callers racing each
     *  other can never both read "under cap" before either has written
     *  anything, which is the whole bug this closes (see budget.ts's own
     *  former comment on checkBudget()/recordUsage() not being atomic).
     *
     *  `pg_advisory_xact_lock` serializes every reservation attempt for the
     *  same month behind one lock (day is a subset of month, so this also
     *  covers the day cap), auto-released on COMMIT or ROLLBACK — a crashed
     *  client can never leave it held. Locking on month rather than day means
     *  a request landing right at midnight still serializes against the
     *  request just before it. */
    async reserve(params: {
      day: string;
      month: string;
      route: AiUsage["route"];
      worstCaseCents: number;
      dayCapCents: number;
      monthCapCents: number;
    }): Promise<AiBudgetReservation> {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `ai_budget:${params.month}`,
        ]);
        const dayResult = await client.query<QueryResultRow>(
          `SELECT COALESCE(SUM(cost_cents), 0)::int AS total FROM personal.ai_usage
           WHERE day = $1 AND ${RESERVATION_FRESH_SQL}`,
          [params.day],
        );
        const dayCents = Number(dayResult.rows[0]?.total ?? 0);
        if (dayCents + params.worstCaseCents >= params.dayCapCents) {
          await client.query("ROLLBACK");
          return { ok: false, scope: "day" };
        }
        const monthResult = await client.query<QueryResultRow>(
          `SELECT COALESCE(SUM(cost_cents), 0)::int AS total FROM personal.ai_usage
           WHERE to_char(day, 'YYYY-MM') = $1 AND ${RESERVATION_FRESH_SQL}`,
          [params.month],
        );
        const monthCents = Number(monthResult.rows[0]?.total ?? 0);
        if (monthCents + params.worstCaseCents >= params.monthCapCents) {
          await client.query("ROLLBACK");
          return { ok: false, scope: "month" };
        }
        const inserted = await client.query<QueryResultRow>(
          `INSERT INTO personal.ai_usage (day, route, model, cost_cents, reserved_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING id`,
          [params.day, params.route, "pending", params.worstCaseCents],
        );
        await client.query("COMMIT");
        return { ok: true, id: Number(inserted.rows[0]!.id) };
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },

    /** Turns a reservation into the real, final record — same row, so the
     *  cap's accounting for this call goes from "worst case" to "actual" in
     *  place rather than adding a second row on top of the first. A no-op
     *  once the row is already reconciled (or already released out from
     *  under it), which is what makes calling this safe even from a path
     *  that cannot know whether a release already ran. */
    async reconcile(usage: Omit<AiUsage, "day" | "route"> & { id: number }): Promise<void> {
      const client = await db.connect();
      try {
        await client.query(
          `UPDATE personal.ai_usage
           SET model = $2, input_tokens = $3, output_tokens = $4, pages = $5, searches = $6,
               cost_cents = $7, reconciled_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND reconciled_at IS NULL`,
          [
            usage.id,
            usage.model,
            usage.inputTokens,
            usage.outputTokens,
            usage.pages,
            usage.searches,
            usage.costCents,
          ],
        );
      } finally {
        client.release();
      }
    },

    /** The call this reservation was holding room for never reached
     *  `reconcile` — it threw first. Deletes the placeholder row rather than
     *  reconciling it to 0, so a failed call leaves exactly the same trace it
     *  left before this reservation step existed: none. Guarded the same way
     *  as `reconcile`, so whichever of the two runs first on a given row
     *  wins and the other is a no-op. */
    async release(id: number): Promise<void> {
      const client = await db.connect();
      try {
        await client.query(
          "DELETE FROM personal.ai_usage WHERE id = $1 AND reconciled_at IS NULL",
          [id],
        );
      } finally {
        client.release();
      }
    },

    async record(usage: AiUsage): Promise<void> {
      const client = await db.connect();
      try {
        await client.query(
          "INSERT INTO personal.ai_usage (day, route, model, input_tokens, output_tokens, pages, searches, cost_cents) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [
            usage.day,
            usage.route,
            usage.model,
            usage.inputTokens,
            usage.outputTokens,
            usage.pages,
            usage.searches,
            usage.costCents,
          ],
        );
      } finally {
        client.release();
      }
    },

    async spentCents(range: { day: string; month: string }): Promise<{
      dayCents: number;
      monthCents: number;
    }> {
      const client = await db.connect();
      try {
        const dayResult = await client.query<QueryResultRow>(
          `SELECT COALESCE(SUM(cost_cents), 0)::int AS total FROM personal.ai_usage
           WHERE day = $1 AND ${RESERVATION_FRESH_SQL}`,
          [range.day],
        );
        const monthResult = await client.query<QueryResultRow>(
          `SELECT COALESCE(SUM(cost_cents), 0)::int AS total FROM personal.ai_usage
           WHERE to_char(day, 'YYYY-MM') = $1 AND ${RESERVATION_FRESH_SQL}`,
          [range.month],
        );
        return {
          dayCents: Number(dayResult.rows[0]?.total ?? 0),
          monthCents: Number(monthResult.rows[0]?.total ?? 0),
        };
      } finally {
        client.release();
      }
    },
  };
}

export type N8nForwardingWrite =
  | { status: "stored"; localPart: string }
  | { status: "invalid" }
  | { status: "taken" };

/* `ON CONFLICT (user_id)` in setLocalPart's INSERT covers the primary key,
 * not local_part's own unique index — a taken local part reaches Postgres as
 * a unique-violation error instead of triggering the upsert. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

/**
 * Where each user's invoice-forwarding local part lives.
 *
 * n8n partitions its invoice queue by `queueKey` — the local part of the
 * address a forwarded invoice mail arrived on (packages/core/src/n8n/queue.js).
 * The browser used to send that key itself; the server now derives it from the
 * caller's session and this table is where it looks it up
 * (docs/adr/0006-invoice-queue-server-proxy.md). At most one row per user
 * (`user_id` is the primary key), and `local_part` carries its own UNIQUE
 * index — two users sharing a local part would each drain the other's queue,
 * so the database refuses that before it can ever happen.
 */
export function createN8nForwardingRepository(db: Database) {
  return {
    /** The caller's own local part, or null when none is recorded yet. RLS
     *  means another user's row is invisible here regardless of what `userId`
     *  claims — but callers must still pass the SESSION's id, never one a
     *  request supplied. */
    async getLocalPart(userId: string | undefined | null): Promise<string | null> {
      const identity = requireUserId(userId);
      return withTenantStatement(db, identity, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT local_part FROM personal.n8n_forwarding WHERE user_id = $1",
          [identity],
        );
        return (result.rows[0]?.local_part as string | undefined) ?? null;
      });
    },

    /** Record or replace the caller's own local part. The write path for
     *  `apps/server/src/n8n-routes.ts`'s `POST /api/n8n/forward-address`. */
    async setLocalPart(
      userId: string | undefined | null,
      localPart: string,
    ): Promise<N8nForwardingWrite> {
      const identity = requireUserId(userId);
      /* SAME CANONICAL FORM THE COLUMN ENFORCES, applied here so an ordinary
       * copy-paste does not become a constraint violation the caller has to
       * interpret. Lowercase, because the email worker lowercases when it
       * decides which n8n bucket a mail goes into and n8n does not lowercase
       * when it reads one back — a capitalised row and its lowercase twin are
       * two rows here and one bucket there, and the one that matches drains
       * the other's invoices. The CHECK stays the backstop for every writer
       * that is not this function. */
      const trimmed = localPart.trim().toLowerCase();
      if (!/^[a-z0-9._%+-]{1,120}$/.test(trimmed)) return { status: "invalid" };
      try {
        await withTenantStatement(db, identity, async (client) => {
          await client.query(
            "INSERT INTO personal.n8n_forwarding (user_id, local_part) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET local_part = EXCLUDED.local_part, updated_at = CURRENT_TIMESTAMP",
            [identity, trimmed],
          );
        });
      } catch (err) {
        if (isUniqueViolation(err)) return { status: "taken" };
        throw err;
      }
      return { status: "stored", localPart: trimmed };
    },
  };
}
