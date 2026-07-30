import { expect, test } from "vitest";
import { createFileImport } from "./fileImport.js";

const ING = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260102";"Albert Heijn";"NL01INGB0001";"";"BA";"Af";"12,34";"Betaalautomaat";"Boodschappen"
"20260103";"Salaris";"NL01INGB0001";"NL99";"OV";"Bij";"2500,00";"Overschrijving";"Loon"`;

test("FileImport: detects ING CSV, builds one account (balance null), parses txs", async () => {
  const adapter = createFileImport();
  const result = await adapter.load({ filename: "ing.csv", text: ING, entity: "BV1" });

  expect(result.source).toBe("ING");
  expect(result.problems).toHaveLength(0);
  expect(result.txs).toHaveLength(2);
  expect(result.accounts).toHaveLength(1);
  expect(result.accounts[0].entity).toBe("BV1");
  expect(result.accounts[0].balance).toBeNull();
  expect(result.accounts[0].bank).toBe("ING");
  expect(result.accounts[0].key).toBe("NL01INGB0001");
  expect(result.accounts[0].iban).toBe("NL01INGB0001");
});

test("FileImport: derives the correct Rekening account key when an earlier column (Naam / Omschrijving) has a quoted embedded ';' on the first data row", async () => {
  const adapter = createFileImport();
  const ING_QUOTED_SEMICOLON = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260102";"Albert Heijn; filiaal 12";"NL01INGB0001";"";"BA";"Af";"12,34";"Betaalautomaat";"Boodschappen"
"20260103";"Salaris";"NL01INGB0001";"NL99";"OV";"Bij";"2500,00";"Overschrijving";"Loon"`;

  const result = await adapter.load({ filename: "ing.csv", text: ING_QUOTED_SEMICOLON, entity: "BV1" });

  expect(result.accounts).toHaveLength(1);
  expect(result.accounts[0].key).toBe("NL01INGB0001");
  expect(result.accounts[0].iban).toBe("NL01INGB0001");
});

test("FileImport: unknown header format returns a problem, no accounts/txs", async () => {
  const adapter = createFileImport();
  const UNKNOWN = `"Foo";"Bar"\n"1";"2"`;
  const result = await adapter.load({ filename: "mystery.csv", text: UNKNOWN, entity: "BV1" });

  expect(result.accounts).toHaveLength(0);
  expect(result.txs).toHaveLength(0);
  expect(result.source).toBe("");
  expect(result.problems).toContain("onbekend CSV-formaat");
});
