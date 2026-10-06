import {
  hash,
  norm,
  type CashBalance,
  type CashFlow,
  type CashFlowKind,
  type CashHistoryCoverage,
  type Dividend,
  type Position,
  type TradeSide,
  normalizeTradeQuantity,
} from "@lavega/core";
import type { TradeWithoutId } from "@lavega/core";
import type { BrokerSection, BrokerSections } from "../BrokerAccessAdapter.js";

type Attributes = Record<string, string>;
export type StatementPeriod = { from: string; to: string };
export type FlexStatementResult = {
  sections: BrokerSections;
  cashHistory?: CashHistoryCoverage;
  /** Span of the statements, so a re-read of the same window can replace it. */
  period?: StatementPeriod;
  /** Account ids of the statements, when every statement names one. */
  accounts?: string[];
  /** Latest end date over all statements, even when their periods differ. */
  statementTo?: string;
  problems: string[];
};

function section<T>(rows: T[], present: boolean, problems: string[]): BrokerSection<T> {
  return {
    status: !present ? "unavailable" : problems.length > 0 ? "partial" : "complete",
    rows,
  };
}

function flexStatements(xml: string): RegExpExecArray[] {
  return [...xml.matchAll(/<FlexStatement\b([^>]*)>([\s\S]*?)<\/FlexStatement\s*>/gi)];
}

function hasTag(xml: string, tag: string): boolean {
  return new RegExp(`<${tag}(?:[\\s/>])`, "i").test(xml);
}

/** IBKR names the Statement of Funds container `StmtFunds` in Flex XML. */
function hasStatementOfFunds(xml: string): boolean {
  return hasTag(xml, "StmtFunds") || hasTag(xml, "StatementOfFunds");
}

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

