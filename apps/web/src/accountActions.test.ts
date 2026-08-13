import { expect, test } from "vitest";
import type { Tx } from "@lavega/core";
import { txIdsForAccount, txDiff } from "./accountActions.js";

const tx = (id: string, accountKey: string, amount = -5): Tx =>
  ({ id, accountKey, date: "2026-06-01", amount, currency: "EUR",
     counterparty: "", description: "", category: "", manual: false });

test("txIdsForAccount picks only that account's txs", () => {
  const txs = [tx("a1", "A"), tx("b1", "B"), tx("a2", "A")];
  expect(txIdsForAccount(txs, "A")).toEqual(["a1", "a2"]);
  expect(txIdsForAccount(txs, "GONE")).toEqual([]);
});

test("txDiff reports removals and additions", () => {
  const prev = [tx("a1", "A"), tx("a2", "A")];
  const next = [tx("a2", "A"), tx("a3", "A")];
  const { removedIds, upserts } = txDiff(prev, next);
  expect(removedIds).toEqual(["a1"]);
  expect(upserts.map((t) => t.id)).toEqual(["a3"]);
});

test("txDiff flags a same-id row that changed in place", () => {
  const prev = [tx("a1", "A", -5)];
  const next = [tx("a1", "A", -9)];
  const { removedIds, upserts } = txDiff(prev, next);
  expect(removedIds).toEqual([]);
  expect(upserts.map((t) => t.amount)).toEqual([-9]);
});

test("txDiff on an unchanged set writes nothing", () => {
  const same = [tx("a1", "A"), tx("a2", "A")];
  expect(txDiff(same, [...same])).toEqual({ removedIds: [], upserts: [] });
});
