import { expect, test } from "vitest";
import { parseBankFile } from "./parseBankFile.js";

const ING = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260102";"Albert Heijn";"NL01INGB0001";"";"BA";"Af";"12,34";"Betaalautomaat";"Boodschappen"
"20260103";"Salaris";"NL01INGB0001";"NL99";"OV";"Bij";"2.500,00";"Overschrijving";"Loon"`;

const RABOBANK = `"IBAN/BBAN","Munt","BIC","Volgnr","Datum","Rentedatum","Bedrag","Saldo na trn","Tegenrekening IBAN/BBAN","Naam tegenpartij","Naam uiteindelijke partij","Naam initierende partij","BIC tegenpartij","Code","Batch ID","Transactiereferentie","Machtigingskenmerk","Incassant ID","Betalingskenmerk","Omschrijving-1","Omschrijving-2","Omschrijving-3","Reden retour","Oorspronkelijk bedrag","Oorspronkelijke munt","Koers"
"NL39RABO0300065264","EUR","RABONL2U","1","20260105","20260105","-45,00","1000,00","NL12ABNA0123456789","Albert Heijn","","","ABNANL2A","BA","","","","","","Boodschappen","","","","","",""`;

const MT940 = [
  ":20:STARTUMS", ":25:NL91ABNA0417164300", ":28C:00001/001",
  ":60F:C260101EUR1000,00",
  ":61:2601020102D75,50NTRFNONREF", ":86:/NAME/Albert Heijn/REMI/Boodschappen betaalpas",
  ":61:2601030103C2500,00NTRFNONREF", ":86:/NAME/Werkgever BV/REMI/Salaris januari",
  ":62F:C260103EUR3424,50", ":64:C260103EUR3424,50",
].join("\n");

test("parseBankFile: routes an ING CSV to the ING profile", () => {
  const r = parseBankFile("ing-jan.csv", ING);
  expect(r.source).toBe("ING");
  expect(r.problems).toHaveLength(0);
  expect(r.txs).toHaveLength(2);
  expect(r.accounts).toHaveLength(1);
  expect(r.accounts[0]).toMatchObject({ key: "NL01INGB0001", iban: "NL01INGB0001", bank: "ING", balance: null });
});

test("parseBankFile: routes a Rabobank CSV", () => {
  const r = parseBankFile("rabo.csv", RABOBANK);
  expect(r.source).toBe("Rabobank");
  expect(r.problems).toHaveLength(0);
  expect(r.txs).toHaveLength(1);
  expect(r.txs[0]).toMatchObject({ amount: -45, counterparty: "Albert Heijn" });
});

test("parseBankFile: routes an MT940/.STA statement, carrying the :62F: closing balance", () => {
  const r = parseBankFile("statement.sta", MT940);
  expect(r.source).toBe("MT940");
  expect(r.problems).toHaveLength(0);
  expect(r.txs).toHaveLength(2);
  expect(r.accounts).toHaveLength(1);
  expect(r.accounts[0].balance).toBe(3424.5);
  expect(r.accounts[0].bank).toBe("ABN AMRO");
});

test("parseBankFile: CAMT/XML input is reported as unsupported, not thrown", () => {
  const r = parseBankFile("camt.xml", `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"></Document>`);
  expect(r.source).toBe("CAMT.053");
  expect(r.problems).toContain("CAMT.053 nog niet ondersteund");
  expect(r.txs).toHaveLength(0);
});

test("parseBankFile: an unrecognized file yields a problem, no throw", () => {
  const r = parseBankFile("mystery.csv", `"Foo";"Bar"\n"1";"2"`);
  expect(r.txs).toHaveLength(0);
  expect(r.accounts).toHaveLength(0);
  expect(r.problems.length).toBeGreaterThan(0);
});

test("parseBankFile: a malformed MT940 (routed by :20:/:61: but no :25: account) yields a problem, not a silent empty success", () => {
  const bad = [":20:X", ":61:2601020102D75,50NTRF", ":86:geen rekening"].join("\n");
  const r = parseBankFile("bad.sta", bad);
  expect(r.source).toBe("MT940"); // format was recognized...
  expect(r.txs).toHaveLength(0); // ...but nothing parsed (no :25:)
  expect(r.accounts).toHaveLength(0);
  expect(r.problems.length).toBeGreaterThan(0); // so a problem is surfaced, not silent
});
