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

/** Holdings carries one counter the dashboard already shows: how many positions
 *  the last read found. Additive on top of `LaneState`; a caller that only reads
 *  the lane fields is unaffected. */
const HoldingsState = Schema.Struct({
  status: LaneStatus,
  syncedAt: Schema.NullOr(Schema.String),
  waitUntil: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  positionsRead: Schema.Number,
});

const HistoryState = Schema.Struct({
  status: LaneStatus,
  syncedAt: Schema.NullOr(Schema.String),
  waitUntil: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  pages: Schema.Number,
  ordersRead: Schema.Number,
  historyProgress: Schema.NullOr(Schema.Unknown),
});

/** `remainingSymbols` keeps the "still loading" line honest without a second
 *  route: the price row already knows the queue, so the state body carries it. */
const PricesState = Schema.Struct({
  status: LaneStatus,
  syncedAt: Schema.NullOr(Schema.String),
  waitUntil: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  total: Schema.Number,
  completed: Schema.Number,
  currentSymbol: Schema.NullOr(Schema.String),
  remainingSymbols: Schema.Array(Schema.String),
});

const runStateFields = {
  active: Schema.Boolean,
  vault: VaultStatus,
  holdings: HoldingsState,
  history: HistoryState,
  prices: PricesState,
  problems: Schema.Array(Schema.String),
  run: Schema.Struct({
    id: Schema.NullOr(Schema.String),
    hop: Schema.Number,
    outcome: Schema.NullOr(RunOutcome),
  }),
} as const;

/** `GET /api/sync/state`: the one read a browser needs while a run is active. */
export const SyncRunState = Schema.Struct(runStateFields);
export type SyncRunStateView = typeof SyncRunState.Type;

/** `POST /api/sync/refresh` answers the same body plus whether this call owns the run. */
export const SyncRefreshState = Schema.Struct({ ...runStateFields, claimed: Schema.Boolean });
export type SyncRefreshState = typeof SyncRefreshState.Type;

export const decodeSyncRunState = Schema.decodeUnknownSync(SyncRunState);
export const decodeSyncRefreshState = Schema.decodeUnknownSync(SyncRefreshState);
