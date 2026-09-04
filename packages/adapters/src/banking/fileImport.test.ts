import { expect, test } from "vitest";
import { createFileImport } from "./fileImport.js";

const ING = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260102";"Albert Heijn";"NL01INGB0001";"";"BA";"Af";"12,34";"Betaalautomaat";"Boodschappen"
"20260103";"Salaris";"NL01INGB0001";"NL99";"OV";"Bij";"2500,00";"Overschrijving";"Loon"`;

const RABOBANK = `"IBAN/BBAN","Munt","BIC","Volgnr","Datum","Rentedatum","Bedrag","Saldo na trn","Tegenrekening IBAN/BBAN","Naam tegenpartij","Naam uiteindelijke partij","Naam initierende partij","BIC tegenpartij","Code","Batch ID","Transactiereferentie","Machtigingskenmerk","Incassant ID","Betalingskenmerk","Omschrijving-1","Omschrijving-2","Omschrijving-3","Reden retour","Oorspronkelijk bedrag","Oorspronkelijke munt","Koers"
"NL39RABO0300065264","EUR","RABONL2U","1","20260105","20260105","-45,00","1000,00","NL12ABNA0123456789","Albert Heijn","","","ABNANL2A","BA","","","","","","Boodschappen","","","","","",""`;

const MT940 = [
  ":20:STARTUMS",
  ":25:NL91ABNA0417164300",
  ":28C:00001/001",
  ":60F:C260101EUR1000,00",
  ":61:2601020102D75,50NTRFNONREF",
  ":86:/NAME/Albert Heijn/REMI/Boodschappen betaalpas",
  ":61:2601030103C2500,00NTRFNONREF",
  ":86:/NAME/Werkgever BV/REMI/Salaris januari",
  ":62F:C260103EUR3424,50",
  ":64:C260103EUR3424,50",
].join("\n");

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

  const result = await adapter.load({
    filename: "ing.csv",
    text: ING_QUOTED_SEMICOLON,
    entity: "BV1",
  });

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
  expect(result.problems.length).toBeGreaterThan(0); // populated, no throw
});

test("FileImport: routes a Rabobank CSV, stamping entity", async () => {
  const adapter = createFileImport();
  const result = await adapter.load({ filename: "rabo.csv", text: RABOBANK, entity: "BV2" });

  expect(result.source).toBe("Rabobank");
  expect(result.txs).toHaveLength(1);
  expect(result.txs[0]).toMatchObject({ amount: -45 });
  expect(result.accounts[0].entity).toBe("BV2");
});

test("FileImport: routes an MT940/.STA statement, carrying balance and entity", async () => {
  const adapter = createFileImport();
  const result = await adapter.load({ filename: "statement.sta", text: MT940, entity: "BV1" });

  expect(result.source).toBe("MT940");
  expect(result.txs).toHaveLength(2);
  expect(result.accounts[0].balance).toBe(3424.5);
  expect(result.accounts[0].entity).toBe("BV1");
});
