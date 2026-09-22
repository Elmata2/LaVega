import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  createBrokerRepository,
  createDashboardSnapshotRepository,
  createPreferencesRepository,
  createPriceBarRepository,
  eraseUserData,
  type Database,
} from "./index.js";
import { databaseOver } from "./testing.js";

/* Staleness is decided by triggers, so these run the real migrations on real
 * Postgres. A mock could only assert the SQL text, not that a write in another
 * table retires the stored dashboard. */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");
let pglite: PGlite;
let db: Database;

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
  process.env.LAVEGA_ENCRYPTION_KEY = "11".repeat(32);
  pglite = new PGlite();
  await pglite.exec("CREATE ROLE lavega_runtime LOGIN NOSUPERUSER;");
  for (const name of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await pglite.exec(readFileSync(join(migrationsDir, name), "utf8"));
  // Only a non-superuser is subject to row-level security.
  await pglite.exec("SET ROLE lavega_runtime;");
  db = pgliteDatabase(pglite);
}, 60_000);

afterAll(async () => {
  delete process.env.LAVEGA_ENCRYPTION_KEY;
  await pglite.close();
});

beforeEach(async () => {
  await pglite.exec(
    "RESET ROLE; DELETE FROM investing.dashboard_snapshots; DELETE FROM investing.dashboard_sources; DELETE FROM investing.price_bars; SET ROLE lavega_runtime;",
  );
});

const bar = (close: number) => ({ symbol: "AAPL", date: "2026-09-01", close, currency: "USD" });

test("a stored dashboard is served until a source it was built from changes", async () => {
  const dashboards = createDashboardSnapshotRepository(db, "user-a");
  const miss = await dashboards.get("");
  expect(miss.dashboard).toBeNull();

  await dashboards.put("", miss.version, { value: 1 });
  expect((await dashboards.get("")).dashboard).toEqual({ value: 1 });

  await createPriceBarRepository(db, "user-a").upsert([bar(100)]);
  expect((await dashboards.get("")).dashboard).toBeNull();
});

test("benchmark and broker writes retire the stored dashboard too", async () => {
  const dashboards = createDashboardSnapshotRepository(db, "user-a");
  await dashboards.put("", (await dashboards.get("")).version, { value: 1 });
  await createPreferencesRepository(db, "user-a").setBenchmarkSymbols(["^AEX"]);
  expect((await dashboards.get("")).dashboard).toBeNull();

  await dashboards.put("", (await dashboards.get("")).version, { value: 2 });
  await createBrokerRepository(db, "user-a").put("trading212", { token: "t" });
  expect((await dashboards.get("")).dashboard).toBeNull();
});

test("a dashboard built from data a sync replaced mid-build is never served", async () => {
  const dashboards = createDashboardSnapshotRepository(db, "user-a");
  const { version: builtAt } = await dashboards.get("");

  await createPriceBarRepository(db, "user-a").upsert([bar(100)]);
  await dashboards.put("", builtAt, { value: "stale" });

  expect((await dashboards.get("")).dashboard).toBeNull();
});

test("one user's writes leave another user's dashboard current, and hidden", async () => {
  const mine = createDashboardSnapshotRepository(db, "user-a");
  const theirs = createDashboardSnapshotRepository(db, "user-b");
  await mine.put("", (await mine.get("")).version, { owner: "a" });

  await createPriceBarRepository(db, "user-b").upsert([bar(100)]);

  expect((await mine.get("")).dashboard).toEqual({ owner: "a" });
  expect((await theirs.get("")).dashboard).toBeNull();
});

test("erasing a user leaves no stored dashboard or version behind", async () => {
  const dashboards = createDashboardSnapshotRepository(db, "user-a");
  await createPriceBarRepository(db, "user-a").upsert([bar(100)]);
  await dashboards.put("", (await dashboards.get("")).version, { value: 1 });

  await eraseUserData(db, "user-a");

  await pglite.exec("RESET ROLE");
  const left = await pglite.query<{ n: number }>(
    "SELECT (SELECT count(*) FROM investing.dashboard_sources WHERE user_id = 'user-a') + (SELECT count(*) FROM investing.dashboard_snapshots WHERE user_id = 'user-a') AS n",
  );
  await pglite.exec("SET ROLE lavega_runtime");
  expect(Number(left.rows[0]?.n)).toBe(0);
});
