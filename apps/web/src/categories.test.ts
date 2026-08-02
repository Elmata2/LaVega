// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import type { Rule, Tx } from "@lavega/core";
import { categorize, categoryTotals } from "@lavega/core";
import { createIndexedDbStorage } from "@lavega/adapters";

const txs: Tx[] = [
  { id: "t1", accountKey: "A1", date: "2026-06-05", amount: 2500, currency: "EUR", counterparty: "Salaris", description: "Loon", category: "", manual: false },
  { id: "t2", accountKey: "A1", date: "2026-06-06", amount: -30, currency: "EUR", counterparty: "Albert Heijn", description: "Boodschappen", category: "", manual: false },
];

test("Categories wiring: rules persist and drive categorize + categoryTotals", async () => {
  const storage = createIndexedDbStorage();
  const rules: Rule[] = [
    { id: "r1", match: "salaris", category: "Inkomen" },
    { id: "r2", match: "albert heijn", category: "Boodschappen" },
  ];
  await storage.putRules(rules);
  const loaded = await storage.getRules();

  expect(categorize(txs[0], loaded)).toBe("Inkomen");
  expect(categorize(txs[1], loaded)).toBe("Boodschappen");
  const totals = categoryTotals(txs, loaded);
  expect(totals["Inkomen"]).toEqual({ in: 2500, out: 0 });
  expect(totals["Boodschappen"]).toEqual({ in: 0, out: -30 });
});
