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

/* --- ING amount column is comma-decimal, e.g. "12,34" --- */
function parseAmount(v: string): number | null {
  const s = String(v ?? "").trim().replace(/^"|"$/g, "").replace(",", ".");
  if (!s) return null;
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
