import type { Position, TradeSide, TradeWithoutId } from "@lavega/core";
import type { BrokerAccessAdapter, BrokerResult } from "../BrokerAccessAdapter.js";

export type Trading212Config = {
  token: string;
  secret: string;
  baseUrl: string;
};

type Trading212Order = Record<string, unknown>;
type Trading212Page = { items: Trading212Order[]; nextPagePath?: string };
type Trading212Positions = Trading212Order[];

const SOURCE = "trading-212";

function value(order: Trading212Order, ...keys: string[]): unknown {
  return keys.map((key) => order[key]).find((item) => item !== undefined && item !== null);
}

function number(valueToParse: unknown, field: string): number {
  const parsed = Number(valueToParse);
  if (!Number.isFinite(parsed)) throw new Error(`Trading 212 order ${field} is missing or invalid`);
  return parsed;
}

function date(valueToParse: unknown): string {
  const raw = String(valueToParse ?? "");
  const parsed = new Date(raw);
  if (!raw || Number.isNaN(parsed.getTime())) throw new Error("Trading 212 order date is missing or invalid");
  return parsed.toISOString().slice(0, 10);
}

function side(valueToParse: unknown): TradeSide {
  switch (String(valueToParse ?? "").toUpperCase()) {
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

function nullableNumber(valueToParse: unknown): number | null {
  if (valueToParse === undefined || valueToParse === null || valueToParse === "") return null;
  const parsed = Number(valueToParse);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapOrder(order: Trading212Order, entity: string): TradeWithoutId {
  const symbol = String(value(order, "ticker", "symbol") ?? "");
  if (!symbol) throw new Error("Trading 212 order symbol is missing");
  const brokerTradeId = value(order, "id", "orderId");
  const amount = nullableNumber(value(order, "totalCost", "filledValue", "value", "amount"));
  const commission = nullableNumber(value(order, "fees", "commission"));
  return {
    entity,
    date: date(value(order, "dateExecuted", "executedAt", "fillDate", "dateCreated", "createdAt")),
    symbol,
    ...(typeof value(order, "isin") === "string" ? { isin: value(order, "isin") as string } : {}),
    ...(typeof value(order, "name", "description") === "string" ? { description: value(order, "name", "description") as string } : {}),
    side: side(value(order, "direction", "side")),
    quantity: number(value(order, "filledQuantity", "quantity"), "quantity"),
    price: nullableNumber(value(order, "fillPrice", "price")),
    amount,
    currency: String(value(order, "currency", "currencyCode") ?? ""),
    commission,
    ...(brokerTradeId !== undefined && brokerTradeId !== null ? { brokerTradeId: String(brokerTradeId) } : {}),
  };
}

function mapPosition(raw: Trading212Order, entity: string): Position {
  // The beta docs name this endpoint and fields, but do not publish a stable
  // response schema. Keep aliases here until a recorded Invest/Stocks ISA
  // response confirms the exact names. Nested instrument fields are accepted
  // because some beta responses place ISIN/name below `instrument`.
  const instrument = raw.instrument && typeof raw.instrument === "object" && !Array.isArray(raw.instrument)
    ? raw.instrument as Trading212Order
    : {};
  const get = (...keys: string[]) => value(raw, ...keys) ?? value(instrument, ...keys);
  const symbol = String(get("ticker", "symbol") ?? "");
  if (!symbol) throw new Error("Trading 212 position symbol is missing");
  return {
    entity,
    symbol,
    ...(typeof get("isin") === "string" ? { isin: get("isin") as string } : {}),
    ...(typeof get("name", "description") === "string" ? { description: get("name", "description") as string } : {}),
    quantity: number(get("quantity", "position"), "position quantity"),
    averagePrice: nullableNumber(get("averagePrice", "avgPrice")),
    marketPrice: nullableNumber(get("currentPrice", "marketPrice", "price")),
    marketValue: nullableNumber(get("marketValue", "value", "currentValue")),
    currency: String(get("currency", "currencyCode") ?? ""),
    asOf: date(get("asOf", "date", "updatedAt") ?? new Date().toISOString()),
  };
}

function result(positions: Position[], trades: TradeWithoutId[], problems: string[]): BrokerResult {
  return { positions, trades, source: SOURCE, problems };
}

async function page(url: string, config: Trading212Config): Promise<Trading212Page> {
  // Trading 212 beta docs do not confirm per-endpoint numeric rate limits. Keep
  // sync bounded to one sequential request per cursor until provider confirms them.
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${Buffer.from(`${config.token}:${config.secret}`).toString("base64")}` },
  });
  if (!response.ok) throw new Error(`Trading 212 request failed with HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { items?: unknown }).items)) {
    throw new Error("Trading 212 order-history response is malformed");
  }
  const data = payload as { items: unknown[]; nextPagePath?: unknown };
  if (!data.items.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))) {
    throw new Error("Trading 212 order-history items are malformed");
  }
  return {
    items: data.items as Trading212Order[],
    ...(typeof data.nextPagePath === "string" && data.nextPagePath ? { nextPagePath: data.nextPagePath } : {}),
  };
}

