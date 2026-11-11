import {
  Cause,
  Clock,
  Context,
  DateTime,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Option,
  Schema,
} from "effect";
import { type PartnerKey, tableIntervalMs } from "./limits.js";

export type { PartnerKey } from "./limits.js";

/**
 * One durable request budget in front of every partner call (issue #305).
 *
 * Partner limits count per account and per source IP across all users. A
 * caller asks for a slot, waits for it, sends the request, then reports what
 * the partner said. The state is shared (Neon) on the hosted tier and local
 * (memory) elsewhere.
 */

/** The store cannot be reached. Callers must not send the partner request. */
export class PartnerBudgetUnavailable extends Schema.TaggedError<PartnerBudgetUnavailable>()(
  "PartnerBudgetUnavailable",
  { message: Schema.String },
) {}

/** The slot comes after the caller's deadline. `until` is the slot instant. */
export class PartnerWait extends Schema.TaggedError<PartnerWait>()("PartnerWait", {
  until: Schema.DateTimeUtc,
}) {}

/**
 * Limit headers of one successful response. The two pairs are independent:
 * `remaining` with `resetAt` can block the key, `intervalMs` alone changes the
 * spacing. A caller passes only the parts it could read.
 */
export type PartnerSeen = {
  remaining?: number;
  resetAt?: DateTime.Utc;
  intervalMs?: number;
};

const MAX_OBSERVED_INTERVAL_MS = 600_000;
const BLOCK_MARGIN_MS = 1_000;
/** A slot this close to the host deadline is not used: leave time to persist. */
export const DEADLINE_MARGIN_MS = 1_000;

export type PartnerObservation = { blockedUntilMs: number | null; intervalMs: number | null };

/** What `observe` stores. Shared by every layer, so memory and Neon agree. */
export function toObservation(seen: PartnerSeen): PartnerObservation {
  const intervalMs =
    seen.intervalMs !== undefined &&
    Number.isInteger(seen.intervalMs) &&
    seen.intervalMs >= 1 &&
    seen.intervalMs <= MAX_OBSERVED_INTERVAL_MS
      ? seen.intervalMs
      : null;
  const blockedUntilMs =
    seen.remaining === 0 && seen.resetAt !== undefined
      ? DateTime.toEpochMillis(seen.resetAt) + BLOCK_MARGIN_MS
      : null;
  return { blockedUntilMs, intervalMs };
}

export type PartnerIntervals = (key: PartnerKey) => number | undefined;

/** The persistence a hosted layer needs. Times are absolute instants. */
export type PartnerBudgetStore = {
  /** Takes the next slot. `intervalMs` is the table interval for the key. */
  reserve(key: PartnerKey, intervalMs: number): Promise<Date>;
  observe(key: PartnerKey, seen: PartnerObservation): Promise<void>;
  reject(key: PartnerKey, until: Date): Promise<void>;
};

type Row = { nextAt: number; blockedUntil: number | null; intervalMs: number | null };

const rowId = (key: PartnerKey) => JSON.stringify([key.partner, key.endpoint, key.scopeId]);

const intervalOrDie = (intervals: PartnerIntervals, key: PartnerKey) => {
  const intervalMs = intervals(key);
  return intervalMs === undefined
    ? Effect.die(new Error(`Partner key ${key.partner}:${key.endpoint} is not in the limit table`))
    : Effect.succeed(intervalMs);
};

export class PartnerBudget extends Context.Service<
  PartnerBudget,
  {
    /** Takes the next free slot for the key and returns its instant.
     *  The slot is consumed even if the caller does not use it. */
    readonly reserve: (key: PartnerKey) => Effect.Effect<DateTime.Utc, PartnerBudgetUnavailable>;
    /** Records limit headers of a successful response. */
    readonly observe: (
      key: PartnerKey,
      seen: PartnerSeen,
    ) => Effect.Effect<void, PartnerBudgetUnavailable>;
    /** Records a rejection (429, or 401/403 from Yahoo): no slot before `until`. */
    readonly reject: (
      key: PartnerKey,
      until: DateTime.Utc,
    ) => Effect.Effect<void, PartnerBudgetUnavailable>;
  }
>()("@lavega/adapters/partnerBudget/PartnerBudget") {
  /** Process-local budget for Docker, local runs and tests. Time comes from Effect `Clock`. */
  static readonly memoryLayer: Layer.Layer<PartnerBudget> = Layer.sync(PartnerBudget, () =>
    makeMemory(tableIntervalMs),
  );

  /** Memory layer with its own interval lookup, for keys outside the table. */
  static memoryLayerWith(intervals: PartnerIntervals): Layer.Layer<PartnerBudget> {
    return Layer.sync(PartnerBudget, () => makeMemory(intervals));
  }

  /** Layer over a durable store. Any store failure becomes `PartnerBudgetUnavailable`. */
  static storeLayer(
    store: PartnerBudgetStore,
    intervals: PartnerIntervals = tableIntervalMs,
  ): Layer.Layer<PartnerBudget> {
    return Layer.succeed(PartnerBudget, makeStore(store, intervals));
  }
}

