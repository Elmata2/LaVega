import { openDB, type IDBPDatabase } from "idb";
import type { PriceBar } from "@lavega/core";
import type { PriceCoverage, PriceStore, SharedPriceStore } from "./PriceStore.js";
import { createMemorySharedBackend, type SerializedSharedPrices } from "./sharedPriceStoreCore.js";

const DEFAULT_DB_NAME = "lavega-prices";
const DB_VERSION = 3;
const STORE_NAME = "prices";
const COVERAGE_STORE_NAME = "coverage";

type StoredPriceBar = PriceBar & { tenantId: string };
type StoredPriceCoverage = PriceCoverage & { tenantId: string };

function openPriceDb(dbName: string): Promise<IDBPDatabase> {
  return openDB(dbName, DB_VERSION, {
    upgrade(db, oldVersion) {
      /* v1 rows were keyed on a tenant the writer chose rather than the tenant
       * the caller asked for, so they cannot be mapped onto v2 keys. Prices are
       * a rebuildable cache; drop them and let the next sync refill. */
      if (oldVersion < 2) {
        if (db.objectStoreNames.contains(STORE_NAME)) db.deleteObjectStore(STORE_NAME);
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: ["tenantId", "symbol", "date"],
        });
        store.createIndex("tenant-symbol-date", ["tenantId", "symbol", "date"], { unique: true });
      }
      if (oldVersion < 3)
        db.createObjectStore(COVERAGE_STORE_NAME, { keyPath: ["tenantId", "symbol"] });
    },
  });
}

function withoutTenant(row: StoredPriceBar): PriceBar {
  const { tenantId, ...bar } = row;
  void tenantId;
  return bar;
}

/** IndexedDB price store. Uses a composite tenant/symbol/date key and index. */
export function createIndexedDbPriceStore(dbName = DEFAULT_DB_NAME): PriceStore {
  return {
    async getRange(tenantId, symbol, from, to) {
      const db = await openPriceDb(dbName);
      const index = db.transaction(STORE_NAME).store.index("tenant-symbol-date");
      /* Dates are ISO strings ordered lexicographically, so an absent bound is
       * the empty string below and a character above every digit up top. */
      const rows: StoredPriceBar[] = await index.getAll(
        IDBKeyRange.bound([tenantId, symbol, from ?? ""], [tenantId, symbol, to ?? "￿"]),
      );
      db.close();
      return rows.map(withoutTenant);
    },
    async lastDate(tenantId, symbol) {
      const db = await openPriceDb(dbName);
      const index = db.transaction(STORE_NAME).store.index("tenant-symbol-date");
      const rows: StoredPriceBar[] = await index.getAll(
        IDBKeyRange.bound([tenantId, symbol, ""], [tenantId, symbol, "￿"]),
      );
      db.close();
      return rows.at(-1)?.date ?? null;
    },
    async upsert(tenantId, bars) {
      if (bars.length === 0) return;
      const db = await openPriceDb(dbName);
      const tx = db.transaction(STORE_NAME, "readwrite");
      await Promise.all(
        bars.map((bar) => tx.store.put({ ...bar, tenantId } satisfies StoredPriceBar)),
      );
      await tx.done;
      db.close();
    },
    async replaceRange(tenantId, symbol, bars, from, to) {
      const db = await openPriceDb(dbName);
      const tx = db.transaction(STORE_NAME, "readwrite");
      await tx.store.delete(
        IDBKeyRange.bound([tenantId, symbol, from ?? ""], [tenantId, symbol, to ?? "￿"]),
      );
      await Promise.all(
        bars.map((bar) => tx.store.put({ ...bar, tenantId } satisfies StoredPriceBar)),
      );
      await tx.done;
      db.close();
    },
    async getCoverage(tenantId, symbol) {
      const db = await openPriceDb(dbName);
      const row: StoredPriceCoverage | undefined = await db.get(COVERAGE_STORE_NAME, [
        tenantId,
        symbol,
      ]);
      db.close();
      if (!row) return null;
      const { tenantId: owner, ...coverage } = row;
      void owner;
      return coverage;
    },
    async putCoverage(tenantId, coverage) {
      const db = await openPriceDb(dbName);
      await db.put(COVERAGE_STORE_NAME, { ...coverage, tenantId } satisfies StoredPriceCoverage);
      db.close();
    },
    async purgeAll() {
      const db = await openPriceDb(dbName);
      const tx = db.transaction([STORE_NAME, COVERAGE_STORE_NAME], "readwrite");
      await Promise.all([
        tx.objectStore(STORE_NAME).clear(),
        tx.objectStore(COVERAGE_STORE_NAME).clear(),
      ]);
      await tx.done;
      db.close();
    },
  };
}

