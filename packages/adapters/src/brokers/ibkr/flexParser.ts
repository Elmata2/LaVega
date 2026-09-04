import {
  hash,
  norm,
  type CashBalance,
  type CashFlow,
  type CashFlowKind,
  type Dividend,
  type Position,
  type TradeSide,
} from "@lavega/core";
import type { TradeWithoutId } from "@lavega/core";

type Attributes = Record<string, string>;
export type FlexStatementResult = {
  positions: Position[];
  trades: TradeWithoutId[];
  dividends: Dividend[];
  cashBalances: CashBalance[];
  cashFlows: CashFlow[];
  problems: string[];
};

const numberOrNull = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

function requiredNumber(value: string | undefined, field: string): number {
  const parsed = numberOrNull(value);
  if (parsed === null) throw new Error(`IBKR Flex ${field} is missing or invalid`);
  return parsed;
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function attributes(text: string): Attributes {
  const result: Attributes = {};
  const pattern = /([A-Za-z][\w:-]*)\s*=\s*(["'])(.*?)\2/g;
  for (const match of text.matchAll(pattern)) {
    const key = match[1];
    const value = match[3];
    if (key && value !== undefined) result[key] = decodeXml(value);
  }
  return result;
}

function rows(
  xml: string,
  tag: "OpenPosition" | "Trade" | "CashReportCurrency" | "StatementOfFundsLine",
): Attributes[] {
  const result: Attributes[] = [];
  const pattern = new RegExp(`<${tag}\\b([^>]*?)(?:/\\s*>|>[^<]*</${tag}\\s*>)`, "gi");
  for (const match of xml.matchAll(pattern)) {
    if (match[1]) result.push(attributes(match[1]));
  }
  return result;
}

function cashDate(attrs: Attributes, field: string): string {
  return date(first(attrs, "date", "reportDate", "toDate", "settleDate", "tradeDate"), field);
}

function brokerIdentity(attrs: Attributes): string | undefined {
  const providerId = first(attrs, "transactionID", "transactionId", "tradeID", "tradeId");
  if (!providerId) return undefined;
  const accountId = first(attrs, "accountId", "accountID");
  return accountId ? `${accountId}:${providerId}` : providerId;
}

function identity(prefix: string, attrs: Attributes, values: unknown[]): string {
  return hash([prefix, first(attrs, "accountId", "accountID"), ...values.map(norm)].join("|"));
}

function parseCashBalances(
  xml: string,
  entity: string,
): { cashBalances: CashBalance[]; problems: string[] } {
  const uniqueRows = new Map<string, { currency: string; amount: number; asOf: string }>();
  const problems: string[] = [];
  for (const attrs of rows(xml, "CashReportCurrency")) {
    try {
      const currency = first(attrs, "currency")?.trim() ?? "";
      if (!currency || /base\s+summary/i.test(currency)) continue;
      const amount = requiredNumber(
        first(attrs, "endingCash", "endingSettledCash"),
        "cash ending balance",
      );
      const asOf = date(first(attrs, "toDate", "reportDate", "date"), "cash balance date");
      const rowIdentity = identity("ibkr-cash-balance", attrs, [currency, amount, asOf]);
      uniqueRows.set(rowIdentity, { currency, amount, asOf });
    } catch (error) {
      problems.push(
        error instanceof Error ? error.message : "IBKR Flex Cash Report row is invalid",
      );
    }
  }

  const totals = new Map<string, CashBalance>();
  for (const row of uniqueRows.values()) {
    const key = `${row.currency}\u0000${row.asOf}`;
    const existing = totals.get(key);
    totals.set(key, {
      entity,
      broker: "ibkr",
      currency: row.currency,
      amount: (existing?.amount ?? 0) + row.amount,
      asOf: row.asOf,
    });
  }
  return { cashBalances: [...totals.values()], problems };
}

function activityKind(attrs: Attributes): CashFlowKind | "dividend" {
  const code = first(attrs, "activityCode", "code")?.toUpperCase() ?? "";
  const description = first(attrs, "activityDescription", "description") ?? "";
  const activity = `${code} ${description}`;
  if (/(^|\W)(DIV|DIVIDEND)(\W|$)/i.test(activity) && !/(WITHHOLD|TAX)/i.test(activity))
    return "dividend";
  if (/(^|\W)(DEP|DEPOSIT|CASH RECEIPT|WIRE RECEIVED)(\W|$)/i.test(activity)) return "deposit";
  if (/(^|\W)(WTH|WITHDRAWAL|CASH DISBURSEMENT|WIRE SENT)(\W|$)/i.test(activity))
    return "withdrawal";
  if (/INTEREST|(^|\W)BINT(\W|$)/i.test(activity)) return "interest";
  if (/FEE|COMMISSION|WITHHOLD|TAX/i.test(activity)) return "fee";
  return "other";
}

function normalizedAmount(amount: number, kind: CashFlowKind): number {
  if (kind === "deposit") return Math.abs(amount);
  if (kind === "withdrawal" || kind === "fee") return -Math.abs(amount);
  return amount;
}

function parseStatementFunds(
  xml: string,
  entity: string,
): { dividends: Dividend[]; cashFlows: CashFlow[]; problems: string[] } {
  const dividends = new Map<string, Dividend>();
  const cashFlows = new Map<string, CashFlow>();
  const problems: string[] = [];
  for (const attrs of rows(xml, "StatementOfFundsLine")) {
    try {
      const flowDate = cashDate(attrs, "Statement of Funds date");
      const currency = first(attrs, "currency")?.trim() ?? "";
      if (!currency || /base\s+summary/i.test(currency))
        throw new Error("IBKR Flex Statement of Funds currency is missing or invalid");
      const rawAmount = requiredNumber(first(attrs, "amount"), "Statement of Funds amount");
      const description = first(attrs, "activityDescription", "description");
      const providerId = brokerIdentity(attrs);
      const kind = activityKind(attrs);

      if (kind === "dividend") {
        const symbol = first(attrs, "symbol", "underlyingSymbol");
        if (!symbol) throw new Error("IBKR Flex dividend symbol is missing");
        const id = identity("ibkr-dividend", attrs, [
          flowDate,
          currency,
          rawAmount,
          symbol,
          description,
        ]);
        const dedupeKey = providerId ?? id;
        dividends.set(dedupeKey, {
          id,
          entity,
          broker: "ibkr",
          date: flowDate,
          symbol,
          ...(first(attrs, "isin") ? { isin: first(attrs, "isin") } : {}),
          ...(description ? { description } : {}),
          amount: Math.abs(rawAmount),
          currency,
          ...(providerId ? { brokerDividendId: providerId } : {}),
        });
        continue;
      }

      const amount = normalizedAmount(rawAmount, kind);
      const id = identity("ibkr-cash-flow", attrs, [flowDate, currency, amount, kind, description]);
      const dedupeKey = providerId ?? id;
      cashFlows.set(dedupeKey, {
        id,
        entity,
        broker: "ibkr",
        date: flowDate,
        currency,
        amount,
        kind,
        ...(description ? { description } : {}),
        ...(providerId ? { brokerFlowId: providerId } : {}),
      });
    } catch (error) {
      problems.push(
        error instanceof Error ? error.message : "IBKR Flex Statement of Funds row is invalid",
      );
    }
  }
  return { dividends: [...dividends.values()], cashFlows: [...cashFlows.values()], problems };
}

function date(value: string | undefined, field: string): string {
  const raw = value?.split(";")[0] ?? "";
  if (!/^\d{8}$/.test(raw)) throw new Error(`IBKR Flex ${field} has invalid date`);
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function first(attrs: Attributes, ...names: string[]): string | undefined {
  return names.map((name) => attrs[name]).find((value) => value !== undefined);
}

function side(value: string | undefined): TradeSide {
  switch (value?.toUpperCase()) {
    case "BUY":
    case "BOT":
      return "buy";
    case "SELL":
    case "SLD":
      return "sell";
    default:
      return "other";
  }
}

function parsePosition(attrs: Attributes, entity: string): Position {
  const symbol = first(attrs, "symbol", "underlyingSymbol");
  if (!symbol) throw new Error("IBKR Flex OpenPosition symbol is missing");
  return {
    entity,
    symbol,
    ...(first(attrs, "isin") ? { isin: first(attrs, "isin") } : {}),
    ...(first(attrs, "description") ? { description: first(attrs, "description") } : {}),
    quantity: requiredNumber(first(attrs, "position", "quantity"), "position quantity"),
    averagePrice: numberOrNull(first(attrs, "avgPrice", "averagePrice")),
    marketPrice: numberOrNull(first(attrs, "markPrice", "marketPrice")),
    marketValue: numberOrNull(first(attrs, "positionValue", "marketValue")),
    currency: first(attrs, "currency", "currencyOfInstrument") || "",
    asOf: date(first(attrs, "reportDate", "date"), "position date"),
  };
}

function parseTrade(attrs: Attributes, entity: string): TradeWithoutId {
  const symbol = first(attrs, "symbol", "underlyingSymbol");
  if (!symbol) throw new Error("IBKR Flex Trade symbol is missing");
  const brokerTradeId = first(attrs, "transactionID", "tradeID", "tradeId");
  return {
    entity,
    date: date(first(attrs, "tradeDate", "dateTime", "date"), "trade date"),
    symbol,
    ...(first(attrs, "isin") ? { isin: first(attrs, "isin") } : {}),
    ...(first(attrs, "description") ? { description: first(attrs, "description") } : {}),
    side: side(first(attrs, "buySell", "side")),
    quantity: requiredNumber(first(attrs, "quantity", "tradeQuantity"), "trade quantity"),
    price: numberOrNull(first(attrs, "tradePrice", "price")),
    amount: numberOrNull(first(attrs, "proceeds", "amount")),
    currency: first(attrs, "currency", "currencyOfTrade") || "",
    commission: numberOrNull(first(attrs, "ibCommission", "commission")),
    ...(brokerTradeId ? { brokerTradeId } : {}),
  };
}

export function parseFlexStatement(xml: string, entity: string): FlexStatementResult {
  if (!xml.includes("<FlexStatements") && !xml.includes("<FlexQueryResponse")) {
    return {
      positions: [],
      trades: [],
      dividends: [],
      cashBalances: [],
      cashFlows: [],
      problems: ["IBKR Flex response is not a statement"],
    };
  }
  if (
    (xml.includes("<FlexStatements") && !xml.includes("</FlexStatements>")) ||
    (xml.includes("<FlexQueryResponse") && !xml.includes("</FlexQueryResponse>"))
  ) {
    return {
      positions: [],
      trades: [],
      dividends: [],
      cashBalances: [],
      cashFlows: [],
      problems: ["IBKR Flex response is malformed"],
    };
  }

  const positions: Position[] = [];
  const trades: TradeWithoutId[] = [];
  const problems: string[] = [];
  for (const attrs of rows(xml, "OpenPosition")) {
    try {
      positions.push(parsePosition(attrs, entity));
    } catch (error) {
      problems.push(
        error instanceof Error ? error.message : "IBKR Flex OpenPosition row is invalid",
      );
    }
  }
  for (const attrs of rows(xml, "Trade")) {
    try {
      trades.push(parseTrade(attrs, entity));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : "IBKR Flex Trade row is invalid");
    }
  }
  const cash = parseCashBalances(xml, entity);
  const funds = parseStatementFunds(xml, entity);
  return {
    positions,
    trades,
    dividends: funds.dividends,
    cashBalances: cash.cashBalances,
    cashFlows: funds.cashFlows,
    problems: [...problems, ...cash.problems, ...funds.problems],
  };
}
