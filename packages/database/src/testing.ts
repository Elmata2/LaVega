import type { Database } from "./index.js";

type Statement = { text: string; params: unknown[] };
type Connection = {
  query(text: string, params?: unknown[]): Promise<unknown>;
  release(): void;
};

/**
 * A `Database` for tests, built on whatever hands out a connection.
 *
 * Neon wraps an HTTP transaction in BEGIN and COMMIT on the server. This runs
 * the same statements on a connection from `connect`, so a test sees the same
 * sequence from either path and a fake needs only its one client.
 */
export function databaseOver(connect: () => Promise<Connection>): Database {
  const http = {
    /* Neon's statement is lazy: awaited alone it runs by itself, and inside
     * `transaction` it runs there instead. A Promise would already have run. */
    query: (text: string, params: unknown[] = []) => ({
      text,
      params,
      // eslint-disable-next-line unicorn/no-thenable
      async then<R>(resolve: (result: unknown) => R, reject: (error: unknown) => R) {
        const client = await connect();
        try {
          return resolve(await client.query(text, params));
        } catch (error) {
          return reject(error);
        } finally {
          client.release();
        }
      },
    }),
    async transaction(statements: Statement[]) {
      const client = await connect();
      try {
        await client.query("BEGIN");
        const results = [];
        for (const { text, params } of statements) results.push(await client.query(text, params));
        await client.query("COMMIT");
        return results;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
  return { connect, http } as unknown as Database;
}
