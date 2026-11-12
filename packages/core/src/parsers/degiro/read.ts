import { Schema } from "effect";

/* Strict, DeGiro-specific CSV primitives. This deliberately does not reuse
 * `../primitives.ts`: `splitRows` there guesses delimiters and drops rows per
 * cell, and `parseAmount` re-guesses the decimal separator per value. A DeGiro
 * export has one delimiter and one decimal convention per file, and the account
 * statement's free-text `Omschrijving` column is full of comma decimals while
 * the real amounts use dots. Deciding the locale once per file, from the
 * numeric columns only, is the fix (#314). */

/** One parsed record: its 1-based source line and its raw cells. */
export type CsvRow = { line: number; cells: string[] };

/** A parsed CSV file: the trimmed first record plus every later record. */
export type CsvTable = { header: string[]; rows: CsvRow[] };

export const CsvRowSchema = Schema.Struct({ line: Schema.Int, cells: Schema.Array(Schema.String) });
export const CsvTableSchema = Schema.Struct({
  header: Schema.Array(Schema.String),
  rows: Schema.Array(CsvRowSchema),
});

/** ISO-4217 code plus a signed decimal amount. */
export const CurrencyAmount = Schema.Struct({ currency: Schema.String, amount: Schema.Finite });
export type CurrencyAmount = Schema.Schema.Type<typeof CurrencyAmount>;

/** File-level failure. `problem` is the same Dutch sentence the caller shows the user. */
export class DeGiroReadError extends Schema.TaggedError<DeGiroReadError>()("DeGiroReadError", {
  problem: Schema.String,
}) {}

/** Which decimal convention the file uses. Decided once per file, never per cell. */
export type DeGiroLocale = "dot" | "comma";

const BOM = "\uFEFF";

/**
 * Parse comma-delimited, RFC 4180 CSV text. Never throws: an unterminated quote
 * simply runs to end of input, and the caller's profile detection rejects the
 * resulting header if the file is not a DeGiro export.
 *
 * `rows[i].line` counts every newline consumed, including blank lines and
 * newlines inside quoted fields, so a problem can name the line the user sees.
 */
