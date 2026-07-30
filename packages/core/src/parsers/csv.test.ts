import { expect, test } from "vitest";
import { parseIngCsv } from "./csv.js";

const ING = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260102";"Albert Heijn";"NL01INGB0001";"";"BA";"Af";"12,34";"Betaalautomaat";"Boodschappen"
"20260103";"Salaris";"NL01INGB0001";"NL99";"OV";"Bij";"2500,00";"Overschrijving";"Loon"`;

test("ING CSV: dates ISO, outflow negative, inflow positive", () => {
  const rows = parseIngCsv(ING, "NL01INGB0001");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ date: "2026-01-02", amount: -12.34, counterparty: "Albert Heijn" });
  expect(rows[1].amount).toBe(2500);
});
