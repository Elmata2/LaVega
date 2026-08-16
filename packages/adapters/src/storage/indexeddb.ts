import { openDB, type IDBPDatabase } from "idb";
import type { Account, Tx, Rule, EntityProfile } from "@lavega/core";
import type { StorageAdapter } from "./StorageAdapter.js";

const DB_NAME = "lavega";
// 3 adds the `entityProfiles` store (privé/zakelijk per entity). Purely
// additive: the upgrade only creates a store that isn't there, so an existing
// database keeps every row it has and simply gains an empty store.
const DB_VERSION = 3;

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
      if (!db.objectStoreNames.contains("entityProfiles")) {
        db.createObjectStore("entityProfiles", { keyPath: "entity" });
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
    // Removal primitives. Account and txs are deleted separately so a merge can
    // reassign the transactions before the duplicate account row goes.
    async deleteAccount(key: string): Promise<void> {
      const db = await openLaVegaDb();
      const tx = db.transaction("accounts", "readwrite");
      await tx.store.delete(key); // absent key = no-op in IndexedDB
      await tx.done;
      db.close();
    },
    async deleteTxs(ids: string[]): Promise<void> {
      const db = await openLaVegaDb();
      const tx = db.transaction("txs", "readwrite");
      await Promise.all(ids.map((id) => tx.store.delete(id)));
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

    // Entity classifications. Keyed on the entity name, replace-all like rules —
    // the UI owns the whole list, and clearing a row means "back to privé".
    async getEntityProfiles(): Promise<EntityProfile[]> {
      const db = await openLaVegaDb();
      const result = await db.getAll("entityProfiles");
      db.close();
      return result;
    },
    async putEntityProfiles(profiles: EntityProfile[]): Promise<void> {
      const db = await openLaVegaDb();
      const tx = db.transaction("entityProfiles", "readwrite");
      await tx.store.clear();
      await Promise.all(profiles.map((p) => tx.store.put(p)));
      await tx.done;
      db.close();
    },
  };
}
