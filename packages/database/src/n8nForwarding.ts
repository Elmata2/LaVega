import type { QueryResultRow } from "@neondatabase/serverless";
import {
  isUniqueViolation,
  requireUserId,
  withTenantStatement,
  type Database,
} from "./connection.js";

export type N8nForwardingWrite =
  | { status: "stored"; localPart: string }
  | { status: "invalid" }
  | { status: "taken" };

/**
 * Per-user n8n invoice-forwarding local part (`personal.n8n_forwarding`).
 *
 * The table holds one row per user (PRIMARY KEY user_id) and guarantees
 * global uniqueness across users (UNIQUE local_part). Storing a new local
 * part for the same user overwrites the previous one; storing one already
 * claimed by another user returns `{ status: "taken" }`.
 *
 * Writes run through `withTenantStatement` because the table has RLS.
 */
export function createN8nForwardingRepository(db: Database) {
  return {
    /** The caller's own local part, or null when none is recorded yet. RLS
     *  means another user's row is invisible here regardless of what `userId`
     *  claims — but callers must still pass the SESSION's id, never one a
     *  request supplied. */
    async getLocalPart(userId: string | undefined | null): Promise<string | null> {
      const identity = requireUserId(userId);
      return withTenantStatement(db, identity, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT local_part FROM personal.n8n_forwarding WHERE user_id = $1",
          [identity],
        );
        return (result.rows[0]?.local_part as string | undefined) ?? null;
      });
    },

    /** Record or replace the caller's own local part. The write path for
     *  `apps/server/src/n8n-routes.ts`'s `POST /api/n8n/forward-address`. */
    async setLocalPart(
      userId: string | undefined | null,
      localPart: string,
    ): Promise<N8nForwardingWrite> {
      const identity = requireUserId(userId);
      /* SAME CANONICAL FORM THE COLUMN ENFORCES, applied here so an ordinary
       * copy-paste does not become a constraint violation the caller has to
       * interpret. Lowercase, because the email worker lowercases when it
       * decides which n8n bucket a mail goes into and n8n does not lowercase
       * when it reads one back — a capitalised row and its lowercase twin are
       * two rows here and one bucket there, and the one that matches drains
       * the other's invoices. The CHECK stays the backstop for every writer
       * that is not this function. */
      const trimmed = localPart.trim().toLowerCase();
      if (!/^[a-z0-9._%+-]{1,120}$/.test(trimmed)) return { status: "invalid" };
      try {
        await withTenantStatement(db, identity, async (client) => {
          await client.query(
            "INSERT INTO personal.n8n_forwarding (user_id, local_part) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET local_part = EXCLUDED.local_part, updated_at = CURRENT_TIMESTAMP",
            [identity, trimmed],
          );
        });
      } catch (err) {
        if (isUniqueViolation(err)) return { status: "taken" };
        throw err;
      }
      return { status: "stored", localPart: trimmed };
    },
  };
}
