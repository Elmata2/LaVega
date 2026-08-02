// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
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
  expect(back.find((r) => r.id === "r1")).toMatchObject({ match: "albert heijn", category: "Boodschappen" });

  // replace-all: saving a shorter list drops the removed rule
  await storage.putRules([{ id: "r2", match: "salaris", category: "Loon" }]);
  const after = await storage.getRules();
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ id: "r2", category: "Loon" });
});

test("existing accounts/txs stores still work after the v2 upgrade adds the rules store", async () => {
  const storage = createIndexedDbStorage();
  await storage.putAccounts([{ key: "A1", iban: "A1", name: "ING", bank: "ING", entity: "BV1", currency: "EUR", balance: null }]);
  expect(await storage.getAccounts()).toHaveLength(1);
});
