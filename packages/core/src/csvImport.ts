/**
 * Generic CSV/Excel import session (WS3.6, issue #294).
 *
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 * Sure sources: `app/models/import.rb` + `import/*_mapping.rb`. No Ruby is
 * copied.
 *
 * Sure runs an import as a session: upload → mapping → pre-flight (row counts,
 * rejected rows with reasons) → confirm → import, with the source document
 * retained and a re-upload detected. LaVega already has per-bank parser
 * profiles and ONE identity scheme (`tx.id` from `hash.ts`); this module is the
 * GENERIC path for a file no profile recognises, and it reuses those primitives
 * instead of inventing a second dedupe scheme.
 *
 * Dedupe honesty, taken from CONTEXT: identity keys on account + counterparty/
 * description, which a bank's CSV and its MT940 export extract differently, so
 * the same account imported in a SECOND format double-counts. This session
 * therefore dedupes only within one source format, warns on a second format and
 * REFUSES it by default (the owner can override explicitly). It never claims
 * cross-format dedupe.
 */
import type { Tx } from "./model.js";
import { assignTxIds, txBase } from "./hash.js";
import { ingest } from "./ingest.js";
import { norm } from "./hash.js";
import { parseAmount, parseDate, splitRows } from "./parsers/primitives.js";

/** The format a session records. Two generic formats are still two formats: a
 *  file exported as CSV and again as XLSX would double-count. */
export type ImportFormat =
  | "generic-csv"
  | "generic-xlsx"
  | "bank-csv"
  | "mt940"
  | "camt053"
  | "other";

/** One import the vault remembers. `txIds` are EXACTLY the rows that import
 *  created, which is what makes revert exact. */
export type ImportSession = {
  id: string;
  /** The retained source document's SHA-256, when it was stored. */
  documentId: string | null;
  filename: string;
  accountKey: string;
  format: ImportFormat;
  importedAt: string;
  txIds: string[];
  rowsRead: number;
  rowsImported: number;
  duplicatesSkipped: number;
  rowsRejected: number;
};

/** Which columns the file's header row maps to. A single signed amount column
 *  OR a debit/credit pair; both may be absent (nothing parses). */
export type GenericMapping = {
  delimiter: string;
  dateColumn: number;
  amountColumn: number | null;
  debitColumn: number | null;
  creditColumn: number | null;
  counterpartyColumn: number | null;
  descriptionColumn: number | null;
  currencyColumn: number | null;
  dateOrder: "DMY" | "MDY";
  /** Flip a single amount column's sign (a bank that exports expenses as
   *  positive). */
  invertAmount: boolean;
};

export type ColumnGuess = {
  mapping: GenericMapping;
  /** How many of the required fields the header row actually answered. */
  confidence: number;
  sources: string[];
};

const DELIMITERS = [";", ",", "\t", "|"] as const;

/** The delimiter that splits the first non-empty lines into the most columns.
 *  A quote-aware default of ";" (the Dutch bank standard) when none stands out. */
export function detectDelimiter(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(0, 5);
  let best = ";";
  let bestSpread = 0;
  for (const delimiter of DELIMITERS) {
    const widths = lines.map((line) => splitRows(line, delimiter)[0]?.length ?? 0);
    const spread = Math.max(...widths, 0);
    if (spread > bestSpread) {
      bestSpread = spread;
      best = delimiter;
    }
  }
  return bestSpread > 1 ? best : ";";
}

const DATE_WORDS = [
  "datum",
  "date",
  "boekdatum",
  "transactiedatum",
  "valutadatum",
  "transaction date",
  "booking date",
];
const AMOUNT_WORDS = [
  "bedrag",
  "amount",
  "transactiebedrag",
  "mutatie",
  "waarde",
  "value",
  "transaction amount",
];
const DEBIT_WORDS = ["af", "debet", "debit", "afgeschreven", "money out"];
const CREDIT_WORDS = ["bij", "credit", "bijgeschreven", "money in"];
const COUNTERPARTY_WORDS = [
  "tegenpartij",
  "naam",
  "name",
  "counterparty",
  "merchant",
  "begunstigde",
  "tegenrekening",
  "payee",
];
const DESCRIPTION_WORDS = [
  "omschrijving",
  "description",
  "mededelingen",
  "memo",
  "details",
  "referentie",
  "reference",
];
const CURRENCY_WORDS = ["valuta", "currency", "munt"];

function headerMatches(cell: string, words: readonly string[]): boolean {
  const value = norm(cell)
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim();
  return words.some(
    (word) => value === word || value.startsWith(`${word} `) || value.includes(word),
  );
}

