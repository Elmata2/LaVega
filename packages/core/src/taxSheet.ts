import { AGENTS, TAX_SHEET_FIELDS, type TaxSheetField } from "./agentFacts.js";
import { makeFact, type LearnedFact } from "./facts.js";
import { norm } from "./hash.js";
import { parseAmount, parseDate, splitRows } from "./parsers/primitives.js";

/* ── THE OWNER'S OWN SPREADSHEET ───────────────────────────────────────────
 *
 * Every entrepreneur already keeps a sheet. It has the figures LaVega cannot
 * derive from bank transactions — real turnover, real costs, real profit, the
 * VAT actually charged and paid — and it is the difference between a reservation
 * built on a crude margin proxy and one built on his own bookkeeping.
 *
 * The problem with reading it is that no two sheets have the same columns. So:
 *
 *  1. The owner's sheet is read as a table of strings and mapped onto the six
 *     figures LaVega needs (`TAX_SHEET_FIELDS`).
 *  2. The mapping is GUESSED from the header the first time (Dutch, German and
 *     English synonyms), CONFIRMED by the owner, and then REMEMBERED as
 *     LearnedFacts in the `belasting` namespace — so the next import of the same
 *     sheet is one click, and a sheet with different headers falls back to the
 *     guess rather than mis-mapping.
 *  3. What is remembered is the column HEADER, never a figure. The numbers stay
 *     in the vault; the fact store only knows that "omzet staat in de kolom
 *     Omzet excl. btw".
 *
 * Purity: this module never touches a file. CSV arrives as text
 * (`readSheetCsv`); an XLSX arrives as already-extracted cells
 * (`readSheetRows`), because unzipping a workbook is I/O-shaped work that
 * belongs in the adapter/app layer, not in `core`. */

/** A sheet reduced to what mapping needs: a header row and the data rows. */
export type SheetTable = { header: string[]; rows: string[][] };

/** field -> the header cell in the owner's sheet that holds it. */
export type TaxSheetMapping = Partial<Record<TaxSheetField, string>>;

/** One row of the owner's sheet, in LaVega's terms. `null` = that column was
 *  not mapped or the cell was unreadable — never silently 0. */
export type TaxSheetRow = {
  /** The period cell as written, e.g. "Q2 2026" — kept for the UI. */
  period: string;
  /** The first day of that period, ISO, when it could be read. */
  date: string | null;
  revenueCents: number | null;
  expensesCents: number | null;
  profitCents: number | null;
  vatChargedCents: number | null;
  vatPaidCents: number | null;
};

/** The owner's own figures over one window, ready for the tax engine. A field
 *  is `null` when NO row in the window supplied it, so "not in the sheet" and
 *  "zero this quarter" stay distinguishable. */
export type TaxFigures = {
  from: string;
  to: string;
  rowCount: number;
  revenueCents: number | null;
  expensesCents: number | null;
  profitCents: number | null;
  vatChargedCents: number | null;
  vatPaidCents: number | null;
};

/** Dutch labels for the six figures — the UI language. */
export const TAX_SHEET_FIELD_LABELS: Record<TaxSheetField, string> = {
  period: "Periode",
  revenue: "Omzet",
  expenses: "Kosten",
  profit: "Winst",
  vatCharged: "Btw over omzet",
  vatPaid: "Btw over kosten (voorbelasting)",
};

/** Header synonyms per field: NL, DE and EN, because the sheet may be his
 *  accountant's. Matched exactly first, then as a substring (same two-pass
 *  approach as the bank/invoice CSV importers). */
const SYNONYMS: Record<TaxSheetField, readonly string[]> = {
  period: ["periode", "maand", "kwartaal", "datum", "period", "month", "quarter", "date", "monat", "zeitraum"],
  revenue: ["omzet", "opbrengst", "inkomsten", "revenue", "turnover", "sales", "income", "umsatz", "erlöse"],
  expenses: ["kosten", "uitgaven", "inkoop", "expenses", "costs", "spend", "aufwand", "ausgaben"],
  profit: ["winst", "resultaat", "profit", "result", "gewinn", "ergebnis"],
  vatCharged: ["btw over omzet", "af te dragen btw", "btw hoog", "btw", "vat charged", "output vat", "vat", "umsatzsteuer", "ust"],
  vatPaid: ["voorbelasting", "btw over kosten", "terug te vragen btw", "input vat", "vat paid", "vorsteuer"],
};

/** Read a CSV the owner exported from his sheet. Delimiter is sniffed (`;` in
 *  most Dutch exports, `,` elsewhere) exactly as the bank/invoice importers do. */
export function readSheetCsv(text: string): SheetTable {
  const delim = sniffDelim(text);
  const rows = splitRows(text, delim);
  return readSheetRows(rows);
}

