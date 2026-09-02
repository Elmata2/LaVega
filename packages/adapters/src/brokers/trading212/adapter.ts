import {
  type CashBalance,
  type CashFlow,
  type CashFlowKind,
  type Dividend,
  type Position,
  type TradeSide,
  type TradeWithoutId,
} from "@lavega/core";
import { historyPending, type BrokerAccessAdapter, type BrokerResult, type BrokerSyncResume } from "../BrokerAccessAdapter.js";

export type Trading212Config = {
  token: string;
  secret: string;
  baseUrl: string;
  diagnostics?: (event: Trading212DiagnosticEvent) => void;
  /**
   * Stop before this Unix ms so the host can persist. On Vercel the function
   * otherwise dies mid-history and the next invocation restarts page one.
   */
  deadlineMs?: number;
  resume?: BrokerSyncResume;
};

export type Trading212DiagnosticEvent =
  | { type: "response"; endpoint: string; attempt: number; status: number; limit: number | null; remaining: number | null; resetAt: string | null }
  | { type: "wait"; endpoint: string; reason: "budget-exhausted" | "http-429"; waitMs: number }
  | { type: "history-page"; page: number; pageItems: number; ordersRead: number; hasNext: boolean }
  | { type: "cash-history-page"; history: "transactions" | "dividends"; page: number; pageItems: number; hasNext: boolean }
  | { type: "positions"; count: number };

type Trading212Order = Record<string, unknown>;
type Trading212Page = { items: Trading212Order[]; nextPagePath?: string };
type Trading212Positions = Trading212Order[];

const SOURCE = "trading-212";
const ORDER_HISTORY_PATH = "/api/v0/equity/history/orders";
const POSITIONS_PATH = "/api/v0/equity/positions";
const ACCOUNT_SUMMARY_PATH = "/api/v0/equity/account/summary";
const TRANSACTIONS_PATH = "/api/v0/equity/history/transactions";
const DIVIDENDS_PATH = "/api/v0/equity/history/dividends";
/** Provider maximum. The default of 20 costs 2.5x the requests for the same history. */
const ORDER_HISTORY_PAGE_SIZE = 50;
const CASH_HISTORY_PAGE_SIZE = 50;
const MAX_RATE_LIMIT_RETRIES = 3;
/** One order-history window is 60s; leave room for a reset timestamp plus clock skew. */
const MAX_RATE_LIMIT_WAIT_MS = 120_000;
const RATE_LIMIT_MARGIN_MS = 1_000;
/** Leave time to persist the snapshot and answer the HTTP request. */
const HOST_DEADLINE_MARGIN_MS = 5_000;
const HOST_DEADLINE_MESSAGE = "Trading 212 sync paused before the host time limit; remaining history resumes on the next run";
const RATE_LIMIT_MESSAGE = "Trading 212 rate limit reached; the sync stopped early and resumes after the provider cooldown";

/** Signals that the provider window or the host time limit ended the sync. Carries the cooldown. */
class Trading212SyncPausedError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

class Trading212RateLimitError extends Trading212SyncPausedError {
  constructor(retryAfterMs: number) {
    super(RATE_LIMIT_MESSAGE, retryAfterMs);
  }
}