function findColumn(headers: readonly string[], words: readonly string[]): number | null {
  for (let i = 0; i < headers.length; i += 1) {
    if (headerMatches(headers[i] ?? "", words)) return i;
  }
  return null;
}

/** A positional fallback for a file with no recognisable header: the first
 *  column whose sample cells parse as dates, and the first whose cells parse as
 *  amounts. Better an explicit guess the owner can correct than nothing. */
function positional(
  sampleRows: readonly string[][],
): { dateColumn: number; amountColumn: number | null } | null {
  const width = Math.max(0, ...sampleRows.map((row) => row.length));
  let dateColumn = -1;
  let amountColumn = -1;
  for (let column = 0; column < width; column += 1) {
    const cells = sampleRows.slice(0, 8).map((row) => row[column] ?? "");
    const dates = cells.filter((cell) => parseDate(cell) != null).length;
    const amounts = cells.filter((cell) => parseAmount(cell) != null).length;
    if (dateColumn < 0 && dates >= Math.max(2, Math.ceil(cells.length / 2))) dateColumn = column;
    if (amountColumn < 0 && amounts >= Math.max(2, Math.ceil(cells.length / 2)))
      amountColumn = column;
  }
  return dateColumn < 0
    ? null
    : { dateColumn, amountColumn: amountColumn < 0 ? null : amountColumn };
}

/** Detect the date order from the values themselves: a first component above 12
 *  is a day, a second component above 12 makes it month-first. */
function detectDateOrder(sampleRows: readonly string[][], column: number): "DMY" | "MDY" {
  let monthFirst = false;
  for (const row of sampleRows.slice(0, 20)) {
    const match = (row[column] ?? "").trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]/);
    if (match == null) continue;
    if (Number(match[1]) > 12) return "DMY";
    if (Number(match[2]) > 12) monthFirst = true;
  }
  return monthFirst ? "MDY" : "DMY";
}

/**
 * Guess the mapping from a header row (and, failing that, from the data). The
 * guess is a STARTING POINT the wizard shows and the owner can override; a low
 * confidence is visible, not hidden.
 */
export function detectGenericMapping(input: {
  headers: readonly string[];
  sampleRows?: readonly string[][];
  text?: string;
}): ColumnGuess {
  const headers = input.headers;
  const sampleRows = input.sampleRows ?? [];
  const sources: string[] = [];
  const delimiter = input.text != null ? detectDelimiter(input.text) : ";";

  let dateColumn = findColumn(headers, DATE_WORDS);
  if (dateColumn != null) sources.push("header:date");
  let amountColumn = findColumn(headers, AMOUNT_WORDS);
  if (amountColumn != null) sources.push("header:amount");
  const debitColumn = findColumn(headers, DEBIT_WORDS);
  if (debitColumn != null) sources.push("header:debit");
  const creditColumn = findColumn(headers, CREDIT_WORDS);
  if (creditColumn != null) sources.push("header:credit");
  const counterpartyColumn = findColumn(headers, COUNTERPARTY_WORDS);
  if (counterpartyColumn != null) sources.push("header:counterparty");
  const descriptionColumn = findColumn(headers, DESCRIPTION_WORDS);
  if (descriptionColumn != null) sources.push("header:description");
  const currencyColumn = findColumn(headers, CURRENCY_WORDS);
  if (currencyColumn != null) sources.push("header:currency");

  if (dateColumn == null || (amountColumn == null && debitColumn == null && creditColumn == null)) {
    const fallback = positional(sampleRows);
    if (fallback != null) {
      if (dateColumn == null) dateColumn = fallback.dateColumn;
      if (amountColumn == null && fallback.amountColumn != null)
        amountColumn = fallback.amountColumn;
      sources.push("values:positional");
    }
  }

  const dateOrder = dateColumn == null ? "DMY" : detectDateOrder(sampleRows, dateColumn);
  const mapping: GenericMapping = {
    delimiter,
    dateColumn: dateColumn ?? -1,
    amountColumn: debitColumn == null && creditColumn == null ? amountColumn : null,
    debitColumn,
    creditColumn,
    counterpartyColumn,
    descriptionColumn,
    currencyColumn,
    dateOrder,
    invertAmount: false,
  };
  const required = [
    mapping.dateColumn >= 0,
    mapping.amountColumn != null || mapping.debitColumn != null || mapping.creditColumn != null,
  ];
  return {
    mapping,
    confidence: required.filter(Boolean).length / required.length,
    sources,
  };
}

export type RejectedRow = {
  /** 1-based line in the FILE, header included, so the message can point at it. */
  line: number;
  reason: "date" | "amount";
  cells: string[];
};

