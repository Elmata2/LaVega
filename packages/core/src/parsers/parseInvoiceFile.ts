import type { Invoice } from "../model.js";
import { parseInvoiceCsv } from "./invoiceCsv.js";
import { parseInvoiceUbl } from "./invoiceUbl.js";

/* Dispatches an invoice file to the UBL/EN-16931 XML parser when its content
 * looks like XML (an <?xml ...?> preamble, or an <Invoice>/<ns:Invoice> root
 * tag), otherwise falls back to the generic invoice CSV. Content-based, like
 * parseBankFile.ts — `_filename` is accepted for a consistent call signature
 * but isn't used for dispatch (invoice exports don't carry the per-bank
 * filename conventions bank files do). */
export function parseInvoiceFile(_filename: string, text: string): Array<Omit<Invoice, "id">> {
  if (/^\s*<\?xml|<([a-zA-Z]+:)?Invoice[\s>]/.test(text)) return parseInvoiceUbl(text);
  return parseInvoiceCsv(text);
}
