import { norm } from "../hash.js";

/* Ported from Kasoverzicht.html's PARSERS block: the quote-aware CSV splitter,
 * parseDate (346-360, full multi-format version), parseAmount (362-385), and
 * headerIndex (502-506). Shared, pure primitives used by both ./csv.ts
 * (parseIngCsv) and ./bankCsv.ts (parseBankCsv) — kept in their own module so
 * those two can both depend on this without importing each other. */

/* --- quote-aware row splitter. Defaults to ';' (ING always uses ';'); the
 * profile engine (./bankCsv.ts) passes other delimiters (',', '\t', '|') for
 * other banks' exports via an explicit second argument. --- */
export function splitRows(text: string, delim = ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === delim) {
        row.push(cur);
        cur = "";
      } else if (ch === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else if (ch === "\r") {
        /* skip */
      } else cur += ch;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

/* --- datum: full multi-format port of Kasoverzicht.html's parseDate (346-360).
 * Handles ISO (YYYY-MM-DD), ING/compact (YYYYMMDD), DD-MM-YYYY / DD/MM/YYYY /
 * DD.MM.YYYY (also 2-digit year), MT940's YYMMDD, and falls back to Date
 * parsing for anything else. Always returns ISO YYYY-MM-DD or null. --- */
export function parseDate(v: unknown, order: "DMY" | "MDY" = "DMY"): string | null {
  let s = String(v ?? "").trim();
  if (!s) return null;
  s = s.replace(/^"|"$/g, "");
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) {
    const a = Number(m[1]),
      b = Number(m[2]);
    const day = order === "MDY" ? b : a;
    const month = order === "MDY" ? a : b;
    return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})(\D|$)/))) {
    const a = Number(m[1]),
      b = Number(m[2]);
    const day = order === "MDY" ? b : a;
    const month = order === "MDY" ? a : b;
    return `20${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if ((m = s.match(/^(\d{2})(\d{2})(\d{2})$/))) return `20${m[1]}-${m[2]}-${m[3]}`; // MT940 YYMMDD
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/* --- bedrag: Dutch-formatted amounts, e.g. "12,34", "2500,00", or with a
 * thousands separator "1.234,56" / "2.500,00". Ported from Kasoverzicht.html
 * parseAmount's comma/dot disambiguation (lines ~361-385): when both ',' and
 * '.' are present, the one that appears later is the decimal separator and
 * the other is stripped as a thousands separator; when only ',' is present
 * it's the decimal separator; when only '.' is present in a \d{1,3}(\.\d{3})+
 * shape it's a thousands separator and gets stripped, otherwise it's already
 * a decimal point. --- */
export function parseAmount(v: unknown): number | null {
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

/* --- maps a normalized header cell -> column index. --- */
export function headerIndex(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    idx[norm(h).replace(/^"|"$/g, "")] = i;
  });
  return idx;
}

/* --- IBAN uit tekst --- */
export function findIban(s: unknown): string | null {
  const m = String(s ?? "")
    .toUpperCase()
    .replace(/\s/g, "")
    .match(/[A-Z]{2}\d{2}[A-Z0-9]{8,26}/);
  return m ? m[0] : null;
}

const BANK_BY_IBAN_PREFIX: Record<string, string> = {
  INGB: "ING",
  ABNA: "ABN AMRO",
  RABO: "Rabobank",
  KNAB: "Knab",
  BUNQ: "bunq",
  TRIO: "Triodos",
  SNSB: "SNS",
  ASNB: "ASN",
  RBRB: "RegioBank",
  NNBA: "NN",
  REVO: "Revolut",
};
export function bankFromIban(iban: unknown): string | null {
  const c = String(iban ?? "")
    .toUpperCase()
    .slice(4, 8);
  return BANK_BY_IBAN_PREFIX[c] || null;
}

/* A BIC's first 4 chars are the same bank code as IBAN positions 5-8, so we can
 * reuse the same map. Used for MT940 accounts whose :25: is an old-style account
 * number (no IBAN) — the bank is then derived from the statement header's BIC. */
export function bankFromBic(bic: unknown): string | null {
  const c = String(bic ?? "")
    .toUpperCase()
    .slice(0, 4);
  return BANK_BY_IBAN_PREFIX[c] || null;
}
