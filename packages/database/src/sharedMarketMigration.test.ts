import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, test } from "vitest";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");
const MIGRATION = "0034_shared_market_data.sql";
let pglite: PGlite;

/** Applies every migration before the shared-market-data one, so this test can
 *  seed the OLD per-user tables the migration copies from. */
beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec("CREATE ROLE lavega_runtime LOGIN NOSUPERUSER;");
  for (const name of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql") && name < MIGRATION)
    .sort())
    await pglite.exec(readFileSync(join(migrationsDir, name), "utf8"));
}, 120_000);

afterAll(async () => {
  await pglite.close();
});

const coverage = (
  userId: string,
  symbol: string,
  from: string,
  to: string,
  listing: string | null,
  currency = "USD",
  updatedAt = "2026-05-01T00:00:00Z",
) => ({
  userId,
  symbol,
  from,
  to,
  listing,
  currency,
  updatedAt,
});

async function seed(
  rows: ReturnType<typeof coverage>[],
  bars: { userId: string; symbol: string; date: string; close: number; currency?: string }[],
): Promise<void> {
  for (const row of rows)
    await pglite.query(
      `INSERT INTO investing.price_coverage
         (user_id, symbol, from_date, to_date, listing, currency, provider, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'yahoo', $7)`,
      [row.userId, row.symbol, row.from, row.to, row.listing, row.currency, row.updatedAt],
    );
  for (const row of bars)
    await pglite.query(
      `INSERT INTO investing.price_bars
         (user_id, symbol, date, close, currency, provider, split)
       VALUES ($1, $2, $3, $4, $5, 'yahoo', 1)`,
      [row.userId, row.symbol, row.date, row.close, row.currency ?? "USD"],
    );
}

async function applyMigration(): Promise<void> {
  await pglite.exec(readFileSync(join(migrationsDir, MIGRATION), "utf8"));
}

test("copies agreeing _EQ and ^ symbols once, with the widest window, and drops the rest", async () => {
  await seed(
    [
      // Agreeing _EQ symbol: the widest window (user-a) wins.
      coverage(
        "user-a",
        "AAA_US_EQ",
        "2026-01-01",
        "2026-03-01",
        "AAA.US",
        "USD",
        "2026-05-01T00:00:00Z",
      ),
      coverage(
        "user-b",
        "AAA_US_EQ",
        "2026-02-01",
        "2026-02-15",
        "AAA.US",
        "USD",
        "2026-06-01T00:00:00Z",
      ),
      // Disagreeing listing: never copied.
      coverage("user-a", "DIS_EQ", "2026-01-01", "2026-02-01", "DIS.NYSE"),
      coverage("user-b", "DIS_EQ", "2026-01-01", "2026-02-01", "DIS.OTHER"),
      // Not derivable without an ISIN: never copied.
      coverage("user-a", "MSFT", "2026-01-01", "2026-02-01", "MSFT.US"),
      // An index: copied without an ISIN.
      coverage("user-a", "^GSPC", "2026-01-01", "2026-02-01", null),
    ],
    [
      { userId: "user-a", symbol: "AAA_US_EQ", date: "2026-01-02", close: 10 },
      { userId: "user-a", symbol: "AAA_US_EQ", date: "2026-01-03", close: 11 },
      { userId: "user-a", symbol: "AAA_US_EQ", date: "2026-01-04", close: 12 },
      { userId: "user-b", symbol: "AAA_US_EQ", date: "2026-02-02", close: 99 },
      { userId: "user-a", symbol: "DIS_EQ", date: "2026-01-02", close: 30 },
      { userId: "user-a", symbol: "MSFT", date: "2026-01-02", close: 200 },
      { userId: "user-a", symbol: "^GSPC", date: "2026-01-02", close: 5000 },
      { userId: "user-a", symbol: "^GSPC", date: "2026-01-03", close: 5010 },
    ],
  );

  await applyMigration();

  const keys = await pglite.query<{ instrument_key: string }>(
    "SELECT instrument_key FROM investing.instrument_price_coverage ORDER BY instrument_key",
  );
  expect(keys.rows.map((row) => row.instrument_key)).toEqual([
    "sym:AAA_US_EQ:USD",
    "sym:^GSPC:USD",
  ]);

  const winner = await pglite.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM investing.instrument_price_bars WHERE instrument_key = 'sym:AAA_US_EQ:USD'",
  );
  // The winner's three bars; user-b's fourth is not merged in.
  expect(winner.rows[0]!.n).toBe(3);
  const index = await pglite.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM investing.instrument_price_bars WHERE instrument_key = 'sym:^GSPC:USD'",
  );
  expect(index.rows[0]!.n).toBe(2);
  const everything = await pglite.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM investing.instrument_price_bars",
  );
  expect(everything.rows[0]!.n).toBe(5);

  // Tie-break: the widest window wins even though user-b updated later.
  const copied = await pglite.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM investing.instrument_price_bars WHERE close = 99",
  );
  expect(copied.rows[0]!.n).toBe(0);

  // The stored-dashboard column exists and defaults to an empty key list.
  const dashboard = await pglite.query<{ price_keys: string[] }>(
    "SELECT price_keys FROM investing.dashboard_snapshots LIMIT 1",
  );
  expect(dashboard.rows).toEqual([]);
  const column = await pglite.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'investing' AND table_name = 'dashboard_snapshots' AND column_name = 'price_keys'",
  );
  expect(column.rows[0]!.n).toBe(1);
});

test("the migration is rerunnable and the second run changes nothing", async () => {
  const before = await pglite.query<{ n: number; at: string | null }>(
    `SELECT count(*)::int AS n, to_char(max(updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS at
     FROM investing.instrument_price_bars`,
  );
  await applyMigration();
  const after = await pglite.query<{ n: number; at: string | null }>(
    `SELECT count(*)::int AS n, to_char(max(updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS at
     FROM investing.instrument_price_bars`,
  );
  expect(after.rows).toEqual(before.rows);
});
