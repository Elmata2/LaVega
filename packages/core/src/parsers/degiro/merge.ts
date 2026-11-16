import type { CashBalance, Trade } from "../../investing/model.js";
import type { BrokerFileSection, ParsedBrokerFile } from "../parseBrokerFile.js";
import { NO_PORTFOLIO_HISTORY_REASON } from "./portfolio.js";
import { NO_ACCOUNT_HISTORY_REASON } from "./transactions.js";

/* One import can hold the account statement, the transaction export and the
 * portfolio export. The account statement stays the cash truth; the transaction
 * export only enriches the execution with venue, FX rate and its local value,
 * and the portfolio export supplies the dated holdings. Merging here, not in
 * the adapter, keeps that field precedence in one place and gives the #323
 * upload route one seam.
 *
 * The execution key is the account reader's own group key: Order Id + Datum +
 * Tijd. Partial fills share an Order Id but each has its own time, so the time
 * is part of the identity; matching on the Order Id alone would collapse them.
 */

/** Stable result order, regardless of the order the files arrived in. A
 *  portfolio-only import lists positions after cash balances, because the
 *  account fields keep their existing order. */
const SECTION_ORDER: readonly BrokerFileSection[] = [
  "trades",
  "dividends",
  "cashFlows",
  "cashBalances",
  "positions",
];

type ParsedTrade = Omit<Trade, "entity" | "id">;

const executionKey = (trade: ParsedTrade): string =>
  `${trade.brokerTradeId ?? ""}\u0000${trade.date}\u0000${trade.executionAt?.slice(11, 16) ?? ""}`;

/** The account row is the cash stream, so it wins every field that describes
 *  money and identity. The transaction row fills only what the statement does
 *  not print: venue, FX rate, and its own price and description. */
function mergeTrade(account: ParsedTrade, transactions: ParsedTrade): ParsedTrade {
  return {
    ...account,
    price: transactions.price,
    ...(transactions.venue ? { venue: transactions.venue } : {}),
    ...(transactions.fxRate !== undefined ? { fxRate: transactions.fxRate } : {}),
    ...(account.description === undefined && transactions.description !== undefined
      ? { description: transactions.description }
      : {}),
  };
}

/**
 * Merge the transaction trades into the account trades by execution. Never
 * throws: a side or quantity disagreement keeps both rows and names the order,
 * and an Order Id seen at another execution is appended with a problem.
 */
function mergeTrades(
  accountTrades: readonly ParsedTrade[],
  transactionsTrades: readonly ParsedTrade[],
): { trades: ParsedTrade[]; problems: string[] } {
  const trades: ParsedTrade[] = [...accountTrades];
  const problems: string[] = [];
  const buckets = new Map<string, number[]>();
  const orderIds = new Set<string>();

  accountTrades.forEach((trade, index) => {
    if (trade.brokerTradeId === undefined) return;
    orderIds.add(trade.brokerTradeId);
    const key = executionKey(trade);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [index]);
    else bucket.push(index);
  });

  for (const trade of transactionsTrades) {
    const orderId = trade.brokerTradeId;
    /* Without an Order Id there is nothing to match on, so the row is a real
     * execution the statement did not carry. Append it, do not guess a pair. */
    if (orderId === undefined) {
      trades.push(trade);
      continue;
    }

    const bucket = buckets.get(executionKey(trade));
    const index = bucket?.shift();
    if (index === undefined) {
      trades.push(trade);
      if (orderIds.has(orderId)) {
        problems.push(
          `order ${orderId}: transactie-uitvoering staat niet in het rekeningoverzicht — andere uitvoering toegevoegd`,
        );
      }
      continue;
    }

    const accountTrade = accountTrades[index];
    if (accountTrade === undefined) {
      trades.push(trade);
      continue;
    }
    if (accountTrade.side !== trade.side || accountTrade.quantity !== trade.quantity) {
      trades.push(trade);
      problems.push(
        `order ${orderId}: transactie wijkt af van het rekeningoverzicht (${accountTrade.side} ${accountTrade.quantity} tegen ${trade.side} ${trade.quantity}) — beide rijen behouden`,
      );
      continue;
    }
    trades[index] = mergeTrade(accountTrade, trade);
  }

  return { trades, problems };
}

