import type { QueryResultRow } from "@neondatabase/serverless";
import { requireUserId, withTenant, withTenantStatement, type Database } from "./connection.js";

export type AiUsageOutcome = "ok" | "failed";

export type AiUsage = {
  day: string; // "YYYY-MM-DD"
  route:
    | "categorize"
    | "extract-invoice"
    | "chat"
    | "travel"
    | "portfolio-persona"
    | "sector-inference"
    | "cash-flow-suggestion"
    | "identifier-selection"
    | "instinct-reply"
    | "assistant-chat";
  model: string;
  inputTokens: number;
  outputTokens: number;
  pages: number;
  searches: number;
  costCents: number;
  /** Provider-reported prompt-cache usage (#300, WS5.7). 0 when it reports none. */
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  /** "ok" for a call that completed; "failed" for one that reached the model
   *  and threw. Failed rows carry cost 0 and error metadata instead of a price. */
  outcome?: AiUsageOutcome;
  /** The route's own machine code for a failure; never a provider message. */
  errorCode?: string;
  /** Upstream HTTP status for a failure, 0 for timeout/transport. */
  httpStatus?: number;
};

export type AiBudgetReservation = { ok: true; id: number } | { ok: false; scope: "day" | "month" };

/* How long an unreconciled reservation still counts toward the cap. Wide
 * enough that no call actually in flight can ever age out from under itself —
 * mistral.ts's own SEARCH_TIMEOUT_MS ceiling is 240s, so this clears it with
 * a 2.5x margin — narrow enough that a reservation orphaned by a hard crash
 * (nothing left alive to release it) self-heals well within the same day
 * instead of squatting on the cap until midnight. See 0009_ai_usage_reservation.sql. */
const RESERVATION_UNEXPIRED_SQL =
  "(reserved_at IS NULL OR reserved_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes')";

const RESERVATION_FRESH_SQL = `(reconciled_at IS NOT NULL OR ${RESERVATION_UNEXPIRED_SQL})`;

