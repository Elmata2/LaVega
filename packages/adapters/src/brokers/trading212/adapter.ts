import { LOCAL_TENANT_ID, type Position, type TradeSide, type TradeWithoutId } from "@lavega/core";
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
const ORDER_HISTORY_PATH = "/api/v0/equity/history/orders";
const POSITIONS_PATH = "/api/v0/equity/positions";
/** Provider maximum. The default of 20 costs 2.5x the requests for the same history. */
const ORDER_HISTORY_PAGE_SIZE = 50;
const MAX_RATE_LIMIT_RETRIES = 3;
/** One order-history window is 60s; leave room for a reset timestamp plus clock skew. */
const MAX_RATE_LIMIT_WAIT_MS = 120_000;
/** Total time one sync may spend waiting out windows before it returns what it has. */
const MAX_RATE_LIMIT_TOTAL_WAIT_MS = 300_000;
const RATE_LIMIT_MARGIN_MS = 1_000;

/** Signals that the provider window, not the request, ended the sync. Carries the cooldown. */
class Trading212RateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("Trading 212 rate limit reached; the sync stopped early and resumes after the provider cooldown");
    this.retryAfterMs = retryAfterMs;
  }
}

function headerNumber(response: Response, name: string): number | null {
  const raw = response.headers.get(name)?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Trading 212 publishes `x-ratelimit-reset` as a Unix timestamp in seconds. */
function resetAtMs(response: Response): number | null {
  const reset = headerNumber(response, "x-ratelimit-reset");
  return reset === null ? null : reset * 1_000;
}

function rateLimitWaitMs(response: Response, retry: number): number {
  const retryAfter = response.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, MAX_RATE_LIMIT_WAIT_MS);
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) return Math.min(Math.max(0, timestamp - Date.now()), MAX_RATE_LIMIT_WAIT_MS);
  }
  // Trading 212 does not document or send Retry-After. `x-ratelimit-reset` is the
  // only header that states when the window actually reopens; blind exponential
  // backoff tops out at 7s against a 60s window and always gives up too early.
  const reset = resetAtMs(response);
  if (reset !== null) return Math.min(Math.max(0, reset - Date.now()) + RATE_LIMIT_MARGIN_MS, MAX_RATE_LIMIT_WAIT_MS);
  return Math.min(1_000 * (2 ** retry), MAX_RATE_LIMIT_WAIT_MS);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type RateLimiter = ReturnType<typeof createRateLimiter>;

/**
 * Paces requests against the per-endpoint budget Trading 212 reports on every
 * response, so a sync waits out a spent window instead of spending a request to
 * discover it is spent.
 */
function createRateLimiter() {
  const budgets = new Map<string, { remaining: number; resetAtMs: number }>();
  let totalWaitMs = 0;

  const sleep = async (milliseconds: number): Promise<void> => {
    if (milliseconds <= 0) return;
    if (totalWaitMs + milliseconds > MAX_RATE_LIMIT_TOTAL_WAIT_MS) throw new Trading212RateLimitError(milliseconds);
    totalWaitMs += milliseconds;
    await wait(milliseconds);
  };

  return {
    async reserve(path: string): Promise<void> {
      const budget = budgets.get(path);
      if (!budget || budget.remaining > 0) return;
      budgets.delete(path);
      await sleep(budget.resetAtMs - Date.now() + RATE_LIMIT_MARGIN_MS);
    },
    observe(path: string, response: Response): void {
      if (response.status === 429) return;
      const remaining = headerNumber(response, "x-ratelimit-remaining");
      const reset = resetAtMs(response);
      if (remaining === null || reset === null) return;
      budgets.set(path, { remaining, resetAtMs: reset });
    },
    sleep,
  };
}

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

function mapOrder(order: Trading212Order, entity: string): TradeWithoutId | null {
  const instrument = order.instrument && typeof order.instrument === "object" && !Array.isArray(order.instrument)
    ? order.instrument as Trading212Order
    : {};
  const get = (...keys: string[]) => value(order, ...keys) ?? value(instrument, ...keys);
  const symbol = String(get("ticker", "symbol") ?? "");
  if (!symbol) return null;
  const brokerTradeId = get("id", "orderId");
  const amount = nullableNumber(get("totalCost", "filledValue", "value", "amount"));
  const commission = nullableNumber(get("fees", "commission"));
  return {
    tenantId: LOCAL_TENANT_ID,
    entity,
    date: date(get("dateExecuted", "executedAt", "fillDate", "dateCreated", "createdAt")),
    symbol,
    ...(typeof get("isin") === "string" ? { isin: get("isin") as string } : {}),
    ...(typeof get("name", "description") === "string" ? { description: get("name", "description") as string } : {}),
    side: side(get("direction", "side")),
    quantity: number(get("filledQuantity", "quantity"), "quantity"),
    price: nullableNumber(get("fillPrice", "price")),
    amount,
    currency: String(get("currency", "currencyCode") ?? ""),
    commission,
    ...(brokerTradeId !== undefined && brokerTradeId !== null ? { brokerTradeId: String(brokerTradeId) } : {}),
  };
}

