import type { Dividend } from "../../investing/dividend.js";
import type { CashBalance, CashFlow, Trade } from "../../investing/model.js";
import { ACCOUNT_COLUMNS, assignCashFlowIds, readAccountStatement } from "./account.js";
import { classifyAccountRow } from "./classify.js";
import { readAccountDividends } from "./dividends.js";
import { readDeGiroCsv } from "./profiles.js";
import { type CsvTable, cellText, currencyAmountAt, detectLocale, parseIsoDate } from "./read.js";
import { readAccountTrades } from "./trades.js";

/* Issue #317: the whole account-statement import, in one place. A DeGiro user
 * can upload `Account.csv` alone and get a complete `BrokerResult`: trades, the
 * cash flows that fund them, dividends, cash balances, a coverage claim and the
 * period. The Saldo walk (#315) is the proof behind the coverage claim; this
 * module ties the three readers together and owns the two facts none of them
 * can state alone:
 *
 * - the cash balances, which are the statement's own `Saldo` anchors;
 * - the period, which is the span of every dated data row.
 */

/** What the statement proves about its own window. */
export type AccountCoverage =
  | { status: "complete"; from: string; to: string }
  | { status: "unknown"; reason: string };

export type DeGiroAccount = {
  /** `entity` is stamped by the adapter, exactly like the cash-flow path. */
  trades: Omit<Trade, "entity" | "id">[];
  cashFlows: Omit<CashFlow, "entity">[];
  dividends: Omit<Dividend, "entity">[];
  /** The latest `Saldo` per currency: the anchors core's cash walk starts from. */
  cashBalances: Omit<CashBalance, "entity" | "broker">[];
  coverage: AccountCoverage;
  period?: { from: string; to: string };
  problems: string[];
};

const NO_PERIOD_REASON = "geen datum gevonden in het rekeningoverzicht";

const empty = (problems: string[]): DeGiroAccount => ({
  trades: [],
  cashFlows: [],
  dividends: [],
  cashBalances: [],
  coverage: { status: "unknown", reason: problems[0] ?? NO_PERIOD_REASON },
  problems,
});

/* Ids are assigned once for the whole ledger, so the readers' own ids are
 * stripped first. Two identical rows then still get distinct ids through
 * `assignCashFlowIds`'s occurrence counter, which now spans both readers. */
function withoutId(flow: Omit<CashFlow, "entity">): Omit<CashFlow, "entity" | "id"> {
  const { id: _dropped, ...rest } = flow;
  return rest;
}

/**
 * Read a DeGiro account statement into the full import result. Never throws:
 * an unusable file explains itself, and a broken Saldo walk still returns the
 * rows while marking the coverage unknown and naming the failing row.
 */
export function readDeGiroAccount(text: string): DeGiroAccount {
  const read = readDeGiroCsv(text);
  if (!read.detection.known)
    return empty(read.problems.length > 0 ? read.problems : ["onbekend DeGiro-formaat"]);
  if (read.detection.profile !== "account")
    return empty([
      `geen DeGiro rekeningoverzicht: dit bestand is een ${read.detection.profile}-export`,
    ]);

  const statement = readAccountStatement(text);
  const tradeRows = readAccountTrades(text);
  const dividendRows = readAccountDividends(text);
  const table: CsvTable = read.table ?? { header: [], rows: [] };
  const locale = detectLocale(table);

  /* File-level problems cannot come from the three readers alone: a header-only
   * export is rejected by `readDeGiroCsv` before any row exists. */
  const problems: string[] = [...read.problems];
  const dates: string[] = [];
  const cashBalances: Omit<CashBalance, "entity" | "broker">[] = [];
  const anchoredCurrencies = new Set<string>();

  for (const row of table.rows) {
    const rawDate = cellText(row.cells, ACCOUNT_COLUMNS.date);
    const date = parseIsoDate(rawDate);
    if (date !== null) dates.push(date);

    const description = cellText(row.cells, ACCOUNT_COLUMNS.description);
    const orderId = cellText(row.cells, ACCOUNT_COLUMNS.orderId);
    const hasAmount = cellText(row.cells, ACCOUNT_COLUMNS.change + 1) !== "";
    const classification = classifyAccountRow({ description, hasAmount, orderId });

    /* Only the rows that took part in the Saldo walk carry a balance the walk
     * proved. The sweep and information lines stay out; a currency's first
     * anchor in the file is its latest, because the file is newest first. */
    if (!classification.saldoWalk) continue;
    if (date === null) {
      problems.push(`rij ${row.line}: onmogelijke datum "${rawDate}"`);
      continue;
    }
    const balance = currencyAmountAt(table.header, row.cells, ACCOUNT_COLUMNS.balance, locale);
    if (balance === null || anchoredCurrencies.has(balance.currency)) continue;
    anchoredCurrencies.add(balance.currency);
    cashBalances.push({ currency: balance.currency, amount: balance.amount, asOf: date });
  }

  const sortedDates = [...dates].sort();
  const period =
    sortedDates.length > 0
      ? { from: sortedDates[0]!, to: sortedDates[sortedDates.length - 1]! }
      : undefined;
  /* A complete claim needs both halves: the walk proved every step, and a period
   * says which window that is. Without either, say the first row that failed. */
  const coverage: AccountCoverage =
    statement.saldo.ok && period !== undefined
      ? { status: "complete", from: period.from, to: period.to }
      : { status: "unknown", reason: statement.saldo.problems[0] ?? NO_PERIOD_REASON };

  const statementFlows = statement.cashFlows.map(withoutId);
  const cashFlows = assignCashFlowIds([...statementFlows, ...tradeRows.cashFlows]);

  return {
    trades: tradeRows.trades,
    cashFlows,
    dividends: dividendRows.dividends,
    cashBalances,
    coverage,
    ...(period ? { period } : {}),
    problems: [
      ...new Set([
        ...problems,
        ...statement.problems,
        ...tradeRows.problems,
        ...dividendRows.problems,
      ]),
    ],
  };
}
