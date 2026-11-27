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

/** Discriminator tagging which of the 3 lifecycles owns a row in `investing.sync_state`. */
export type SyncStateLifecycleKind = "broker" | "prices" | "run";

export type SyncStateRow = {
  kind?: "broker";
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

const PRICE_SYNC_KEY = "prices";
const SYNC_RUN_KEY = "run";
const RESERVED_SYNC_KEYS = new Set<string>([PRICE_SYNC_KEY, SYNC_RUN_KEY]);

function assertBrokerKey(broker: string): void {
  if (RESERVED_SYNC_KEYS.has(broker)) {
    throw new Error(`Reserved sync_state key '${broker}' cannot be accessed as a broker`);
  }
}

type SyncStateSqlStatus = "idle" | "running" | "succeeded" | "failed" | "partial";

const BROKER_SYNC_STATUS_COLUMN: Record<SyncProgressRow["status"], SyncStateSqlStatus> = {
  idle: "idle",
  running: "running",
  waiting: "partial",
  completed: "succeeded",
  problem: "failed",
};

function brokerSyncStatusColumn(status: SyncProgressRow["status"]): SyncStateSqlStatus {
  return BROKER_SYNC_STATUS_COLUMN[status];
}

function tagLifecycle<K extends SyncStateLifecycleKind>(
  kind: K,
  value: unknown,
): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>), kind };
  }
  return { kind };
}

function readLifecycleRow(
  value: unknown,
  expectedKind: SyncStateLifecycleKind,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === 0) return null;
  if (record.kind !== undefined && record.kind !== expectedKind) return null;
  if ("kind" in record) {
    const { kind: _kind, ...rest } = record;
    return rest;
  }
  return record;
}

