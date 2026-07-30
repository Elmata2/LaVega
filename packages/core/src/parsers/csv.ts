import type { Tx } from "../model.js";
import { norm } from "../hash.js";

/* Ported from Kasoverzicht.html PARSERS block (parseCSV + parseDate + parseAmount
 * + the ING entry in PROFILES). Only the ING CSV profile — other bank profiles are
 * later tasks. Pure string logic, no I/O. */

/* --- quote-aware row splitter, ';'-delimited (ING always uses ';') --- */
function splitRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ";") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (ch === "\r") { /* skip */ }
      else cur += ch;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

/* --- ING date column is YYYYMMDD -> ISO YYYY-MM-DD --- */
function parseDate(v: string): string | null {
  const s = String(v ?? "").trim().replace(/^"|"$/g, "");
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/* --- ING amount column is Dutch-formatted: "12,34", "2500,00", or with a
 * thousands separator "1.234,56" / "2.500,00". Ported from Kasoverzicht.html
 * parseAmount's comma/dot disambiguation (lines ~361-385): when both ',' and
 * '.' are present, the one that appears later is the decimal separator and
 * the other is stripped as a thousands separator; when only ',' is present
 * it's the decimal separator; when only '.' is present in a \d{1,3}(\.\d{3})+
 * shape it's a thousands separator and gets stripped, otherwise it's already
 * a decimal point. --- */
function parseAmount(v: string): number | null {
  if (v == null) return null;
  let s = String(v).trim().replace(/^"|"$/g, "");
  if (!s) return null;
  const lastC = s.lastIndexOf(",");
  const lastD = s.lastIndexOf(".");
  if (lastC > -1 && lastD > -1) {
    if (lastC > lastD) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastC > -1) {
    s = s.replace(",", ".");
  } else if (lastD > -1) {
    const dec = s.length - lastD - 1;
    if (dec === 3 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function headerIndex(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  header.forEach((h, i) => { idx[norm(h).replace(/^"|"$/g, "")] = i; });
  return idx;
}

export function parseIngCsv(text: string, accountKey: string): Omit<Tx, "id">[] {
  const rows = splitRows(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h).replace(/^"|"$/g, "").trim());
  const idx = headerIndex(header);

  const dateCol = idx["datum"];
  const cpCol = idx["naam / omschrijving"];
  const descCol = idx["mededelingen"];
  const amountCol = idx["bedrag (eur)"];
  const dcCol = idx["af bij"];

  const out: Omit<Tx, "id">[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 2) continue;
    const date = parseDate(r[dateCol]);
    let amount = parseAmount(r[amountCol]);
    if (date == null || amount == null) continue;
    const dc = norm(r[dcCol]);
    amount = Math.abs(amount) * (dc === "af" ? -1 : 1);
    out.push({
      accountKey,
      date,
      amount,
      currency: "EUR",
      counterparty: (cpCol > -1 ? String(r[cpCol] ?? "").trim() : ""),
      description: (descCol > -1 ? String(r[descCol] ?? "").trim() : ""),
      category: "",
      manual: false,
    });
  }
  return out;
}
