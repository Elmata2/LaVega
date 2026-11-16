import type { CashBalance, Position, Trade } from "../../investing/model.js";

/* Issue #326: the DeGiro exports are separate files, so they can disagree.
 * Never pick silently. The portfolio export is the dated truth for holdings,
 * the trade history says what should have produced them, and the account
 * statement's `Saldo` is the dated truth for cash.
 *
 * Reconciliation is report-only: the portfolio quantities stay the holdings,
 * the merged trades are never rewritten, and every disagreement becomes one
 * problem naming the identity and both numbers.
 */

type PositionFacts = Pick<Position, "isin" | "description" | "quantity" | "asOf">;
type TradeFacts = Pick<Trade, "date" | "isin" | "side" | "quantity">;
type CashFacts = Pick<CashBalance, "currency" | "amount" | "asOf">;

export type DeGiroReconciliationInput = {
  /** The portfolio export's dated holdings. */
  positions: readonly PositionFacts[];
  /** The merged account/transaction executions. */
  trades: readonly TradeFacts[];
  /** The portfolio export's own cash row, dated with the export date. */
  portfolioCashBalances?: readonly CashFacts[] | undefined;
  /** The account statement's latest `Saldo` per currency. */
  accountCashBalances?: readonly CashFacts[] | undefined;
};

const QUANTITY_EPSILON = 1e-9;
/** Half a cent: a float artefact is not a disagreement, one cent is. */
const CASH_EPSILON = 0.005;

const day = (value: string): string => value.slice(0, 10);

function formatQuantity(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

function formatAmount(value: number): string {
  return value.toFixed(2);
}

function tradeDelta(trade: TradeFacts): number {
  if (trade.side === "buy") return trade.quantity;
  if (trade.side === "sell") return -trade.quantity;
  return 0;
}

/** The likely causes named in every quantity problem. The message tells the
 *  reader what to check instead of implying the import is corrupt. */
const QUANTITY_CAUSES =
  "mogelijk een splitsing, ISIN-wijziging, overboeking van effecten of een te korte transactiehistorie";

type PositionGroup = {
  isin: string;
  description?: string;
  asOf: string;
  quantity: number;
};

function groupPositions(positions: readonly PositionFacts[]): Map<string, PositionGroup> {
  const groups = new Map<string, PositionGroup>();
  for (const position of positions) {
    /* A portfolio position without an ISIN is already a problem in the reader;
     * without an identity it cannot be reconciled. */
    if (!position.isin) continue;
    const existing = groups.get(position.isin);
    if (existing === undefined) {
      groups.set(position.isin, {
        isin: position.isin,
        ...(position.description ? { description: position.description } : {}),
        asOf: day(position.asOf),
        quantity: position.quantity,
      });
      continue;
    }
    existing.quantity += position.quantity;
    if (day(position.asOf) > existing.asOf) existing.asOf = day(position.asOf);
  }
  return groups;
}

/** Executions per ISIN, from the trade history. A trade without an ISIN cannot
 *  be matched to a portfolio identity; the readers already report it. */
function groupTrades(trades: readonly TradeFacts[]): Map<string, TradeFacts[]> {
  const groups = new Map<string, TradeFacts[]>();
  for (const trade of trades) {
    if (!trade.isin) continue;
    const list = groups.get(trade.isin);
    if (list === undefined) groups.set(trade.isin, [trade]);
    else list.push(trade);
  }
  return groups;
}

/** The walked quantity per ISIN up to and including `asOf`. Trades after the
 *  portfolio date belong to a later snapshot, not to this one. */
function walkedQuantity(trades: readonly TradeFacts[], asOf: string): number {
  return trades
    .filter((trade) => day(trade.date) <= asOf)
    .reduce((sum, trade) => sum + tradeDelta(trade), 0);
}

function mismatch(
  isin: string,
  description: string | undefined,
  walked: number,
  held: number,
): string {
  const identity = description === undefined ? `ISIN ${isin}` : `ISIN ${isin} (${description})`;
  return `${identity}: portfolio zegt ${formatQuantity(held)}, transacties geven ${formatQuantity(walked)} — ${QUANTITY_CAUSES}`;
}

/** Report-only quantity and cash reconciliation for one merged import. Never
 *  throws; an import with no shared ISIN is not comparable and raises no
 *  fabricated per-holding problems. */
export function reconcileDeGiroImport(input: DeGiroReconciliationInput): string[] {
  const problems: string[] = [];
  const positions = groupPositions(input.positions);
  const trades = groupTrades(input.trades);

  /* One shared ISIN proves the two files describe the same holdings. Without
   * one the files are unrelated snapshots (the checked-in real fixtures come
   * from different samples); reporting every holding as miscounted would be
   * noise, not evidence. */
  const shared = [...positions.keys()].some((isin) => trades.has(isin));
  if (shared) {
    for (const position of positions.values()) {
      const walked = walkedQuantity(trades.get(position.isin) ?? [], position.asOf);
      if (Math.abs(walked - position.quantity) <= QUANTITY_EPSILON) continue;
      problems.push(mismatch(position.isin, position.description, walked, position.quantity));
    }
    /* The other direction: a trade-built position the portfolio does not list.
     * A fully sold position walks to zero and is correctly absent. */
    const latestAsOf = [...positions.values()].reduce(
      (latest, position) => (position.asOf > latest ? position.asOf : latest),
      "",
    );
    for (const [isin, isinTrades] of trades) {
      if (positions.has(isin)) continue;
      const walked = walkedQuantity(isinTrades, latestAsOf);
      if (Math.abs(walked) <= QUANTITY_EPSILON) continue;
      problems.push(mismatch(isin, undefined, walked, 0));
    }
  }

  /* Cash compares only on the same day: a portfolio row and a `Saldo` from
   * different days describe different moments, not a disagreement. */
  const accountCash = new Map(
    (input.accountCashBalances ?? []).map((balance) => [
      `${balance.currency}\u0000${day(balance.asOf)}`,
      balance,
    ]),
  );
  for (const portfolio of input.portfolioCashBalances ?? []) {
    const account = accountCash.get(`${portfolio.currency}\u0000${day(portfolio.asOf)}`);
    if (account === undefined) continue;
    if (Math.abs(portfolio.amount - account.amount) <= CASH_EPSILON) continue;
    problems.push(
      `${portfolio.currency} cash per ${day(portfolio.asOf)}: portfolio zegt ${formatAmount(portfolio.amount)}, Saldo zegt ${formatAmount(account.amount)} — controleer de kasstroom`,
    );
  }

  return problems;
}
