import type { TradeSide, TradeWithoutId } from "@lavega/core";
import type { BrokerAccessAdapter, BrokerResult } from "../BrokerAccessAdapter.js";

export type Trading212Config = {
  token: string;
  secret: string;
  baseUrl: string;
};

type Trading212Order = Record<string, unknown>;
type Trading212Page = { items: Trading212Order[]; nextPagePath?: string };

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

function result(trades: TradeWithoutId[], problems: string[]): BrokerResult {
  return { positions: [], trades, source: SOURCE, problems };
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

export function createTrading212Adapter(config: Trading212Config): BrokerAccessAdapter {
  // Trading 212 beta docs do not confirm a read-only key scope. The UI consent
  // gate must warn users before storing/using credentials; this adapter only reads.
  return {
    async sync({ entity }) {
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
      return result(trades, problems);
    },
  };
}
