import { openDB, type IDBPDatabase } from "idb";
import type { PriceBar } from "@lavega/core";
import type { PriceStore } from "./PriceStore.js";

const DEFAULT_DB_NAME = "lavega-prices";
const DB_VERSION = 1;
const STORE_NAME = "prices";

type StoredPriceBar = PriceBar;

function openPriceDb(dbName: string): Promise<IDBPDatabase> {
  return openDB(dbName, DB_VERSION, {
    upgrade(db) {
      if (db.objectStoreNames.contains(STORE_NAME)) return;
      const store = db.createObjectStore(STORE_NAME, { keyPath: ["tenantId", "symbol", "date"] });
      store.createIndex("tenant-symbol-date", ["tenantId", "symbol", "date"], { unique: true });
    },
  });
}

/** IndexedDB price store. Uses a composite tenant/symbol/date key and index. */
export function createIndexedDbPriceStore(dbName = DEFAULT_DB_NAME): PriceStore {
  return {
    async getRange(tenantId, symbol, from, to) {
      const db = await openPriceDb(dbName);
      const index = db.transaction(STORE_NAME).store.index("tenant-symbol-date");
      /* Dates are ISO strings ordered lexicographically, so an absent bound is
       * the empty string below and a character above every digit up top. */
      const rows = await index.getAll(IDBKeyRange.bound([tenantId, symbol, from ?? ""], [tenantId, symbol, to ?? "\uffff"]));
      db.close();
      return rows;
    },
    async lastDate(tenantId, symbol) {
      const db = await openPriceDb(dbName);
      const index = db.transaction(STORE_NAME).store.index("tenant-symbol-date");
      const rows = await index.getAll(IDBKeyRange.bound([tenantId, symbol, ""], [tenantId, symbol, "\uffff"]));
      db.close();
      return rows.at(-1)?.date ?? null;
    },
    async upsert(bars) {
      if (bars.length === 0) return;
      const db = await openPriceDb(dbName);
      const tx = db.transaction(STORE_NAME, "readwrite");
      await Promise.all(bars.map((bar) => tx.store.put({ ...bar } satisfies StoredPriceBar)));
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