/**
 * The internal AI-spend ledger (`personal.ai_usage`), read and written by the
 * budget guard in front of the agent routes. One model key, one cap per
 * account: `userId` is the session user, and sums never cross accounts.
 * Rows with a NULL `user_id` are the pre-signup ledger and count toward no
 * account.
 *
 * Every method here runs as the account it names: `reserve` sets
 * `app.user_id` transaction-locally, the rest go through `withTenantStatement`,
 * and `reconcile`/`release` also carry an explicit `user_id` predicate. That is
 * belt and braces for the same reason `eraseUserData` writes its own predicate:
 * 0025 forces row-level security on this table, and a query that named another
 * account's row would match nothing even if the predicate were ever dropped.
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
     *  same account and month behind one lock (day is a subset of month, so
     *  this also covers the day cap), auto-released on COMMIT or ROLLBACK — a
     *  crashed client can never leave it held. Locking on month rather than
     *  day means a request landing right at midnight still serializes against
     *  the request just before it. */
    async reserve(params: {
      userId: string;
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
        /* 0025 puts `personal.ai_usage` under FORCE row security scoped to
         * `app.user_id`. Set it here, transaction-local, before the sums and
         * the INSERT below read or write a row. The identity is the ACCOUNT
         * this reservation is for — `aiAccountId()` substitutes "unscoped"
         * when there is no session — never a value a request supplied. */
        await client.query("SELECT set_config('app.user_id', $1, true)", [params.userId]);
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `ai_budget:${params.userId}:${params.month}`,
        ]);
        const dayResult = await client.query<QueryResultRow>(
          `SELECT COALESCE(SUM(cost_cents), 0)::int AS total FROM personal.ai_usage
           WHERE day = $1 AND user_id = $2 AND ${RESERVATION_FRESH_SQL}`,
          [params.day, params.userId],
        );
        const dayCents = Number(dayResult.rows[0]?.total ?? 0);
        if (dayCents + params.worstCaseCents >= params.dayCapCents) {
          await client.query("ROLLBACK");
          return { ok: false, scope: "day" };
        }
        const monthResult = await client.query<QueryResultRow>(
          `SELECT COALESCE(SUM(cost_cents), 0)::int AS total FROM personal.ai_usage
           WHERE to_char(day, 'YYYY-MM') = $1 AND user_id = $2 AND ${RESERVATION_FRESH_SQL}`,
          [params.month, params.userId],
        );
        const monthCents = Number(monthResult.rows[0]?.total ?? 0);
        if (monthCents + params.worstCaseCents >= params.monthCapCents) {
          await client.query("ROLLBACK");
          return { ok: false, scope: "month" };
        }
        const inserted = await client.query<QueryResultRow>(
          `INSERT INTO personal.ai_usage (day, route, model, cost_cents, reserved_at, user_id)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5) RETURNING id`,
          [params.day, params.route, "pending", params.worstCaseCents, params.userId],
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
     *  that cannot know whether a release already ran.
     *
     *  `userId` is the account that reserved the row, not a value chosen here.
     *  The id alone used to be enough to reach any account's reservation
     *  (`id` is server-side, so that was latent rather than reachable); the
     *  predicate now says whose row it may be, and RLS says the same thing
     *  again in the transaction `withTenantStatement` opens. */
    async reconcile(
      usage: Omit<AiUsage, "day" | "route"> & { id: number },
      userId: string,
    ): Promise<void> {
      const identity = requireUserId(userId);
      await withTenantStatement(db, identity, async (client) => {
        await client.query(
          `UPDATE personal.ai_usage
           SET model = $2, input_tokens = $3, output_tokens = $4, pages = $5, searches = $6,
               cost_cents = $7, cache_write_tokens = $9, cache_read_tokens = $10,
               outcome = 'ok', reconciled_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND user_id = $8 AND reconciled_at IS NULL AND ${RESERVATION_UNEXPIRED_SQL}`,
          [
            usage.id,
            usage.model,
            usage.inputTokens,
            usage.outputTokens,
            usage.pages,
            usage.searches,
            usage.costCents,
            identity,
            usage.cacheWriteTokens ?? 0,
            usage.cacheReadTokens ?? 0,
          ],
        );
      });
    },

    /** Turn an unsettled, unexpired reservation into a FAILED ledger row (#300, #385).
     *
     *  Enforces single settlement (`reconciled_at IS NULL` + 10m expiry): once a
     *  reservation is reconciled, failed, or released (or expired), subsequent
     *  settlement calls are no-ops. Callers pass any partial/ceiling billed
     *  usage (e.g. bought searches or OCR pages) directly into `fail()` instead
     *  of reconciling before failing. */
    async fail(
      failure: {
        id: number;
        model: string;
        errorCode: string;
        httpStatus?: number;
        inputTokens?: number;
        outputTokens?: number;
        pages?: number;
        searches?: number;
        cacheWriteTokens?: number;
        cacheReadTokens?: number;
        costCents?: number;
      },
      userId: string,
    ): Promise<void> {
      const identity = requireUserId(userId);
      await withTenantStatement(db, identity, async (client) => {
        await client.query(
          `UPDATE personal.ai_usage
           SET model = $2,
               input_tokens = $9,
               output_tokens = $10,
               pages = $11,
               searches = $12,
               cost_cents = $8,
               cache_write_tokens = $4,
               cache_read_tokens = $5,
               outcome = 'failed', error_code = $3, http_status = $6,
               reconciled_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND user_id = $7 AND reconciled_at IS NULL AND ${RESERVATION_UNEXPIRED_SQL}`,
          [
            failure.id,
            failure.model,
            failure.errorCode,
            failure.cacheWriteTokens ?? 0,
            failure.cacheReadTokens ?? 0,
            failure.httpStatus ?? null,
            identity,
            Math.max(0, Math.round(failure.costCents ?? 0)),
            Math.max(0, Math.round(failure.inputTokens ?? 0)),
            Math.max(0, Math.round(failure.outputTokens ?? 0)),
            Math.max(0, Math.round(failure.pages ?? 0)),
            Math.max(0, Math.round(failure.searches ?? 0)),
          ],
        );
      });
    },

    /** The call this reservation was holding room for never reached
     *  `reconcile` or `fail` — it aborted before the provider was called.
     *  Deletes the placeholder row only while unsettled and unexpired. */
    async release(id: number, userId: string): Promise<void> {
      const identity = requireUserId(userId);
      await withTenantStatement(db, identity, async (client) => {
        await client.query(
          `DELETE FROM personal.ai_usage
           WHERE id = $1 AND user_id = $2 AND reconciled_at IS NULL AND ${RESERVATION_UNEXPIRED_SQL}`,
          [id, identity],
        );
      });
    },

    async record(usage: AiUsage & { userId: string }): Promise<void> {
      const identity = requireUserId(usage.userId);
      await withTenantStatement(db, identity, async (client) => {
        await client.query(
          `INSERT INTO personal.ai_usage
             (day, route, model, input_tokens, output_tokens, pages, searches, cost_cents,
              cache_write_tokens, cache_read_tokens, outcome, error_code, http_status, user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            usage.day,
            usage.route,
            usage.model,
            usage.inputTokens,
            usage.outputTokens,
            usage.pages,
            usage.searches,
            usage.costCents,
            usage.cacheWriteTokens ?? 0,
            usage.cacheReadTokens ?? 0,
            usage.outcome ?? "ok",
            usage.errorCode ?? null,
            usage.httpStatus ?? null,
            identity,
          ],
        );
      });
    },

    async spentCents(range: { userId: string; day: string; month: string }): Promise<{
      dayCents: number;
      monthCents: number;
    }> {
      /* Two statements, so a tenant transaction rather than a single tenant
       * statement — the same reason `eraseUserData` uses `withTenant`. */
      const identity = requireUserId(range.userId);
      return withTenant(db, identity, async (client) => {
        const dayResult = await client.query<QueryResultRow>(
          `SELECT COALESCE(SUM(cost_cents), 0)::int AS total FROM personal.ai_usage
           WHERE day = $1 AND user_id = $2 AND ${RESERVATION_FRESH_SQL}`,
          [range.day, identity],
        );
        const monthResult = await client.query<QueryResultRow>(
          `SELECT COALESCE(SUM(cost_cents), 0)::int AS total FROM personal.ai_usage
           WHERE to_char(day, 'YYYY-MM') = $1 AND user_id = $2 AND ${RESERVATION_FRESH_SQL}`,
          [range.month, identity],
        );
        return {
          dayCents: Number(dayResult.rows[0]?.total ?? 0),
          monthCents: Number(monthResult.rows[0]?.total ?? 0),
        };
      });
    },
  };
}