export type ParsedGenericRow = {
  line: number;
  date: string;
  amount: number;
  counterparty: string;
  description: string;
  currency: string;
};

function cell(row: readonly string[], column: number | null): string {
  return column == null || column < 0 ? "" : String(row[column] ?? "").trim();
}

/** Map raw cells to transactions, rejecting every row with a reason instead of
 *  dropping it silently. Header rows are the CALLER's problem: `rows` start at
 *  the first data line and `firstLine` numbers the errors. */
export function parseGenericRows(
  rows: readonly string[][],
  mapping: GenericMapping,
  options: { currency?: string; firstLine?: number } = {},
): { parsed: ParsedGenericRow[]; rejected: RejectedRow[] } {
  const parsed: ParsedGenericRow[] = [];
  const rejected: RejectedRow[] = [];
  const firstLine = options.firstLine ?? 2;
  rows.forEach((row, index) => {
    const line = firstLine + index;
    const date = parseDate(cell(row, mapping.dateColumn), mapping.dateOrder);
    if (date == null) {
      rejected.push({ line, reason: "date", cells: [...row] });
      return;
    }
    let amount: number | null = null;
    if (mapping.amountColumn != null) {
      amount = parseAmount(cell(row, mapping.amountColumn));
      if (amount != null && mapping.invertAmount) amount = -amount;
    } else if (mapping.debitColumn != null || mapping.creditColumn != null) {
      const debit = parseAmount(cell(row, mapping.debitColumn));
      const credit = parseAmount(cell(row, mapping.creditColumn));
      if (debit != null || credit != null) {
        amount = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
      }
    }
    if (amount == null || Math.abs(amount) < 0.005) {
      rejected.push({ line, reason: "amount", cells: [...row] });
      return;
    }
    parsed.push({
      line,
      date,
      amount: Math.round(amount * 100) / 100,
      counterparty: cell(row, mapping.counterpartyColumn),
      description: cell(row, mapping.descriptionColumn),
      currency: (cell(row, mapping.currencyColumn) || options.currency || "EUR").toUpperCase(),
    });
  });
  return { parsed, rejected };
}

/** Why a second format is a problem, in data: the formats this account already
 *  imported. Empty means the account is new to imports (or only this format). */
export function importFormatsFor(
  sessions: readonly ImportSession[],
  accountKey: string,
): ImportFormat[] {
  return [...new Set(sessions.filter((s) => s.accountKey === accountKey).map((s) => s.format))];
}

export type GenericImportPlan = {
  format: ImportFormat;
  accountKey: string;
  rowsRead: number;
  parsed: ParsedGenericRow[];
  rejected: RejectedRow[];
  /** Rows that repeat an earlier row in THIS file (same identity). */
  duplicatesInFile: number;
  /** Rows the vault already holds for this account (same-format identity). */
  duplicatesOnFile: number;
  /** What a confirm would add. Empty when blocked. */
  newRows: ParsedGenericRow[];
  /** Set when the account already imported in a DIFFERENT format: the session
   *  refuses by default instead of double-counting (CONTEXT). */
  blocked: { reason: "cross-format"; formats: ImportFormat[] } | null;
  warnings: { kind: "cross-format"; formats: ImportFormat[] }[];
};

export type GenericImportInput = {
  rows: readonly string[][];
  mapping: GenericMapping;
  accountKey: string;
  existingTxs: readonly Tx[];
  sessions: readonly ImportSession[];
  format: ImportFormat;
  currency?: string;
  /** The owner read the warning and chose to import anyway. */
  allowCrossFormat?: boolean;
};

/** The dry run: what would be read, rejected, skipped and added. Nothing here
 *  writes; the wizard shows these counts BEFORE anything is imported. */
