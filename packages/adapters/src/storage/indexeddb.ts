import { openDB, type IDBPDatabase } from "idb";
import type { Account, Tx } from "@lavega/core";
import type { StorageAdapter } from "./StorageAdapter.js";

const DB_NAME = "lavega";
const DB_VERSION = 1;

function openLaVegaDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("accounts")) {
        db.createObjectStore("accounts", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("txs")) {
        db.createObjectStore("txs", { keyPath: "id" });
      }
    },
  });
}

export function createIndexedDbStorage(): StorageAdapter {
  return {
    async getAccounts(): Promise<Account[]> {
      const db = await openLaVegaDb();
      return db.getAll("accounts");
    },
    async putAccounts(a: Account[]): Promise<void> {
      const db = await openLaVegaDb();
      const tx = db.transaction("accounts", "readwrite");
      await Promise.all(a.map((account) => tx.store.put(account)));
      await tx.done;
    },
    async getTxs(): Promise<Tx[]> {
      const db = await openLaVegaDb();
      return db.getAll("txs");
    },
    async putTxs(t: Tx[]): Promise<void> {
      const db = await openLaVegaDb();
      const tx = db.transaction("txs", "readwrite");
      await Promise.all(t.map((entry) => tx.store.put(entry)));
      await tx.done;
    },
  };
}
