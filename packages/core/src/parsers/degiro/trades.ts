import type { CashFlow, Trade } from "../../investing/model.js";
import { ACCOUNT_COLUMNS } from "./account.js";
import {
  classifyAccountRow,
  COMMISSION_DESCRIPTION,
  EXECUTION_DESCRIPTION,
  FX_LEG_DESCRIPTION,
} from "./classify.js";
import { readDeGiroCsv } from "./profiles.js";
import {
  type CsvTable,
  cellText,
  currencyAmountAt,
  detectLocale,
  parseClockTime,
  parseIsoDate,
} from "./read.js";

/* Issue #317: turn the account statement's trade bucket into `Trade[]` and its
 * cash-flow rows.
 *
 * The statement is the only place a DeGiro trade exists without the separate
 * Transactions export, so one row carries both facts this issue needs: the
 * execution (quantity, price) and the cash it moved (`Mutatie`). Both derive
 * from the same row, which is why the trade carries no `settlement`: core must
 * not add the execution's cash a second time on top of the ledger flow.
 *
 * A trade, its commission and its AutoFX legs share one `Order Id` and one
 * `Datum`+`Tijd`. Partial fills share the `Order Id` but have their own time and
 * their own commission row, so the grouping key is all three: summing a whole
 * `Order Id` would bill every fill for every fee.
 */

export type AccountTrades = {
  /** `entity` is stamped by the adapter, exactly like the cash-flow path. */
  trades: Omit<Trade, "entity" | "id">[];
  /** Signed ledger cash this bucket moved: one row per trade-bucket row. */
  cashFlows: Omit<CashFlow, "entity" | "id">[];
  problems: string[];
};

const empty = (problems: string[]): AccountTrades => ({ trades: [], cashFlows: [], problems });

/** One validated trade-bucket row, reduced to what cash and trade building need. */
type TradeRow = {
  /** 1-based source line, for the problem text. */
  line: number;
  date: string;
  /** `Tijd` as `HH:MM`, null when it does not parse. */
  time: string | null;
  product: string;
  isin: string;
  description: string;
  orderId: string;
  currency: string;
  /** Signed `Mutatie`: a buy is negative, a sell positive. */
  amount: number;
};

/** A parsed execution: verb, quantity and unit price from `Omschrijving`. */
type Execution = { verb: string; quantity: number; price: number };

/**
 * Parse a number token inside `Omschrijving`. The free-text column is not bound
 * by the file's amount locale: DeGiro writes `1.234,56` and `19.648` in it, and
 * a comma-only token (`19,648`) is a decimal, not a thousands separator. The
 * last separator that appears is the decimal one; every other one groups.
 */
function parseStatementNumber(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, "");
  if (text === "") return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  /* Both separators present: the one that comes last is decimal, the other
   * groups thousands. Only one present: it is the decimal one. */
  const normalized =
    lastComma >= 0 && lastDot >= 0
      ? lastComma > lastDot
        ? text.replace(/\./g, "").replace(",", ".")
        : text.replace(/,/g, "")
      : text.replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** `Koop 5 @ 19,648 USD` -> verb, quantity and price. Null when it does not parse. */
function parseExecution(description: string): Execution | null {
  const match = /^(koop|verkoop|buy|sell)\s+(.+?)\s*@\s*(.+?)\s+[A-Za-z]{3}\s*$/i.exec(description);
  if (!match) return null;
  const verb = match[1]!.toLowerCase();
  const quantity = parseStatementNumber(match[2]!);
  const price = parseStatementNumber(match[3]!);
  if (quantity === null || quantity <= 0 || price === null || price < 0) return null;
  return { verb, quantity, price };
}

/**
 * Read an account statement's trades and their cash flows. Never throws: an
 * unusable file returns the same kind of problem the other readers report, an
 * unparseable execution row still emits its cash flow, and an unknown
 * trade-bucket text is booked as "other" with a problem naming it.
 */