export function planGenericImport(input: GenericImportInput): GenericImportPlan {
  const { parsed, rejected } = parseGenericRows(input.rows, input.mapping, {
    currency: input.currency,
  });
  const formats = importFormatsFor(input.sessions, input.accountKey).filter(
    (format) => format !== input.format,
  );
  const blocked =
    formats.length > 0 && input.allowCrossFormat !== true
      ? ({ reason: "cross-format", formats } as const)
      : null;

  // Same-format identity: a stored row with the same coordinates (and the same
  // occurrence index) is the SAME movement, so a re-import of the file — or of
  // its overlap — is skipped instead of doubled. A repeat inside the file with
  // no stored counterpart is a genuine second movement on those coordinates and
  // is imported (the same max-count rule `ingest` applies).
  const existing = input.existingTxs.filter((tx) => tx.accountKey === input.accountKey);
  const existingCount = new Map<string, number>();
  for (const tx of existing) {
    const key = txBase(tx);
    existingCount.set(key, (existingCount.get(key) ?? 0) + 1);
  }
  const fileCount = new Map<string, number>();
  const fresh: ParsedGenericRow[] = [];
  let duplicatesOnFile = 0;
  for (const row of parsed) {
    const probe = {
      accountKey: input.accountKey,
      date: row.date,
      amount: row.amount,
      counterparty: row.counterparty,
      description: row.description,
    };
    const key = txBase(probe);
    const occurrence = (fileCount.get(key) ?? 0) + 1;
    fileCount.set(key, occurrence);
    if (occurrence <= (existingCount.get(key) ?? 0)) {
      duplicatesOnFile += 1;
      continue;
    }
    fresh.push(row);
  }

  return {
    format: input.format,
    accountKey: input.accountKey,
    rowsRead: input.rows.length,
    parsed,
    rejected,
    duplicatesInFile: 0,
    duplicatesOnFile,
    newRows: blocked == null ? fresh : [],
    blocked,
    warnings: formats.length > 0 ? [{ kind: "cross-format", formats }] : [],
  };
}

export type GenericImportResult = {
  txs: Tx[];
  session: ImportSession;
  /** The rows this import created, in order. */
  importedIds: string[];
};

/** Apply a confirmed plan: merge the rows with `ingest` (the ONE identity
 *  scheme) and record exactly what was created in a session. */
export function applyGenericImport(input: {
  existingTxs: readonly Tx[];
  plan: GenericImportPlan;
  id: string;
  filename: string;
  asOf: string;
  documentId?: string | null;
}): GenericImportResult {
  if (input.plan.blocked != null) {
    throw new Error(`import blocked: ${input.plan.blocked.reason}`);
  }
  const incoming = input.plan.newRows.map((row) => ({
    accountKey: input.plan.accountKey,
    date: row.date,
    amount: row.amount,
    currency: row.currency,
    counterparty: row.counterparty,
    description: row.description,
    category: "",
    manual: false,
  }));
  const before = new Set(input.existingTxs.map((tx) => tx.id));
  const txs = ingest([...input.existingTxs], incoming);
  const importedIds = txs.filter((tx) => !before.has(tx.id)).map((tx) => tx.id);
  const session: ImportSession = {
    id: input.id,
    documentId: input.documentId ?? null,
    filename: input.filename,
    accountKey: input.plan.accountKey,
    format: input.plan.format,
    importedAt: input.asOf,
    txIds: importedIds,
    rowsRead: input.plan.rowsRead,
    rowsImported: importedIds.length,
    duplicatesSkipped: input.plan.duplicatesOnFile + input.plan.duplicatesInFile,
    rowsRejected: input.plan.rejected.length,
  };
  return { txs, session, importedIds };
}

export type RevertResult = {
  txs: Tx[];
  session: ImportSession | null;
  removedIds: string[];
  /** The source document the session had retained, for the caller to unlink. */
  documentId: string | null;
};

/**
 * Revert ONE import: remove exactly the rows its session recorded that are
 * still in the ledger, and nothing else. A row that was edited or merged since
 * (its id is gone) is not invented back.
 */
export function revertImport(input: {
  txs: readonly Tx[];
  sessions: readonly ImportSession[];
  sessionId: string;
}): RevertResult {
  const session = input.sessions.find((s) => s.id === input.sessionId) ?? null;
  if (session == null)
    return { txs: [...input.txs], session: null, removedIds: [], documentId: null };
  const recorded = new Set(session.txIds);
  const removedIds = input.txs.filter((tx) => recorded.has(tx.id)).map((tx) => tx.id);
  return {
    txs: input.txs.filter((tx) => !recorded.has(tx.id)),
    session,
    removedIds,
    documentId: session.documentId,
  };
}

/** Ids the wizard needs: a session is a fresh, content-independent record. */
export function fallbackSessionId(index: number, asOf: string): string {
  return `import-${asOf}-${index}`;
}

/** CSV text → header + rows, with the delimiter the mapping carries. Reused by
 *  the wizard and by tests so a preview reads the file exactly as the import
 *  will. */
export function rowsFromCsv(
  text: string,
  delimiter: string,
): { headers: string[]; rows: string[][] } {
  const rows = splitRows(text.replace(/^\uFEFF/, ""), delimiter);
  const headers = rows[0] ?? [];
  return { headers, rows: rows.slice(1) };
}

/** A plan's incoming rows as a preview of what the ledger will hold. */
export function previewRows(plan: GenericImportPlan, limit = 5): ParsedGenericRow[] {
  void limit;
  return plan.newRows.slice(0, limit);
}

/** Exported so the wizard and tests share one identity walking. */
export { assignTxIds, txBase };
