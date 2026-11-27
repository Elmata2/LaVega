import { createAiUsageRepository, type AiUsage } from "@lavega/database";
import { runtimeDatabase } from "@lavega/database";
import { loadBudgetConfig } from "../config.js";
import { totalCostCents } from "./pricing.js";

export type UsageInput = {
  userId?: string;
  route: AiUsage["route"];
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  pages?: number;
  // Callers of a chatWithSearch-based route (chat, travel) always pass 1 here
  // regardless of whether the model actually invoked the web_search tool —
  // deliberately conservative (over-attributes cost, never under-attributes
  // it), traded for not having to parse tool-invocation detail out of every
  // response just to price a call correctly.
  searches?: number;
  /** Provider-reported prompt-cache counts (#300, WS5.7 leftover). Stored on the
   *  row even when the price model treats them pessimistically. */
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
};

export type ReservationState = "reserved" | "reconciled" | "failed" | "released";

export type FailureUsage = {
  inputTokens?: number;
  outputTokens?: number;
  pages?: number;
  searches?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
};

const failureUsageByError = new WeakMap<object, FailureUsage>();

/** Attach partial/ceiling billable usage to an error thrown by an AI helper so
 *  the outer route settles the reservation ONCE via `recordFailure()` instead
 *  of reconciling before rethrowing. */
export function attachFailureUsage(error: unknown, usage: FailureUsage): void {
  if (error && typeof error === "object") {
    failureUsageByError.set(error, usage);
  }
}

export function readFailureUsage(error: unknown): FailureUsage | undefined {
  return error && typeof error === "object" ? failureUsageByError.get(error) : undefined;
}

/** A held reservation, returned by `checkBudget()` and threaded into
 *  `recordUsage()` (Reserved -> Reconciled), `recordFailure()` (Reserved ->
 *  Failed), or `releaseReservation()` (Reserved -> Released). Single-settlement
 *  is enforced both on the handle (`state` / `settled`) and in SQL
 *  (`reconciled_at IS NULL` + 10m expiry). */
export type ReservationHandle =
  | {
      readonly kind: "db";
      readonly id: number;
      readonly userId: string;
      state?: ReservationState;
    }
  | {
      readonly kind: "memory";
      readonly userId: string;
      readonly day: string;
      readonly month: string;
      readonly amount: number;
      settled: boolean;
      state?: ReservationState;
    };

function trySettle(
  reservation: ReservationHandle | undefined,
  next: Exclude<ReservationState, "reserved">,
): boolean {
  if (!reservation) return true;
  if (reservation.state !== undefined && reservation.state !== "reserved") return false;
  if (reservation.kind === "memory" && reservation.settled) return false;
  reservation.state = next;
  if (reservation.kind === "memory") reservation.settled = true;
  return true;
}

export type BudgetGate =
  | { ok: true; reservation?: ReservationHandle }
  | { ok: false; scope: "day" | "month" };

// Per-process fallback for a deployment with no DATABASE_URL (local dev,
// self-hosting). Keyed by "day:<YYYY-MM-DD>" / "month:<YYYY-MM>" so day and
// month totals never collide. Lost on restart — acceptable, the guard it
// feeds only needs to be roughly right within one process's lifetime, and a
// restart also wipes any reservation an in-flight call was holding, so there
// is nothing here that can leak past the process the way an orphaned DB row
// theoretically could.
const memory = new Map<string, number>();
let warnedNoDatabase = false;

/** Callers with no session (tests, local dev with the guard stood down) share
 *  one bucket. A real request always passes the session user id. */
export const UNSCOPED_AI_USER = "unscoped";

export function aiAccountId(userId: string | undefined): string {
  const trimmed = userId?.trim();
  return trimmed ? trimmed : UNSCOPED_AI_USER;
}

function memoryKey(scope: "day" | "month", userId: string, period: string): string {
  return `${scope}:${userId}:${period}`;
}

