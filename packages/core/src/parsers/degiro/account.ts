import { hash, norm } from "../../hash.js";
import type { CashFlow } from "../../investing/model.js";
import { classifyAccountRow } from "./classify.js";
import { readDeGiroCsv } from "./profiles.js";
import { type CsvTable, cellText, currencyAmountAt, detectLocale, parseIsoDate } from "./read.js";
import { type SaldoRow, type SaldoWalk, walkSaldo } from "./saldo.js";

/* Issue #315: turn an account statement into `CashFlow[]` and prove the window
 * it covers with the Saldo walk.
 *
 * The statement is the primary DeGiro import because it alone proves cash
 * history. Every row is classified first (`./classify.ts`): only this issue's
 * cash flows are emitted here, dividends belong to #316 and trades to #317, and
 * information lines emit nothing. The walk (`./saldo.ts`) is what later lets
 * #317 claim `status: "complete"`.
 */

/**
 * Column layout of the verified NL account statement, from
 * `docs/investing/DEGIRO.md`. Only the NL header passes profile detection today,
 * so these positions are guaranteed; a future EN export has to add its own
 * signature and then these names can be resolved by label instead.
 *
 * Exported because the dividend mapper (#316) reads the same verified layout;
 * keeping one table means a future EN header has one place to change.
 */
export const ACCOUNT_COLUMNS = {
  date: 0,
  valueDate: 2,
  product: 3,
  isin: 4,
  description: 5,
  change: 7,
  balance: 9,
  orderId: 11,
} as const;

/** How many rows fell into each owner. Sums to the number of data rows. */
export type AccountCounts = {
  cashFlow: number;
  /** Owned by #316, not emitted here. */
  dividend: number;
  /** Owned by #317, not emitted here. */
  trade: number;
  /** Information lines and corporate actions: no cash moves. */
  skipped: number;
};

export type AccountStatement = {
  /** `entity` is stamped by the adapter, exactly like the trade and position paths. */
  cashFlows: Omit<CashFlow, "entity">[];
  counts: AccountCounts;
  /** Completeness proof for `[first Datum, last Datum]`; #317 reads `ok`/`problems`. */
  saldo: SaldoWalk;
  problems: string[];
};

const EMPTY_COUNTS = (): AccountCounts => ({ cashFlow: 0, dividend: 0, trade: 0, skipped: 0 });

/** Same content-hash identity the IBKR and Trading 212 paths use, so a re-parse
 *  of the same file yields the same ids and a merge cannot append duplicates. */
function cashFlowBase(flow: Omit<CashFlow, "entity" | "id">): string {
  return [
    "degiro-cash-flow",
    flow.date,
    norm(flow.currency),
    flow.amount,
    flow.kind,
    norm(flow.description),
  ].join("|");
}

function assignCashFlowIds(flows: Omit<CashFlow, "entity" | "id">[]): Omit<CashFlow, "entity">[] {
  const seen = new Map<string, number>();
  return flows.map((flow) => {
    const base = cashFlowBase(flow);
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return { ...flow, id: hash(`${base}#${occurrence}`) };
  });
}

const empty = (problems: string[]): AccountStatement => ({
  cashFlows: [],
  counts: EMPTY_COUNTS(),
  saldo: { ok: false, problems: [], closing: new Map() },
  problems,
});

/**
 * Read an account statement. Never throws and never guesses: an unusable file
 * returns its problem, an unknown description still becomes a cash flow of kind
 * `other` with a problem naming the text, so a row is never dropped silently.
 */
export function readAccountStatement(text: string): AccountStatement {
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
  const pending: Omit<CashFlow, "entity" | "id">[] = [];
  const saldoRows: SaldoRow[] = [];

  for (const row of table.rows) {
    const description = cellText(row.cells, ACCOUNT_COLUMNS.description);
    const orderId = cellText(row.cells, ACCOUNT_COLUMNS.orderId);
    const hasAmount = cellText(row.cells, ACCOUNT_COLUMNS.change + 1) !== "";
    const classification = classifyAccountRow({ description, hasAmount, orderId });
    const change = currencyAmountAt(table.header, row.cells, ACCOUNT_COLUMNS.change, locale);
    const balance = currencyAmountAt(table.header, row.cells, ACCOUNT_COLUMNS.balance, locale);

    /* The walk spans every row that moves cash, not only this issue's flows:
     * dividends (#316) and trades (#317) move it too. The walk is the only true
     * order the file gives (a trade, its commission and its AutoFX legs share
     * one Datum and Tijd), so it is built in file order, and the rows that do
     * not move cash stay out of it. */
    if (classification.saldoWalk) {
      if (change && balance) saldoRows.push({ line: row.line, change, balance });
      else
        problems.push(
          `rij ${row.line}: saldo of mutatie ontbreekt bij "${description}" — de saldo-controle slaat deze rij over`,
        );
    }

    if (classification.bucket === "skip") {
      counts.skipped++;
      continue;
    }
    if (classification.bucket === "dividend") {
      counts.dividend++;
      continue;
    }
    if (classification.bucket === "trade") {
      counts.trade++;
      continue;
    }

    counts.cashFlow++;
    if (!classification.recognised)
      problems.push(
        `rij ${row.line}: onbekende omschrijving "${description}" — als "overig" geboekt`,
      );

    const rawDate = cellText(row.cells, ACCOUNT_COLUMNS.date);
    const date = parseIsoDate(rawDate);
    if (date === null) {
      problems.push(`rij ${row.line}: onmogelijke datum "${rawDate}"`);
      continue;
    }
    if (change === null) {
      problems.push(`rij ${row.line}: geen bedrag bij "${description}"`);
      continue;
    }

    pending.push({
      date,
      currency: change.currency,
      amount: change.amount,
      kind: classification.kind ?? "other",
      broker: "degiro",
      ...(description ? { description } : {}),
      ...(orderId ? { brokerFlowId: orderId } : {}),
    });
  }

  const saldo = walkSaldo(saldoRows);
  return {
    cashFlows: assignCashFlowIds(pending),
    counts,
    saldo,
    problems: [...problems, ...saldo.problems],
  };
}