function mapPosition(raw: Trading212Order, entity: string): Position {
  // KNOWN GAP: the published schema names `averagePricePaid` and puts market
  // value under `walletImpact.currentValue`, so both come back null against a
  // real payload. The aliases below only cover the shape this adapter was
  // written against. See docs/investing/CONNECTORS.md, Trading 212 open items.
  const instrument = raw.instrument && typeof raw.instrument === "object" && !Array.isArray(raw.instrument)
    ? raw.instrument as Trading212Order
    : {};
  const get = (...keys: string[]) => value(raw, ...keys) ?? value(instrument, ...keys);
  const symbol = String(get("ticker", "symbol") ?? "");
  if (!symbol) throw new Error("Trading 212 position symbol is missing");
  return {
    tenantId: LOCAL_TENANT_ID,
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

function result(positions: Position[], trades: TradeWithoutId[], problems: string[], retryAfterMs: number | null): BrokerResult {
  return {
    positions,
    trades,
    source: SOURCE,
    problems,
    ...(retryAfterMs !== null ? { retryAfter: new Date(Date.now() + retryAfterMs).toISOString() } : {}),
  };
}

async function page(url: string, config: Trading212Config, limiter: RateLimiter): Promise<Trading212Page> {
  // Order history allows 6 requests per minute. `limiter` waits out a spent
  // window between cursors, so sync stays one sequential request per cursor.
  const response = await request(url, config, limiter);
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

async function request(url: string, config: Trading212Config, limiter: RateLimiter): Promise<Response> {
  const path = new URL(url).pathname;
  for (let retry = 0; ; retry += 1) {
    await limiter.reserve(path);
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`${config.token}:${config.secret}`).toString("base64")}` },
    });
    limiter.observe(path, response);
    if (response.status !== 429) return response;
    if (retry >= MAX_RATE_LIMIT_RETRIES) throw new Trading212RateLimitError(rateLimitWaitMs(response, retry));
    await limiter.sleep(rateLimitWaitMs(response, retry));
  }
}

async function positions(url: string, config: Trading212Config, limiter: RateLimiter): Promise<Trading212Positions> {
  const response = await request(url, config, limiter);
  if (!response.ok) throw new Error(`Trading 212 holdings request failed with HTTP ${response.status}`);
  const payload: unknown = await response.json();
  // The published schema returns a bare array. The envelope forms are kept as a
  // tolerated fallback; everything else becomes a visible problem.
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
      const limiter = createRateLimiter();
      let retryAfterMs: number | null = null;
      const noteRateLimit = (error: unknown) => {
        if (error instanceof Trading212RateLimitError) retryAfterMs = Math.max(retryAfterMs ?? 0, error.retryAfterMs);
      };
      const historyUrl = new URL(ORDER_HISTORY_PATH, config.baseUrl);
      historyUrl.searchParams.set("limit", String(ORDER_HISTORY_PAGE_SIZE));
      let nextUrl = historyUrl.toString();
      try {
        while (nextUrl) {
          const current = await page(nextUrl, config, limiter);
          for (const order of current.items) {
            try {
              const trade = mapOrder(order, entity);
              if (trade) trades.push(trade);
            } catch (error) {
              if (error instanceof Error && error.message !== "Trading 212 order symbol is missing") {
                problems.push(error.message);
              }
            }
          }
          nextUrl = current.nextPagePath ? new URL(current.nextPagePath, config.baseUrl).toString() : "";
        }
      } catch (error) {
        noteRateLimit(error);
        problems.push(error instanceof Error ? error.message : "Trading 212 sync failed");
      }
      try {
        // This equity endpoint is the shared read scope for Trading 212 Invest
        // and Stocks ISA accounts. Multi-currency accounts are outside the
        // connector contract; no order-capable endpoint is called here. It has
        // its own 1-per-second budget, so it still runs after a history cutoff.
        const holdingsUrl = new URL(POSITIONS_PATH, config.baseUrl).toString();
        for (const holding of await positions(holdingsUrl, config, limiter)) {
          try {
            positionsResult.push(mapPosition(holding, entity));
          } catch (error) {
            problems.push(error instanceof Error ? error.message : "Trading 212 holding is invalid");
          }
        }
      } catch (error) {
        noteRateLimit(error);
        problems.push(error instanceof Error ? error.message : "Trading 212 holdings sync failed");
      }
      return result(positionsResult, trades, problems, retryAfterMs);
    },
  };
}
