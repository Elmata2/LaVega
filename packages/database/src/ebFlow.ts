import type { QueryResultRow } from "@neondatabase/serverless";
import { requireUserId, withTenantStatement, type Database } from "./connection.js";
import { encryptBlob, tryDecryptBlob } from "./crypto.js";

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

    /**
     * Atomically claim one daily Enable Banking read for `userId` on `today`
     * (YYYY-MM-DD in Europe/Amsterdam) up to `max`. Shared with the Instinct
     * cron and WhatsApp agent via `personal.eb_daily_reads`.
     */
    async takeFetchBudget(userId: string, today: string, max: number): Promise<boolean> {
      if (max < 1) return false;
      const identity = requireUserId(userId);
      return withTenantStatement(db, identity, async (client) => {
        const result = await client.query(
          `INSERT INTO personal.eb_daily_reads (user_id, fetches_today, fetches_day)
           VALUES ($1, 1, $2::date)
           ON CONFLICT (user_id) DO UPDATE SET
             fetches_today = CASE WHEN personal.eb_daily_reads.fetches_day = $2::date
               THEN personal.eb_daily_reads.fetches_today + 1 ELSE 1 END,
             fetches_day = $2::date
           WHERE personal.eb_daily_reads.fetches_day IS DISTINCT FROM $2::date
              OR personal.eb_daily_reads.fetches_today < $3
           RETURNING 1`,
          [identity, today, max],
        );
        return (result.rows?.length ?? 0) > 0;
      });
    },
  };
}