/* ---------- the shared, instrument-keyed store (issue #307) ---------- */

/** The shared store lives in its own database so the old per-tenant DB is never
 *  opened by the new code and vice versa. Old-shape price data is a rebuildable
 *  cache: the first shared read starts empty and the next sync refills it. */
const SHARED_DB_NAME = "lavega-prices-shared";
const SHARED_STORE_NAME = "state";
const SHARED_RECORD_KEY = "series";

function openSharedPriceDb(dbName: string): Promise<IDBPDatabase> {
  return openDB(dbName, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(SHARED_STORE_NAME)) db.createObjectStore(SHARED_STORE_NAME);
    },
  });
}

/**
 * IndexedDB implementation of the shared store (browser tier). The whole cache
 * is a rebuildable reference-data set, so it is held as one snapshot record:
 * a read hydrates the same in-memory backend the other adapters use, a write
 * replaces the snapshot. Series are keyed by instrument, never by user.
 */
export function createIndexedDbSharedPriceStore(
  dbName = SHARED_DB_NAME,
  now?: () => number,
): SharedPriceStore {
  const backend = createMemorySharedBackend(now);
  let ready: Promise<void> | null = null;
  const load = (): Promise<void> => {
    ready ??= (async () => {
      try {
        const db = await openSharedPriceDb(dbName);
        const stored = (await db.get(SHARED_STORE_NAME, SHARED_RECORD_KEY)) as
          | SerializedSharedPrices
          | undefined;
        db.close();
        if (stored && stored.version === 2) backend.hydrate(stored);
      } catch {
        // A private window without IndexedDB still serves prices for this visit.
      }
    })();
    return ready;
  };
  const write = async <R>(operation: () => Promise<R>): Promise<R> => {
    await load();
    const result = await operation();
    try {
      const db = await openSharedPriceDb(dbName);
      await db.put(SHARED_STORE_NAME, backend.snapshot(), SHARED_RECORD_KEY);
      db.close();
    } catch {
      // Persistence is best-effort; the in-memory snapshot is still correct.
    }
    return result;
  };

  return {
    async getRange(key, from, to) {
      await load();
      return backend.store.getRange(key, from, to);
    },
    async getRanges(keys) {
      await load();
      return backend.store.getRanges(keys);
    },
    async lastDate(key) {
      await load();
      return backend.store.lastDate(key);
    },
    upsert: (instrumentKey, bars) => write(() => backend.store.upsert(instrumentKey, bars)),
    replaceRange: (instrumentKey, bars, from, to) =>
      write(() => backend.store.replaceRange(instrumentKey, bars, from, to)),
    async getCoverage(key) {
      await load();
      return backend.store.getCoverage(key);
    },
    putCoverage: (instrumentKey, coverage) =>
      write(() => backend.store.putCoverage(instrumentKey, coverage)),
    async latestChange(keys) {
      await load();
      return backend.store.latestChange(keys);
    },
    adoptAlias: (key, alias) => write(() => backend.store.adoptAlias(key, alias)),
    async claim(key, owner, ttlMs) {
      await load();
      return backend.store.claim(key, owner, ttlMs);
    },
    async release(key, owner) {
      await load();
      return backend.store.release(key, owner);
    },
  };
}
