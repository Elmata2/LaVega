import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPersonalNetWorthRepository, eraseUserData, type Database } from "./index.js";
import { singleConnectionDatabase } from "./testing.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");
let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec("CREATE ROLE lavega_runtime LOGIN NOSUPERUSER;");
  for (const name of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await pglite.exec(readFileSync(join(migrationsDir, name), "utf8"));
  await pglite.exec("SET ROLE lavega_runtime;");
  db = singleConnectionDatabase(pglite);
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

test("a total round-trips per user and a second write for the same date replaces it", async () => {
  const totals = createPersonalNetWorthRepository(db, "user-a");
  expect(await totals.list()).toEqual([]);

  await totals.put("2026-09-01", 123_456);
  await totals.put("2026-09-01", 200_000);
  await totals.put("2026-09-02", -50_00);

  expect(await totals.list()).toEqual([
    { date: "2026-09-01", totalCents: 200_000 },
    { date: "2026-09-02", totalCents: -5000 },
  ]);
});

test("one user's totals are invisible to another", async () => {
  await createPersonalNetWorthRepository(db, "user-b").put("2026-09-01", 111);
  expect(await createPersonalNetWorthRepository(db, "user-c").list()).toEqual([]);
});

test("turning sharing off deletes every stored total for that user only", async () => {
  const owner = createPersonalNetWorthRepository(db, "user-d");
  const other = createPersonalNetWorthRepository(db, "user-e");
  await owner.put("2026-09-01", 100);
  await owner.put("2026-09-02", 200);
  await other.put("2026-09-01", 300);

  await owner.deleteAll();

  expect(await owner.list()).toEqual([]);
  expect(await other.list()).toEqual([{ date: "2026-09-01", totalCents: 300 }]);
});

test("account erasure removes stored net worth totals", async () => {
  const owner = createPersonalNetWorthRepository(db, "user-f");
  await owner.put("2026-09-01", 100);

  await eraseUserData(db, "user-f");

  expect(await owner.list()).toEqual([]);
});
