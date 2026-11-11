import { afterEach, expect, test, vi } from "vitest";
import {
  createNeonBenchmarkSelectionStore,
  createNeonInvestingLayoutStore,
  createNeonMarketDataConsentStore,
  createNeonSectorCorrectionStore,
  createNeonSectorInferenceSettingStore,
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

test("sector corrections and the inference setting run under the caller's tenant, not another one's", async () => {
  const { db, calls } = fakeDatabase([{ sector_corrections: {} }]);
  await createNeonSectorCorrectionStore(db).set("user-a", "AAPL", "Healthcare");
  await createNeonSectorInferenceSettingStore(db).set("user-b", true);

  expect(identities(calls)).toEqual(["user-a", "user-a", "user-b"]);
});
