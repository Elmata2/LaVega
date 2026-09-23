import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createFxRateRepository, type Database } from "./index.js";
import { databaseOver } from "./testing.js";

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
  db = databaseOver(async () => ({
    query: (sql: string, values?: unknown[]) => pglite.query(sql, values as never[]),
    release: () => undefined,
  }));
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await pglite.exec("DELETE FROM investing.fx_rates;");
});

const rate = (date: string, usd: number) => ({
  base: "EUR",
  date,
  rates: { USD: usd },
});

test("a range starts at the last published rate on or before its first day", async () => {
  const fx = createFxRateRepository(db);
  await fx.put([rate("2024-01-04", 1.09), rate("2024-01-05", 1.0921), rate("2024-01-08", 1.0946)]);

  expect(await fx.range("EUR", "2024-01-06", "2024-01-08")).toEqual([
    rate("2024-01-05", 1.0921),
    rate("2024-01-08", 1.0946),
  ]);
});

test("a range with nothing on or before its first day starts at its first day", async () => {
  const fx = createFxRateRepository(db);
  await fx.put([rate("2024-01-08", 1.0946)]);

  expect(await fx.range("EUR", "2024-01-01", "2024-01-31")).toEqual([rate("2024-01-08", 1.0946)]);
});

test("a rate written again replaces the stored one", async () => {
  const fx = createFxRateRepository(db);
  await fx.put([rate("2024-01-08", 1.0)]);
  await fx.put([rate("2024-01-08", 1.0946)]);

  expect(await fx.range("EUR", "2024-01-08", "2024-01-08")).toEqual([rate("2024-01-08", 1.0946)]);
});