function makeMemory(intervals: PartnerIntervals) {
  const rows = new Map<string, Row>();

  const reserve = Effect.fnUntraced(function* (key: PartnerKey) {
    const intervalMs = yield* intervalOrDie(intervals, key);
    const now = yield* Clock.currentTimeMillis;
    const id = rowId(key);
    const row = rows.get(id);
    if (row === undefined) {
      rows.set(id, { nextAt: now + intervalMs, blockedUntil: null, intervalMs: null });
      return DateTime.makeUnsafe(now);
    }
    const slot = Math.max(now, row.nextAt, row.blockedUntil ?? now);
    row.nextAt = slot + (row.intervalMs ?? intervalMs);
    return DateTime.makeUnsafe(slot);
  });

  const upsert = (key: PartnerKey, now: number): Row => {
    const id = rowId(key);
    const existing = rows.get(id);
    if (existing !== undefined) return existing;
    const created: Row = { nextAt: now, blockedUntil: null, intervalMs: null };
    rows.set(id, created);
    return created;
  };

  const block = (row: Row, untilMs: number | null) => {
    if (untilMs !== null) row.blockedUntil = Math.max(row.blockedUntil ?? untilMs, untilMs);
  };

  const observe = Effect.fnUntraced(function* (key: PartnerKey, seen: PartnerSeen) {
    const observation = toObservation(seen);
    const row = upsert(key, yield* Clock.currentTimeMillis);
    block(row, observation.blockedUntilMs);
    if (observation.intervalMs !== null) row.intervalMs = observation.intervalMs;
  });

  const reject = Effect.fnUntraced(function* (key: PartnerKey, until: DateTime.Utc) {
    block(upsert(key, yield* Clock.currentTimeMillis), DateTime.toEpochMillis(until));
  });

  return PartnerBudget.of({ reserve, observe, reject });
}

function makeStore(store: PartnerBudgetStore, intervals: PartnerIntervals) {
  const unavailable = (cause: unknown) =>
    new PartnerBudgetUnavailable({
      message: `Partner budget store failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    });

  const reserve = Effect.fnUntraced(function* (key: PartnerKey) {
    const intervalMs = yield* intervalOrDie(intervals, key);
    const slot = yield* Effect.tryPromise({
      try: () => store.reserve(key, intervalMs),
      catch: unavailable,
    });
    return DateTime.fromDateUnsafe(slot);
  });

  const observe = (key: PartnerKey, seen: PartnerSeen) =>
    Effect.tryPromise({ try: () => store.observe(key, toObservation(seen)), catch: unavailable });

  const reject = (key: PartnerKey, until: DateTime.Utc) =>
    Effect.tryPromise({
      try: () => store.reject(key, DateTime.toDateUtc(until)),
      catch: unavailable,
    });

  return PartnerBudget.of({ reserve, observe, reject });
}

/**
 * Reserves a slot, sleeps until it, or fails with `PartnerWait` when the slot
 * is after `deadlineMs`. A slot exactly one second before the deadline still
 * proceeds. With no deadline it always sleeps.
 */
export const awaitSlot = Effect.fnUntraced(function* (key: PartnerKey, deadlineMs?: number) {
  const budget = yield* PartnerBudget;
  const slot = yield* budget.reserve(key);
  const slotMs = DateTime.toEpochMillis(slot);
  if (deadlineMs !== undefined && slotMs > deadlineMs - DEADLINE_MARGIN_MS) {
    return yield* new PartnerWait({ until: slot });
  }
  const now = yield* Clock.currentTimeMillis;
  if (slotMs > now) yield* Effect.sleep(slotMs - now);
});

/**
 * The promise-based seam for adapters that are not written in Effect. Each
 * function rejects with the typed error of the Effect (`PartnerWait` or
 * `PartnerBudgetUnavailable`), which the adapter maps to its own pause outcome.
 */
export type PartnerBudgetClient = {
  awaitSlot(key: PartnerKey, deadlineMs?: number): Promise<void>;
  observe(key: PartnerKey, seen: PartnerSeen): Promise<void>;
  reject(key: PartnerKey, untilMs: number): Promise<void>;
};

/** The adapter-side error type check, so callers need no Effect imports. */
export const isPartnerWait = Schema.is(PartnerWait);
export const isPartnerBudgetUnavailable = Schema.is(PartnerBudgetUnavailable);

/**
 * Bridges a `PartnerBudget` layer to a `PartnerBudgetClient` through one
 * `ManagedRuntime`, as in `repos/effect/ai-docs/src/04_integration/10_managed-runtime.ts`.
 */
export function createPartnerBudgetClient(
  layer: Layer.Layer<PartnerBudget>,
): PartnerBudgetClient & { dispose(): Promise<void> } {
  const runtime = ManagedRuntime.make(layer);
  const run = async <A, E>(effect: Effect.Effect<A, E, PartnerBudget>): Promise<A> => {
    const exit = await runtime.runPromiseExit(effect);
    if (Exit.isSuccess(exit)) return exit.value;
    const failure = Cause.findErrorOption(exit.cause);
    throw Option.isSome(failure) ? failure.value : Cause.squash(exit.cause);
  };
  return {
    awaitSlot: (key, deadlineMs) => run(awaitSlot(key, deadlineMs)),
    observe: (key, seen) => run(PartnerBudget.use((budget) => budget.observe(key, seen))),
    reject: (key, untilMs) =>
      run(PartnerBudget.use((budget) => budget.reject(key, DateTime.makeUnsafe(untilMs)))),
    dispose: () => runtime.dispose(),
  };
}

/** A client over a fresh memory layer: the default where no budget is passed. */
export function createMemoryPartnerBudgetClient(): PartnerBudgetClient {
  return createPartnerBudgetClient(PartnerBudget.memoryLayer);
}