async function positions(url: string, config: Trading212Config): Promise<Trading212Positions> {
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${Buffer.from(`${config.token}:${config.secret}`).toString("base64")}` },
  });
  if (!response.ok) throw new Error(`Trading 212 holdings request failed with HTTP ${response.status}`);
  const payload: unknown = await response.json();
  // Trading 212 docs reference this endpoint but do not confirm whether beta
  // returns a bare array or an envelope. Accept both documented possibilities;
  // reject everything else so a changed payload becomes visible as a problem.
  const items = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? (payload as { items?: unknown; positions?: unknown; holdings?: unknown }).items
        ?? (payload as { positions?: unknown }).positions
        ?? (payload as { holdings?: unknown }).holdings
      : undefined;
  if (!Array.isArray(items)) throw new Error("Trading 212 holdings response is malformed");
  if (!items.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))) {
    throw new Error("Trading 212 holdings items are malformed");
  }
  const unsupported = items.find((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const row = item as Trading212Order;
    const account = value(row, "accountType", "account", "accountName");
    return account !== undefined && !/^(invest|stocks\s*isa)$/i.test(String(account));
  });
  if (unsupported) throw new Error("Trading 212 holdings include unsupported account type");
  return items as Trading212Order[];
}

export function createTrading212Adapter(config: Trading212Config): BrokerAccessAdapter {
  // Trading 212 beta docs do not confirm a read-only key scope. The UI consent
  // gate must warn users before storing/using credentials; this adapter only reads.
  return {
    async sync({ entity }) {
      const positionsResult: Position[] = [];
      const trades: TradeWithoutId[] = [];
      const problems: string[] = [];
      let nextUrl = new URL("/api/v0/equity/history/orders", config.baseUrl).toString();
      try {
        while (nextUrl) {
          const current = await page(nextUrl, config);
          for (const order of current.items) {
            try {
              trades.push(mapOrder(order, entity));
            } catch (error) {
              problems.push(error instanceof Error ? error.message : "Trading 212 order is invalid");
            }
          }
          nextUrl = current.nextPagePath ? new URL(current.nextPagePath, config.baseUrl).toString() : "";
        }
      } catch (error) {
        problems.push(error instanceof Error ? error.message : "Trading 212 sync failed");
      }
      try {
        // This equity endpoint is the shared read scope for Trading 212 Invest
        // and Stocks ISA accounts. Multi-currency accounts are outside the
        // connector contract; no order-capable endpoint is called here.
        const holdingsUrl = new URL("/api/v0/equity/positions", config.baseUrl).toString();
        for (const holding of await positions(holdingsUrl, config)) {
          try {
            positionsResult.push(mapPosition(holding, entity));
          } catch (error) {
            problems.push(error instanceof Error ? error.message : "Trading 212 holding is invalid");
          }
        }
      } catch (error) {
        problems.push(error instanceof Error ? error.message : "Trading 212 holdings sync failed");
      }
      return result(positionsResult, trades, problems);
    },
  };
}
