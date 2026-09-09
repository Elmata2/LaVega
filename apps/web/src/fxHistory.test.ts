// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { rateOn } from "@lavega/core";
import { createEncryptedStorage, type VaultStorage } from "@lavega/adapters";
import { syncFxHistory } from "./fxHistory.js";

const acc = (key: string, currency: string): Account => ({
  key,
  iban: key,
  name: key,
  bank: "",
  entity: "BV1",
  currency,
  balance: 100,
});

const tx = (id: string, currency: string, date: string): Tx => ({
  id,
  accountKey: "A1",
  date,
  amount: -5,
  currency,
  counterparty: "",
  description: "",
  category: "",
  manual: false,
});

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
const todayIso = () => new Date().toISOString().slice(0, 10);

async function unlocked(dbName: string): Promise<VaultStorage> {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage(dbName);
  await v.setup("pw");
  return v;
}

function stubFetch(byCurrency: Record<string, { status: number; rates?: Record<string, number> }>) {
  const fetchMock = vi.fn(async (url: string) => {
    const match = /currency=([A-Z]+)/.exec(String(url));
    const currency = match?.[1] ?? "";
    const entry = byCurrency[currency];
    if (entry == null) return new Response(null, { status: 404 });
    if (entry.status !== 200) return new Response(null, { status: entry.status });
    return new Response(JSON.stringify({ base: "EUR", currency, rates: entry.rates }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => vi.unstubAllGlobals());

test("a currency present in txs but not yet in history fetches from the earliest tx date and persists the merged result", async () => {
  const storage = await unlocked("lavega-vault-test-fxhistory-new");
  const fetchMock = stubFetch({
    HUF: { status: 200, rates: { "2026-08-01": 390.5, "2026-08-02": 391.2 } },
  });

  const accounts = [acc("A1", "HUF")];
  const txs = [tx("t1", "HUF", "2026-08-02"), tx("t2", "HUF", "2026-07-20")];

  await syncFxHistory(storage, accounts, txs);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const url = String(fetchMock.mock.calls[0]![0]);
  expect(url).toContain("currency=HUF");
  expect(url).toContain("from=2026-07-20");

  expect(await storage.getFxHistory()).toEqual({
    HUF: { "2026-08-01": 390.5, "2026-08-02": 391.2 },
  });
});

test("a currency already in history only re-fetches from near its latest cached date", async () => {
  const storage = await unlocked("lavega-vault-test-fxhistory-refresh");
  await storage.putFxHistory({ HUF: { "2026-08-01": 390.5, "2026-08-05": 391.9 } });
  const fetchMock = stubFetch({
    HUF: { status: 200, rates: { "2026-08-05": 392.0, "2026-08-06": 392.4 } },
  });

  const accounts = [acc("A1", "HUF")];
  const txs = [tx("t1", "HUF", "2026-08-06")];

  await syncFxHistory(storage, accounts, txs);

  const url = String(fetchMock.mock.calls[0]![0]);
  expect(url).toContain(`from=${addDays("2026-08-05", -5)}`);

  expect(await storage.getFxHistory()).toEqual({
    HUF: { "2026-08-01": 390.5, "2026-08-05": 392.0, "2026-08-06": 392.4 },
  });
});

test("a currency already cached from June re-fetches from an older tx date newly imported in March", async () => {
  const storage = await unlocked("lavega-vault-test-fxhistory-backfill");
  await storage.putFxHistory({ HUF: { "2026-06-01": 388.0, "2026-06-10": 389.4 } });
  const fetchMock = stubFetch({
    HUF: { status: 200, rates: { "2026-03-15": 385.0, "2026-06-10": 389.4 } },
  });

  const accounts = [acc("A1", "HUF")];
  const txs = [tx("t1", "HUF", "2026-06-08"), tx("t2", "HUF", "2026-03-15")];

  await syncFxHistory(storage, accounts, txs);

  const url = String(fetchMock.mock.calls[0]![0]);
  expect(url).toContain("from=2026-03-15");

  expect(await storage.getFxHistory()).toEqual({
    HUF: { "2026-03-15": 385.0, "2026-06-01": 388.0, "2026-06-10": 389.4 },
  });
});

test("a currency present only on an account (no txs) fetches with the 30-day fallback", async () => {
  const storage = await unlocked("lavega-vault-test-fxhistory-account-only");
  const fetchMock = stubFetch({ HUF: { status: 200, rates: { [todayIso()]: 390.5 } } });

  const accounts = [acc("A1", "HUF")];
  const txs: Tx[] = [];

  await syncFxHistory(storage, accounts, txs);

  const url = String(fetchMock.mock.calls[0]![0]);
  expect(url).toContain(`from=${addDays(todayIso(), -30)}`);
});

test("EUR-only accounts/txs trigger zero fetches", async () => {
  const storage = await unlocked("lavega-vault-test-fxhistory-eur-only");
  const fetchMock = stubFetch({});
  const putSpy = vi.spyOn(storage, "putFxHistory");

  const accounts = [acc("A1", "EUR"), acc("A2", "eur")];
  const txs = [tx("t1", "EUR", "2026-08-01"), tx("t2", "", "2026-08-01")];

  await syncFxHistory(storage, accounts, txs);

  expect(fetchMock).not.toHaveBeenCalled();
  expect(putSpy).not.toHaveBeenCalled();
});

test("a fetch failure for one currency doesn't prevent others from succeeding and being persisted", async () => {
  const storage = await unlocked("lavega-vault-test-fxhistory-partial-failure");
  stubFetch({
    HUF: { status: 500 },
    USD: { status: 200, rates: { "2026-08-01": 1.08 } },
  });

  const accounts = [acc("A1", "HUF"), acc("A2", "USD")];
  const txs = [tx("t1", "HUF", "2026-08-01"), tx("t2", "USD", "2026-08-01")];

  await syncFxHistory(storage, accounts, txs);

  expect(await storage.getFxHistory()).toEqual({ USD: { "2026-08-01": 1.08 } });
});

test("a lowercase currency from a CSV import fetches under the uppercase code and lands in the vault under that same uppercase key", async () => {
  const storage = await unlocked("lavega-vault-test-fxhistory-lowercase-source");
  const fetchMock = stubFetch({
    HUF: { status: 200, rates: { "2026-08-01": 390.5 } },
  });

  const accounts = [acc("A1", "huf")];
  const txs = [tx("t1", "huf", "2026-08-01")];

  await syncFxHistory(storage, accounts, txs);

  const url = String(fetchMock.mock.calls[0]![0]);
  expect(url).toContain("currency=HUF");

  const history = await storage.getFxHistory();
  expect(history).toEqual({ HUF: { "2026-08-01": 390.5 } });
  expect(rateOn(history, "huf", "2026-08-01")).toBe(390.5);
});

test("the vault key follows the request's normalized currency, not whatever case the server response echoes back", async () => {
  const storage = await unlocked("lavega-vault-test-fxhistory-echo-mismatch");
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ base: "EUR", currency: "huf", rates: { "2026-08-01": 390.5 } }),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);

  const accounts = [acc("A1", "HUF")];
  const txs = [tx("t1", "HUF", "2026-08-01")];

  await syncFxHistory(storage, accounts, txs);

  const history = await storage.getFxHistory();
  expect(history).toEqual({ HUF: { "2026-08-01": 390.5 } });
});

test("nothing is written to the vault if there's nothing to sync", async () => {
  const storage = await unlocked("lavega-vault-test-fxhistory-nothing");
  const fetchMock = stubFetch({});
  const putSpy = vi.spyOn(storage, "putFxHistory");

  await syncFxHistory(storage, [], []);

  expect(fetchMock).not.toHaveBeenCalled();
  expect(putSpy).not.toHaveBeenCalled();
});
