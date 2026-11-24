import type { QueryResultRow } from "@neondatabase/serverless";
import { withTenant, withTenantStatement, type Database } from "./connection.js";
import { encryptBlob, tryDecryptBlob } from "./crypto.js";

export type EncryptedBrokerRepository = {
  get<T>(broker: string): Promise<{ credentials: T; credentialGeneration: number } | null>;
  /** Every broker's snapshot in one read. Snapshots are the large part of a
   *  vault row, so `get` leaves them out and only this reads them. */
  snapshots(): Promise<Record<string, unknown> | null>;
  /** Writing credentials starts a new generation: whatever a running sync is
   *  reading belongs to the connection this call replaces. */
  put(broker: string, credentials: unknown, snapshot?: unknown): Promise<void>;
  /** Stores broker data alone. The credential blob is left untouched, so a
   *  reconnect that lands mid-sync is not reverted by the snapshot write that
   *  follows it. False means the credentials moved on and the data was dropped. */
  putSnapshot(broker: string, snapshot: unknown, credentialGeneration: number): Promise<boolean>;
  /** Creates a snapshot-only row for a broker the vault stores no credentials
   *  for (a file import). False when the row carries credentials: that broker's
   *  sync owns its snapshot. */
  putSnapshotOnly(broker: string, snapshot: unknown): Promise<boolean>;
};

export class UnreadableBrokerCredentialsError extends Error {
  constructor() {
    super("Stored broker credentials cannot be read with the current LAVEGA_ENCRYPTION_KEY");
    this.name = "UnreadableBrokerCredentialsError";
  }
}

export function createBrokerRepository(
  db: Database,
  userId: string | undefined | null,
): EncryptedBrokerRepository {
  return {
    async get<T>(broker: string) {
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT credentials_blob, credential_generation FROM investing.broker_vaults WHERE broker = $1",
          [broker],
        );
        const row = result.rows[0];
        if (!row) return null;
        const credentials = tryDecryptBlob<T>(row.credentials_blob as Buffer);
        /* Credentials are the only copy there is. Reporting them as missing
         * would send the user to re-enter their broker tokens, and that write
         * would replace ciphertext a restored key could still have opened. */
        if (!credentials.readable) throw new UnreadableBrokerCredentialsError();
        return {
          credentials: credentials.value,
          credentialGeneration: Number(row.credential_generation ?? 1),
        };
      });
    },
    async snapshots() {
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT broker, snapshot_blob FROM investing.broker_vaults",
        );
        // No row at all is an empty vault, which callers treat unlike one without data yet.
        if (result.rows.length === 0) return null;
        const snapshots: Record<string, unknown> = {};
        for (const row of result.rows) {
          // The snapshot is a cache of broker data. A sync rebuilds it, so an
          // unreadable one is dropped rather than taking the account down.
          if (!row.snapshot_blob) continue;
          const snapshot = tryDecryptBlob(row.snapshot_blob as Buffer);
          if (snapshot.readable) snapshots[row.broker as string] = snapshot.value;
        }
        return snapshots;
      });
    },
    async put(broker: string, credentials: unknown, snapshot?: unknown) {
      const credentialsBlob = encryptBlob(credentials);
      const snapshotBlob = snapshot === undefined ? null : encryptBlob(snapshot);
      await withTenant(db, userId, async (client) => {
        await client.query(
          "INSERT INTO investing.broker_vaults (user_id, broker, credentials_blob, snapshot_blob) VALUES (current_setting('app.user_id'), $1, $2, $3) ON CONFLICT (user_id, broker) DO UPDATE SET credentials_blob = EXCLUDED.credentials_blob, snapshot_blob = EXCLUDED.snapshot_blob, credential_generation = investing.broker_vaults.credential_generation + 1, updated_at = CURRENT_TIMESTAMP",
          [broker, credentialsBlob, snapshotBlob],
        );
        // A new connection must never resume another account's history or lease.
        await client.query("DELETE FROM investing.sync_state WHERE broker = $1", [broker]);
      });
    },
    async putSnapshot(broker: string, snapshot: unknown, credentialGeneration: number) {
      const snapshotBlob = encryptBlob(snapshot);
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query(
          "UPDATE investing.broker_vaults SET snapshot_blob = $2, updated_at = CURRENT_TIMESTAMP WHERE broker = $1 AND credential_generation = $3 RETURNING broker",
          [broker, snapshotBlob, credentialGeneration],
        );
        return result.rows.length > 0;
      });
    },
    async putSnapshotOnly(broker: string, snapshot: unknown) {
      const snapshotBlob = encryptBlob(snapshot);
      return withTenantStatement(db, userId, async (client) => {
        /* The WHERE on the conflict update is the guard: a row that carries
         * credentials belongs to a broker with an API, whose sync alone may
         * write its snapshot. */
        const result = await client.query(
          "INSERT INTO investing.broker_vaults (user_id, broker, credentials_blob, snapshot_blob) VALUES (current_setting('app.user_id'), $1, NULL, $2) ON CONFLICT (user_id, broker) DO UPDATE SET snapshot_blob = EXCLUDED.snapshot_blob, updated_at = CURRENT_TIMESTAMP WHERE investing.broker_vaults.credentials_blob IS NULL RETURNING broker",
          [broker, snapshotBlob],
        );
        return result.rows.length > 0;
      });
    },
  };
}

/**
 * Every user with a connected broker, least recently synced first.
 *
 * Deliberately the one read in this file with no tenant: it calls the
 * SECURITY DEFINER function from 0022, which returns user ids and nothing else.
 * The table's own policy is untouched, so a query for anything more still sees
 * only the tenant it names.
 */
export async function listBrokerSyncTenants(db: Database): Promise<string[]> {
  const result = await db.http.query("SELECT tenant_id FROM investing.list_broker_sync_tenants()");
  return result.rows.map((row) => String(row.tenant_id));
}