export function readAccountTrades(text: string): AccountTrades {
  const read = readDeGiroCsv(text);
  if (!read.detection.known)
    return empty(read.problems.length > 0 ? read.problems : ["onbekend DeGiro-formaat"]);
  if (read.detection.profile !== "account")
    return empty([
      `geen DeGiro rekeningoverzicht: dit bestand is een ${read.detection.profile}-export`,
    ]);

  const table: CsvTable = read.table ?? { header: [], rows: [] };
  const locale = detectLocale(table);
  const problems: string[] = [];
  const cashFlows: Omit<CashFlow, "entity" | "id">[] = [];
  const rows: TradeRow[] = [];

  for (const tableRow of table.rows) {
    const description = cellText(tableRow.cells, ACCOUNT_COLUMNS.description);
    const orderId = cellText(tableRow.cells, ACCOUNT_COLUMNS.orderId);
    const hasAmount = cellText(tableRow.cells, ACCOUNT_COLUMNS.change + 1) !== "";
    const classification = classifyAccountRow({ description, hasAmount, orderId });
    if (classification.bucket !== "trade") continue;

    const rawDate = cellText(tableRow.cells, ACCOUNT_COLUMNS.date);
    const date = parseIsoDate(rawDate);
    if (date === null) {
      problems.push(`rij ${tableRow.line}: onmogelijke datum "${rawDate}"`);
      continue;
    }
    const change = currencyAmountAt(table.header, tableRow.cells, ACCOUNT_COLUMNS.change, locale);
    if (change === null) {
      problems.push(`rij ${tableRow.line}: geen bedrag bij "${description}"`);
      continue;
    }

    const isCommission = COMMISSION_DESCRIPTION.test(description);
    const isFxLeg = FX_LEG_DESCRIPTION.test(description);
    /* One ledger row per trade-bucket row, in file order. `brokerFlowId` stays
     * off the execution and commission rows on purpose: core's cash walk dedupes
     * flows by `brokerFlowId`, so stamping the shared Order Id on a fill and its
     * fee would collapse two same-currency events into one and under-count the
     * cash. Only an AutoFX leg carries it, because its two legs are not one
     * movement. */
    cashFlows.push({
      date,
      currency: change.currency,
      amount: change.amount,
      kind: isCommission ? "fee" : "other",
      broker: "degiro",
      ...(description ? { description } : {}),
      ...(isFxLeg && orderId ? { brokerFlowId: orderId } : {}),
    });

    if (!EXECUTION_DESCRIPTION.test(description) && !isCommission && !isFxLeg) {
      problems.push(
        `rij ${tableRow.line}: onbekende transactieregel "${description}" — als "overig" geboekt`,
      );
    }

    rows.push({
      line: tableRow.line,
      date,
      time: parseClockTime(cellText(tableRow.cells, ACCOUNT_COLUMNS.time)),
      product: cellText(tableRow.cells, ACCOUNT_COLUMNS.product),
      isin: cellText(tableRow.cells, ACCOUNT_COLUMNS.isin),
      description,
      orderId,
      currency: change.currency,
      amount: change.amount,
    });
  }

  /* Group by Order Id + Datum + Tijd: a trade, its commission and its AutoFX
   * legs share all three, while partial fills of one order each have their own
   * time and fee. Map insertion order is file order, so the trades come out in
   * the order the export lists them. */
  const groups = new Map<string, TradeRow[]>();
  for (const row of rows) {
    const key = `${row.orderId}\u0000${row.date}\u0000${row.time ?? ""}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [row]);
    else group.push(row);
  }

  const trades: Omit<Trade, "entity" | "id">[] = [];
  for (const group of groups.values()) {
    const commission = group
      .filter((row) => COMMISSION_DESCRIPTION.test(row.description))
      .reduce((sum, row) => sum + row.amount, 0);

    for (const row of group) {
      if (!EXECUTION_DESCRIPTION.test(row.description)) continue;
      const execution = parseExecution(row.description);
      if (execution === null) {
        /* The ledger row is real cash and was emitted above; only the trade
         * facts are unreadable, so this row adds no trade. */
        problems.push(`rij ${row.line}: onleesbare uitvoering "${row.description}"`);
        continue;
      }

      // DeGiro has no ticker. The spec makes ISIN the instrument identity, with
      // the product name as the display fallback when a row has no ISIN.
      const symbol = row.isin || row.product;
      if (row.isin === "") {
        problems.push(`rij ${row.line}: transactie zonder ISIN — productnaam gebruikt als symbool`);
      }

      // The side comes from the verb, never from the `Mutatie` sign: the sign is
      // the cash direction, and a fee-bearing sell is still a sell.
      const side = execution.verb === "koop" || execution.verb === "buy" ? "buy" : "sell";
      trades.push({
        date: row.date,
        ...(row.time ? { executionAt: `${row.date}T${row.time}:00` } : {}),
        symbol,
        ...(row.isin ? { isin: row.isin } : {}),
        ...(row.product ? { description: row.product } : {}),
        side,
        quantity: execution.quantity,
        price: execution.price,
        amount: row.amount,
        currency: row.currency,
        commission,
        ...(row.orderId ? { brokerTradeId: row.orderId } : {}),
      });
    }
  }

  return { trades, cashFlows, problems };
}
