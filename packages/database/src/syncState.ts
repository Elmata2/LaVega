import type { QueryResultRow } from "@neondatabase/serverless";
import { requireUserId, withTenant, withTenantStatement, type Database } from "./connection.js";
import { encryptBlob, tryDecryptBlob } from "./crypto.js";

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

export type SyncRunRepository = {
  get(): Promise<unknown | null>;
  /** Writes the run state only while `leaseId` still owns it. */
  put(state: unknown, status: string, leaseId: string): Promise<boolean>;
  /** Atomic claim. Returns null when claimed, the live state when another run holds it. */
  claim(state: unknown, status: string, staleBefore: string): Promise<unknown | null>;
};

/* The server-owned run is a sync like any other: one row, keyed by what it
 * drives. `state.lease.heartbeatAt` is what makes a run live; a lease older
 * than the caller's staleBefore may be taken over. */
const SYNC_RUN_KEY = "run";
const SYNC_RUN_STATUS_COLUMN: Record<string, string> = {
  running: "running",
  waiting: "running",
  done: "succeeded",
  failed: "failed",
};

export function createSyncRunRepository(
  db: Database,
  userId: string | undefined | null,
): SyncRunRepository {
  const tenantId = requireUserId(userId);
  return {
    async get() {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT state FROM investing.sync_state WHERE broker = $1",
          [SYNC_RUN_KEY],
        );
        const state = result.rows[0]?.state as Record<string, unknown> | undefined;
        return state && Object.keys(state).length > 0 ? state : null;
      });
    },
    async put(state, status, leaseId) {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "UPDATE investing.sync_state SET status = $2, state = $3::jsonb, updated_at = CURRENT_TIMESTAMP, last_succeeded_at = CASE WHEN $2 = 'succeeded' THEN CURRENT_TIMESTAMP ELSE last_succeeded_at END, last_error = CASE WHEN $2 = 'failed' THEN $5 ELSE NULL END WHERE broker = $1 AND state->'lease'->>'id' = $4 RETURNING state",
          [
            SYNC_RUN_KEY,
            SYNC_RUN_STATUS_COLUMN[status] ?? "running",
            JSON.stringify(state),
            leaseId,
            (state as { outcome?: unknown }).outcome === "failed" ? "run failed" : null,
          ],
        );
        return result.rows.length > 0;
      });
    },
    async claim(state, status, staleBefore) {
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
             WHERE investing.sync_state.state->'lease'->>'heartbeatAt' IS NULL
                OR (investing.sync_state.state->'lease'->>'heartbeatAt')::timestamptz < $4::timestamptz
             RETURNING state, true AS claimed
           )
           SELECT state, claimed FROM claimed
           UNION ALL
           SELECT state, false AS claimed
           FROM investing.sync_state
           WHERE broker = $1 AND NOT EXISTS (SELECT 1 FROM claimed)
           LIMIT 1`,
          [
            SYNC_RUN_KEY,
            SYNC_RUN_STATUS_COLUMN[status] ?? "running",
            JSON.stringify(state),
            staleBefore,
          ],
        );
        const row = result.rows[0];
        return row?.claimed ? null : (row?.state ?? null);
      });
    },
  };
}
