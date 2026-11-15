import type { Invoice } from "../model.js";
import { norm } from "../hash.js";
import { splitRows, parseDate, parseAmount, headerIndex } from "./primitives.js";

/* Generic invoice CSV importer — mirrors bankCsv.ts's structure (sniff the
 * delimiter, index the header, fuzzily `pick()` flexible NL/EN column names,
 * map per row) but for a single loose "invoice export" shape rather than a
 * table of per-bank profiles: exports vary far more between bookkeeping tools
 * than between banks, so there is one column map with generous synonyms
 * instead of a per-source PROFILES table. */

/* --- fuzzy column-name picker, ported verbatim from bankCsv.ts's pick():
 * exact normalized-header match first, then a substring fallback. --- */
function pick(idx: Record<string, number>, names: string[]): number {
  for (const n of names) {
    const k = norm(n);
    if (k in idx) return idx[k];
  }
  for (const n of names) {
    const k = norm(n);
    for (const key in idx) {
      if (key.includes(k)) return idx[key];
    }
  }
  return -1;
}

/* --- pick a delimiter by counting occurrences in the first few lines; ties
 * favour ';' > ',' > '\t' > '|' (candidate order), default ',' if none found.
 * Ported verbatim from bankCsv.ts's sniffDelim(). --- */
function sniffDelim(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join("\n");
  const cands: Array<[string, number]> = [
    [";", 0],
    [",", 0],
    ["\t", 0],
    ["|", 0],
  ];
  for (const c of cands) c[1] = head.split(c[0]).length - 1;
  cands.sort((a, b) => b[1] - a[1]);
  return cands[0][1] > 0 ? cands[0][0] : ",";
}

const CP_NAMES = [
  "relatie",
  "leverancier",
  "klant",
  "counterparty",
  "naam",
  "debiteur",
  "crediteur",
];
const AMOUNT_NAMES = ["bedrag", "amount", "totaal", "total", "bedrag incl"];
const ISSUE_DATE_NAMES = ["factuurdatum", "datum", "issue date"];
const DUE_DATE_NAMES = ["vervaldatum", "due date", "verval"];
const NUMBER_NAMES = ["factuurnummer", "nummer", "invoice"];
const VAT_NAMES = ["btw", "vat", "btw-bedrag"];
const DIRECTION_NAMES = ["richting", "type", "soort"];

// Values within the richting/type/soort column, not header names.
const OUT_HINTS = ["inkoop", "purchase", "crediteur"];
const IN_HINTS = ["verkoop", "sales", "debiteur", "income"];

function detectDirection(raw: string | undefined): Invoice["direction"] {
  const v = norm(raw);
  if (!v) return "out";
  if (IN_HINTS.some((h) => v.includes(h))) return "in";
  if (OUT_HINTS.some((h) => v.includes(h))) return "out";
  return "out";
}

/**
 * Parses a generic invoice CSV export (NL or EN headers) into
 * Omit<Invoice,"id">[]. `entity` is left blank — the caller (Facturen.tsx)
 * stamps it with the currently-selected entity before running the rows
 * through makeInvoice. Rows missing an amount or an issue date are skipped;
 * a missing due date defaults to the issue date (mirrors invoiceUbl.ts).
 */
export function parseInvoiceCsv(text: string): Array<Omit<Invoice, "id">> {
  const delim = sniffDelim(text);
  const rows = splitRows(text, delim);
  if (!rows.length) return [];

  const header = rows[0].map((h) => String(h).replace(/^"|"$/g, "").trim());
  const idx = headerIndex(header);

  const ci = {
    cp: pick(idx, CP_NAMES),
    amount: pick(idx, AMOUNT_NAMES),
    issue: pick(idx, ISSUE_DATE_NAMES),
    due: pick(idx, DUE_DATE_NAMES),
    number: pick(idx, NUMBER_NAMES),
    vat: pick(idx, VAT_NAMES),
    direction: pick(idx, DIRECTION_NAMES),
  };

  const out: Array<Omit<Invoice, "id">> = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 2) continue;

    const amount = ci.amount > -1 ? parseAmount(r[ci.amount]) : null;
    const issueDate = ci.issue > -1 ? parseDate(r[ci.issue]) : null;
    if (amount == null || issueDate == null) continue;
    // No dueDate column (or unparseable) -> default to issueDate, matching
    // the UBL parser's fallback.
    const dueDate = (ci.due > -1 ? parseDate(r[ci.due]) : null) ?? issueDate;

    const vat = ci.vat > -1 ? parseAmount(r[ci.vat]) : null;

    out.push({
      entity: "",
      direction: detectDirection(ci.direction > -1 ? String(r[ci.direction] ?? "") : undefined),
      counterparty: ci.cp > -1 ? String(r[ci.cp] ?? "").trim() : "",
      invoiceNumber: ci.number > -1 ? String(r[ci.number] ?? "").trim() || undefined : undefined,
      issueDate,
      dueDate,
      amount: Math.abs(amount),
      vatAmount: vat != null ? Math.abs(vat) : undefined,
      currency: "EUR",
      status: "expected",
      sourceType: "csv",
    });
  }
  return out;
}
