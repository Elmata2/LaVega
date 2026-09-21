import { expect, test } from "vitest";
import { parseBankFile } from "./parseBankFile.js";

/* NO GERMAN BANK HAS ITS OWN PROFILE, so every German export lands on
 * GENERIC_MAP. Before these headers were added it found neither a date nor an
 * amount column, skipped every row, and reported "geen transacties gevonden" —
 * an empty screen rather than an error, which is the worst way to fail.
 *
 * Header rows below are the real shapes: Sparkasse's CSV-CAMT export, DKB's
 * "Umsatzliste", and N26 (English, which always worked). Semicolon-delimited
 * and comma-decimal, as German banks ship them. */

test("a Sparkasse export imports, with the right sign and counterparty", () => {
  const csv = [
    "Auftragskonto;Buchungstag;Wertstellung;Buchungstext;Verwendungszweck;Beguenstigter/Zahlungspflichtiger;Kontonummer/IBAN;Betrag;Waehrung",
    'DE02120300000000202051;31.08.2026;31.08.2026;LASTSCHRIFT;Monatsbeitrag August;Stadtwerke Muenchen;DE44500105175407324931;"-89,90";EUR',
    'DE02120300000000202051;01.09.2026;01.09.2026;GUTSCHRIFT;Gehalt September;Beispiel GmbH;DE89370400440532013000;"3.250,00";EUR',
  ].join("\n");

  const out = parseBankFile("umsaetze.csv", csv);
  expect(out.problems).toEqual([]);
  expect(out.txs).toHaveLength(2);
  /* DMY with dots — 31.08.2026 is the 31st of August, not an invalid month. */
  expect(out.txs[0]?.date).toBe("2026-08-31");
  expect(out.txs[0]?.amount).toBeLessThan(0);
  expect(out.txs[0]?.counterparty).toContain("Stadtwerke");
  /* 3.250,00 is three thousand, not three. A thousands dot read as a decimal
   * point would understate income by a factor of a thousand and say nothing. */
  expect(out.txs[1]?.amount).toBe(3250);
});

test("a DKB export imports", () => {
  const csv = [
    "Buchungstag;Wertstellung;Buchungstext;Auftraggeber/Beguenstigter;Verwendungszweck;Betrag (EUR)",
    ' 15.09.2026;15.09.2026;Kartenzahlung;REWE Markt GmbH;Einkauf;"-42,17"',
  ].join("\n");

  const out = parseBankFile("umsatzliste.csv", csv);
  expect(out.txs).toHaveLength(1);
  expect(out.txs[0]?.date).toBe("2026-09-15");
  expect(out.txs[0]?.amount).toBeCloseTo(-42.17, 2);
});

/* N26 exports English headers, so it worked before this change. Pinned so a
 * future edit to the German entries cannot quietly cost us the one German
 * bank that already imported. */
test("N26's English export still imports", () => {
  const csv = [
    "Date,Payee,Account number,Transaction type,Payment reference,Amount (EUR)",
    "2026-09-02,Deutsche Bahn,DE89370400440532013000,Debit,Ticket,-59.90",
  ].join("\n");

  const out = parseBankFile("n26.csv", csv);
  expect(out.txs).toHaveLength(1);
  expect(out.txs[0]?.amount).toBeCloseTo(-59.9, 2);
});