function accountField(attrs: Attributes): { account?: string } {
  const account = first(attrs, "accountId", "accountID");
  return account ? { account } : {};
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
      if (!currency || /^base[\s_]*summary$/i.test(currency)) continue;
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

/** Owner money moves IBKR books without an activity code; the sign says which way. */
const OWNER_TRANSFER =
  /ELECTRONIC FUND TRANSFER|^\s*DISBURSEMENT|CASH TRANSFER|INTERNAL TRANSFER|^\s*TRANSFER (TO|FROM) |^\s*(DEPOSIT|WITHDRAWAL)|CASH RECEIPT|WIRE RECEIVED|WIRE SENT/i;

function activityKind(attrs: Attributes): CashFlowKind | "dividend" {
  const code = first(attrs, "activityCode", "code")?.toUpperCase() ?? "";
  const description = first(attrs, "activityDescription", "description") ?? "";
  const activity = `${code} ${description}`;
  if (/^(BUY|SELL)$/.test(code) || /^\s*(BUY|SELL|BOUGHT|SOLD)\b/i.test(description))
    return "other";
  if (/(^|\W)(DIV|DIVIDEND)(\W|$)/i.test(activity) && !/(WITHHOLD|TAX)/i.test(activity))
    return "dividend";
  if (/FEE|COMMISSION/i.test(activity)) return "fee";
  if (/\bOF POSITION\b/i.test(description)) return "other";
  if (/INTEREST|(^|\W)BINT(\W|$)/i.test(activity)) return "interest";
  if (/^(DEP|WTH|WITH)$/.test(code) || OWNER_TRANSFER.test(description)) {
    const amount = numberOrNull(first(attrs, "amount"));
    if (amount !== null && amount > 0) return "deposit";
    if (amount !== null && amount < 0) return "withdrawal";
  }
  if (/WITHHOLD|TAX/i.test(activity)) return "fee";
  return "other";
}

function parseStatementFunds(
  xml: string,
  entity: string,
): { dividends: Dividend[]; cashFlows: CashFlow[]; problems: string[] } {
  const dividends = new Map<string, Dividend>();
  const cashFlows = new Map<string, CashFlow>();
  const problems: string[] = [];
  const statements = flexStatements(xml);
  const scopes = statements.length > 0 ? statements.map(([, , body = ""]) => body) : [xml];
  const lines = scopes.flatMap((body) => {
    const seen = new Map<string, number>();
    return rows(body, "StatementOfFundsLine").map((attrs) => {
      const content = JSON.stringify(Object.entries(attrs).sort());
      const occurrence = seen.get(content) ?? 0;
      seen.set(content, occurrence + 1);
      return { attrs, occurrence };
    });
  });
  for (const { attrs, occurrence } of lines) {
    try {
      const flowDate = cashDate(attrs, "Statement of Funds date");
      const currency = first(attrs, "currency")?.trim() ?? "";
      if (!currency || /^base[\s_]*summary$/i.test(currency))
        throw new Error("IBKR Flex Statement of Funds currency is missing or invalid");
      const rawAmount = requiredNumber(first(attrs, "amount"), "Statement of Funds amount");
      const description = first(attrs, "activityDescription", "description");
      const providerId = brokerIdentity(attrs);
      const kind = activityKind(attrs);
      /* Without a provider id the line's own content is its identity, so two
       * identical lines must differ by running balance or occurrence. */
      const lineIdentity = providerId ? [] : [first(attrs, "balance"), occurrence];

      if (kind === "dividend") {
        const symbol = first(attrs, "symbol", "underlyingSymbol");
        if (!symbol) throw new Error("IBKR Flex dividend symbol is missing");
        const id = identity("ibkr-dividend", attrs, [
          flowDate,
          currency,
          rawAmount,
          symbol,
          description,
          ...lineIdentity,
        ]);
        const dedupeKey = providerId ?? id;
        dividends.set(dedupeKey, {
          id,
          entity,
          broker: "ibkr",
          ...accountField(attrs),
          date: flowDate,
          symbol,
          ...(first(attrs, "isin") ? { isin: first(attrs, "isin") } : {}),
          ...(description ? { description } : {}),
          amount: rawAmount,
          currency,
          ...(providerId ? { brokerDividendId: providerId } : {}),
        });
        continue;
      }

      const amount = rawAmount;
      const id = identity("ibkr-cash-flow", attrs, [
        flowDate,
        currency,
        amount,
        kind,
        description,
        ...lineIdentity,
      ]);
      const dedupeKey = providerId ?? id;
      cashFlows.set(dedupeKey, {
        id,
        entity,
        broker: "ibkr",
        ...accountField(attrs),
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

/** Quantity moves by executions, but also by account transfers (ACATS,
 *  internal moves) and corporate actions (mergers, spin-offs, stock
 *  dividends), which book no cash and which this parser does not read. A
 *  statement proves its quantity history only if it carries a Trades,
 *  Transfers and CorporateActions section and the last two hold no rows. */
function provesQuantityHistory(body: string): boolean {
  const present = (tag: string) => new RegExp(`<${tag}(?:[\\s/>])`, "i").test(body);
  if (!present("Trades") || !present("Transfers") || !present("CorporateActions")) return false;
  return !/<(?:Transfer|CorporateAction)\b/i.test(body);
}

/** Statement of Funds books every cash movement in the statement period,
 *  trades included, so it is the one trade-cash stream and the period is the
 *  proven window. Accounts share one wallet identity here and their Cash
 *  Report rows merge by currency and date, so a window is proven only when
 *  every account statement carries both cash sections for the same period. */
function cashHistory(
  xml: string,
  entity: string,
  sections: Pick<BrokerSections, "cashBalances" | "cashFlows" | "dividends" | "trades">,
): CashHistoryCoverage {
  /* Statement of Funds books every cash movement including trades, so that is
   * where IBKR trade cash lives whether or not a window is proven. */
  const unknown = (reason: string): CashHistoryCoverage => ({
    entity,
    broker: "ibkr",
    tradeCash: "cash-flows",
    status: "unknown",
    reason,
  });
  if (Object.values(sections).some((value) => value.status !== "complete"))
    return unknown("IBKR Flex cash report or Statement of Funds is missing or partial");
  const periods = new Set<string>();
  let quantityHistoryProven = true;
  for (const [, attrs = "", body = ""] of flexStatements(xml)) {
    if (!provesQuantityHistory(body)) quantityHistoryProven = false;
    if (!hasTag(body, "CashReport") || !hasStatementOfFunds(body))
      return unknown("An IBKR Flex account statement lacks its cash report or Statement of Funds");
    const { fromDate, toDate } = attributes(attrs);
    if (!fromDate || !toDate || !/^\d{8}$/.test(fromDate) || !/^\d{8}$/.test(toDate))
      return unknown("IBKR Flex statement period is missing");
    periods.add(`${fromDate}-${toDate}`);
  }
  const [period, ...others] = periods;
  if (!period) return unknown("IBKR Flex statement period is missing");
  if (others.length > 0) return unknown("IBKR Flex account statements cover different periods");
  const [fromDate, toDate] = period.split("-");
  return {
    entity,
    broker: "ibkr",
    status: "complete",
    from: date(fromDate, "statement period start"),
    to: date(toDate, "statement period end"),
    tradeCash: "cash-flows",
    ...(quantityHistoryProven && sections.trades.status === "complete"
      ? { quantityProvenFrom: date(fromDate, "statement period start") }
      : {}),
  };
}

/** One window only when every account statement states the same period;
 *  otherwise a replace would drop rows of the account with the shorter one. */
function statementPeriod(xml: string): StatementPeriod | undefined {
  const periods = new Set<string>();
  for (const [, attrs = ""] of flexStatements(xml)) {
    const { fromDate, toDate } = attributes(attrs);
    if (!fromDate || !toDate || !/^\d{8}$/.test(fromDate) || !/^\d{8}$/.test(toDate))
      return undefined;
    periods.add(`${fromDate}-${toDate}`);
  }
  const [period, ...others] = periods;
  if (!period || others.length > 0) return undefined;
  const [fromDate, toDate] = period.split("-");
  return {
    from: date(fromDate, "statement period start"),
    to: date(toDate, "statement period end"),
  };
}

function latestStatementEnd(xml: string): string | undefined {
  let latest: string | undefined;
  for (const [, attrs = ""] of flexStatements(xml)) {
    const { toDate } = attributes(attrs);
    if (!toDate || !/^\d{8}$/.test(toDate)) continue;
    const day = date(toDate, "statement period end");
    if (latest === undefined || day > latest) latest = day;
  }
  return latest;
}

function statementAccounts(xml: string): string[] | undefined {
  const accounts: string[] = [];
  for (const [, attrs = ""] of flexStatements(xml)) {
    const accountId = first(attributes(attrs), "accountId", "accountID");
    if (!accountId) return undefined;
    accounts.push(accountId);
  }
  return accounts.length > 0 ? accounts : undefined;
}

function date(value: string | undefined, field: string): string {
  const raw = value?.split(";")[0] ?? "";
  if (!/^\d{8}$/.test(raw)) throw new Error(`IBKR Flex ${field} has invalid date`);
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function tradeTime(value: string | undefined): { date: string; executionAt?: string } {
  const tradeDate = date(value, "trade date");
  const rawTime = value?.split(";")[1];
  if (rawTime === undefined || rawTime === "") return { date: tradeDate };
  if (!/^\d{6}$/.test(rawTime)) throw new Error("IBKR Flex trade time is invalid");
  const hour = Number(rawTime.slice(0, 2));
  const minute = Number(rawTime.slice(2, 4));
  const second = Number(rawTime.slice(4, 6));
  if (hour > 23 || minute > 59 || second > 59) throw new Error("IBKR Flex trade time is invalid");
  return {
    date: tradeDate,
    executionAt: `${tradeDate}T${rawTime.slice(0, 2)}:${rawTime.slice(2, 4)}:${rawTime.slice(4, 6)}`,
  };
}

function first(attrs: Attributes, ...names: string[]): string | undefined {
  return names.map((name) => attrs[name]).find((value) => value !== undefined);
}

function isCurrencyPair(attrs: Attributes): boolean {
  return first(attrs, "assetCategory")?.toUpperCase() === "CASH";
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

function positionDate(attrs: Attributes, statementDate: string | undefined): string {
  const value = first(attrs, "reportDate", "date") || statementDate;
  if (!value)
    throw new Error(
      "IBKR Flex position date is missing; enable Report Date in the Open Positions section of the Flex query",
    );
  return date(value, "position date");
}

function parsePosition(attrs: Attributes, entity: string, statementDate?: string): Position {
  const symbol = first(attrs, "symbol", "underlyingSymbol");
  if (!symbol) throw new Error("IBKR Flex OpenPosition symbol is missing");
  const account = first(attrs, "accountId", "accountID");
  const quantity = requiredNumber(first(attrs, "position", "quantity"), "position quantity");
  const costBasisMoney = numberOrNull(first(attrs, "costBasisMoney"));
  const category = first(attrs, "assetCategory")?.trim().toUpperCase();
  // Options and futures carry a contract multiplier in the total, so only stocks can divide it out.
  const perUnitFromTotal =
    (!category || category === "STK") && costBasisMoney !== null && quantity !== 0
      ? costBasisMoney / quantity
      : null;
  const averagePrice =
    numberOrNull(first(attrs, "avgPrice", "averagePrice", "costBasisPrice")) ?? perUnitFromTotal;
  const currency = first(attrs, "currency", "currencyOfInstrument") || "";
  return {
    entity,
    broker: "ibkr",
    ...(account ? { account } : {}),
    symbol,
    ...(first(attrs, "isin") ? { isin: first(attrs, "isin") } : {}),
    ...(first(attrs, "description") ? { description: first(attrs, "description") } : {}),
    quantity,
    brokerCost:
      costBasisMoney === null && averagePrice === null
        ? { status: "unknown", reason: "not-reported" }
        : { status: "known", amount: costBasisMoney ?? (averagePrice ?? 0) * quantity, currency },
    averagePrice,
    marketPrice: numberOrNull(first(attrs, "markPrice", "marketPrice")),
    marketValue: numberOrNull(first(attrs, "positionValue", "marketValue")),
    currency,
    asOf: positionDate(attrs, statementDate),
  };
}

function parseTrade(attrs: Attributes, entity: string): TradeWithoutId {
  const symbol = first(attrs, "symbol", "underlyingSymbol");
  if (!symbol) throw new Error("IBKR Flex Trade symbol is missing");
  const brokerTradeId = first(attrs, "transactionID", "tradeID", "tradeId");
  const account = first(attrs, "accountId", "accountID");
  const time = tradeTime(first(attrs, "tradeDate", "dateTime", "date"));
  const tradeSide = side(first(attrs, "buySell", "side"));
  const quantity = normalizeTradeQuantity(
    tradeSide,
    requiredNumber(first(attrs, "quantity", "tradeQuantity"), "trade quantity"),
  );
  return {
    entity,
    broker: "ibkr",
    ...(account ? { account } : {}),
    ...time,
    symbol,
    ...(first(attrs, "isin") ? { isin: first(attrs, "isin") } : {}),
    ...(first(attrs, "description") ? { description: first(attrs, "description") } : {}),
    side: tradeSide,
    quantity,
    price: numberOrNull(first(attrs, "tradePrice", "price")),
    amount: numberOrNull(first(attrs, "proceeds", "amount")),
    currency: first(attrs, "currency", "currencyOfTrade") || "",
    commission: numberOrNull(first(attrs, "ibCommission", "commission")),
    ...(brokerTradeId ? { brokerTradeId } : {}),
  };
}

function periodField(period: StatementPeriod | undefined): { period?: StatementPeriod } {
  return period ? { period } : {};
}

function statementToField(statementTo: string | undefined): { statementTo?: string } {
  return statementTo ? { statementTo } : {};
}

function accountsField(accounts: string[] | undefined): { accounts?: string[] } {
  return accounts ? { accounts } : {};
}

export function parseFlexStatement(xml: string, entity: string): FlexStatementResult {
  if (!xml.includes("<FlexStatements") && !xml.includes("<FlexQueryResponse")) {
    return {
      sections: {
        positions: { status: "unavailable", rows: [] },
        trades: { status: "unavailable", rows: [] },
        dividends: { status: "unavailable", rows: [] },
        cashBalances: { status: "unavailable", rows: [] },
        cashFlows: { status: "unavailable", rows: [] },
      },
      problems: ["IBKR Flex response is not a statement"],
    };
  }
  if (
    (xml.includes("<FlexStatements") && !xml.includes("</FlexStatements>")) ||
    (xml.includes("<FlexQueryResponse") && !xml.includes("</FlexQueryResponse>"))
  ) {
    return {
      sections: {
        positions: { status: "unavailable", rows: [] },
        trades: { status: "unavailable", rows: [] },
        dividends: { status: "unavailable", rows: [] },
        cashBalances: { status: "unavailable", rows: [] },
        cashFlows: { status: "unavailable", rows: [] },
      },
      problems: ["IBKR Flex response is malformed"],
    };
  }

  const positions: Position[] = [];
  const trades: TradeWithoutId[] = [];
  const positionProblems: string[] = [];
  const tradeProblems: string[] = [];
  const statements = flexStatements(xml);
  const positionScopes: Array<[string, string | undefined]> =
    statements.length > 0
      ? statements.map(([, attrs = "", body = ""]) => [body, attributes(attrs).toDate])
      : [[xml, undefined]];
  for (const [body, statementDate] of positionScopes) {
    for (const attrs of rows(body, "OpenPosition")) {
      if (isCurrencyPair(attrs)) continue;
      try {
        positions.push(parsePosition(attrs, entity, statementDate));
      } catch (error) {
        positionProblems.push(
          error instanceof Error ? error.message : "IBKR Flex OpenPosition row is invalid",
        );
      }
    }
  }
  for (const attrs of rows(xml, "Trade")) {
    if (isCurrencyPair(attrs)) continue;
    try {
      trades.push(parseTrade(attrs, entity));
    } catch (error) {
      tradeProblems.push(error instanceof Error ? error.message : "IBKR Flex Trade row is invalid");
    }
  }
  const cash = parseCashBalances(xml, entity);
  const funds = parseStatementFunds(xml, entity);
  const sections: BrokerSections = {
    positions: section(positions, hasTag(xml, "OpenPositions"), positionProblems),
    trades: section(trades, hasTag(xml, "Trades"), tradeProblems),
    dividends: section(funds.dividends, hasStatementOfFunds(xml), funds.problems),
    cashBalances: section(cash.cashBalances, hasTag(xml, "CashReport"), cash.problems),
    cashFlows: section(funds.cashFlows, hasStatementOfFunds(xml), funds.problems),
  };
  return {
    sections,
    cashHistory: cashHistory(xml, entity, sections),
    ...periodField(statementPeriod(xml)),
    ...accountsField(statementAccounts(xml)),
    ...statementToField(latestStatementEnd(xml)),
    problems: [...positionProblems, ...tradeProblems, ...cash.problems, ...funds.problems],
  };
}
