import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "@neondatabase/serverless";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type Database = Pool;

export function createDatabase(connectionString = process.env.DATABASE_URL): Database {
  if (!connectionString?.trim()) throw new Error("DATABASE_URL is required");
  return new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000 });
}

export function requireUserId(userId: string | undefined | null): string {
  if (!userId?.trim()) throw new Error("Authenticated user identity is required");
  return userId;
}

/** Every request gets its own transaction. SET LOCAL cannot leak to another request. */
export async function withTenant<T>(db: Database, userId: string | undefined | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const identity = requireUserId(userId);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [identity]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function encryptionKey(): Buffer {
  const value = process.env.LAVEGA_ENCRYPTION_KEY;
  if (!value) throw new Error("LAVEGA_ENCRYPTION_KEY is required");
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("LAVEGA_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

/** Versioned AES-256-GCM envelope. Key never enters PostgreSQL. */
export function encryptBlob(value: unknown): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1, iv.length]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBlob<T>(blob: Buffer | Uint8Array): T {
  const bytes = Buffer.from(blob);
  if (bytes[0] !== 1 || bytes[1] !== 12 || bytes.length < 30) throw new Error("Invalid encrypted blob");
  const iv = bytes.subarray(2, 14);
  const tag = bytes.subarray(14, 30);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(30)), decipher.final()]).toString("utf8")) as T;
}

export type VaultRepository = {
  get<T>(): Promise<T | null>;
  put(value: unknown): Promise<void>;
};

export function createVaultRepository(db: Database, userId: string | undefined | null): VaultRepository {
  return {
    async get<T>() {
      return withTenant(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>("SELECT vault_blob FROM personal.vaults");
        return result.rows[0] ? decryptBlob<T>(result.rows[0].vault_blob as Buffer) : null;
      });
    },
    async put(value) {
      const blob = encryptBlob(value);
      await withTenant(db, userId, async (client) => {
        await client.query("INSERT INTO personal.vaults (user_id, vault_blob) VALUES (current_setting('app.user_id'), $1) ON CONFLICT (user_id) DO UPDATE SET vault_blob = EXCLUDED.vault_blob, updated_at = CURRENT_TIMESTAMP", [blob]);
      });
    },
  };
}

export type EncryptedBrokerRepository = {
  get<T>(broker: string): Promise<{ credentials: T; snapshot: unknown | null } | null>;
  put(broker: string, credentials: unknown, snapshot?: unknown): Promise<void>;
};

export function createBrokerRepository(db: Database, userId: string | undefined | null): EncryptedBrokerRepository {
  return {
    async get<T>(broker: string) {
      return withTenant(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>("SELECT credentials_blob, snapshot_blob FROM investing.broker_vaults WHERE broker = $1", [broker]);
        const row = result.rows[0];
        return row ? { credentials: decryptBlob<T>(row.credentials_blob as Buffer), snapshot: row.snapshot_blob ? decryptBlob(row.snapshot_blob as Buffer) : null } : null;
      });
    },
    async put(broker: string, credentials: unknown, snapshot?: unknown) {
      const credentialsBlob = encryptBlob(credentials);
      const snapshotBlob = snapshot === undefined ? null : encryptBlob(snapshot);
      await withTenant(db, userId, async (client) => {
        await client.query("INSERT INTO investing.broker_vaults (user_id, broker, credentials_blob, snapshot_blob) VALUES (current_setting('app.user_id'), $1, $2, $3) ON CONFLICT (user_id, broker) DO UPDATE SET credentials_blob = EXCLUDED.credentials_blob, snapshot_blob = COALESCE(EXCLUDED.snapshot_blob, investing.broker_vaults.snapshot_blob), updated_at = CURRENT_TIMESTAMP", [broker, credentialsBlob, snapshotBlob]);
      });
    },
  };
}

export type { PoolClient, QueryResult };