// UTC day/month boundary, not Europe/Amsterdam — the caps only need to reset
// roughly once a day, so the 1-2 hour skew near local midnight (the Dutch
// "vandaag"/"deze maand" wording implies the owner's own calendar) is an
// accepted tradeoff rather than a bug to fix.
function todayParts(): { day: string; month: string } {
  const iso = new Date().toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

export async function spentCents(
  userId?: string,
): Promise<{ dayCents: number; monthCents: number }> {
  const account = aiAccountId(userId);
  const { day, month } = todayParts();
  const db = runtimeDatabase();
  if (db) return createAiUsageRepository(db).spentCents({ userId: account, day, month });
  if (!warnedNoDatabase) {
    warnedNoDatabase = true;
    console.warn("agent/budget: no DATABASE_URL — using an in-memory, per-process spend counter");
  }
  return {
    dayCents: memory.get(memoryKey("day", account, day)) ?? 0,
    monthCents: memory.get(memoryKey("month", account, month)) ?? 0,
  };
}

/** The most a single call on each route can cost, in euro cents, derived from
 *  that route's own input bounds: OCR is capped at a 20-page window, categorize
 *  at 200 short items, the two search-backed routes now send a max_tokens, and
 *  sector-inference sends one System One choice over 11 sector criteria with
 *  only a symbol and a short instrument description as input, so it is priced
 *  like portfolio-persona's own single System One call.
 *  Rounded generously upward — this is a ceiling, not an estimate.
 *
 *  These exist so the gate can refuse a call it cannot afford BEFORE making it.
 *  Without them the cap only ever looked backwards: a request was admitted
 *  whenever past spend was under the cap, so one call could cost more than the
 *  whole day's allowance and only the next one would be refused. */
export const WORST_CASE_CENTS: Record<AiUsage["route"], number> = {
  "extract-invoice": 15,
  categorize: 5,
  chat: 25,
  travel: 20,
  "portfolio-persona": 1,
  "sector-inference": 1,
  "instinct-reply": 3,
  /* One round of the Assistent chat on the small model. The body is capped at
   * 200 KiB; dense JSON at that size is about 1.5 to 2 cents of input, so the
   * reservation is 3. A typical round costs about 0.05 cent. */
  "assistant-chat": 3,
  /* Jev-04: one batched Choice over at most 24 unknown types, each with a short
   * type string, description, currency and sign — same order as one
   * portfolio-persona call. */
  "cash-flow-suggestion": 1,
  /* One Jev Choice over the provider's candidate set with a small state; the
   * identifier-selection route's own ceiling (issue #136). */
  "identifier-selection": 2,
};

/** Is there room for a call on `route`, counting what that call could cost —
 *  and if so, HOLD that room, atomically, before answering yes.
 *
 *  Refuses slightly early by design: a route is blocked once its worst case no
 *  longer fits under the cap, rather than once the cap is already breached.
 *  That is the difference between a ceiling and a speed bump.
 *
 *  The check and the hold are one operation because two of them are not: a
 *  request that reads "under cap" and only reserves afterwards leaves a gap
 *  for a second request to read the same "under cap" before the first has
 *  written anything — which is exactly how 240 concurrent card-terms lookups
 *  once cleared a one-cent cap by EUR 14.39 (see cardTerms.ts's own account of
 *  it). Every caller of `checkBudget(route)` that gets `{ ok: true }` back
 *  MUST eventually call either `recordUsage(usage, reservation)` (the call
 *  happened; turn the hold into the real charge) or
 *  `releaseReservation(reservation)` (it didn't; give the room back) —
 *  `reservation` is `undefined` only when `route` itself was omitted, the
 *  read-only form used to just peek at the caps without charging anything. */
export async function checkBudget(
  route?: AiUsage["route"],
  userId?: string,
  options?: { reserve?: boolean },
): Promise<BudgetGate> {
  const account = aiAccountId(userId);
  const caps = loadBudgetConfig();

  if (!route || options?.reserve === false) {
    // Read-only gate: no placeholder row created or released.
    const worstCase = route ? WORST_CASE_CENTS[route] : 0;
    const spent = await spentCents(account);
    if (spent.dayCents + worstCase >= caps.dayCents) return { ok: false, scope: "day" };
    if (spent.monthCents + worstCase >= caps.monthCents) return { ok: false, scope: "month" };
    return { ok: true };
  }

  const worstCase = WORST_CASE_CENTS[route];
  const { day, month } = todayParts();
  const db = runtimeDatabase();

  if (db) {
    const result = await createAiUsageRepository(db).reserve({
      userId: account,
      day,
      month,
      route,
      worstCaseCents: worstCase,
      dayCapCents: caps.dayCents,
      monthCapCents: caps.monthCents,
    });
    if (!result.ok) return { ok: false, scope: result.scope };
    return {
      ok: true,
      reservation: { kind: "db", id: result.id, userId: account, state: "reserved" },
    };
  }

  if (!warnedNoDatabase) {
    warnedNoDatabase = true;
    console.warn("agent/budget: no DATABASE_URL — using an in-memory, per-process spend counter");
  }
  // No DATABASE_URL: the read and the hold below are plain Map access with no
  // `await` between them, which is what makes this atomic rather than the SQL
  // transaction above — an `async function` body runs synchronously up to its
  // first real `await`, and this path never reaches one, so two calls fired
  // together (e.g. `Promise.all([checkBudget(r), checkBudget(r)])`) cannot
  // interleave here: the first call's read-decide-write finishes before the
  // second call's body even starts. Reintroducing an `await` in between (e.g.
  // routing this through the async `spentCents()` above) would reopen exactly
  // the gap this function exists to close.
  const dayKey = memoryKey("day", account, day);
  const monthKey = memoryKey("month", account, month);
  const dayCents = memory.get(dayKey) ?? 0;
  const monthCents = memory.get(monthKey) ?? 0;
  if (dayCents + worstCase >= caps.dayCents) return { ok: false, scope: "day" };
  if (monthCents + worstCase >= caps.monthCents) return { ok: false, scope: "month" };
  memory.set(dayKey, dayCents + worstCase);
  memory.set(monthKey, monthCents + worstCase);
  return {
    ok: true,
    reservation: {
      kind: "memory",
      userId: account,
      day,
      month,
      amount: worstCase,
      settled: false,
      state: "reserved",
    },
  };
}

/** Log and persist one AI call's cost.
 *
 *  AWAITED, not detached. It used to run as `void (async () => …)()` so that a
 *  logging failure could never fail a request that had already succeeded. On a
 *  serverless host that reasoning does not survive contact with the platform:
 *  the instance is free to stop once the response is sent, so a write suspended
 *  mid-flight can simply be discarded. The Mistral call is billed either way,
 *  the ledger never sees it, and the cap keeps answering "under cap" forever.
 *  `waitUntil` would be the platform's own answer, but `@vercel/functions` is
 *  not a dependency here.
 *
 *  So the promise is returned and the caller awaits it before responding. The
 *  original guarantee is kept by never rejecting: every failure is swallowed
 *  into a log, exactly as before.
 *
 *  `reservation`, when given, is the hold `checkBudget()` returned for this
 *  same call — this turns it into the real charge in place (see the
 *  repository's `reconcile`/memory equivalent) instead of adding a second,
 *  separate row on top of the worst-case one. Omitted, this inserts a plain
 *  finalized row directly, exactly as before this reservation step existed —
 *  every existing caller that never reserves keeps working unchanged. */
export async function recordUsage(
  input: UsageInput,
  reservation?: ReservationHandle,
): Promise<void> {
  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const pages = input.pages ?? 0;
  const searches = input.searches ?? 0;
  const cacheWriteTokens = input.cacheWriteTokens ?? 0;
  const cacheReadTokens = input.cacheReadTokens ?? 0;
  let costCents: number;
  try {
    costCents = totalCostCents({
      model: input.model,
      inputTokens,
      outputTokens,
      pages,
      searches,
      cacheWriteTokens,
      cacheReadTokens,
    });
  } catch (e) {
    // pricing.ts refuses to price an unrecognized model rather than silently
    // charging 0 (see its own comment) — that protects the cap from a renamed
    // model going invisibly free, but this function's own contract is to never
    // fail a request that already succeeded, so the failure surfaces as a
    // loud log instead of a thrown error, and this one call's spend is not
    // recorded — which means any hold this call was given has to be released
    // here too, or an unrecognized model would leak its reservation the same
    // way a thrown call does, just one step later.
    console.error(`agent/budget: ${e instanceof Error ? e.message : String(e)}`);
    await releaseReservation(reservation);
    return;
  }
  if (reservation && !trySettle(reservation, "reconciled")) return;

  console.log(
    `ai.usage route=${input.route} model=${input.model} in=${inputTokens} out=${outputTokens} pages=${pages} cost_cents=${costCents}`,
  );

  try {
    const { day, month } = todayParts();
    const db = runtimeDatabase();
    if (db) {
      const repo = createAiUsageRepository(db);
      if (reservation?.kind === "db") {
        await repo.reconcile(
          {
            id: reservation.id,
            model: input.model,
            inputTokens,
            outputTokens,
            pages,
            searches,
            costCents,
            cacheWriteTokens,
            cacheReadTokens,
          },
          reservation.userId,
        );
      } else {
        await repo.record({
          userId: aiAccountId(input.userId),
          day,
          route: input.route,
          model: input.model,
          inputTokens,
          outputTokens,
          pages,
          searches,
          costCents,
          cacheWriteTokens,
          cacheReadTokens,
        });
      }
      return;
    }
    if (reservation?.kind === "memory") {
      memory.set(
        memoryKey("day", reservation.userId, reservation.day),
        (memory.get(memoryKey("day", reservation.userId, reservation.day)) ?? 0) -
          reservation.amount +
          costCents,
      );
      memory.set(
        memoryKey("month", reservation.userId, reservation.month),
        (memory.get(memoryKey("month", reservation.userId, reservation.month)) ?? 0) -
          reservation.amount +
          costCents,
      );
      return;
    }
    const account = aiAccountId(input.userId);
    memory.set(
      memoryKey("day", account, day),
      (memory.get(memoryKey("day", account, day)) ?? 0) + costCents,
    );
    memory.set(
      memoryKey("month", account, month),
      (memory.get(memoryKey("month", account, month)) ?? 0) + costCents,
    );
  } catch (e) {
    console.error(
      `agent/budget: failed to persist usage: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export async function recordFailure(
  input: {
    route: AiUsage["route"];
    model: string;
    errorCode: string;
    httpStatus?: number;
    inputTokens?: number;
    outputTokens?: number;
    pages?: number;
    /** A travel lookup buys its searches before the model can time out. */
    searches?: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
  },
  reservation?: ReservationHandle,
): Promise<void> {
  if (reservation && !trySettle(reservation, "failed")) return;

  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const pages = input.pages ?? 0;
  const searches = input.searches ?? 0;
  const cacheWriteTokens = input.cacheWriteTokens ?? 0;
  const cacheReadTokens = input.cacheReadTokens ?? 0;
  let costCents = 0;
  if (
    inputTokens > 0 ||
    outputTokens > 0 ||
    pages > 0 ||
    searches > 0 ||
    cacheWriteTokens > 0 ||
    cacheReadTokens > 0
  ) {
    try {
      costCents = totalCostCents({
        model: input.model,
        inputTokens,
        outputTokens,
        pages,
        searches,
        cacheWriteTokens,
        cacheReadTokens,
      });
    } catch (e) {
      /* An unknown model must not stop the failure row from being written. */
      console.error(`agent/budget: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(
    `ai.usage.failed route=${input.route} model=${input.model} code=${input.errorCode} status=${input.httpStatus ?? 0} cost_cents=${costCents}`,
  );

  try {
    const db = runtimeDatabase();
    if (db && reservation?.kind === "db") {
      await createAiUsageRepository(db).fail(
        {
          id: reservation.id,
          model: input.model,
          errorCode: input.errorCode,
          ...(input.httpStatus === undefined ? {} : { httpStatus: input.httpStatus }),
          inputTokens,
          outputTokens,
          pages,
          searches,
          cacheWriteTokens,
          cacheReadTokens,
          costCents,
        },
        reservation.userId,
      );
      return;
    }
    if (reservation?.kind === "memory") {
      memory.set(
        memoryKey("day", reservation.userId, reservation.day),
        Math.max(
          0,
          (memory.get(memoryKey("day", reservation.userId, reservation.day)) ?? 0) -
            reservation.amount +
            costCents,
        ),
      );
      memory.set(
        memoryKey("month", reservation.userId, reservation.month),
        Math.max(
          0,
          (memory.get(memoryKey("month", reservation.userId, reservation.month)) ?? 0) -
            reservation.amount +
            costCents,
        ),
      );
      return;
    }
  } catch (e) {
    console.error(
      `agent/budget: failed to persist failure: ${e instanceof Error ? e.message : String(e)}`,
    );
    if (reservation?.kind === "db") {
      const db = runtimeDatabase();
      if (db) {
        await createAiUsageRepository(db)
          .release(reservation.id, reservation.userId)
          .catch(() => undefined);
      }
    }
  }
}

export async function releaseReservation(
  reservation: ReservationHandle | undefined,
): Promise<void> {
  if (!reservation) return;
  if (!trySettle(reservation, "released")) return;
  try {
    if (reservation.kind === "db") {
      const db = runtimeDatabase();
      if (db) await createAiUsageRepository(db).release(reservation.id, reservation.userId);
      return;
    }
    memory.set(
      memoryKey("day", reservation.userId, reservation.day),
      Math.max(
        0,
        (memory.get(memoryKey("day", reservation.userId, reservation.day)) ?? 0) -
          reservation.amount,
      ),
    );
    memory.set(
      memoryKey("month", reservation.userId, reservation.month),
      Math.max(
        0,
        (memory.get(memoryKey("month", reservation.userId, reservation.month)) ?? 0) -
          reservation.amount,
      ),
    );
  } catch (e) {
    console.error(
      `agent/budget: failed to release reservation: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Test seam: clears the in-memory counter and the "warned once" flag. Cannot
 *  reset credentialStore.ts's own pool singleton cleanly, so DB-path coverage
 *  is out of scope for tests here — no DATABASE_URL is set anywhere in this
 *  test env. */
export function resetBudgetMemory(): void {
  memory.clear();
  warnedNoDatabase = false;
}
