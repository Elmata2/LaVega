import { afterEach, expect, test, vi } from "vitest";
import {
  createNeonBenchmarkSelectionStore,
  createNeonInvestingLayoutStore,
  createNeonMarketDataConsentStore,
  createNeonPriceStore,
} from "./neonStores.js";
import { YAHOO_DISCLOSURE_VERSION } from "./marketDataConsent.js";
import { databaseOver } from "@lavega/database/testing";

/** A pool whose client records every statement and replays canned rows. */
function fakeDatabase(rows: Record<string, unknown>[] = []) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: sql.startsWith("SELECT set_config") ? [] : rows };
    },
    release: () => undefined,
  };
  return { db: databaseOver(async () => client), calls };
}

const identities = (calls: Array<{ sql: string; values?: unknown[] }>) =>
  calls.filter((call) => call.sql.startsWith("SELECT set_config")).map((call) => call.values?.[0]);

const executed = (calls: Array<{ sql: string; values?: unknown[] }>) =>
  calls.filter(
    (call) =>
      !["BEGIN", "COMMIT", "ROLLBACK"].includes(call.sql) &&
      !call.sql.startsWith("SELECT set_config"),
  );

afterEach(() => vi.clearAllMocks());

test("price reads and writes run under the tenant that owns the bars", async () => {
  const { db, calls } = fakeDatabase([
    { symbol: "AAPL", date: "2026-01-02", close: "120.5", currency: "USD" },
  ]);
  const store = createNeonPriceStore(db, () => "user-purge");

  await store.getRange("user-a", "AAPL", "2026-01-01", "2026-01-31");
  await store.upsert("user-b", [{ symbol: "AAPL", date: "2026-01-02", close: 1, currency: "USD" }]);
  await store.replaceRange("user-c", "AAPL", [], "2026-01-01");
  await store.purgeAll();

  expect(identities(calls)).toEqual(["user-a", "user-b", "user-c", "user-purge"]);
});

test("purging the price cache clears only the caller's rows", async () => {
  const { db, calls } = fakeDatabase();

  await createNeonPriceStore(db, () => "user-a").purgeAll();

  expect(
    calls.some(
      (call) =>
        call.sql ===
        "WITH coverage AS (DELETE FROM investing.price_coverage) DELETE FROM investing.price_bars",
    ),
  ).toBe(true);
  expect(calls.some((call) => call.sql.includes("TRUNCATE"))).toBe(false);
});

test("benchmark selection is validated on the way in and out", async () => {
  const { db, calls } = fakeDatabase([{ benchmark_symbols: ["^AEX", "^GSPC"] }]);
  const store = createNeonBenchmarkSelectionStore(db);

  expect(await store.get("user-a")).toEqual({ tenantId: "user-a", symbols: ["^AEX", "^GSPC"] });

  await expect(store.set({ tenantId: "user-a", symbols: ["A", "B", "C", "D"] })).rejects.toThrow();
  expect(calls.some((call) => call.sql.includes("INSERT INTO investing.preferences"))).toBe(false);
});

test("investing layout is validated on the way in and out", async () => {
  const { db, calls } = fakeDatabase([{ layout: { modules: { positions: false }, widgets: {} } }]);
  const store = createNeonInvestingLayoutStore(db);

  await expect(store.get("user-123")).resolves.toEqual({
    modules: { positions: false },
    widgets: {},
  });

  await store.set({ tenantId: "user-123", modules: {}, widgets: { sectors: false } });
  const write = executed(calls).at(-1)!;
  expect(write.sql).toContain("layout");
  expect(write.values).toEqual([JSON.stringify({ modules: {}, widgets: { sectors: false } })]);
});

test("a tenant with no preferences row reads an empty layout from Neon", async () => {
  const store = createNeonInvestingLayoutStore(fakeDatabase().db);
  await expect(store.get("user-123")).resolves.toEqual({ modules: {}, widgets: {} });
});

test("consent given to an older disclosure does not count as consent to this one", async () => {
  const stale = fakeDatabase([
    {
      market_data_consent: {
        accepted: true,
        decidedAt: "2026-01-01T00:00:00.000Z",
        disclosureVersion: "yahoo-finance-v0",
      },
    },
  ]);

  expect(await createNeonMarketDataConsentStore(stale.db).get("user-a")).toEqual({
    tenantId: "user-a",
    accepted: false,
    decidedAt: null,
    disclosureVersion: YAHOO_DISCLOSURE_VERSION,
  });
});

test("consent to the current disclosure is read back as given", async () => {
  const current = fakeDatabase([
    {
      market_data_consent: {
        accepted: true,
        decidedAt: "2026-08-31T00:00:00.000Z",
        disclosureVersion: YAHOO_DISCLOSURE_VERSION,
      },
    },
  ]);

  expect(await createNeonMarketDataConsentStore(current.db).get("user-a")).toMatchObject({
    accepted: true,
    decidedAt: "2026-08-31T00:00:00.000Z",
  });
});

test("a tenant with no preferences row has no benchmarks and no consent", async () => {
  const { db } = fakeDatabase();

  expect(await createNeonBenchmarkSelectionStore(db).get("user-a")).toEqual({
    tenantId: "user-a",
    symbols: [],
  });
  expect(await createNeonMarketDataConsentStore(db).get("user-a")).toMatchObject({
    accepted: false,
  });
});
