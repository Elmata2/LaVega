// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { ingest, consolidate } from "@lavega/core";
import { createFileImport, createIndexedDbStorage } from "@lavega/adapters";

const ING = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260102";"Albert Heijn";"NL01INGB0001";"";"BA";"Af";"12,34";"Betaalautomaat";"Boodschappen"
"20260103";"Salaris";"NL01INGB0001";"NL99";"OV";"Bij";"2500,00";"Overschrijving";"Loon"`;

test("Overview wiring: FileImport -> ingest -> IndexedDB -> consolidate yields per-entity in/out", async () => {
  const storage = createIndexedDbStorage();

  const existingTxs = await storage.getTxs();
  const result = await createFileImport().load({ filename: "ing.csv", text: ING, entity: "BV1" });
  const mergedTxs = ingest(existingTxs, result.txs);

  await storage.putAccounts(result.accounts);
  await storage.putTxs(mergedTxs);

  const accounts = await storage.getAccounts();
  const txs = await storage.getTxs();

  const { byEntity } = consolidate(accounts, txs);

  expect(byEntity["BV1"].out).toBe(-12.34);
  expect(byEntity["BV1"].in).toBe(2500);
});
