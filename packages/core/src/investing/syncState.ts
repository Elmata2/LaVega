import { Schema } from "effect";

const VaultStatus = Schema.Literals(["empty", "locked", "unlocked"]);
const RunOutcome = Schema.Literals(["done", "stopped-at-hop-limit", "failed"]);

const lanePhaseFields = <Status extends "idle" | "running" | "waiting" | "completed" | "problem">(
  status: Status,
) =>
  ({
    status: Schema.Literal(status),
    /** ISO timestamp of the last successful completion of this lane. */
    syncedAt: Schema.NullOr(Schema.String),
    /** ISO timestamp before which the lane must not run again; only populated while waiting. */
    waitUntil: status === "waiting" ? Schema.NullOr(Schema.String) : Schema.Null,
    message: Schema.NullOr(Schema.String),
  }) as const;

const IdleLaneState = Schema.Struct(lanePhaseFields("idle"));
const RunningLaneState = Schema.Struct(lanePhaseFields("running"));
const WaitingLaneState = Schema.Struct(lanePhaseFields("waiting"));
const CompletedLaneState = Schema.Struct(lanePhaseFields("completed"));
const ProblemLaneState = Schema.Struct(lanePhaseFields("problem"));

/** One lane as the dashboard needs it: per-phase discriminated union on `status`. */
export const LaneState = Schema.Union([
  IdleLaneState,
  RunningLaneState,
  WaitingLaneState,
  CompletedLaneState,
  ProblemLaneState,
]);
export type LaneState = typeof LaneState.Type;

const holdingsPhase = <Status extends "idle" | "running" | "waiting" | "completed" | "problem">(
  status: Status,
) =>
  Schema.Struct({
    ...lanePhaseFields(status),
    positionsRead: Schema.Number,
  });

/** Holdings carries one counter the dashboard already shows: how many positions
 *  the last read found. Per-phase discriminated union on `status`. */
export const HoldingsState = Schema.Union([
  holdingsPhase("idle"),
  holdingsPhase("running"),
  holdingsPhase("waiting"),
  holdingsPhase("completed"),
  holdingsPhase("problem"),
]);
export type HoldingsState = typeof HoldingsState.Type;

const historyPhase = <Status extends "idle" | "running" | "waiting" | "completed" | "problem">(
  status: Status,
) =>
  Schema.Struct({
    ...lanePhaseFields(status),
    pages: Schema.Number,
    ordersRead: Schema.Number,
    historyProgress: Schema.NullOr(Schema.Unknown),
  });

export const HistoryState = Schema.Union([
  historyPhase("idle"),
  historyPhase("running"),
  historyPhase("waiting"),
  historyPhase("completed"),
  historyPhase("problem"),
]);
export type HistoryState = typeof HistoryState.Type;

const pricesPhase = <Status extends "idle" | "running" | "waiting" | "completed" | "problem">(
  status: Status,
) =>
  Schema.Struct({
    ...lanePhaseFields(status),
    total: Schema.Number,
    completed: Schema.Number,
    currentSymbol:
      status === "running" || status === "problem" ? Schema.NullOr(Schema.String) : Schema.Null,
    remainingSymbols: Schema.Array(Schema.String),
  });

/** `remainingSymbols` keeps the "still loading" line honest without a second
 *  route: the price row already knows the queue, so the state body carries it. */
export const PricesState = Schema.Union([
  pricesPhase("idle"),
  pricesPhase("running"),
  pricesPhase("waiting"),
  pricesPhase("completed"),
  pricesPhase("problem"),
]);
export type PricesState = typeof PricesState.Type;

const ActiveRunInfo = Schema.Struct({
  id: Schema.String,
  hop: Schema.Number,
  outcome: Schema.Null,
});

const InactiveRunInfo = Schema.Union([
  Schema.Struct({
    id: Schema.Null,
    hop: Schema.Literal(0),
    outcome: Schema.Null,
  }),
  Schema.Struct({
    id: Schema.String,
    hop: Schema.Number,
    outcome: Schema.Null,
  }),
  Schema.Struct({
    id: Schema.String,
    hop: Schema.Number,
    outcome: RunOutcome,
  }),
]);

const sharedRunStateFields = {
  vault: VaultStatus,
  holdings: HoldingsState,
  history: HistoryState,
  prices: PricesState,
  problems: Schema.Array(Schema.String),
} as const;

const ActiveSyncRunState = Schema.Struct({
  active: Schema.Literal(true),
  ...sharedRunStateFields,
  run: ActiveRunInfo,
});

const InactiveSyncRunState = Schema.Struct({
  active: Schema.Literal(false),
  ...sharedRunStateFields,
  run: InactiveRunInfo,
});

/** `GET /api/sync/state`: the one read a browser needs while a run is active. */
export const SyncRunState = Schema.Union([ActiveSyncRunState, InactiveSyncRunState]);
export type SyncRunStateView = typeof SyncRunState.Type;

const ActiveSyncRefreshState = Schema.Struct({
  active: Schema.Literal(true),
  claimed: Schema.Boolean,
  ...sharedRunStateFields,
  run: ActiveRunInfo,
});

const InactiveSyncRefreshState = Schema.Struct({
  active: Schema.Literal(false),
  claimed: Schema.Literal(false),
  ...sharedRunStateFields,
  run: InactiveRunInfo,
});

/** `POST /api/sync/refresh` answers the same body plus whether this call owns the run. */
export const SyncRefreshState = Schema.Union([ActiveSyncRefreshState, InactiveSyncRefreshState]);
export type SyncRefreshState = typeof SyncRefreshState.Type;

export const decodeSyncRunState = Schema.decodeUnknownSync(SyncRunState);
export const decodeSyncRefreshState = Schema.decodeUnknownSync(SyncRefreshState);