/** Read a sheet that something else already turned into cells — an XLSX
 *  worksheet, a pasted table. Blank leading rows are skipped so a sheet with a
 *  title above the header still works. */
export function readSheetRows(cells: string[][]): SheetTable {
  const rows = cells.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (rows.length === 0) return { header: [], rows: [] };
  return {
    header: rows[0].map((h) => String(h ?? "").replace(/^"|"$/g, "").trim()),
    rows: rows.slice(1).map((r) => r.map((c) => String(c ?? "").trim())),
  };
}

function sniffDelim(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join("\n");
  const cands: Array<[string, number]> = [[";", 0], [",", 0], ["\t", 0], ["|", 0]];
  for (const c of cands) c[1] = head.split(c[0]).length - 1;
  cands.sort((a, b) => b[1] - a[1]);
  return cands[0][1] > 0 ? cands[0][0] : ",";
}

/** Terms that may only match a header EXACTLY. They are real column names on
 *  their own ("Btw"), but as a substring they hit everything — "btw" would
 *  claim "Omzet incl. btw", which is turnover, not VAT. */
const EXACT_ONLY = new Set(["btw", "vat", "ust"]);

/** The header cell that best matches one of `names`: exact normalized match
 *  first, then a substring match, mirroring the invoice/bank CSV `pick()`. */
function matchHeader(header: readonly string[], names: readonly string[]): string | undefined {
  for (const n of names) {
    const k = norm(n);
    const hit = header.find((h) => norm(h) === k);
    if (hit !== undefined) return hit;
  }
  for (const n of names) {
    const k = norm(n);
    if (EXACT_ONLY.has(k)) continue;
    const hit = header.find((h) => norm(h).includes(k));
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/**
 * The mapping to offer the owner for THIS header row.
 *
 * Two passes, in that order for a reason:
 *
 *  1. What the owner already confirmed, but only where the column he named is
 *    actually in this sheet — that is what lets one fact set serve the sheet it
 *    fits and get out of the way of one it doesn't.
 *  2. The synonyms, over the columns pass 1 left free. A column belongs to at
 *    most one figure, so a broad synonym ("btw") can no longer steal a column a
 *    narrower one already claimed ("Omzet incl. btw").
 *
 * A field with no match is left out, for the owner to point at himself.
 */
export function suggestTaxSheetMapping(header: string[], facts: readonly LearnedFact[] = []): TaxSheetMapping {
  const remembered = new Map<string, string>();
  for (const f of facts) {
    if (norm(f.agent) === AGENTS.belasting && norm(f.key) === "kolom") remembered.set(norm(f.subject), f.value);
  }
  const mapping: TaxSheetMapping = {};
  const taken = new Set<string>();
  for (const field of TAX_SHEET_FIELDS) {
    const known = remembered.get(field);
    const inSheet = known === undefined ? undefined : header.find((h) => norm(h) === norm(known));
    if (inSheet !== undefined) {
      mapping[field] = inSheet;
      taken.add(norm(inSheet));
    }
  }
  for (const field of TAX_SHEET_FIELDS) {
    if (mapping[field] !== undefined) continue;
    const chosen = matchHeader(header.filter((h) => !taken.has(norm(h))), SYNONYMS[field]);
    if (chosen !== undefined) {
      mapping[field] = chosen;
      taken.add(norm(chosen));
    }
  }
  return mapping;
}

/**
 * The mapping the owner confirmed, as facts to merge into the vault with
 * `upsertFacts`. Written as `source: "user"` because he confirmed it, so no
 * later guess can overwrite it — that is exactly the learning rule that makes
 * the second import one click.
 */
export function taxSheetMappingFacts(mapping: TaxSheetMapping, updatedAt: string): LearnedFact[] {
  const out: LearnedFact[] = [];
  for (const field of TAX_SHEET_FIELDS) {
    const column = mapping[field];
    if (!column) continue;
    out.push(makeFact({ agent: AGENTS.belasting, subject: field, key: "kolom", value: column, source: "user", updatedAt }));
  }
  return out;
}

const firstOf = (year: string, month: number): string => `${year}-${String(month).padStart(2, "0")}-01`;

/** First three letters of a month name in Dutch, English or German. */
const MONTH_BY_PREFIX: Record<string, number> = {
  jan: 1, feb: 2, mrt: 3, mar: 3, mär: 3, apr: 4, mei: 5, may: 5, mai: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dec: 12, dez: 12,
};

/**
 * The first day of the period a cell describes: a quarter ("Q2 2026"), a month
 * ("2026-04", "apr 2026"), a year ("2026") or a plain date.
 *
 * Period labels are resolved here rather than left to `parseDate`'s
 * `new Date(s)` fallback on purpose: that fallback reads "apr 2026" as LOCAL
 * midnight and then formats it in UTC, which in a positive timezone lands on
 * 31 March — a whole month out, exactly at the boundary a tax window cares
 * about. Every branch below is pure string arithmetic.
 */
export function periodStart(raw: string): string | null {
  const s = norm(raw);
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^[qk]([1-4])[\s\-/]*(\d{4})$/))) return firstOf(m[2], Number(m[1]) * 3 - 2);
  if ((m = s.match(/^(\d{4})[\s\-/]*[qk]([1-4])$/))) return firstOf(m[1], Number(m[2]) * 3 - 2);
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})$/))) return firstOf(m[1], Number(m[2]));
  if ((m = s.match(/^(\d{1,2})[-/](\d{4})$/))) return firstOf(m[2], Number(m[1]));
  if ((m = s.match(/^([a-zä]{3,})\.?[\s\-/]*(\d{4})$/))) {
    const month = MONTH_BY_PREFIX[m[1].slice(0, 3)];
    if (month) return firstOf(m[2], month);
  }
  if (/^\d{4}$/.test(s)) return firstOf(s, 1);
  return parseDate(s);
}

