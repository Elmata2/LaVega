import { expect, test } from "vitest";
import { parseIngCsv } from "./csv.js";

const ING = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260102";"Albert Heijn";"NL01INGB0001";"";"BA";"Af";"12,34";"Betaalautomaat";"Boodschappen"
"20260103";"Salaris";"NL01INGB0001";"NL99";"OV";"Bij";"2500,00";"Overschrijving";"Loon"`;

test("ING CSV: dates ISO, outflow negative, inflow positive", () => {
  const rows = parseIngCsv(ING, "NL01INGB0001");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    date: "2026-01-02",
    amount: -12.34,
    counterparty: "Albert Heijn",
  });
  expect(rows[1].amount).toBe(2500);
});

/* Regression: Dutch/European ING amounts use '.' as thousands separator and ','
 * as decimal separator (e.g. "2.500,00" = 2500, "1.234,56" = 1234.56). A naive
 * .replace(",", ".") corrupts these (e.g. "2.500,00" -> 2.5). */
const ING_THOUSANDS = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260104";"Werkgever BV";"NL01INGB0001";"NL99";"OV";"Bij";"2.500,00";"Overschrijving";"Loon"
"20260105";"Belastingdienst";"NL01INGB0001";"NL88";"OV";"Af";"1.234,56";"Overschrijving";"Aanslag"`;

test("ING CSV: amounts with Dutch thousands separator parse correctly", () => {
  const rows = parseIngCsv(ING_THOUSANDS, "NL01INGB0001");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ date: "2026-01-04", amount: 2500, counterparty: "Werkgever BV" });
  expect(rows[1]).toMatchObject({
    date: "2026-01-05",
    amount: -1234.56,
    counterparty: "Belastingdienst",
  });
});

test("ING CSV: blank lines are skipped", () => {
  const withBlankLine = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260102";"Albert Heijn";"NL01INGB0001";"";"BA";"Af";"12,34";"Betaalautomaat";"Boodschappen"

"20260103";"Salaris";"NL01INGB0001";"NL99";"OV";"Bij";"2500,00";"Overschrijving";"Loon"`;
  const rows = parseIngCsv(withBlankLine, "NL01INGB0001");
  expect(rows).toHaveLength(2);
  expect(rows[0].counterparty).toBe("Albert Heijn");
  expect(rows[1].amount).toBe(2500);
});

test("ING CSV: short/malformed rows are skipped, not thrown", () => {
  const withMalformedRow = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260102"
"20260103";"Salaris";"NL01INGB0001";"NL99";"OV";"Bij";"2500,00";"Overschrijving";"Loon"`;
  expect(() => parseIngCsv(withMalformedRow, "NL01INGB0001")).not.toThrow();
  const rows = parseIngCsv(withMalformedRow, "NL01INGB0001");
  expect(rows).toHaveLength(1);
  expect(rows[0].amount).toBe(2500);
});
