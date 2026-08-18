import type { Position, TradeSide } from "@lavega/core";
import type { TradeWithoutId } from "@lavega/core";

type Attributes = Record<string, string>;
export type FlexStatementResult = {
  positions: Position[];
  trades: TradeWithoutId[];
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

function rows(xml: string, tag: "OpenPosition" | "Trade"): Attributes[] {
  const result: Attributes[] = [];
  const pattern = new RegExp(`<${tag}\\b([^>]*?)(?:/\\s*>|>[^<]*</${tag}\\s*>)`, "gi");
  for (const match of xml.matchAll(pattern)) {
    if (match[1]) result.push(attributes(match[1]));
  }
  return result;
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
    return { positions: [], trades: [], problems: ["IBKR Flex response is not a statement"] };
  }
  if ((xml.includes("<FlexStatements") && !xml.includes("</FlexStatements>"))
    || (xml.includes("<FlexQueryResponse") && !xml.includes("</FlexQueryResponse>"))) {
    return { positions: [], trades: [], problems: ["IBKR Flex response is malformed"] };
  }

  const positions: Position[] = [];
  const trades: TradeWithoutId[] = [];
  const problems: string[] = [];
  for (const attrs of rows(xml, "OpenPosition")) {
    try {
      positions.push(parsePosition(attrs, entity));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : "IBKR Flex OpenPosition row is invalid");
    }
  }
  for (const attrs of rows(xml, "Trade")) {
    try {
      trades.push(parseTrade(attrs, entity));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : "IBKR Flex Trade row is invalid");
    }
  }
  return { positions, trades, problems };
}
