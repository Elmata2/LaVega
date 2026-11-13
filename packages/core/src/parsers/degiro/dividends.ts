import { hash, norm } from "../../hash.js";
import type { Dividend } from "../../investing/dividend.js";
import { ACCOUNT_COLUMNS } from "./account.js";
import { classifyAccountRow } from "./classify.js";
import { readDeGiroCsv } from "./profiles.js";
import { type CsvTable, cellText, currencyAmountAt, detectLocale, parseIsoDate } from "./read.js";

/* Issue #316: turn the account statement's `Dividend` and `Dividendbelasting`
 * rows into `Dividend[]`, with the withholding tax kept as its own fact.
 *
 * A dividend and its tax are two ledger rows, not one. The dividend row carries
 * the gross cash, the tax row what the broker took (or refunded). LaVega's model
 * wants one dividend per event, so this mapper pairs the rows on
 * ISIN + currency + Valutadatum, sums the tax per pair, and nets it out of the
 * amount. `withholdingTax` stays present so a zero-tax event (field absent) is
 * distinct from a fully refunded one (field 0).
 *
 * The statement is newest first and a tax row may sit above or below its gross
 * row. Tax is therefore summed per key before the gross rows are walked oldest
 * first: a negative gross row can only be netted into a dividend that has
 * already been emitted.
 */

/** How the statement's dividend rows were accounted for. */
export type AccountDividendCounts = {
  /** `Dividend` rows, including corrections. */
  grossRows: number;
  /** `Dividendbelasting` rows. */
  taxRows: number;
  /** Negative `Dividend` rows netted into an earlier dividend. */
  corrections: number;
  /** Rows recorded without their counterpart (see problems). */
  unmatched: number;
};

export type AccountDividends = {
  /** `entity` is stamped by the adapter, exactly like the cash-flow and trade paths. */
  dividends: Omit<Dividend, "entity">[];
  counts: AccountDividendCounts;
  problems: string[];
};

const EMPTY_COUNTS = (): AccountDividendCounts => ({
  grossRows: 0,
  taxRows: 0,
  corrections: 0,
  unmatched: 0,
});

const empty = (problems: string[]): AccountDividends => ({
  dividends: [],
  counts: EMPTY_COUNTS(),
  problems,
});

/** One validated dividend-bucket row, reduced to what the pairing needs. */
type DividendRow = {
  /** 1-based source line, for the problem text. */
  line: number;
  /** The cash date: `Valutadatum` when valid, else `Datum`. */
  date: string;
  product: string;
  isin: string;
  description: string;
  currency: string;
  /** Signed `Mutatie`: a charge is negative. */
  amount: number;
  kind: "gross" | "tax";
};

type PendingDividend = {
  dividend: Omit<Dividend, "entity" | "id">;
  /* The origin row's own signed amount and cash date, before its tax was added
   * and before a correction netted into it. Content-hash identity must use these:
   * a re-parse of a newer file whose correction changes `amount` then keeps the
   * same id, so a merge replaces instead of duplicating. */
  originAmount: number;
  originDate: string;
};

const matchKey = (row: DividendRow): string => `${row.isin}|${row.currency}|${row.date}`;

/** The dividend for one row. `withholdingTax` is null only when the row's key
 *  had no tax line at all; a fully refunded tax is 0, not absent. */
