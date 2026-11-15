import type { Invoice } from "../model.js";

/* UBL/EN-16931 invoice XML importer. Extracts a handful of well-known tags
 * via regex — no DOMParser dependency, mirroring mt940.ts's string-parsing
 * style. UBL is one invoice per document, so this handles exactly one
 * <Invoice>/<ubl:Invoice> root and returns at most one row. Direction is
 * kept deliberately simple: a received invoice is always AP ("out") — this
 * module has no notion of "which party is the user" (that would need entity
 * config from the caller), so it doesn't try to infer it from
 * InvoiceTypeCode or the customer name. */

// Grabs the first <(ns:)?tag ...>content</(ns:)?tag> leaf anywhere in `xml`
// (tolerant of a namespace prefix and attributes on the opening tag).
function tag(xml: string, name: string): { value: string; attrs: string } | null {
  const m = xml.match(
    new RegExp(`<(?:[a-zA-Z0-9]+:)?${name}\\b([^>]*)>([^<]*)</(?:[a-zA-Z0-9]+:)?${name}>`),
  );
  return m ? { value: m[2].trim(), attrs: m[1] } : null;
}

// Slices out the first <(ns:)?section ...>...</(ns:)?section> block
// (non-greedy), so a tag() lookup can be scoped to inside e.g.
// cac:LegalMonetaryTotal instead of matching the first occurrence anywhere.
function section(xml: string, name: string): string | null {
  const m = xml.match(
    new RegExp(`<(?:[a-zA-Z0-9]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${name}>`),
  );
  return m ? m[1] : null;
}

function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

export function parseInvoiceUbl(xml: string): Array<Omit<Invoice, "id">> {
  // Scope to the <Invoice> root when present so a stray same-named leaf
  // outside it (unlikely, but defensive) can't leak in; fall back to the
  // whole document if the root wrapper itself can't be found.
  const body = section(xml, "Invoice") ?? xml;

  const issueDate = tag(body, "IssueDate")?.value || "";
  const dueDate = tag(body, "DueDate")?.value || "";
  const invoiceNumber = tag(body, "ID")?.value || undefined;

  const legalTotal = section(body, "LegalMonetaryTotal");
  const payable = legalTotal ? tag(legalTotal, "PayableAmount") : null;
  const taxIncl = legalTotal ? tag(legalTotal, "TaxInclusiveAmount") : null;
  const amountTag = payable ?? taxIncl;
  const amount = amountTag ? parseFloat(amountTag.value) : NaN;

  const taxTotal = section(body, "TaxTotal");
  const taxAmountTag = taxTotal ? tag(taxTotal, "TaxAmount") : null;
  const vatAmount = taxAmountTag ? parseFloat(taxAmountTag.value) : NaN;

  const supplierSection = section(body, "AccountingSupplierParty");
  const supplierName = supplierSection
    ? tag(supplierSection, "Name")?.value || tag(supplierSection, "RegistrationName")?.value || ""
    : "";

  const currency =
    (amountTag ? attr(amountTag.attrs, "currencyID") : null) ||
    tag(body, "DocumentCurrencyCode")?.value ||
    "EUR";

  if (!issueDate || isNaN(amount)) return [];

  return [
    {
      entity: "",
      direction: "out",
      counterparty: supplierName,
      invoiceNumber,
      issueDate,
      dueDate: dueDate || issueDate,
      amount: Math.abs(amount),
      vatAmount: isNaN(vatAmount) ? undefined : Math.abs(vatAmount),
      currency,
      status: "expected",
      sourceType: "ubl",
    },
  ];
}
