// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { expect, test } from "vitest";
import { openDB } from "idb";
import type { Rule } from "@lavega/core";
import { createIndexedDbStorage } from "./indexeddb.js";

test("rules store: put then get round-trips; putRules replaces the whole set", async () => {
  const storage = createIndexedDbStorage();
  expect(await storage.getRules()).toEqual([]);

  const rules: Rule[] = [
    { id: "r1", match: "albert heijn", category: "Boodschappen" },
    { id: "r2", match: "salaris", category: "Inkomen" },
  ];
  await storage.putRules(rules);
  const back = await storage.getRules();
  expect(back).toHaveLength(2);
  expect(back.find((r) => r.id === "r1")).toMatchObject({
    match: "albert heijn",
    category: "Boodschappen",
  });

  // replace-all: saving a shorter list drops the removed rule
  await storage.putRules([{ id: "r2", match: "salaris", category: "Loon" }]);
  const after = await storage.getRules();
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ id: "r2", category: "Loon" });
});

test("REAL v1->v2 upgrade: a pre-existing v1 DB's accounts/txs survive the schema bump (no data loss for returning users)", async () => {
  // Fresh IndexedDB factory so this test starts from a truly empty slate,
  // independent of the DBs the earlier tests left open (deleteDB would block on
  // their un-closed connections). Then build a genuine v1 database: only the
  // accounts + txs stores existed at version 1. Seed real rows into it.
  globalThis.indexedDB = new IDBFactory();
  const v1 = await openDB("lavega", 1, {
    upgrade(db) {
      db.createObjectStore("accounts", { keyPath: "key" });
      db.createObjectStore("txs", { keyPath: "id" });
    },
  });
  await v1.put("accounts", {
    key: "155430750",
    iban: "",
    name: "155430750",
    bank: "ABN AMRO",
    entity: "BV1",
    currency: "EUR",
    balance: 1.98,
  });
  await v1.put("txs", {
    id: "old1",
    accountKey: "155430750",
    date: "2026-06-22",
    amount: 30,
    currency: "EUR",
    counterparty: "HR A STEUNENBERG",
    description: "NOTPROVIDED",
    category: "",
    manual: false,
  });
  v1.close();

  // Reopen through the app's storage, which opens at v2 and runs the upgrade.
  const storage = createIndexedDbStorage();
  const accounts = await storage.getAccounts();
  const txs = await storage.getTxs();

  expect(accounts).toHaveLength(1);
  expect(accounts[0]).toMatchObject({ key: "155430750", balance: 1.98 }); // v1 data intact
  expect(txs).toHaveLength(1);
  expect(txs[0]).toMatchObject({ id: "old1", amount: 30 });
  expect(await storage.getRules()).toEqual([]); // new v2 store exists and is empty
});

test("a v2 rule round-trips the rules store unchanged", async () => {
  // WS1.3 added the typed shape to the SAME store; a vault write/read must not
  // reshape it (the engine treats a re-saved row as the source of truth).
  const storage = createIndexedDbStorage();
  const v2: Rule = {
    v: 2,
    id: "r-v2",
    name: "Boodschappen",
    conditions: [
      { kind: "merchant", op: "contains", value: "albert heijn" },
      { kind: "amount", op: "between", valueCents: -5000, upperCents: -100 },
    ],
    actions: [
      { kind: "setCategory", category: "Boodschappen" },
      { kind: "addTag", tag: "boodschappen" },
    ],
    stopProcessing: false,
    effectiveFrom: "2026-01-01",
  };
  await storage.putRules([v2]);
  expect(await storage.getRules()).toEqual([v2]);
});