function throwIfHostDeadline(deadlineMs: number | undefined, waitMs = 0): void {
  if (deadlineMs === undefined) return;
  const remaining = deadlineMs - Date.now();
  if (remaining - HOST_DEADLINE_MARGIN_MS > waitMs) return;
  throw new Trading212SyncPausedError(HOST_DEADLINE_MESSAGE, Math.max(0, waitMs));
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
function createRateLimiter(diagnostics: (event: Trading212DiagnosticEvent) => void, deadlineMs?: number) {
  const budgets = new Map<string, { remaining: number; resetAtMs: number }>();

  const sleep = async (milliseconds: number): Promise<void> => {
    if (milliseconds <= 0) return;
    await wait(milliseconds);
  };

  return {
    async reserve(path: string): Promise<void> {
      const budget = budgets.get(path);
      if (!budget || budget.remaining > 0) return;
      budgets.delete(path);
      const waitMs = Math.max(0, budget.resetAtMs - Date.now() + RATE_LIMIT_MARGIN_MS);
      throwIfHostDeadline(deadlineMs, waitMs);
      diagnostics({ type: "wait", endpoint: path, reason: "budget-exhausted", waitMs });
      await sleep(waitMs);
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

function object(valueToParse: unknown, field: string): Trading212Order {
  if (!valueToParse || typeof valueToParse !== "object" || Array.isArray(valueToParse)) {
    throw new Error(`Trading 212 ${field} is missing or invalid`);
  }
  return valueToParse as Trading212Order;
}

function optionalObject(valueToParse: unknown, field: string): Trading212Order | null {
  if (valueToParse === undefined || valueToParse === null) return null;
  return object(valueToParse, field);
}

function string(valueToParse: unknown, field: string): string {
  if (typeof valueToParse !== "string" || !valueToParse) throw new Error(`Trading 212 ${field} is missing or invalid`);
  return valueToParse;
}

function optionalString(valueToParse: unknown): string | undefined {
  return typeof valueToParse === "string" && valueToParse ? valueToParse : undefined;
}

function number(valueToParse: unknown, field: string): number {
  const parsed = Number(valueToParse);
  if (!Number.isFinite(parsed)) throw new Error(`Trading 212 ${field} is missing or invalid`);
  return parsed;
}

function date(valueToParse: unknown, field: string): string {
  const raw = String(valueToParse ?? "");
  const parsed = new Date(raw);
  if (!raw || Number.isNaN(parsed.getTime())) throw new Error(`Trading 212 ${field} is missing or invalid`);
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

function stableId(entity: string, kind: "cash" | "dividend", reference: string): string {
  return `trading212:${encodeURIComponent(entity)}:${kind}:${reference}`;
}

function mapCashBalance(raw: Trading212Order, entity: string, asOf: string): { balance: CashBalance | null; problems: string[] } {
  const cash = object(raw.cash, "account summary cash");
  const currency = string(raw.currency, "account summary currency");
  const available = number(cash.availableToTrade, "account summary available cash");
  // Live verification (#88): accounts with pie investments always report a
  // non-zero inPies, and pending orders set reservedForOrders. Both are cash
  // the owner still holds, so they count toward the balance instead of
  // discarding the record. pieCash on /account/cash is the same pie money.
  return {
    balance: { entity, broker: "trading212", currency, amount: available + (nullableNumber(cash.inPies) ?? 0) + (nullableNumber(cash.reservedForOrders) ?? 0), asOf },
    problems: [],
  };
}

function transactionKind(type: string): CashFlowKind | null {
  switch (type) {
    case "DEPOSIT": return "deposit";
    case "WITHDRAW": return "withdrawal";
    case "FEE": return "fee";
    case "INTEREST_ON_FREE_CASH":
    case "LENDING_INTEREST": return "interest";
    case "TRANSFER": return null;
    default: return "other";
  }
}

function mapTransaction(raw: Trading212Order, entity: string, accountCurrency: string): { flow: CashFlow | null; problem?: string } {
  const reference = string(raw.reference, "transaction reference");
  const sourceType = string(raw.type, "transaction type").toUpperCase();
  const kind = transactionKind(sourceType);
  if (kind === null) {
    return { flow: null, problem: `Trading 212 transaction ${reference} has ambiguous TRANSFER direction` };
  }
  const sourceAmount = number(raw.amount, "transaction amount");
  const amount = sourceAmount < 0
    ? sourceAmount
    : kind === "withdrawal" || kind === "fee"
      ? -sourceAmount
      : sourceAmount;
  const currency = string(raw.currency ?? accountCurrency, "transaction currency");
  const flow: CashFlow = {
    id: stableId(entity, "cash", reference),
    entity,
    broker: "trading212",
    date: date(raw.dateTime, "transaction date"),
    currency,
    amount,
    kind,
    description: `Trading 212 ${sourceType}`,
    brokerFlowId: reference,
  };
  return sourceType === "DEPOSIT" || sourceType === "WITHDRAW" || sourceType === "FEE" || sourceType === "INTEREST_ON_FREE_CASH" || sourceType === "LENDING_INTEREST"
    ? { flow }
    : { flow, problem: `Trading 212 transaction ${reference} has unknown type ${sourceType}; provider sign was preserved` };
}

function mapDividend(raw: Trading212Order, entity: string, accountCurrency: string): Dividend {
  const reference = string(raw.reference, "dividend reference");
  const instrument = optionalObject(raw.instrument, "dividend instrument") ?? {};
  const symbol = string(raw.ticker ?? instrument.ticker, "dividend ticker");
  const isin = optionalString(instrument.isin);
  const name = optionalString(instrument.name);
  const sourceType = optionalString(raw.type);
  return {
    id: stableId(entity, "dividend", reference),
    entity,
    broker: "trading212",
    date: date(raw.paidOn, "dividend date"),
    symbol,
    ...(isin ? { isin } : {}),
    ...((name || sourceType) ? { description: [name, sourceType && `Trading 212 ${sourceType}`].filter(Boolean).join(" — ") } : {}),
    amount: Math.abs(number(raw.amount, "dividend amount")),
    currency: string(raw.currency ?? accountCurrency, "dividend currency"),
    brokerDividendId: reference,
  };
}

function basicAuth(token: string, secret: string): string {
  return `Basic ${globalThis.btoa(`${token}:${secret}`)}`;
}

function mapOrder(historyOrder: Trading212Order, entity: string): TradeWithoutId | null {
  // Pending and cancelled orders legitimately have no fill yet; they are not
  // executed trades and must not fail the whole history sync. That skip only
  // applies to rows that carry the order envelope: a row without one is not a
  // Trading 212 order at all, and swallowing it turns a changed provider schema
  // into a silent empty sync.
  const envelope = optionalObject(historyOrder.order, "historical order");
  if (envelope && (!historyOrder.fill || typeof historyOrder.fill !== "object" || Array.isArray(historyOrder.fill))) return null;
  const fill = object(historyOrder.fill, "historical order fill");
  if (value(fill, "type") !== "TRADE") return null;
  const order = envelope ?? object(historyOrder.order, "historical order");
  const instrument = optionalObject(order.instrument, "historical order instrument") ?? {};
  const symbol = string(value(order, "ticker") ?? value(instrument, "ticker"), "order symbol");
  const fillPrice = number(fill.price, "order fill price");
  // Trading 212 reports sell fills as negative quantities; the trade model
  // carries direction in `side`, so magnitudes stay positive.
  const fillQuantity = Math.abs(number(fill.quantity, "order fill quantity"));
  const brokerTradeId = value(fill, "id") ?? value(order, "id");
  const walletImpact = optionalObject(fill.walletImpact, "order fill wallet impact");
  const isin = optionalString(value(instrument, "isin"));
  const description = optionalString(value(instrument, "name"));
  const commission = walletImpact && Array.isArray(walletImpact.taxes)
    ? walletImpact.taxes.reduce((total, tax) => {
        if (!tax || typeof tax !== "object" || Array.isArray(tax)) return total;
        return total + (nullableNumber((tax as Trading212Order).fillAmount) ?? 0);
      }, 0)
    : null;
  return {
    entity,
    date: date(fill.filledAt, "order fill date"),
    symbol,
    ...(isin ? { isin } : {}),
    ...(description ? { description } : {}),
    side: side(order.side),
    quantity: fillQuantity,
    price: fillPrice,
    amount: fillPrice * fillQuantity,
    currency: string(value(instrument, "currency") ?? order.currency, "order currency"),
    commission,
    ...(brokerTradeId !== undefined && brokerTradeId !== null ? { brokerTradeId: String(brokerTradeId) } : {}),
  };
}

function mapPosition(raw: Trading212Order, entity: string): Position {
  const instrument = object(raw.instrument, "position instrument");
  const walletImpact = optionalObject(raw.walletImpact, "position wallet impact");
  const symbol = string(instrument.ticker, "position symbol");
  const isin = optionalString(instrument.isin);
  const description = optionalString(instrument.name);
  return {
    entity,
    symbol,
    ...(isin ? { isin } : {}),
    ...(description ? { description } : {}),
    quantity: number(raw.quantity, "position quantity"),
    averagePrice: nullableNumber(raw.averagePricePaid),
    marketPrice: nullableNumber(raw.currentPrice),
    marketValue: walletImpact ? nullableNumber(walletImpact.currentValue) : null,
    currency: string(instrument.currency ?? walletImpact?.currency, "position currency"),
    asOf: date(raw.createdAt ?? new Date().toISOString(), "position date"),
  };
}

function result(
  positions: Position[],
  trades: TradeWithoutId[],
  dividends: Dividend[],
  cashBalances: CashBalance[],
  cashFlows: CashFlow[],
  problems: string[],
  retryAfterMs: number | null,
  tradesComplete = true,
  resume?: BrokerSyncResume,
  completeness?: { positionsComplete?: boolean; cashBalancesComplete?: boolean },
): BrokerResult {
  return {
    positions,
    trades,
    dividends,
    cashBalances,
    cashFlows,
    source: SOURCE,
    problems,
    tradesComplete,
    ...(completeness?.positionsComplete === false ? { positionsComplete: false } : {}),
    ...(completeness?.cashBalancesComplete === false ? { cashBalancesComplete: false } : {}),
    ...(retryAfterMs !== null ? { retryAfter: new Date(Date.now() + retryAfterMs).toISOString() } : {}),
    ...(historyPending(resume) ? { resume } : {}),
  };
}

async function accountSummary(url: string, config: Trading212Config, limiter: RateLimiter): Promise<Trading212Order> {
  const response = await request(url, config, limiter);
  if (!response.ok) throw new Error(`Trading 212 account-summary request failed with HTTP ${response.status}`);
  const payload: unknown = await response.json().catch(() => { throw new Error(`Trading 212 response from ${new URL(response.url).pathname} is not valid JSON`); });
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Trading 212 account-summary response is malformed");
  }
  return payload as Trading212Order;
}

async function historyPage(url: string, label: "transaction" | "dividend", config: Trading212Config, limiter: RateLimiter): Promise<Trading212Page> {
  const response = await request(url, config, limiter);
  if (!response.ok) throw new Error(`Trading 212 ${label}-history request failed with HTTP ${response.status}`);
  const payload: unknown = await response.json().catch(() => { throw new Error(`Trading 212 response from ${new URL(response.url).pathname} is not valid JSON`); });
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { items?: unknown }).items)) {
    throw new Error(`Trading 212 ${label}-history response is malformed`);
  }
  const data = payload as { items: unknown[]; nextPagePath?: unknown };
  if (!data.items.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))) {
    throw new Error(`Trading 212 ${label}-history items are malformed`);
  }
  if (data.nextPagePath !== undefined && data.nextPagePath !== null && typeof data.nextPagePath !== "string") {
    throw new Error(`Trading 212 ${label}-history nextPagePath is malformed`);
  }
  return {
    items: data.items as Trading212Order[],
    ...(typeof data.nextPagePath === "string" && data.nextPagePath ? { nextPagePath: data.nextPagePath } : {}),
  };
}