export function createSyncStateRepository(
  db: Database,
  userId: string | undefined | null,
): SyncStateRepository {
  const tenantId = requireUserId(userId);
  return {
    async get(broker) {
      assertBrokerKey(broker);
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT state FROM investing.sync_state WHERE broker = $1",
          [broker],
        );
        const state = readLifecycleRow(result.rows[0]?.state, "broker") as SyncStateRow | null;
        return state ?? { lastSyncedAt: null, retryAfter: null };
      });
    },
    async put(broker, state) {
      assertBrokerKey(broker);
      await withTenantStatement(db, tenantId, async (client) => {
        const { lease: _lease, ...withoutLease } = state;
        const tagged = tagLifecycle("broker", withoutLease);
        const sqlStatus = state.progress ? brokerSyncStatusColumn(state.progress.status) : "idle";
        await client.query(
          "INSERT INTO investing.sync_state (user_id, broker, status, state, last_succeeded_at) VALUES (current_setting('app.user_id'), $1, $4, $2::jsonb, $3) ON CONFLICT (user_id, broker) DO UPDATE SET status = EXCLUDED.status, state = EXCLUDED.state, last_succeeded_at = EXCLUDED.last_succeeded_at, updated_at = CURRENT_TIMESTAMP",
          [broker, JSON.stringify(tagged), state.lastSyncedAt, sqlStatus],
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
    const state = readLifecycleRow(value, "broker") as SyncStateRow | null;
    return state ?? EMPTY_SYNC_STATE;
  };
  return {
    async claim(broker, input) {
      assertBrokerKey(broker);
      return withTenant(db, tenantId, async (client) => {
        const lease: SyncLeaseRow = {
          id: input.leaseId,
          startedAt: input.progress.updatedAt ?? new Date().toISOString(),
          heartbeatAt: input.progress.updatedAt ?? new Date().toISOString(),
        };
        const claim = JSON.stringify({ kind: "broker", lease, progress: input.progress });
        const sqlStatus = brokerSyncStatusColumn(input.progress.status);
        /* The cursor already in the row is the whole point of resuming, so the
         * claim merges into it instead of replacing it. */
        const result = await client.query<QueryResultRow>(
          `WITH claimed AS (
             INSERT INTO investing.sync_state (user_id, broker, status, state, last_started_at)
             VALUES (current_setting('app.user_id'), $1, $4, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id, broker) DO UPDATE
               SET status = $4,
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
          [broker, claim, input.staleBefore, sqlStatus],
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
      assertBrokerKey(broker);
      if (!leaseId) return false;
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query(
          `UPDATE investing.sync_state
             SET status = $5,
                 state = state || jsonb_build_object(
                   'kind', 'broker',
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
            brokerSyncStatusColumn(progress.status),
          ],
        );
        return result.rows.length > 0;
      });
    },
    async progress(broker) {
      assertBrokerKey(broker);
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT state->'progress' AS progress FROM investing.sync_state WHERE broker = $1",
          [broker],
        );
        return (result.rows[0]?.progress as SyncProgressRow | null) ?? null;
      });
    },
    async commit(broker, input) {
      assertBrokerKey(broker);
      if (!input.leaseId) return false;
      const snapshotBlob = input.snapshot ? encryptBlob(input.snapshot.value) : null;
      const sqlStatus = brokerSyncStatusColumn(input.progress.status);
      const { lease: _lease, ...stateWithoutLease } = input.state;
      const committedState = tagLifecycle("broker", {
        ...stateWithoutLease,
        progress: input.progress,
      });
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
              sqlStatus,
              JSON.stringify(committedState),
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
      assertBrokerKey(broker);
      if (!leaseId) return;
      await withTenantStatement(db, tenantId, async (client) => {
        await client.query(
          `UPDATE investing.sync_state
             SET status = $4,
                 state = (state - 'lease') || jsonb_build_object('kind', 'broker', 'progress', $3::jsonb),
                 last_error = CASE WHEN $4 = 'failed' THEN $5 ELSE NULL END,
                 updated_at = CURRENT_TIMESTAMP
           WHERE broker = $1 AND state->'lease'->>'id' = $2`,
          [
            broker,
            leaseId,
            JSON.stringify(progress),
            brokerSyncStatusColumn(progress.status),
            progress.status === "problem" ? progress.message : null,
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

const PRICE_SYNC_STATUS_COLUMN: Record<string, SyncStateSqlStatus> = {
  idle: "idle",
  running: "running",
  waiting: "partial",
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
        return readLifecycleRow(result.rows[0]?.state, "prices");
      });
    },
    async put(progress, status, leaseId) {
      return withTenantStatement(db, tenantId, async (client) => {
        if (!leaseId) throw new Error("Price progress write requires a lease");
        const tagged = tagLifecycle("prices", progress);
        const result = await client.query<QueryResultRow>(
          "UPDATE investing.sync_state SET status = $2, state = $3::jsonb, updated_at = CURRENT_TIMESTAMP, last_succeeded_at = CASE WHEN $2 = 'succeeded' THEN CURRENT_TIMESTAMP ELSE last_succeeded_at END, last_error = CASE WHEN $2 = 'failed' THEN $5 ELSE NULL END WHERE broker = $1 AND state->>'leaseId' = $4 RETURNING state",
          [
            PRICE_SYNC_KEY,
            PRICE_SYNC_STATUS_COLUMN[status] ?? "idle",
            JSON.stringify(tagged),
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
        const tagged = tagLifecycle("prices", progress);
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
            JSON.stringify(tagged),
            staleBefore,
          ],
        );
        const row = result.rows[0];
        return row?.claimed ? null : readLifecycleRow(row?.state, "prices");
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

const SYNC_RUN_STATUS_COLUMN: Record<string, SyncStateSqlStatus> = {
  idle: "idle",
  running: "running",
  paused: "partial",
  waiting: "partial",
  done: "succeeded",
  "stopped-at-hop-limit": "partial",
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
        return readLifecycleRow(result.rows[0]?.state, "run");
      });
    },
    async put(state, status, leaseId) {
      return withTenantStatement(db, tenantId, async (client) => {
        if (!leaseId) throw new Error("Sync run write requires a lease");
        const tagged = tagLifecycle("run", state);
        const result = await client.query<QueryResultRow>(
          "UPDATE investing.sync_state SET status = $2, state = $3::jsonb, updated_at = CURRENT_TIMESTAMP, last_succeeded_at = CASE WHEN $2 = 'succeeded' THEN CURRENT_TIMESTAMP ELSE last_succeeded_at END, last_error = CASE WHEN $2 = 'failed' THEN $5 ELSE NULL END WHERE broker = $1 AND state->'lease'->>'id' = $4 RETURNING state",
          [
            SYNC_RUN_KEY,
            SYNC_RUN_STATUS_COLUMN[status] ?? "running",
            JSON.stringify(tagged),
            leaseId,
            (state as { outcome?: unknown }).outcome === "failed" ? "run failed" : null,
          ],
        );
        return result.rows.length > 0;
      });
    },
    async claim(state, status, staleBefore) {
      return withTenantStatement(db, tenantId, async (client) => {
        const tagged = tagLifecycle("run", state);
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
            JSON.stringify(tagged),
            staleBefore,
          ],
        );
        const row = result.rows[0];
        return row?.claimed ? null : readLifecycleRow(row?.state, "run");
      });
    },
  };
}