function cents(raw: string | undefined, signed: boolean): number | null {
  const n = parseAmount(raw);
  if (n === null) return null;
  return Math.round((signed ? n : Math.abs(n)) * 100);
}

/**
 * Apply a mapping to a sheet. Amounts become integer cents; costs and VAT are
 * taken as magnitudes (a sheet may write them negative), profit keeps its sign
 * because a loss is real information.
 *
 * `problems` is the honest surface for the UI: which figures LaVega could not
 * find a column for, and how many rows had no readable period.
 */
export function readTaxSheet(table: SheetTable, mapping: TaxSheetMapping): { rows: TaxSheetRow[]; problems: string[] } {
  const col: Partial<Record<TaxSheetField, number>> = {};
  const missing: string[] = [];
  for (const field of TAX_SHEET_FIELDS) {
    const wanted = mapping[field];
    const i = wanted === undefined ? -1 : table.header.findIndex((h) => norm(h) === norm(wanted));
    if (i >= 0) col[field] = i;
    else missing.push(TAX_SHEET_FIELD_LABELS[field]);
  }

  const at = (r: string[], field: TaxSheetField): string | undefined => {
    const i = col[field];
    return i === undefined ? undefined : r[i];
  };

  const rows: TaxSheetRow[] = [];
  let undated = 0;
  for (const r of table.rows) {
    const period = String(at(r, "period") ?? "").trim();
    const row: TaxSheetRow = {
      period,
      date: periodStart(period),
      revenueCents: cents(at(r, "revenue"), false),
      expensesCents: cents(at(r, "expenses"), false),
      profitCents: cents(at(r, "profit"), true),
      vatChargedCents: cents(at(r, "vatCharged"), false),
      vatPaidCents: cents(at(r, "vatPaid"), false),
    };
    // A row with no figures at all is a spacer or a header repeat, not data.
    const empty = row.revenueCents === null && row.expensesCents === null && row.profitCents === null
      && row.vatChargedCents === null && row.vatPaidCents === null;
    if (empty) continue;
    if (row.date === null) undated++;
    rows.push(row);
  }

  const problems: string[] = [];
  if (missing.length) problems.push(`geen kolom gekoppeld voor: ${missing.join(", ")}`);
  if (undated) problems.push(`${undated} regel(s) zonder leesbare periode — die tellen niet mee`);
  return { rows, problems };
}

/**
 * The owner's own figures over `[from, to]` (ISO, inclusive), summed.
 *
 * Profit falls back to revenue − expenses when the sheet has no profit column,
 * because that is arithmetic on his numbers, not a guess. Everything else stays
 * `null` when the sheet does not say.
 */
export function sumTaxFigures(rows: readonly TaxSheetRow[], from: string, to: string): TaxFigures {
  type Sums = Omit<TaxFigures, "from" | "to" | "rowCount">;
  const acc: Sums = { revenueCents: null, expensesCents: null, profitCents: null, vatChargedCents: null, vatPaidCents: null };
  const add = (k: keyof Sums, v: number | null) => {
    if (v === null) return;
    acc[k] = (acc[k] ?? 0) + v;
  };

  let rowCount = 0;
  for (const r of rows) {
    if (r.date === null || r.date < from || r.date > to) continue;
    rowCount++;
    add("revenueCents", r.revenueCents);
    add("expensesCents", r.expensesCents);
    add("profitCents", r.profitCents);
    add("vatChargedCents", r.vatChargedCents);
    add("vatPaidCents", r.vatPaidCents);
  }
  if (acc.profitCents === null && acc.revenueCents !== null && acc.expensesCents !== null) {
    acc.profitCents = acc.revenueCents - acc.expensesCents;
  }
  return { from, to, rowCount, ...acc };
}
