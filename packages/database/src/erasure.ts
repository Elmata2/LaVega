import type { QueryResultRow } from "@neondatabase/serverless";
import { requireUserId, withTenant, type Database } from "./connection.js";

/* The tables that hold anything belonging to a person. Deliberately a
 * literal list rather than a query over the catalogue: a table added later
 * should have to be considered here by a human, not silently swept up or —
 * worse — silently missed. Order is child-before-parent: agent memory
 * (0020) references investing.agent_threads, so its children go first. */
const USER_DATA_TABLES = [
  "personal.agent_whatsapp",
  "personal.agent_link_codes",
  "personal.agent_events",
  "personal.agent_push_subscriptions",
  "personal.agent_mirror",
  "personal.agent_state",
  "personal.agent_settings",
  "personal.eb_daily_reads",
  "personal.eb_sessions",
  "personal.eb_pending_auth",
  "personal.n8n_forwarding",
  "investing.portfolio_letters",
  "investing.agent_observations",
  "investing.agent_messages",
  "investing.goals",
  "investing.theses",
  "investing.agent_threads",
  "investing.agent_runs",
  "investing.sync_state",
  "investing.preferences",
  "investing.broker_vaults",
  // After the tables above: deleting their rows raises this user's dashboard version.
  "investing.dashboard_snapshots",
  "investing.dashboard_sources",
  "personal.vaults",
  // After the vault: with its key gone, any copy left in a browser is unreadable.
  "personal.vault_keys",
  "personal.net_worth_totals",
  // 0013 made this ledger per-account, so an erasure has to take it too. It was
  // missing here because 0005 had declared it aggregate owner spend; 0025 gives
  // it the same forced RLS as every other table in `personal` for the same reason.
  "personal.ai_usage",
] as const;

/* The Better Auth identity, which 0002_auth.sql keeps in `public` — deliberately
 * outside the tenant schemas — so its scoping column is not `user_id` and one
 * `WHERE user_id = $1` shape does not cover it. `session` and `account` both
 * carry `"userId"` and both cascade from `public."user"`; they are still deleted
 * explicitly so the erasure report can evidence them. `verification` has no user
 * column at all: its `identifier` is whatever a token was minted for, which is
 * the address for an email confirmation and the account id for other flows, so
 * both are matched. */
const AUTH_IDENTITY_DELETES = [
  { table: "public.session", sql: `DELETE FROM public.session WHERE "userId" = $1` },
  { table: "public.account", sql: `DELETE FROM public.account WHERE "userId" = $1` },
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
 * carries an explicit `WHERE user_id = $1` (or `"userId"`/`identifier` for the
 * Better Auth tables, which live in `public`). RLS is a second belt, not the
 * only one: `personal.eb_pending_auth` deliberately has no RLS policy at all
 * (`0003_eb_flow.sql`), so an unqualified `DELETE FROM` against it would
 * empty every user's pending bank authorisations, not just this one's.
 * Either every table is cleared or none is; a half-erased account
 * is worse than a failed request, because the caller is told they are gone.
 *
 * The Better Auth identity is part of this transaction, not a second step
 * someone has to remember. Clearing application data alone left the person
 * forgotten but able to sign back in with the same password, which recreated a
 * vault under the same account id — the erasure appeared to succeed and did
 * not. Deleting `public."user"` takes `session` and `account` with it by
 * cascade, so the old cookie stops resolving and the old credentials stop
 * authenticating in the same commit that removed the rows. Doing the two in
 * separate transactions would reopen exactly the half-erased window this doc
 * warns about, so there is one transaction and no ordering to get wrong.
 *
 * It returns what it deleted per table. An erasure you cannot evidence is one
 * you cannot answer a regulator about, and "0 rows" is a legitimate result that
 * needs to be distinguishable from "never ran".
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

    /* `verification` is keyed by `identifier`, which is the email for a
     * confirmation token and the account id elsewhere, so read the address
     * back before its row is gone and match on both. A missing user row simply
     * yields no email; the id is still matched. */
    const found = await client.query<QueryResultRow>(
      'SELECT email FROM public."user" WHERE id = $1',
      [identity],
    );
    const email = (found.rows[0]?.email as string | undefined) ?? null;

    for (const { table, sql } of AUTH_IDENTITY_DELETES) {
      const result = await client.query(sql, [identity]);
      report.push({ table, rows: result.rowCount ?? 0 });
    }
    const verification = await client.query(
      "DELETE FROM public.verification WHERE identifier = $1 OR identifier = $2",
      [identity, email ?? identity],
    );
    report.push({ table: "public.verification", rows: verification.rowCount ?? 0 });
    const user = await client.query('DELETE FROM public."user" WHERE id = $1', [identity]);
    report.push({ table: 'public."user"', rows: user.rowCount ?? 0 });

    return report;
  });
}

/* The personal-side reset.
 * A literal list, like USER_DATA_TABLES, and deliberately SHORTER than it: no
 * investing.* table, no Better Auth table, and two personal tables stay.
 *
 * Kept on purpose:
 *  - personal.vault_keys: the key a browser vault is sealed with. Deleting it
 *    would mint a new key on the next request and strand any vault copy still
 *    in a browser behind a misleading "unreachable" screen.
 *  - personal.ai_usage: the AI spend ledger; deleting it would reset the cap. */
export const PERSONAL_RESET_TABLES = [
  "personal.eb_sessions",
  // No RLS (0003_eb_flow.sql): the WHERE user_id below is the only guard.
  "personal.eb_pending_auth",
  "personal.n8n_forwarding",
  "personal.vaults",
  "personal.net_worth_totals",
  /* The Instinct agent: after a reset it is off (no settings row) and holds nothing. Same
   * child-first order as USER_DATA_TABLES; the privacy policy says the reset removes it. */
  "personal.agent_whatsapp",
  "personal.agent_link_codes",
  "personal.agent_events",
  "personal.agent_push_subscriptions",
  "personal.agent_mirror",
  "personal.agent_state",
  "personal.agent_settings",
] as const;

/**
 * Clear one person's personal-side data and nothing else: the tables in
 * PERSONAL_RESET_TABLES, in one transaction, each `DELETE ... WHERE user_id = $1`
 * with the id as a bound parameter. The login, Investing and the vault key stay.
 * Not a GDPR erasure; see `eraseUserData` for that.
 */
export async function erasePersonalData(
  db: Database,
  userId: string | undefined | null,
): Promise<ErasureReport> {
  const identity = requireUserId(userId);
  return withTenant(db, identity, async (client) => {
    const report: ErasureReport = [];
    for (const table of PERSONAL_RESET_TABLES) {
      const result = await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [identity]);
      report.push({ table, rows: result.rowCount ?? 0 });
    }
    return report;
  });
}
