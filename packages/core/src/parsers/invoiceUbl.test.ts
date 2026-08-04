import { expect, test } from "vitest";
import { parseInvoiceUbl } from "./invoiceUbl.js";
import { parseInvoiceFile } from "./parseInvoiceFile.js";

/* Minimal but structurally realistic EN-16931 UBL invoice: a purchase
 * invoice (Coolblue as supplier) with a supplier PartyName/Name, a customer
 * PartyLegalEntity/RegistrationName, a TaxTotal with the total TaxAmount
 * ahead of any TaxSubtotal, and a LegalMonetaryTotal carrying both
 * TaxInclusiveAmount and PayableAmount. */
const UBL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>F-2026-001</cbc:ID>
  <cbc:IssueDate>2026-08-01</cbc:IssueDate>
  <cbc:DueDate>2026-09-01</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Coolblue B.V.</cbc:Name>
      </cac:PartyName>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>LaVega Klant BV</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">210.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">1000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">210.00</cbc:TaxAmount>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">1000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">1210.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">1210.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;

test("parseInvoiceUbl: extracts issueDate/dueDate/amount/counterparty/invoiceNumber/currency from a minimal EN-16931 fixture", () => {
  const rows = parseInvoiceUbl(UBL_XML);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    direction: "out",
    counterparty: "Coolblue B.V.",
    invoiceNumber: "F-2026-001",
    issueDate: "2026-08-01",
    dueDate: "2026-09-01",
    amount: 1210,
    vatAmount: 210,
    currency: "EUR",
    sourceType: "ubl",
    status: "expected",
  });
});

test("parseInvoiceUbl: falls back to TaxInclusiveAmount when PayableAmount is absent", () => {
  const xml = UBL_XML.replace(/<cbc:PayableAmount[\s\S]*?<\/cbc:PayableAmount>\s*/, "");
  const rows = parseInvoiceUbl(xml);
  expect(rows).toHaveLength(1);
  expect(rows[0].amount).toBe(1210);
});

test("parseInvoiceUbl: returns [] when neither an IssueDate nor an amount can be found", () => {
  expect(parseInvoiceUbl("<Invoice><cbc:ID>X</cbc:ID></Invoice>")).toEqual([]);
});

test("parseInvoiceFile: dispatches XML content (an <Invoice> root) to the UBL parser", () => {
  const rows = parseInvoiceFile("factuur.xml", UBL_XML);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ sourceType: "ubl", counterparty: "Coolblue B.V.", amount: 1210 });
});

test("parseInvoiceFile: dispatches non-XML content to the CSV parser", () => {
  const csv = "Relatie;Bedrag;Factuurdatum;Vervaldatum\nCoolblue B.V.;1210,00;01-08-2026;01-09-2026";
  const rows = parseInvoiceFile("facturen.csv", csv);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ sourceType: "csv", counterparty: "Coolblue B.V.", amount: 1210 });
});
