import { openDB, type IDBPDatabase } from "idb";
import type { Account, Tx, Rule } from "@lavega/core";
import type { StorageAdapter } from "./StorageAdapter.js";

const DB_NAME = "lavega";
const DB_VERSION = 2;

function openLaVegaDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("accounts")) {
        db.createObjectStore("accounts", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("txs")) {
        db.createObjectStore("txs", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("rules")) {
        db.createObjectStore("rules", { keyPath: "id" });
      }
    },
  });
}

export function createIndexedDbStorage(): StorageAdapter {
  return {
    async getAccounts(): Promise<Account[]> {
      const db = await openLaVegaDb();
      const result = await db.getAll("accounts");
      db.close(); // don't leak a connection — a lingering one blocks a later
      // indexedDB.deleteDatabase("lavega") (the vault migration's cleanup step)
      return result;
    },
    async putAccounts(a: Account[]): Promise<void> {
      const db = await openLaVegaDb();
      const tx = db.transaction("accounts", "readwrite");
      await Promise.all(a.map((account) => tx.store.put(account)));
      await tx.done;
      db.close();
    },
    async getTxs(): Promise<Tx[]> {
      const db = await openLaVegaDb();
      const result = await db.getAll("txs");
      db.close();
      return result;
    },
    async putTxs(t: Tx[]): Promise<void> {
      const db = await openLaVegaDb();
      const tx = db.transaction("txs", "readwrite");
      await Promise.all(t.map((entry) => tx.store.put(entry)));
      await tx.done;
      db.close();
    },
    async getRules(): Promise<Rule[]> {
      const db = await openLaVegaDb();
      const result = await db.getAll("rules");
      db.close();
      return result;
    },
    // Replace-all: the UI owns the full rules list, so a save clears and rewrites.
    async putRules(rules: Rule[]): Promise<void> {
      const db = await openLaVegaDb();
      const tx = db.transaction("rules", "readwrite");
      await tx.store.clear();
      await Promise.all(rules.map((r) => tx.store.put(r)));
      await tx.done;
      db.close();
    },
  };
}
