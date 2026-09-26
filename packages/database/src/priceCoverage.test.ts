import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPriceBarRepository, eraseUserData, type Database } from "./index.js";
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

const coverage = {
  symbol: "ASML",
  from: "2025-06-02",
  to: "2025-09-30",
  listing: "ASML.AS",
  currency: "EUR",
};

test("coverage round-trips per user and is replaced, not duplicated", async () => {
  const prices = createPriceBarRepository(db, "user-a");
  expect(await prices.getCoverage("ASML")).toBeNull();

  await prices.putCoverage(coverage);
  await prices.putCoverage({ ...coverage, from: "2024-06-03", listing: null });

  expect(await prices.getCoverage("ASML")).toEqual({
    ...coverage,
    from: "2024-06-03",
    listing: null,
  });
  expect(await createPriceBarRepository(db, "user-b").getCoverage("ASML")).toBeNull();
});

test("purging a user's price cache also forgets what it covered", async () => {
  const prices = createPriceBarRepository(db, "user-c");
  await prices.upsert([{ symbol: "ASML", date: "2025-06-02", close: 1, currency: "EUR" }]);
  await prices.putCoverage(coverage);
  await createPriceBarRepository(db, "user-d").putCoverage(coverage);

  await prices.purgeAll();

  expect(await prices.getCoverage("ASML")).toBeNull();
  expect(await prices.getRange("ASML")).toEqual([]);
  expect(await createPriceBarRepository(db, "user-d").getCoverage("ASML")).toEqual(coverage);
});

test("replacing a window deletes the bars the new answer lacks, for that user and symbol only", async () => {
  const bar = (date: string, close: number, currency = "EUR") => ({
    symbol: "ASML",
    date,
    close,
    currency,
    split: 1,
  });
  const prices = createPriceBarRepository(db, "user-f");
  await prices.upsert([bar("2025-01-17", 1), bar("2025-01-20", 2), bar("2025-01-21", 3)]);
  await prices.upsert([{ ...bar("2025-01-20", 2), symbol: "ASM" }]);
  await createPriceBarRepository(db, "user-g").upsert([bar("2025-01-20", 2)]);

  await prices.replaceRange("ASML", [bar("2025-01-21", 30, "USD")], "2025-01-18");

  expect(await prices.getRange("ASML")).toEqual([
    bar("2025-01-17", 1),
    bar("2025-01-21", 30, "USD"),
  ]);
  expect(await prices.getRange("ASM")).toHaveLength(1);
  expect(await createPriceBarRepository(db, "user-g").getRange("ASML")).toHaveLength(1);
});

test("erasure removes a user's coverage", async () => {
  await createPriceBarRepository(db, "user-e").putCoverage(coverage);

  await eraseUserData(db, "user-e");

  expect(await createPriceBarRepository(db, "user-e").getCoverage("ASML")).toBeNull();
});