function toDividend(
  row: DividendRow,
  amount: number,
  withholdingTax: number | null,
): Omit<Dividend, "entity" | "id"> {
  // DeGiro has no ticker. The spec makes ISIN the instrument identity, with the
  // product name as the display fallback when a row has no ISIN.
  const symbol = row.isin || row.product;
  return {
    date: row.date,
    symbol,
    amount,
    currency: row.currency,
    broker: "degiro",
    ...(row.isin ? { isin: row.isin } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(withholdingTax === null ? {} : { withholdingTax }),
  };
}

/** Same content-hash identity as `assignCashFlowIds`, so a re-parse yields the
 *  same ids and identical rows stay distinct through the occurrence counter. */
function assignDividendIds(pending: readonly PendingDividend[]): Omit<Dividend, "entity">[] {
  const seen = new Map<string, number>();
  return pending.map((entry) => {
    const base = [
      "degiro-dividend",
      entry.originDate,
      norm(entry.dividend.currency),
      entry.originAmount,
      norm(entry.dividend.symbol),
      norm(entry.dividend.description),
    ].join("|");
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return { ...entry.dividend, id: hash(`${base}#${occurrence}`) };
  });
}

/**
 * Read the account statement's dividends. Never throws and never guesses: an
 * unusable file returns the same problems `readAccountStatement` reports, and a
 * dividend row whose counterpart is missing still emits a dividend with a
 * problem naming the row, so it is never dropped silently.
 */
export function readAccountDividends(text: string): AccountDividends {
  const read = readDeGiroCsv(text);
  if (!read.detection.known)
    return empty(read.problems.length > 0 ? read.problems : ["onbekend DeGiro-formaat"]);
  if (read.detection.profile !== "account")
    return empty([
      `geen DeGiro rekeningoverzicht: dit bestand is een ${read.detection.profile}-export`,
    ]);

  const table: CsvTable = read.table ?? { header: [], rows: [] };
  const locale = detectLocale(table);
  const counts = EMPTY_COUNTS();
  const problems: string[] = [];
  const rows: DividendRow[] = [];

  for (const row of table.rows) {
    const description = cellText(row.cells, ACCOUNT_COLUMNS.description);
    const orderId = cellText(row.cells, ACCOUNT_COLUMNS.orderId);
    const hasAmount = cellText(row.cells, ACCOUNT_COLUMNS.change + 1) !== "";
    const classification = classifyAccountRow({ description, hasAmount, orderId });
    if (classification.bucket !== "dividend") continue;

    /* Count before validating: `grossRows + taxRows` must equal the number of
     * rows in the dividend bucket, including a row whose amount or date turns
     * out unusable and therefore emits nothing. */
    const kind = classification.dividendKind ?? "gross";
    if (kind === "tax") counts.taxRows++;
    else counts.grossRows++;

    const change = currencyAmountAt(table.header, row.cells, ACCOUNT_COLUMNS.change, locale);
    if (change === null) {
      problems.push(`rij ${row.line}: geen bedrag bij "${description}"`);
      continue;
    }

    const rawDate = cellText(row.cells, ACCOUNT_COLUMNS.date);
    const date = parseIsoDate(rawDate);
    const valueDate = parseIsoDate(cellText(row.cells, ACCOUNT_COLUMNS.valueDate));
    /* Valutadatum is the cash date the tax row is matched on, so it wins when it
     * parses; Datum is only a fallback. A row with neither cannot be placed. */
    const cashDate = valueDate ?? date;
    if (cashDate === null) {
      problems.push(`rij ${row.line}: onmogelijke datum "${rawDate}"`);
      continue;
    }

    rows.push({
      line: row.line,
      date: cashDate,
      product: cellText(row.cells, ACCOUNT_COLUMNS.product),
      isin: cellText(row.cells, ACCOUNT_COLUMNS.isin),
      description,
      currency: change.currency,
      amount: change.amount,
      kind,
    });
  }

  // Sum each key's tax first: a tax row may appear above or below its gross row.
  const taxByKey = new Map<string, { sum: number; newest: DividendRow }>();
  for (const row of rows) {
    if (row.kind !== "tax") continue;
    const key = matchKey(row);
    const entry = taxByKey.get(key);
    // File order is newest first, so the first tax row for a key is the newest.
    if (entry === undefined) taxByKey.set(key, { sum: row.amount, newest: row });
    else entry.sum += row.amount;
  }

  // A key with any gross row is not "tax only", whatever the file order shows.
  const grossKeys = new Set<string>();
  for (const row of rows) if (row.kind === "gross") grossKeys.add(matchKey(row));

  const pending: PendingDividend[] = [];
  const grossRows = rows.filter((row) => row.kind === "gross");

  /* Oldest first. An emitted dividend is therefore never revisited by an older
   * correction, and the most recently emitted dividend is the one a correction
   * with the same ISIN + currency belongs to. */
  for (let index = grossRows.length - 1; index >= 0; index--) {
    const row = grossRows[index]!;
    /* The tax belongs to one dividend only. Two gross rows that share ISIN,
     * currency and cash date would otherwise both carry the same tax and book it
     * twice, so the first row to claim it (the oldest in the file) takes it. */
    const key = matchKey(row);
    const tax = taxByKey.get(key);
    if (tax !== undefined) taxByKey.delete(key);
    const netAmount = row.amount + (tax?.sum ?? 0);

    if (row.amount >= 0) {
      if (row.isin === "")
        problems.push(`rij ${row.line}: dividend zonder ISIN — productnaam gebruikt als symbool`);
      pending.push({
        dividend: toDividend(row, netAmount, tax === undefined ? null : -tax.sum),
        originAmount: row.amount,
        originDate: row.date,
      });
      continue;
    }

    /* A negative `Dividend` is a correction, never a second dividend. Matching
     * ignores the value date on purpose: the reversal moves cash on a later date
     * than the dividend it cancels. */
    let target: PendingDividend | undefined;
    for (let emitted = pending.length - 1; emitted >= 0; emitted--) {
      const candidate = pending[emitted]!;
      if (
        candidate.dividend.currency === row.currency &&
        (candidate.dividend.isin ?? "") === row.isin
      ) {
        target = candidate;
        break;
      }
    }

    if (target !== undefined) {
      target.dividend.amount += netAmount;
      if (tax !== undefined) {
        // A refund adds a positive tax sum, so the original withholding shrinks.
        target.dividend.withholdingTax = (target.dividend.withholdingTax ?? 0) - tax.sum;
      }
      counts.corrections++;
      continue;
    }

    // No original: keep the cash fact and say why it is alone.
    if (row.isin === "")
      problems.push(`rij ${row.line}: dividend zonder ISIN — productnaam gebruikt als symbool`);
    pending.push({
      dividend: toDividend(row, netAmount, tax === undefined ? null : -tax.sum),
      originAmount: row.amount,
      originDate: row.date,
    });
    problems.push(
      `rij ${row.line}: dividendcorrectie zonder origineel — als negatief dividend geboekt`,
    );
    counts.unmatched++;
  }

  // Tax rows whose dividend is absent from this file: record the charge alone.
  for (const [key, tax] of taxByKey) {
    if (grossKeys.has(key)) continue;
    const row = tax.newest;
    pending.push({
      dividend: toDividend(row, tax.sum, -tax.sum),
      originAmount: row.amount,
      originDate: row.date,
    });
    problems.push(`rij ${row.line}: dividendbelasting zonder bijbehorend dividend — apart geboekt`);
    counts.unmatched++;
  }

  return { dividends: assignDividendIds(pending), counts, problems };
}
