import type { CashBalance, Position } from "../../investing/model.js";
import { readDeGiroCsv } from "./profiles.js";
import {
  type CsvTable,
  cellText,
  currencyAmountAt,
  detectLocale,
  parseDecimal,
  parseIsoDate,
} from "./read.js";

/* Issue #319: a DeGiro portfolio export is a dated snapshot of the holdings at
 * one moment. It carries no date column, so the export date is an input: a
 * position cannot exist without one, and inventing today would silently date
 * every holding to the import.
 *
 * The export also proves no cash history. It carries the current cash row only,
 * not the movements that produced it, so this reader returns positions and
 * balances and never a coverage claim.
 *
 * The verified export always holds one `CASH & CASH FUND` line: a cash balance,
 * not a holding. Booking it as a position would invent an ISIN-less instrument.
 */

/**
 * Fixed column layout, from `docs/investing/DEGIRO.md`. The verified NL and EN
 * headers have the same column order, so one table serves both languages.
 *
 * `Lokale waarde` labels the currency and its blank neighbour holds the amount,
 * the opposite pairing from the transaction export. `currencyAmountAt` finds the
 * pair by the blank header, never by position within the pair.
 */
export const PORTFOLIO_COLUMNS = {
  product: 0,
  isin: 1,
  quantity: 2,
  /** `Slotkoers` / `Closing`: a decimal in the local currency. */
  closing: 3,
  /** `Lokale waarde` + blank neighbour: currency and amount. */
  localValue: 4,
  valueEur: 6,
} as const;

/** The one thing a portfolio export cannot say: whether cash history is
 *  complete. Only the account statement proves that. */
export const NO_PORTFOLIO_HISTORY_REASON =
  "geen rekeningoverzicht in deze import — een portfolio-export bewijst geen cashhistorie";

export type DeGiroPortfolio = {
  /** `entity` and `broker` are stamped by the adapter. */
  positions: Omit<Position, "entity" | "tenantId">[];
  cashBalances: Omit<CashBalance, "entity" | "broker">[];
  problems: string[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate the export date as an ISO `YYYY-MM-DD` calendar date. The format is
 * fixed because the reader's rows carry it verbatim; `12-11-2026` is refused
 * rather than translated, and `parseIsoDate` rejects `2026-02-31`.
 */
export function parsePortfolioAsOf(raw: string): string | null {
  const text = raw.trim();
  return ISO_DATE.test(text) ? parseIsoDate(text) : null;
}

const HEADER_ONLY_PROBLEM = "geen posities in de DeGiro portfolio-export (alleen een kopregel)";

const empty = (problems: string[]): DeGiroPortfolio => ({
  positions: [],
  cashBalances: [],
  problems,
});

const isCashProduct = (product: string): boolean =>
  product.toLowerCase().startsWith("cash & cash fund");

/**
 * Read a DeGiro portfolio export into dated positions and cash balances. Never
 * throws: a row that cannot be read is skipped with a row-numbered problem, and
 * an absent or invalid export date withholds every row.
 */
export function readDeGiroPortfolio(text: string, asOf: string): DeGiroPortfolio {
  const read = readDeGiroCsv(text);
  if (!read.detection.known)
    return empty(read.problems.length > 0 ? read.problems : ["onbekend DeGiro-formaat"]);
  if (read.detection.profile !== "portfolio")
    return empty([
      `geen DeGiro portfolio-export: dit bestand is een ${read.detection.profile}-export`,
    ]);

  const dated = parsePortfolioAsOf(asOf);
  if (dated === null)
    return empty(["geen exportdatum (asOf) voor de portfolio-export — posities niet gedateerd"]);

  if (read.problems.length > 0) return empty([HEADER_ONLY_PROBLEM]);

  const table: CsvTable = read.table ?? { header: [], rows: [] };
  const locale = detectLocale(table);
  const positions: Omit<Position, "entity" | "tenantId">[] = [];
  const cashBalances: Omit<CashBalance, "entity" | "broker">[] = [];
  const problems: string[] = [];

  for (const row of table.rows) {
    const product = cellText(row.cells, PORTFOLIO_COLUMNS.product);

    /* The cash row has no ISIN, quantity or closing price. It is a balance, and
     * treating it as a position would create a holding without an identity. */
    if (isCashProduct(product)) {
      const balance = currencyAmountAt(
        table.header,
        row.cells,
        PORTFOLIO_COLUMNS.localValue,
        locale,
      );
      if (balance === null) {
        problems.push(`rij ${row.line}: geen valuta of bedrag bij de cashregel "${product}"`);
        continue;
      }
      cashBalances.push({ currency: balance.currency, amount: balance.amount, asOf: dated });
      continue;
    }

    const isin = cellText(row.cells, PORTFOLIO_COLUMNS.isin);
    if (isin === "") {
      problems.push(`rij ${row.line}: positie zonder ISIN bij "${product}" — overgeslagen`);
      continue;
    }

    const rawQuantity = cellText(row.cells, PORTFOLIO_COLUMNS.quantity);
    const quantity = parseDecimal(rawQuantity, locale);
    if (quantity === null) {
      problems.push(`rij ${row.line}: ongeldige quantiteit "${rawQuantity}" bij "${product}"`);
      continue;
    }

    const rawClosing = cellText(row.cells, PORTFOLIO_COLUMNS.closing);
    const closing = parseDecimal(rawClosing, locale);
    if (closing === null) {
      problems.push(`rij ${row.line}: ongeldige slotkoers "${rawClosing}" bij "${product}"`);
      continue;
    }

    const localValue = currencyAmountAt(
      table.header,
      row.cells,
      PORTFOLIO_COLUMNS.localValue,
      locale,
    );
    if (localValue === null) {
      problems.push(`rij ${row.line}: geen lokale waarde bij "${product}"`);
      continue;
    }

    positions.push({
      /* DeGiro has an ISIN, not a ticker. Keying the position on the ISIN means a
       * product rename cannot create a second identity. */
      symbol: isin,
      isin,
      ...(product ? { description: product } : {}),
      quantity,
      averagePrice: null,
      marketPrice: closing,
      marketValue: localValue.amount,
      currency: localValue.currency,
      brokerCost: { status: "unknown", reason: "not-reported" },
      asOf: dated,
    });
  }

  return { positions, cashBalances, problems };
}