export function readCsv(text: string): CsvTable {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const records: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  /* A quoted field that holds only spaces is real content, so it survives the
   * blank-record filter; only quoted emptiness proves the record was intended. */
  let recordQuoted = false;
  let line = 1;
  let recordLine = 1;

  const pushCell = (): void => {
    cells.push(cell);
    cell = "";
  };

  const finishRecord = (): void => {
    pushCell();
    if (recordQuoted || cells.some((value) => value.trim() !== "")) {
      records.push({ line: recordLine, cells });
    }
    cells = [];
    recordQuoted = false;
  };

  for (let i = 0; i < source.length; i++) {
    const character = source[i]!;
    if (quoted) {
      if (character === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (character === "\n") line++;
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
      recordQuoted = true;
      continue;
    }
    if (character === ",") {
      pushCell();
      continue;
    }
    if (character === "\n") {
      finishRecord();
      line++;
      recordLine = line;
      continue;
    }
    if (character === "\r") {
      // CRLF and a lone CR both end a record; a CRLF is one line break, not two.
      finishRecord();
      if (source[i + 1] === "\n") i++;
      line++;
      recordLine = line;
      continue;
    }
    cell += character;
  }
  if (cells.length > 0 || cell !== "" || recordQuoted) finishRecord();

  const [first, ...rest] = records;
  return {
    header: first ? first.cells.map((value) => value.trim()) : [],
    rows: rest,
  };
}

/* Columns whose content is prose, a timestamp or an identifier. Skipping them
 * is what keeps the account statement on "dot": its `Omschrijving` values carry
 * comma decimals ("Koop 1 @ 49,12 EUR") that say nothing about file locale. */
const FREE_TEXT_HEADERS = new Set([
  "datum",
  "date",
  "tijd",
  "time",
  "valutadatum",
  "value date",
  "product",
  "naam",
  "name",
  "isin",
  "symbool/isin",
  "symbol/isin",
  "omschrijving",
  "description",
  "beurs",
  "reference exchange",
  "uitvoeringsplaats",
  "venue",
  "order id",
]);

const NUMBERISH = /^-?\d[\d.,]*$/;
const THOUSANDS_DOT = /^-?\d{1,3}(?:\.\d{3})+$/;

/**
 * Decide the file's decimal convention from the numeric columns only.
 *
 * A pair of separators is read by position: whichever appears last is the
 * decimal one. A dot that only groups thousands ("1.234") abstains, because it
 * cannot be told apart from a decimal dot; a comma never groups thousands in
 * the exports seen so far. A tie or no evidence at all means dot, the account
 * statement's convention.
 */
export function detectLocale(table: CsvTable): DeGiroLocale {
  let comma = 0;
  let dot = 0;

  for (let column = 0; column < table.header.length; column++) {
    const label = table.header[column]!.trim().toLowerCase();
    if (FREE_TEXT_HEADERS.has(label)) continue;
    for (const row of table.rows) {
      const cell = row.cells[column];
      if (cell === undefined) continue;
      const token = cell.trim();
      if (!NUMBERISH.test(token)) continue;
      const lastComma = token.lastIndexOf(",");
      const lastDot = token.lastIndexOf(".");
      if (lastComma >= 0 && lastDot >= 0) {
        if (lastComma > lastDot) comma++;
        else dot++;
      } else if (lastComma >= 0) {
        comma++;
      } else if (lastDot >= 0 && !THOUSANDS_DOT.test(token)) {
        dot++;
      }
    }
  }

  return comma > dot ? "comma" : "dot";
}

/**
 * Parse one amount in the file's convention. Returns `null` for empty or
 * non-numeric input and never `NaN`; `0` is a real value and survives.
 */
export function parseDecimal(raw: string, locale: DeGiroLocale): number | null {
  let text = raw.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
  // `\s` already covers the non-breaking variants (NBSP, narrow NBSP, thin space).
  text = text.replace(/\s/g, "");
  if (!text) return null;
  const normalized =
    locale === "dot" ? text.replace(/,/g, "") : text.replace(/\./g, "").replace(/,/g, ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
};

const isoDate = (year: number, month: number, day: number): string | null => {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/**
 * Parse `DD-MM-YYYY` (the DeGiro shape) or an already-ISO date into ISO
 * `YYYY-MM-DD`. Rejects impossible calendar days, including 29-02 off a leap
 * year; it never falls back to `new Date(text)` and its timezone guessing.
 */
export function parseIsoDate(raw: string): string | null {
  const text = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dutch = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(text);
  if (dutch) return isoDate(Number(dutch[3]), Number(dutch[2]), Number(dutch[1]));
  return null;
}

/**
 * Parse `H:MM` or `HH:MM` into zero-padded `"HH:MM"`. A trailing `:SS` is
 * ignored. Returns `null` for empty input or an impossible clock time.
 */
export function parseClockTime(raw: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const CURRENCY_CODE = /^[A-Z]{3}$/;

const cellAt = (cells: readonly string[], index: number): string =>
  index >= 0 && index < cells.length ? cells[index]! : "";

const isBlankHeader = (header: readonly string[], index: number): boolean =>
  index >= 0 && index < header.length && header[index]!.trim() === "";

/**
 * Read a currency and its amount from the two adjacent columns DeGiro uses for
 * every money field. The label column holds the currency on the account
 * statement (`Mutatie`, `Saldo`) and the amount on the transactions and
 * portfolio exports (`Koers`, `Lokale waarde`), so only the label's blank
 * neighbour identifies the pair; the value shapes then say which is which.
 *
 * Returns `null` rather than guessing when the neighbour is labelled, when both
 * cells look like currency codes, or when the amount does not parse. An empty
 * amount cell is `null`, never `0`.
 */
export function currencyAmountAt(
  header: readonly string[],
  cells: readonly string[],
  labelIndex: number,
  locale: DeGiroLocale,
): CurrencyAmount | null {
  const partner = isBlankHeader(header, labelIndex + 1)
    ? labelIndex + 1
    : isBlankHeader(header, labelIndex - 1)
      ? labelIndex - 1
      : null;
  if (partner === null) return null;

  const label = cellAt(cells, labelIndex).trim();
  const adjacent = cellAt(cells, partner).trim();
  const labelIsCurrency = CURRENCY_CODE.test(label);
  const adjacentIsCurrency = CURRENCY_CODE.test(adjacent);
  if (labelIsCurrency === adjacentIsCurrency) return null;

  const amount = parseDecimal(labelIsCurrency ? adjacent : label, locale);
  if (amount === null) return null;
  return { currency: labelIsCurrency ? label : adjacent, amount };
}

/**
 * One Dutch problem per row whose cell is non-empty but not a real date. The
 * line number is the source line, so the user can open the export at that row.
 */
export function dateProblems(table: CsvTable, column: number): string[] {
  const problems: string[] = [];
  for (const row of table.rows) {
    const raw = cellAt(row.cells, column).trim();
    if (raw === "") continue;
    if (parseIsoDate(raw) === null) {
      problems.push(`rij ${row.line}: onmogelijke datum "${raw}"`);
    }
  }
  return problems;
}
