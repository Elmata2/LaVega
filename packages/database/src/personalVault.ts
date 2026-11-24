import { randomBytes } from "node:crypto";
import type { QueryResultRow } from "@neondatabase/serverless";
import { requireUserId, withTenantStatement, type Database } from "./connection.js";
import { encryptBlob, tryDecryptBlob } from "./crypto.js";

export type OpaqueVaultRow = { blob: Buffer; updatedAt: string };

/* The version token a conditional write is compared against.
 *
 * It has to come back out of Postgres at the precision it went in at.
 * `timestamptz` keeps microseconds and `Date.toISOString()` only keeps
 * milliseconds, so reading the column through a JS Date and sending it back
 * lands three digits short of the stored value — and then `updated_at = $2`
 * never matches and every conditional write reads as a conflict. Formatting in
 * SQL keeps it exact, and the client only ever echoes it back. */
const VAULT_VERSION = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;
export type OpaqueVaultWrite = { status: "stored"; updatedAt: string } | { status: "conflict" };

/**
 * The personal vault as bytes the server cannot read.
 *
 * `encryptBlob` uses the SERVER's key, which is right for data the server has to
 * act on — broker credentials it must present to a broker. Personal finances are
 * not that: the browser encrypts them with a key derived from the user's own
 * passphrase, and this only holds the result. There is deliberately no
 * `encryptBlob` here — if a later change needs one, that is a decision to
 * re-open, not a line to add.
 *
 * A `createVaultRepository` that sealed this table with the server's key used to
 * sit above. It was wired to nothing, but an exported function that decrypts
 * personal vaults server-side is one import away from making the promise below
 * false, so it was deleted rather than left for someone to find and use.
 *
 * Writes are conditional on the copy the client last saw. Two devices holding
 * different vaults is a real situation, and last-write-wins would silently
 * destroy one of them, so a stale write is refused instead.
 */
/**
 * The key the browser seals the personal vault with (0024_personal_vault_keys.sql,
 * docs/adr/0009-account-held-vault-key.md).
 *
 * Created on first use, never replaced: a new key would orphan the vault sealed
 * under the old one. The server hands the key to its signed-in owner and never
 * uses it itself; nothing here reads `personal.vaults`.
 */
export function createVaultKeyRepository(db: Database, userId: string | undefined | null) {
  const tenantId = requireUserId(userId);
  const read = () =>
    withTenantStatement(db, tenantId, async (client) => {
      const result = await client.query<QueryResultRow>(
        `WITH created AS (
           INSERT INTO personal.vault_keys (user_id, wrapped_key)
           VALUES (current_setting('app.user_id'), $1)
           ON CONFLICT (user_id) DO NOTHING
           RETURNING wrapped_key
         )
         SELECT wrapped_key FROM created
         UNION ALL
         SELECT wrapped_key FROM personal.vault_keys WHERE NOT EXISTS (SELECT 1 FROM created)`,
        [encryptBlob({ key: randomBytes(32).toString("base64") })],
      );
      const row = result.rows[0];
      return row ? Buffer.from(row.wrapped_key as Buffer) : null;
    });
  return {
    /** The raw 32-byte key. Throws when LAVEGA_ENCRYPTION_KEY cannot open it. */
    async getOrCreate(): Promise<Buffer> {
      /* Two first requests at once: the one that loses the insert can run its
       * SELECT on a snapshot taken before the winner committed and see no row.
       * The second read sees it. */
      const wrapped = (await read()) ?? (await read());
      if (!wrapped) throw new Error("Vault key could not be created");
      const opened = tryDecryptBlob<{ key: string }>(wrapped);
      if (!opened.readable) throw new UnreadableVaultKeyError();
      const key = Buffer.from(opened.value.key, "base64");
      if (key.length !== 32) throw new UnreadableVaultKeyError();
      return key;
    },
  };
}

export class UnreadableVaultKeyError extends Error {
  constructor() {
    super("The stored vault key cannot be read with the current LAVEGA_ENCRYPTION_KEY");
    this.name = "UnreadableVaultKeyError";
  }
}

