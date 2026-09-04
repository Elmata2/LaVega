// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { consolidate, reassignEntity } from "@lavega/core";
import { createIndexedDbStorage } from "@lavega/adapters";

test("Reassign flow: change an account's entity -> persist -> its txs regroup on reconsolidate", async () => {
  const storage = createIndexedDbStorage();
  const accounts: Account[] = [
    {
      key: "A1",
      iban: "A1",
      name: "ING",
      bank: "ING",
      entity: "BV1",
      currency: "EUR",
      balance: null,
    },
  ];
  const txs: Tx[] = [
    {
      id: "t1",
      accountKey: "A1",
      date: "2026-01-02",
      amount: -10,
      currency: "EUR",
      counterparty: "AH",
      description: "Eten",
      category: "",
      manual: false,
    },
    {
      id: "t2",
      accountKey: "A1",
      date: "2026-01-03",
      amount: 50,
      currency: "EUR",
      counterparty: "Klant",
      description: "Factuur",
      category: "",
      manual: false,
    },
  ];
  await storage.putAccounts(accounts);
  await storage.putTxs(txs);

  expect(consolidate(accounts, txs).byEntity["BV1"]).toMatchObject({ in: 50, out: -10 });

  const next = reassignEntity(accounts, "A1", "BV3");
  await storage.putAccounts([next.find((a) => a.key === "A1")!]);

  const reloaded = await storage.getAccounts();
  const persistedTxs = await storage.getTxs();
  const after = consolidate(reloaded, persistedTxs);
  expect(after.byEntity["BV3"]).toMatchObject({ in: 50, out: -10 });
  expect(after.byEntity["BV1"]).toBeUndefined();
});