/**
 * Merge every parsed DeGiro file of one import. The first account statement, the
 * first transaction export and the first portfolio export are the import; every
 * other file, including an unknown header, contributes its problems only.
 *
 * Positions come from the portfolio export alone. Cash balances come from the
 * account statement when it read them, because only its `Saldo` walk proves the
 * anchors; otherwise the portfolio's current cash row stands in.
 *
 * Never throws. When the import holds no mapped file, the first parsed result
 * stands.
 */
export function mergeDeGiroFiles(parsed: readonly ParsedBrokerFile[]): ParsedBrokerFile {
  const account = parsed.find((file) => file.profile === "account");
  const transactions = parsed.find((file) => file.profile === "transactions");
  const portfolio = parsed.find((file) => file.profile === "portfolio");

  /* A problem without its filename is unusable once one import holds more than
   * one file: the user cannot tell which export failed. */
  const problems: string[] = [];
  for (const file of parsed) {
    const prefix = parsed.length > 1 && file.filename !== undefined ? `${file.filename}: ` : "";
    for (const problem of file.problems) problems.push(`${prefix}${problem}`);
  }

  if (account === undefined && transactions === undefined && portfolio === undefined) {
    const first = parsed[0];
    if (first === undefined) return { positions: [], trades: [], source: "", problems };
    return { ...first, problems };
  }

  let trades: ParsedTrade[] = [...(account?.trades ?? transactions?.trades ?? [])];
  const tradeProblems: string[] = [];
  if (account !== undefined && transactions !== undefined) {
    const merged = mergeTrades(account.trades, transactions.trades);
    trades = merged.trades;
    tradeProblems.push(...merged.problems);
  }

  /* The portfolio export proves no cash history. A transaction export at least
   * names the missing account statement, so its reason is the more specific one. */
  const cashHistory: ParsedBrokerFile["cashHistory"] = account?.cashHistory ?? {
    status: "unknown",
    reason: transactions !== undefined ? NO_ACCOUNT_HISTORY_REASON : NO_PORTFOLIO_HISTORY_REASON,
  };

  const readSections = new Set<BrokerFileSection>();
  for (const file of parsed) for (const section of file.sections ?? []) readSections.add(section);

  /* The account statement keeps its `Saldo` anchors; the portfolio cash row is a
   * current balance and only stands in when no statement read one. */
  const cashBalances: Omit<CashBalance, "entity" | "broker">[] | undefined =
    account?.cashBalances ?? portfolio?.cashBalances;
  const positions = portfolio?.positions ?? [];
  const period = account?.period ?? transactions?.period;

  const parts: string[] = [];
  if (account !== undefined) parts.push("account");
  if (transactions !== undefined) parts.push("transactions");
  if (portfolio !== undefined) parts.push("portfolio");

  return {
    profile:
      account !== undefined ? "account" : transactions !== undefined ? "transactions" : "portfolio",
    positions,
    trades,
    /* Cash flows, dividends and cash balances come from the account statement
     * only; neither other export has a ledger to prove them. */
    ...(account?.dividends !== undefined ? { dividends: account.dividends } : {}),
    ...(account?.cashFlows !== undefined ? { cashFlows: account.cashFlows } : {}),
    ...(cashBalances !== undefined ? { cashBalances } : {}),
    cashHistory,
    sections: SECTION_ORDER.filter((section) => readSections.has(section)),
    ...(period !== undefined ? { period } : {}),
    source: `DeGiro ${parts.join(" + ")}`,
    problems: [...problems, ...tradeProblems],
  };
}
