import type { Trade } from "../../investing/model.js";
import type { ParsedBrokerFile } from "../parseBrokerFile.js";
import { NO_ACCOUNT_HISTORY_REASON } from "./transactions.js";

/* Issue #318: one import can hold the account statement and the transaction
 * export. The account statement stays the cash truth; the transaction export
 * only enriches the execution with venue, FX rate and its local value. Merging
 * here, not in the adapter, keeps that field precedence in one place and gives
 * the #323 upload route one seam.
 *
 * The execution key is the account reader's own group key: Order Id + Datum +
 * Tijd. Partial fills share an Order Id but each has its own time, so the time
 * is part of the identity; matching on the Order Id alone would collapse them.
 */

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
 * Merge every parsed DeGiro file of one import. The first account statement and
 * the first transaction export are the import; every other file, including a
 * portfolio export or an unknown header, contributes its problems only.
 *
 * Never throws. When the import holds neither an account statement nor a
 * transaction export, the first parsed result stands.
 */
export function mergeDeGiroFiles(parsed: readonly ParsedBrokerFile[]): ParsedBrokerFile {
  const account = parsed.find((file) => file.profile === "account");
  const transactions = parsed.find((file) => file.profile === "transactions");

  /* A problem without its filename is unusable once one import holds more than
   * one file: the user cannot tell which export failed. */
  const problems: string[] = [];
  for (const file of parsed) {
    const prefix = parsed.length > 1 && file.filename !== undefined ? `${file.filename}: ` : "";
    for (const problem of file.problems) problems.push(`${prefix}${problem}`);
  }

  if (account === undefined && transactions === undefined) {
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

  const cashHistory =
    account !== undefined
      ? account.cashHistory
      : { status: "unknown" as const, reason: NO_ACCOUNT_HISTORY_REASON };
  const sections = account?.sections ?? transactions?.sections;
  const period = account?.period ?? transactions?.period;
  const source =
    account !== undefined
      ? transactions !== undefined
        ? "DeGiro account + transactions"
        : "DeGiro account"
      : "DeGiro transactions";

  return {
    profile: account !== undefined ? "account" : "transactions",
    positions: [],
    trades,
    /* Cash flows, dividends and cash balances come from the account statement
     * only; a transaction export has no ledger to prove them. */
    ...(account?.dividends !== undefined ? { dividends: account.dividends } : {}),
    ...(account?.cashFlows !== undefined ? { cashFlows: account.cashFlows } : {}),
    ...(account?.cashBalances !== undefined ? { cashBalances: account.cashBalances } : {}),
    ...(cashHistory !== undefined ? { cashHistory } : {}),
    ...(sections !== undefined ? { sections } : {}),
    ...(period !== undefined ? { period } : {}),
    source,
    problems: [...problems, ...tradeProblems],
  };
}
