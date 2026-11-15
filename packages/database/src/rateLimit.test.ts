import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createRateLimitRepository, type Database } from "./index.js";
import { databaseOver } from "./testing.js";

/* Real migrations against real Postgres (PGlite). The limit is enforced by one
 * upsert statement and the cleanup by a CTE in that same statement; a mock
 * would assert the SQL text we happened to write, not what the database does
 * with a repeated key. */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");
const KEY = "a".repeat(64);

let pglite: PGlite;
let db: Database;

/** PGlite is one connection, so each statement finishes before the next. */
function pgliteDatabase(instance: PGlite): Database {
  let inUse: Promise<unknown> = Promise.resolve();
  return databaseOver(async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const ahead = inUse;
    inUse = inUse.then(() => held);
    await ahead;
    return {
      query: (sql: string, values?: unknown[]) => instance.query(sql, values as never[]),
      release,
    };
  });
}

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec("CREATE ROLE lavega_runtime LOGIN NOSUPERUSER;");
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await pglite.exec(readFileSync(join(migrationsDir, file), "utf8"));
  await pglite.exec("SET ROLE lavega_runtime;");
  db = pgliteDatabase(pglite);
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await db.http.query("DELETE FROM personal.rate_limit_buckets");
});

const consume = (at: number, max = 2, windowMs = 1000) =>
  createRateLimitRepository(db, { max, windowMs }).consume(KEY, at);

test("allows max hits in a window, then refuses the next", async () => {
  expect(await consume(0)).toBe(true);
  expect(await consume(10)).toBe(true);
  expect(await consume(20)).toBe(false);
});

test("a new window starts a new budget", async () => {
  expect(await consume(0)).toBe(true);
  expect(await consume(10)).toBe(true);
  expect(await consume(20)).toBe(false);
  expect(await consume(1000)).toBe(true);
  expect(await consume(1010)).toBe(true);
  expect(await consume(1020)).toBe(false);
});

test("a different key has its own budget", async () => {
  const repository = createRateLimitRepository(db, { max: 1, windowMs: 1000 });
  expect(await repository.consume("b".repeat(64), 0)).toBe(true);
  expect(await repository.consume("c".repeat(64), 0)).toBe(true);
  expect(await repository.consume("b".repeat(64), 0)).toBe(false);
});

test("two repository instances over one database share one counter", async () => {
  const instanceA = createRateLimitRepository(db, { max: 2, windowMs: 1000 });
  const instanceB = createRateLimitRepository(db, { max: 2, windowMs: 1000 });
  expect(await instanceA.consume(KEY, 0)).toBe(true);
  expect(await instanceA.consume(KEY, 0)).toBe(true);
  expect(await instanceB.consume(KEY, 0)).toBe(false);
});

test("hits for a retired window are deleted in the same statement", async () => {
  expect(await consume(0)).toBe(true);
  const before = await db.http.query("SELECT count(*)::int AS n FROM personal.rate_limit_buckets");
  expect(before.rows[0]?.n).toBe(1);

  // Two windows later the row at window 0 is older than the prune boundary.
  expect(await consume(2000)).toBe(true);
  const after = await db.http.query(
    "SELECT count(*)::int AS n, min(window_start) AS oldest FROM personal.rate_limit_buckets",
  );
  expect(after.rows[0]?.n).toBe(1);
  expect(new Date(after.rows[0]!.oldest as string).getTime()).toBe(2000);
});

test("the table stores exactly the digest it is given, never the caller's key", async () => {
  expect(await consume(0)).toBe(true);
  const rows = await db.http.query("SELECT key_hash FROM personal.rate_limit_buckets");
  expect((rows.rows as Array<{ key_hash: string }>).map((row) => row.key_hash)).toEqual([KEY]);
});