async function page(url: string, config: Trading212Config, limiter: RateLimiter): Promise<Trading212Page> {
  // Order history allows 6 requests per minute. `limiter` waits out a spent
  // window between cursors, so sync stays one sequential request per cursor.
  const response = await request(url, config, limiter);
  if (!response.ok) throw new Error(`Trading 212 request failed with HTTP ${response.status}`);
  const payload: unknown = await response.json().catch(() => { throw new Error(`Trading 212 response from ${new URL(response.url).pathname} is not valid JSON`); });
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
      headers: { Authorization: basicAuth(config.token, config.secret) },
    });
    const reset = resetAtMs(response);
    config.diagnostics?.({
      type: "response",
      endpoint: path,
      attempt: retry + 1,
      status: response.status,
      limit: headerNumber(response, "x-ratelimit-limit"),
      remaining: headerNumber(response, "x-ratelimit-remaining"),
      resetAt: reset === null ? null : new Date(reset).toISOString(),
    });
    limiter.observe(path, response);
    if (response.status !== 429) return response;
    if (retry >= MAX_RATE_LIMIT_RETRIES) throw new Trading212RateLimitError(rateLimitWaitMs(response, retry));
    const waitMs = rateLimitWaitMs(response, retry);
    throwIfHostDeadline(config.deadlineMs, waitMs);
    config.diagnostics?.({ type: "wait", endpoint: path, reason: "http-429", waitMs });
    await limiter.sleep(waitMs);
  }
}

