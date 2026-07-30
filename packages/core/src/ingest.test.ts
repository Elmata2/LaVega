import { expect, test } from "vitest";
import { ingest, consolidate } from "./ingest.js";
import { assignTxIds } from "./hash.js";

const mk = (o: Partial<any>) => ({
  accountKey: "A",
  date: "2026-01-02",
  amount: -10,
  currency: "EUR",
  counterparty: "S",
  description: "d",
  category: "",
  manual: false,
  ...o,
});

test("ingest dedupes overlapping imports by id", () => {
  const first = assignTxIds([mk({}), mk({ amount: -20 })]);
  const merged = ingest(first, [mk({}), mk({ amount: -30 })]);
  expect(merged).toHaveLength(3);
});

test("consolidate sums in/out per entity", () => {
  const txs = assignTxIds([mk({ amount: -10 }), mk({ amount: 40 })]);
  const accounts = [
    {
      key: "A",
      iban: "A",
      name: "",
      bank: "",
      entity: "BV1",
      currency: "EUR",
      balance: 100,
    },
  ];
  const c = consolidate(accounts, txs);
  expect(c.byEntity["BV1"]).toMatchObject({ in: 40, out: -10, balance: 100 });
});
