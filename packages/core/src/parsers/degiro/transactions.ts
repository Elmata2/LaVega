import type { Trade } from "../../investing/model.js";
import { readDeGiroCsv } from "./profiles.js";
import {
  type CsvTable,
  cellText,
  currencyAmountAt,
  detectLocale,
  parseClockTime,
  parseDecimal,
  parseIsoDate,
} from "./read.js";

/* Issue #318: a DeGiro transaction export carries what the account statement
 * does not: the execution venue, the local value in the trade's own currency
 * and the FX rate. It proves no cash history, though — only the account
 * statement does — so this reader returns trades and never a coverage claim.
 *
 * A row with a quantity but no price is not a trade. DeGiro writes corporate
 * actions and share transfers in the same export with `Aantal` filled and
 * `Koers` empty or zero; booking those as executions would invent a price of 0.
 * Their quantity and cash reconciliation is #326.
 *
 * The signed local value decides the side, because the export has no verb. A
 * real sell row is unverified: the verified sample holds buys only.
 */

/**
 * Fixed column layout, from `docs/investing/DEGIRO.md`. The verified NL and EN
 * headers have the same column order, so one table serves both languages.
 *
 * Two money fields are a label + blank pair: `Koers` and its blank neighbour
 * hold the amount and the amount's currency, and `Lokale waarde` with its blank
 * neighbour does the same. `currencyAmountAt` identifies the pair by the blank
 * header, never by position within the pair.
 */
export const TRANSACTIONS_COLUMNS = {
  date: 0,
  time: 1,
  product: 2,
  isin: 3,
  referenceExchange: 4,
  /** `Uitvoeringsplaats` / `Venue`: the MIC the execution happened on. */
  venue: 5,
  quantity: 6,
  /** `Koers` + blank neighbour: amount and currency. */
  price: 7,
  /** `Lokale waarde` + blank neighbour: amount and currency. */
  localValue: 9,
  valueEur: 11,
  /** `Wisselkoers`: units of the trade currency per 1 EUR, provenance only. */
  fxRate: 12,
  autoFxFee: 13,
  fee: 14,
  totalEur: 15,
  orderId: 16,
} as const;

/** The one thing a transaction export cannot say: whether cash history is
 *  complete. Only the account statement proves that. */
export const NO_ACCOUNT_HISTORY_REASON =
  "geen rekeningoverzicht in deze import — een transactie-export bewijst geen cashhistorie";

export type DeGiroTransactions = {
  /** `entity` is stamped by the adapter, exactly like the account path. */
  trades: Omit<Trade, "entity" | "id">[];
  period?: { from: string; to: string };
  problems: string[];
};

const empty = (problems: string[]): DeGiroTransactions => ({ trades: [], problems });

/**
 * Read a DeGiro transaction export into trades. Never throws: an unusable file
 * explains itself, and a row that is a corporate action or a transfer is
 * skipped with a problem instead of becoming an execution at price 0.
 */
export function readDeGiroTransactions(text: string): DeGiroTransactions {
  const read = readDeGiroCsv(text);
  if (!read.detection.known)
    return empty(read.problems.length > 0 ? read.problems : ["onbekend DeGiro-formaat"]);
  if (read.detection.profile !== "transactions")
    return empty([
      `geen DeGiro transactie-export: dit bestand is een ${read.detection.profile}-export`,
    ]);

  const table: CsvTable = read.table ?? { header: [], rows: [] };
  const locale = detectLocale(table);
  /* A header-only export is rejected by `readDeGiroCsv` before a row exists;
   * its problem belongs to the result, like the account reader does. */
  const problems: string[] = [...read.problems];
  const trades: Omit<Trade, "entity" | "id">[] = [];
  const dates: string[] = [];

  for (const row of table.rows) {
    const rawDate = cellText(row.cells, TRANSACTIONS_COLUMNS.date);
    const date = parseIsoDate(rawDate);
    if (date === null) {
      problems.push(`rij ${row.line}: onmogelijke datum "${rawDate}"`);
      continue;
    }
    dates.push(date);

    const product = cellText(row.cells, TRANSACTIONS_COLUMNS.product);
    const isin = cellText(row.cells, TRANSACTIONS_COLUMNS.isin);

    const rawQuantity = cellText(row.cells, TRANSACTIONS_COLUMNS.quantity);
    const quantity = parseDecimal(rawQuantity, locale);
    if (quantity === null || quantity <= 0) {
      problems.push(`rij ${row.line}: ongeldige quantiteit "${rawQuantity}" bij "${product}"`);
      continue;
    }

    const price = currencyAmountAt(table.header, row.cells, TRANSACTIONS_COLUMNS.price, locale);
    if (price === null || price.amount <= 0) {
      problems.push(
        `rij ${row.line}: geen koers bij "${product}" — overdracht of corporate action, geen transactie (quantiteit volgt in #326)`,
      );
      continue;
    }

    const localValue = currencyAmountAt(
      table.header,
      row.cells,
      TRANSACTIONS_COLUMNS.localValue,
      locale,
    );
    if (localValue === null) {
      problems.push(`rij ${row.line}: geen lokale waarde bij "${product}"`);
      continue;
    }

    /* The export has no verb. The signed local value is the cash direction of
     * the same order, so it is the only side signal a row carries. */
    const side = localValue.amount < 0 ? "buy" : localValue.amount > 0 ? "sell" : null;
    if (side === null) {
      problems.push(`rij ${row.line}: lokale waarde nul bij "${product}" — geen transactie`);
      continue;
    }

    /* Only the transaction fee. `AutoFX Kosten` is a separate currency
     * conversion, which the account statement books as its own ledger legs;
     * folding it into `commission` would make one field mean two things. */
    const commission = Math.abs(
      parseDecimal(cellText(row.cells, TRANSACTIONS_COLUMNS.fee), locale) ?? 0,
    );
    const fxRate = parseDecimal(cellText(row.cells, TRANSACTIONS_COLUMNS.fxRate), locale);
    const venue = cellText(row.cells, TRANSACTIONS_COLUMNS.venue);
    const time = parseClockTime(cellText(row.cells, TRANSACTIONS_COLUMNS.time));
    const orderId = cellText(row.cells, TRANSACTIONS_COLUMNS.orderId);
    const symbol = isin || product;
    if (isin === "") {
      problems.push(`rij ${row.line}: transactie zonder ISIN — productnaam gebruikt als symbool`);
    }

    trades.push({
      date,
      ...(time ? { executionAt: `${date}T${time}:00` } : {}),
      symbol,
      ...(isin ? { isin } : {}),
      ...(product ? { description: product } : {}),
      side,
      quantity,
      price: price.amount,
      amount: localValue.amount,
      currency: localValue.currency,
      commission,
      ...(venue ? { venue } : {}),
      ...(fxRate !== null ? { fxRate } : {}),
      ...(orderId ? { brokerTradeId: orderId } : {}),
    });
  }

  const sortedDates = [...dates].sort();
  const first = sortedDates[0];
  const last = sortedDates[sortedDates.length - 1];
  const period = first !== undefined && last !== undefined ? { from: first, to: last } : undefined;

  return { trades, ...(period ? { period } : {}), problems };
}