async function positions(url: string, config: Trading212Config, limiter: RateLimiter): Promise<Trading212Positions> {
  const response = await request(url, config, limiter);
  if (!response.ok) throw new Error(`Trading 212 holdings request failed with HTTP ${response.status}`);
  const payload: unknown = await response.json().catch(() => { throw new Error(`Trading 212 response from ${new URL(response.url).pathname} is not valid JSON`); });
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
    async sync({ entity, resume: inputResume }) {
      const resume = inputResume ?? config.resume ?? {};
      const positionsResult: Position[] = [];
      const trades: TradeWithoutId[] = [];
      const dividends: Dividend[] = [];
      const cashBalances: CashBalance[] = [];
      const cashFlows: CashFlow[] = [];
      const problems: string[] = [];
      const limiter = createRateLimiter(config.diagnostics ?? (() => undefined), config.deadlineMs);
      let retryAfterMs: number | null = null;
      const notePaused = (error: unknown) => {
        if (error instanceof Trading212SyncPausedError) retryAfterMs = Math.max(retryAfterMs ?? 0, error.retryAfterMs);
      };
      const firstHistoryUrl = () => {
        const historyUrl = new URL(ORDER_HISTORY_PATH, config.baseUrl);
        historyUrl.searchParams.set("limit", String(ORDER_HISTORY_PAGE_SIZE));
        return historyUrl.toString();
      };
      const firstCashUrl = (path: string) => {
        const url = new URL(path, config.baseUrl);
        url.searchParams.set("limit", String(CASH_HISTORY_PAGE_SIZE));
        return url.toString();
      };
      let ordersComplete = resume.ordersComplete === true;
      let transactionsComplete = resume.transactionsComplete === true;
      let dividendsComplete = resume.dividendsComplete === true;
      let ordersResume = !ordersComplete ? (resume.ordersNextPagePath ?? firstHistoryUrl()) : undefined;
      let transactionsResume = !transactionsComplete ? (resume.transactionsNextPagePath ?? undefined) : undefined;
      let dividendsResume = !dividendsComplete ? (resume.dividendsNextPagePath ?? undefined) : undefined;
      let holdingsComplete = false;
      let summaryComplete = false;

      try {
        throwIfHostDeadline(config.deadlineMs, 0);
        // Holdings and cash are one request each. Read them before order
        // history so a host time limit still leaves the dashboard something
        // current to show.
        const holdingsUrl = new URL(POSITIONS_PATH, config.baseUrl).toString();
        const holdings = await positions(holdingsUrl, config, limiter);
        holdingsComplete = true;
        config.diagnostics?.({ type: "positions", count: holdings.length });
        for (const holding of holdings) {
          try {
            positionsResult.push(mapPosition(holding, entity));
          } catch (error) {
            problems.push(error instanceof Error ? error.message : "Trading 212 holding is invalid");
          }
        }
      } catch (error) {
        notePaused(error);
        problems.push(error instanceof Error ? error.message : "Trading 212 holdings sync failed");
      }

      let accountCurrency = "";
      try {
        throwIfHostDeadline(config.deadlineMs, 0);
        const summary = await accountSummary(new URL(ACCOUNT_SUMMARY_PATH, config.baseUrl).toString(), config, limiter);
        summaryComplete = true;
        accountCurrency = string(summary.currency, "account summary currency");
        const mapped = mapCashBalance(summary, entity, new Date().toISOString().slice(0, 10));
        if (mapped.balance) cashBalances.push(mapped.balance);
        problems.push(...mapped.problems);
      } catch (error) {
        notePaused(error);
        problems.push(error instanceof Error ? error.message : "Trading 212 account-summary sync failed");
      }

      let historyComplete = ordersComplete;
      if (!ordersComplete) {
        let nextUrl = ordersResume ?? firstHistoryUrl();
        let historyPages = 0;
        let ordersRead = 0;
        try {
          while (nextUrl) {
            throwIfHostDeadline(config.deadlineMs, 0);
            const current = await page(nextUrl, config, limiter);
            historyPages += 1;
            ordersRead += current.items.length;
            config.diagnostics?.({ type: "history-page", page: historyPages, pageItems: current.items.length, ordersRead, hasNext: Boolean(current.nextPagePath) });
            for (const order of current.items) {
              try {
                const trade = mapOrder(order, entity);
                if (trade) trades.push(trade);
              } catch (error) {
                problems.push(error instanceof Error ? error.message : "Trading 212 order is invalid");
              }
            }
            nextUrl = current.nextPagePath ? new URL(current.nextPagePath, config.baseUrl).toString() : "";
          }
          ordersComplete = true;
          historyComplete = true;
          ordersResume = undefined;
        } catch (error) {
          historyComplete = false;
          ordersComplete = false;
          ordersResume = nextUrl || firstHistoryUrl();
          notePaused(error);
          problems.push(error instanceof Error ? error.message : "Trading 212 sync failed");
        }
      }

      const readCashHistory = async (history: "transactions" | "dividends") => {
        const path = history === "transactions" ? TRANSACTIONS_PATH : DIVIDENDS_PATH;
        const seenPaths = new Set<string>();
        const seenReferences = new Set<string>();
        const stored = history === "transactions" ? transactionsResume : dividendsResume;
        let nextUrl = stored ?? firstCashUrl(path);
        let pageNumber = 0;
        try {
          while (nextUrl) {
            throwIfHostDeadline(config.deadlineMs, 0);
            if (seenPaths.has(nextUrl)) throw new Error(`Trading 212 ${history} pagination repeated nextPagePath`);
            seenPaths.add(nextUrl);
            const current = await historyPage(nextUrl, history === "transactions" ? "transaction" : "dividend", config, limiter);
            pageNumber += 1;
            config.diagnostics?.({ type: "cash-history-page", history, page: pageNumber, pageItems: current.items.length, hasNext: Boolean(current.nextPagePath) });
            for (const row of current.items) {
              try {
                const reference = string(row.reference, `${history === "transactions" ? "transaction" : "dividend"} reference`);
                if (seenReferences.has(reference)) continue;
                seenReferences.add(reference);
                if (history === "transactions") {
                  const mapped = mapTransaction(row, entity, accountCurrency);
                  if (mapped.flow) cashFlows.push(mapped.flow);
                  if (mapped.problem) problems.push(mapped.problem);
                } else {
                  dividends.push(mapDividend(row, entity, accountCurrency));
                }
              } catch (error) {
                problems.push(error instanceof Error ? error.message : `Trading 212 ${history} row is invalid`);
              }
            }
            nextUrl = current.nextPagePath ? new URL(current.nextPagePath, config.baseUrl).toString() : "";
          }
        } catch (error) {
          if (history === "transactions") transactionsResume = nextUrl || firstCashUrl(path);
          else dividendsResume = nextUrl || firstCashUrl(path);
          throw error;
        }
      };

      // Cash history waits until order history is done so a resumed run does
      // not spend the 6/min budget on a second stream while trades are incomplete.
      if (ordersComplete) {
        for (const history of ["transactions", "dividends"] as const) {
          const alreadyDone = history === "transactions" ? transactionsComplete : dividendsComplete;
          if (alreadyDone) continue;
          try {
            await readCashHistory(history);
            if (history === "transactions") {
              transactionsComplete = true;
              transactionsResume = undefined;
            } else {
              dividendsComplete = true;
              dividendsResume = undefined;
            }
          } catch (error) {
            notePaused(error);
            problems.push(error instanceof Error ? error.message : `Trading 212 ${history} sync failed`);
          }
        }
      }

      const nextResume: BrokerSyncResume = {
        ...(ordersComplete ? { ordersComplete: true } : ordersResume ? { ordersNextPagePath: ordersResume } : {}),
        ...(transactionsComplete ? { transactionsComplete: true } : transactionsResume ? { transactionsNextPagePath: transactionsResume } : {}),
        ...(dividendsComplete ? { dividendsComplete: true } : dividendsResume ? { dividendsNextPagePath: dividendsResume } : {}),
      };
      return result(positionsResult, trades, dividends, cashBalances, cashFlows, problems, retryAfterMs, historyComplete, nextResume, {
        positionsComplete: holdingsComplete,
        cashBalancesComplete: summaryComplete,
      });
    },
  };
}
