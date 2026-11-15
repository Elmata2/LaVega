import { expect, test } from "vitest";
import { migrateTxStates, type Tx } from "./model.js";

const tx = (over: Partial<Tx> = {}): Tx => ({
  id: "t1",
  accountKey: "A",
  date: "2026-06-01",
  amount: -5,
  currency: "EUR",
  counterparty: "X",
  description: "",
  category: "",
  manual: false,
  ...over,
});

test("migrateTxStates fills the four state defaults and keeps the tx id", () => {
  const old = tx();
  const { txs, changed } = migrateTxStates([old]);
  expect(changed).toBe(true);
  expect(txs[0]).toEqual({
    ...old,
    excluded: false,
    pending: false,
    notes: "",
    tags: [],
  });
  expect(txs[0].id).toBe(old.id);
});

test("migrateTxStates keeps an explicit state and only fills the missing fields", () => {
  const { txs, changed } = migrateTxStates([tx({ excluded: true, tags: ["werk"] })]);
  expect(changed).toBe(true);
  expect(txs[0].excluded).toBe(true);
  expect(txs[0].tags).toEqual(["werk"]);
  expect(txs[0].pending).toBe(false);
  expect(txs[0].notes).toBe("");
});

test("migrateTxStates is idempotent: a second pass changes nothing", () => {
  const first = migrateTxStates([
    tx(),
    tx({ id: "t2", excluded: true, pending: true, notes: "x", tags: [] }),
  ]);
  expect(first.changed).toBe(true);
  const second = migrateTxStates(first.txs);
  expect(second.changed).toBe(false);
  expect(second.txs[0]).toBe(first.txs[0]);
  expect(second.txs[1]).toBe(first.txs[1]);
});

test("migrateTxStates leaves an empty tx list alone", () => {
  expect(migrateTxStates([])).toEqual({ txs: [], changed: false });
});
