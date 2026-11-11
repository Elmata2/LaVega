import { Schema } from "effect";

const LaneStatus = Schema.Literals(["idle", "running", "waiting", "completed", "problem"]);
const VaultStatus = Schema.Literals(["empty", "locked", "unlocked"]);
const RunOutcome = Schema.Literals(["done", "stopped-at-hop-limit", "failed"]);

/** One lane as the dashboard needs it: what it last proved, and what it waits for. */
export const LaneState = Schema.Struct({
  status: LaneStatus,
  /** ISO timestamp of the last successful completion of this lane. */
  syncedAt: Schema.NullOr(Schema.String),
  /** ISO timestamp before which the lane must not run again. */
  waitUntil: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
});
export type LaneState = typeof LaneState.Type;

/** `GET /api/sync/state`: the one read a browser needs while a run is active. */
export const SyncRunState = Schema.Struct({
  active: Schema.Boolean,
  vault: VaultStatus,
  holdings: LaneState,
  history: Schema.Struct({
    status: LaneStatus,
    syncedAt: Schema.NullOr(Schema.String),
    waitUntil: Schema.NullOr(Schema.String),
    message: Schema.NullOr(Schema.String),
    pages: Schema.Number,
    ordersRead: Schema.Number,
    historyProgress: Schema.NullOr(Schema.Unknown),
  }),
  prices: Schema.Struct({
    status: LaneStatus,
    syncedAt: Schema.NullOr(Schema.String),
    waitUntil: Schema.NullOr(Schema.String),
    message: Schema.NullOr(Schema.String),
    total: Schema.Number,
    completed: Schema.Number,
    currentSymbol: Schema.NullOr(Schema.String),
  }),
  problems: Schema.Array(Schema.String),
  run: Schema.Struct({
    id: Schema.NullOr(Schema.String),
    hop: Schema.Number,
    outcome: Schema.NullOr(RunOutcome),
  }),
});
export type SyncRunStateView = typeof SyncRunState.Type;

/** `POST /api/sync/refresh` answers the same body plus whether this call owns the run. */
export const SyncRefreshState = Schema.Struct({
  active: Schema.Boolean,
  vault: VaultStatus,
  holdings: LaneState,
  history: Schema.Struct({
    status: LaneStatus,
    syncedAt: Schema.NullOr(Schema.String),
    waitUntil: Schema.NullOr(Schema.String),
    message: Schema.NullOr(Schema.String),
    pages: Schema.Number,
    ordersRead: Schema.Number,
    historyProgress: Schema.NullOr(Schema.Unknown),
  }),
  prices: Schema.Struct({
    status: LaneStatus,
    syncedAt: Schema.NullOr(Schema.String),
    waitUntil: Schema.NullOr(Schema.String),
    message: Schema.NullOr(Schema.String),
    total: Schema.Number,
    completed: Schema.Number,
    currentSymbol: Schema.NullOr(Schema.String),
  }),
  problems: Schema.Array(Schema.String),
  run: Schema.Struct({
    id: Schema.NullOr(Schema.String),
    hop: Schema.Number,
    outcome: Schema.NullOr(RunOutcome),
  }),
  claimed: Schema.Boolean,
});
export type SyncRefreshState = typeof SyncRefreshState.Type;

export const decodeSyncRunState = Schema.decodeUnknownSync(SyncRunState);
export const decodeSyncRefreshState = Schema.decodeUnknownSync(SyncRefreshState);
