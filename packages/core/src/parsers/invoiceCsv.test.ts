import { expect, test } from "vitest";
import { parseInvoiceCsv } from "./invoiceCsv.js";

/* NL-style, semicolon-delimited generic invoice export: one purchase (AP,
 * "Inkoop" -> out) and one sales (AR, "Verkoop" -> in) row. */
const NL_CSV = `Relatie;Bedrag;Factuurdatum;Vervaldatum;Factuurnummer;Richting;BTW
Coolblue B.V.;1210,00;01-08-2026;01-09-2026;F-100;Inkoop;210,00
Klant BV;2500,00;05-08-2026;20-08-2026;V-200;Verkoop;0,00`;

test("parseInvoiceCsv: parses NL headers into 2 invoices with correct amount/dates/direction/counterparty", () => {
  const rows = parseInvoiceCsv(NL_CSV);
  expect(rows).toHaveLength(2);

  expect(rows[0]).toMatchObject({
    direction: "out",
    counterparty: "Coolblue B.V.",
    invoiceNumber: "F-100",
    issueDate: "2026-08-01",
    dueDate: "2026-09-01",
    amount: 1210,
    vatAmount: 210,
    currency: "EUR",
    sourceType: "csv",
    status: "expected",
  });

  expect(rows[1]).toMatchObject({
    direction: "in",
    counterparty: "Klant BV",
    invoiceNumber: "V-200",
    issueDate: "2026-08-05",
    dueDate: "2026-08-20",
    amount: 2500,
    currency: "EUR",
    sourceType: "csv",
    status: "expected",
  });
});

test("parseInvoiceCsv: rows missing amount or a date are skipped", () => {
  const csv = `Relatie;Bedrag;Factuurdatum;Vervaldatum
Geen Bedrag BV;;01-08-2026;01-09-2026
Geen Datum BV;100,00;;01-09-2026
Goede Rij BV;100,00;01-08-2026;01-09-2026`;
  const rows = parseInvoiceCsv(csv);
  expect(rows).toHaveLength(1);
  expect(rows[0].counterparty).toBe("Goede Rij BV");
});

test("parseInvoiceCsv: defaults direction to \"out\" when no richting/type/soort column is present", () => {
  const csv = `Relatie;Bedrag;Factuurdatum;Vervaldatum
Geen Richting BV;100,00;01-08-2026;01-09-2026`;
  const rows = parseInvoiceCsv(csv);
  expect(rows).toHaveLength(1);
  expect(rows[0].direction).toBe("out");
});

test("parseInvoiceCsv: comma-delimited fixture also sniffs correctly", () => {
  const csv = `Relatie,Bedrag,Factuurdatum,Vervaldatum,Richting
Leverancier X,99.99,15-08-2026,15-09-2026,inkoop`;
  const rows = parseInvoiceCsv(csv);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ counterparty: "Leverancier X", amount: 99.99, direction: "out" });
});
