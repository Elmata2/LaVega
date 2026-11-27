import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  CoverageLifecycleConflictError,
  createSharedPriceRepository,
  PriceClaimLostError,
  type SharedPriceCoverageRow,
} from "./sharedPrices.js";
import type { Database } from "./connection.js";
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
  await pglite.exec(
    "DELETE FROM investing.instrument_price_bars; DELETE FROM investing.instrument_price_coverage; DELETE FROM investing.instrument_price_claims;",
  );
});

const coverage = (
  instrumentKey: string,
  over: Partial<SharedPriceCoverageRow> = {},
): SharedPriceCoverageRow => ({
  instrumentKey,
  from: "2026-01-01",
  to: "2026-01-03",
  listing: "AAA.AS",
  currency: "EUR",
  provider: "yahoo",
  ...over,
});

test("replaceRange and putCoverage verify claim ownership when owner is supplied", async () => {
  const repo = createSharedPriceRepository(db);
  const key = "isin:US0378331005:USD";
  expect(await repo.claim(key, "run-1", 60_000)).toBe(true);

  await expect(
    repo.replaceRange(
      key,
      [{ instrumentKey: key, date: "2026-01-02", close: 100, currency: "USD" }],
      "2026-01-01",
      "2026-01-03",
      "run-2",
    ),
  ).rejects.toBeInstanceOf(PriceClaimLostError);
  expect(await repo.getRange({ key })).toEqual([]);

  await expect(repo.putCoverage(key, coverage(key), "run-2")).rejects.toBeInstanceOf(
    PriceClaimLostError,
  );
  expect(await repo.getCoverage({ key })).toBeNull();

  await repo.replaceRange(
    key,
    [{ instrumentKey: key, date: "2026-01-02", close: 100, currency: "USD" }],
    "2026-01-01",
    "2026-01-03",
    "run-1",
  );
  await repo.putCoverage(key, coverage(key, { currency: "USD" }), "run-1");
  expect(await repo.getRange({ key })).toHaveLength(1);
  expect(await repo.getCoverage({ key })).toMatchObject({ provider: "yahoo" });
});

test("renewClaim extends a live claim for its owner and refuses others or expired claims", async () => {
  const repo = createSharedPriceRepository(db);
  const key = "isin:NL0010273215:EUR";
  expect(await repo.claim(key, "run-1", 60_000)).toBe(true);
  expect(await repo.renewClaim(key, "run-1", 120_000)).toBe(true);
  expect(await repo.renewClaim(key, "run-2", 120_000)).toBe(false);

  await repo.release(key, "run-1");
  expect(await repo.renewClaim(key, "run-1", 120_000)).toBe(false);
});

test("putCoverage enforces mutual exclusion across lifecycle dates and adoptAlias reconciles them", async () => {
  const repo = createSharedPriceRepository(db);
  const key = "isin:NL0010273215:EUR";
  const alias = "sym:ASML:EUR";

  await expect(
    repo.putCoverage(
      key,
      coverage(key, {
        delistedSince: "2026-01-03",
        listingMissingSince: "2026-01-03T12:00:00.000Z",
      }),
    ),
  ).rejects.toBeInstanceOf(CoverageLifecycleConflictError);

  await repo.putCoverage(
    key,
    coverage(key, {
      from: "2026-01-02",
      to: "2026-01-05",
      provisionalThrough: "2026-01-05",
    }),
  );
  await repo.putCoverage(
    alias,
    coverage(alias, {
      from: "2026-01-01",
      to: "2026-01-03",
      delistedSince: "2026-01-03",
    }),
  );

  await repo.adoptAlias(key, alias);
  const merged = await repo.getCoverage({ key });
  expect(merged).toMatchObject({
    from: "2026-01-01",
    to: "2026-01-05",
    provisionalThrough: "2026-01-05",
  });
  expect(merged?.delistedSince).toBeUndefined();
  expect(merged?.listingMissingSince).toBeUndefined();
});
