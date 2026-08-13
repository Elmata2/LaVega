// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { createIndexedDbStorage } from "./indexeddb.js";

const tx = (id: string, accountKey = "A"): Tx =>
  ({ id, accountKey, date: "2026-01-02", amount: -5, currency: "EUR",
     counterparty: "x", description: "", category: "", manual: false });

const acc = (key: string): Account =>
  ({ key, iban: key, name: key, bank: "", entity: "BV1", currency: "EUR", balance: null });

test("round-trips txs", async () => {
  const s = createIndexedDbStorage();
  await s.putTxs([tx("1#0")]);
  expect(await s.getTxs()).toHaveLength(1);
});

test("deleteAccount removes only that account row — its txs stay (the caller decides)", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createIndexedDbStorage();
  await s.putAccounts([acc("A"), acc("B")]);
  await s.putTxs([tx("a1", "A"), tx("b1", "B")]);

  await s.deleteAccount("A");
  expect((await s.getAccounts()).map((a) => a.key)).toEqual(["B"]);
  expect(await s.getTxs()).toHaveLength(2); // txs untouched
});

test("deleteTxs removes only the listed ids; unknown ids and [] are no-ops", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createIndexedDbStorage();
  await s.putTxs([tx("a1", "A"), tx("a2", "A"), tx("b1", "B")]);

  await s.deleteTxs([]);
  expect(await s.getTxs()).toHaveLength(3);

  await s.deleteTxs(["a1", "nope"]);
  expect((await s.getTxs()).map((t) => t.id).sort()).toEqual(["a2", "b1"]);
});

test("deleting an absent account is a no-op", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createIndexedDbStorage();
  await s.putAccounts([acc("A")]);
  await s.deleteAccount("GONE");
  expect(await s.getAccounts()).toHaveLength(1);
});