export function createOpaqueVaultRepository(db: Database, userId: string | undefined | null) {
  const tenantId = requireUserId(userId);
  return {
    async get(): Promise<OpaqueVaultRow | null> {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `SELECT vault_blob, ${VAULT_VERSION} FROM personal.vaults`,
        );
        const row = result.rows[0];
        return row
          ? { blob: Buffer.from(row.vault_blob as Buffer), updatedAt: row.updated_at as string }
          : null;
      });
    },
    /** `expectedUpdatedAt` is the copy the client is replacing; `null` means it believes there is none. */
    async put(blob: Buffer, expectedUpdatedAt: string | null): Promise<OpaqueVaultWrite> {
      if (blob.length === 0) throw new Error("Vault blob is empty");
      return withTenantStatement(db, tenantId, async (client) => {
        /* A client that names a server copy (`expectedUpdatedAt`) is replacing
         * THAT row. If the row is gone (a personal-data reset, a full erase) a
         * plain UPDATE finds nothing and the answer is a conflict, instead of an
         * INSERT that silently puts an old device's vault back. Only a client
         * that expects nothing (`null`) may create the first row. */
        const result =
          expectedUpdatedAt === null
            ? await client.query<QueryResultRow>(
                `INSERT INTO personal.vaults (user_id, vault_blob) VALUES (current_setting('app.user_id'), $1) ON CONFLICT (user_id) DO UPDATE SET vault_blob = EXCLUDED.vault_blob, updated_at = CURRENT_TIMESTAMP WHERE personal.vaults.updated_at = $2::timestamptz RETURNING ${VAULT_VERSION}`,
                [blob, expectedUpdatedAt],
              )
            : await client.query<QueryResultRow>(
                `UPDATE personal.vaults SET vault_blob = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = current_setting('app.user_id') AND updated_at = $2::timestamptz RETURNING ${VAULT_VERSION}`,
                [blob, expectedUpdatedAt],
              );
        const row = result.rows[0];
        return row
          ? { status: "stored", updatedAt: row.updated_at as string }
          : { status: "conflict" };
      });
    },
    /** Replace whatever the server holds. Only for a user who has been shown the conflict and chose. */
    async overwrite(blob: Buffer): Promise<{ updatedAt: string }> {
      if (blob.length === 0) throw new Error("Vault blob is empty");
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `INSERT INTO personal.vaults (user_id, vault_blob) VALUES (current_setting('app.user_id'), $1) ON CONFLICT (user_id) DO UPDATE SET vault_blob = EXCLUDED.vault_blob, updated_at = CURRENT_TIMESTAMP RETURNING ${VAULT_VERSION}`,
          [blob],
        );
        return { updatedAt: result.rows[0]?.updated_at as string };
      });
    },
  };
}

export type PersonalNetWorthTotal = {
  date: string;
  totalCents: number;
  /** The agent-path citation for this valuation (#300, WS5.5), as stored JSON.
   *  Absent on rows the browser's own share flow wrote. */
  provenance?: Record<string, unknown>;
};

/**
 * Personal's opt-in share of its own "Totale positie" into Investing's net
 * worth (0019_personal_net_worth_totals.sql). Personal owns every write —
 * `put` is called once per day, from the browser, only while the switch is on
 * and the vault is unlocked. `list` is Investing's read side: it needs the
 * whole history to carry the latest total forward onto days with no total of
 * their own, so unlike every other repository in this file it takes no
 * upper bound and returns everything the tenant has.
 */
export function createPersonalNetWorthRepository(db: Database, userId: string | undefined | null) {
  const tenantId = requireUserId(userId);
  return {
    async put(
      date: string,
      totalCents: number,
      provenance?: Record<string, unknown>,
    ): Promise<void> {
      await withTenantStatement(db, tenantId, async (client) => {
        await client.query(
          `INSERT INTO personal.net_worth_totals (user_id, date, total_cents, currency, provenance)
           VALUES (current_setting('app.user_id'), $1, $2, 'EUR', $3::jsonb)
           ON CONFLICT (user_id, date) DO UPDATE SET
             total_cents = EXCLUDED.total_cents,
             provenance = EXCLUDED.provenance,
             updated_at = CURRENT_TIMESTAMP`,
          [date, totalCents, provenance === undefined ? null : JSON.stringify(provenance)],
        );
      });
    },
    /** Every stored total, oldest first — Investing carries the latest one on
     *  or before a date forward, so it needs the full series, not a window.
     *  `date` is formatted in SQL rather than trusted from the driver: a DATE
     *  column round-trips as a string over Neon but as a JS `Date` under the
     *  PGlite driver these repositories are tested against, and `to_char`
     *  gives one answer regardless of which one is reading it back. */
    async list(): Promise<PersonalNetWorthTotal[]> {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `SELECT to_char(date, 'YYYY-MM-DD') AS date, total_cents, provenance
           FROM personal.net_worth_totals ORDER BY date ASC`,
        );
        return result.rows.map((row) => ({
          date: row.date as string,
          totalCents: Number(row.total_cents),
          ...(row.provenance && typeof row.provenance === "object"
            ? { provenance: row.provenance as Record<string, unknown> }
            : {}),
        }));
      });
    },
    /** Turning the share switch off: every stored total for this user, gone. */
    async deleteAll(): Promise<void> {
      await withTenantStatement(db, tenantId, async (client) => {
        await client.query("DELETE FROM personal.net_worth_totals");
      });
    },
  };
}
