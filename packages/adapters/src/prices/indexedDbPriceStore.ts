import { openDB, type IDBPDatabase } from "idb";
import type { PriceBar } from "@lavega/core";
import type { PriceStore } from "./PriceStore.js";

const DEFAULT_DB_NAME = "lavega-prices";
const DB_VERSION = 2;
const STORE_NAME = "prices";

type StoredPriceBar = PriceBar & { tenantId: string };

function openPriceDb(dbName: string): Promise<IDBPDatabase> {
  return openDB(dbName, DB_VERSION, {
    upgrade(db) {
      /* v1 rows were keyed on a tenant the writer chose rather than the tenant
       * the caller asked for, so they cannot be mapped onto v2 keys. Prices are
       * a rebuildable cache; drop them and let the next sync refill. */
      if (db.objectStoreNames.contains(STORE_NAME)) db.deleteObjectStore(STORE_NAME);
      const store = db.createObjectStore(STORE_NAME, { keyPath: ["tenantId", "symbol", "date"] });
      store.createIndex("tenant-symbol-date", ["tenantId", "symbol", "date"], { unique: true });
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
    async purgeAll() {
      const db = await openPriceDb(dbName);
      await db.clear(STORE_NAME);
      db.close();
    },
  };
}
