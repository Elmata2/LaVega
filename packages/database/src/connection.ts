import {
  neon,
  Pool,
  type NeonQueryFunction,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "@neondatabase/serverless";

export type { PoolClient, QueryResult };

/** The pool carries multi-statement transactions; `http` carries the rest. */
export type Database = Pool & { readonly http: NeonQueryFunction<false, true> };

function poolErrorText(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "connection closed";
}

export function createDatabase(connectionString = process.env.DATABASE_URL): Database {
  if (!connectionString?.trim()) throw new Error("DATABASE_URL is required");
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  });
  /* An idle Neon socket that dies without a close frame emits an ErrorEvent,
   * not an Error, and the message is empty. This driver throws that as
   * "Unhandled error. ()" unless the pool is listening. pg-pool has already
   * discarded the client. */
  pool.on("error", (error: unknown) => {
    console.error(`database pool: ${poolErrorText(error)}`);
  });
  return Object.assign(pool, { http: neon(connectionString, { fullResults: true }) });
}

export function requireUserId(userId: string | undefined | null): string {
  if (!userId?.trim()) throw new Error("Authenticated user identity is required");
  return userId;
}

/** Every request gets its own transaction. SET LOCAL cannot leak to another request. */
export async function withTenant<T>(
  db: Database,
  userId: string | undefined | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
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

export type TenantStatement = {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
};

/**
 * One statement as the tenant, in one round trip.
 *
 * `withTenant` over the pool costs five: connect, BEGIN, set_config, the
 * statement and COMMIT. Neon's HTTP transaction sends set_config and the
 * statement in one request and wraps them in BEGIN and COMMIT on the server, so
 * RLS sees the same `app.user_id` for the same single transaction. The client
 * takes one statement. A second would run outside that transaction, so it
 * throws; code that needs two belongs in `withTenant`.
 */
export async function withTenantStatement<T>(
  db: Database,
  userId: string | undefined | null,
  fn: (client: TenantStatement) => Promise<T>,
): Promise<T> {
  const identity = requireUserId(userId);
  let sent = false;
  return fn({
    async query<R extends QueryResultRow>(text: string, params: unknown[] = []) {
      if (sent) throw new Error("withTenantStatement runs one statement; use withTenant for more");
      sent = true;
      const [, result] = await db.http.transaction([
        db.http.query("SELECT set_config('app.user_id', $1, true)", [identity]),
        db.http.query(text, params),
      ]);
      return result as unknown as QueryResult<R>;
    },
  });
}

/** PostgreSQL unique-violation (23505) check. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}
