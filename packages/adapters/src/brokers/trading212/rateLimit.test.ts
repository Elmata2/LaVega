import { afterEach, expect, test, vi } from "vitest";
import { createTrading212Adapter } from "./adapter.js";

// Trading 212 publishes a numeric rate limit per endpoint in its OpenAPI
// description (https://docs.trading212.com/_spec/api.json):
//   GET /api/v0/equity/history/orders  ->  6 req / 1m0s, cursor paging, limit default 20 / max 50
//   GET /api/v0/equity/positions       ->  1 req / 1s
// Every response carries x-ratelimit-limit / -period / -remaining / -reset / -used.
// No Retry-After header is documented or sent.
const ORDER_HISTORY_LIMIT = 6;
const ORDER_HISTORY_PERIOD_MS = 60_000;
const POSITIONS_LIMIT = 1;
const POSITIONS_PERIOD_MS = 1_000;
const TOTAL_ORDERS = 150;

const START_MS = Date.parse("2026-08-19T12:00:00.000Z");

type Bucket = { limit: number; periodMs: number; start: number; used: number };

/**
 * Runs the adapter with a virtual clock: setTimeout fires on the next microtask
 * and advances Date.now() by its delay instead of waiting. A 60s provider
 * cooldown therefore costs no wall time, and the fake provider below sees the
 * same clock the adapter does.
 */
function withVirtualClock(): { restore: () => void; now: () => number } {
  let virtualNow = START_MS;
  const realSetTimeout = globalThis.setTimeout;
  const dateNow = vi.spyOn(Date, "now").mockImplementation(() => virtualNow);
  const stub = ((handler: () => void, delay?: number) => {
    virtualNow += delay ?? 0;
    queueMicrotask(handler);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof globalThis.setTimeout;
  globalThis.setTimeout = stub;
  return {
    now: () => virtualNow,
    restore: () => {
      globalThis.setTimeout = realSetTimeout;
      dateNow.mockRestore();
    },
  };
}

function order(index: number) {
  return {
    id: 900_000 + index,
    ticker: `SYM${index}_US_EQ`,
    direction: index % 2 === 0 ? "BUY" : "SELL",
    filledQuantity: 1,
    fillPrice: 10,
    totalCost: 10,
    currency: "EUR",
    dateExecuted: "2026-08-18T10:15:00Z",
    fees: 0.01,
  };
}

const holding = { ticker: "AAPL_US_EQ", isin: "US0378331005", name: "Apple Inc.", quantity: 3, averagePrice: 150.25, currentPrice: 175.5, marketValue: 526.5, currency: "USD", asOf: "2026-08-18T12:00:00Z" };

function fakeTrading212(totalOrders = TOTAL_ORDERS): { fetch: typeof globalThis.fetch; requests: string[]; rejections: number } {
  const orders = Array.from({ length: totalOrders }, (_, index) => order(index));
  const buckets = new Map<string, Bucket>([
    ["orders", { limit: ORDER_HISTORY_LIMIT, periodMs: ORDER_HISTORY_PERIOD_MS, start: START_MS, used: 0 }],
    ["positions", { limit: POSITIONS_LIMIT, periodMs: POSITIONS_PERIOD_MS, start: START_MS, used: 0 }],
  ]);
  const requests: string[] = [];
  const state = { rejections: 0 };

  const headers = (bucket: Bucket) => ({
    "x-ratelimit-limit": String(bucket.limit),
    "x-ratelimit-period": String(bucket.periodMs / 1_000),
    "x-ratelimit-remaining": String(Math.max(0, bucket.limit - bucket.used)),
    "x-ratelimit-reset": String(Math.ceil((bucket.start + bucket.periodMs) / 1_000)),
    "x-ratelimit-used": String(bucket.used),
  });

  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requests.push(`${url.pathname}${url.search}`);
    const name = url.pathname.endsWith("/positions") ? "positions" : "orders";
    const bucket = buckets.get(name)!;
    if (Date.now() - bucket.start >= bucket.periodMs) {
      bucket.start = Date.now();
      bucket.used = 0;
    }
    if (bucket.used >= bucket.limit) {
      state.rejections += 1;
      return new Response(JSON.stringify({ error: "Limited" }), { status: 429, headers: headers(bucket) });
    }
    bucket.used += 1;
    if (name === "positions") {
      return new Response(JSON.stringify([holding]), { status: 200, headers: { ...headers(bucket), "content-type": "application/json" } });
    }
    const size = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 50);
    const cursor = Number(url.searchParams.get("cursor") ?? 0) || 0;
    const items = orders.slice(cursor, cursor + size);
    const next = cursor + size < orders.length ? `/api/v0/equity/history/orders?limit=${size}&cursor=${cursor + size}` : null;
    return new Response(JSON.stringify({ items, nextPagePath: next }), { status: 200, headers: { ...headers(bucket), "content-type": "application/json" } });
  }) as typeof globalThis.fetch;

  return { fetch: fetchImpl, requests, get rejections() { return state.rejections; } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("full order history syncs within the published Trading 212 rate limits", async () => {
  const clock = withVirtualClock();
  const provider = fakeTrading212();
  vi.stubGlobal("fetch", provider.fetch);
  try {
    const result = await createTrading212Adapter({ token: "key", secret: "secret", baseUrl: "https://live.trading212.com" }).sync({ entity: "BV" });

    expect(result.problems).toEqual([]);
    expect(result.trades).toHaveLength(TOTAL_ORDERS);
    expect(result.positions).toHaveLength(1);
    // 150 orders at the provider maximum of 50 per page is 3 requests, well
    // inside the 6-per-minute window: no waiting, no rejection.
    expect(provider.requests.filter((path) => path.startsWith("/api/v0/equity/history/orders"))).toHaveLength(3);
    expect(clock.now()).toBe(START_MS);
  } finally {
    clock.restore();
  }
});

test("paces across windows instead of burning retries on rejected requests", async () => {
  const clock = withVirtualClock();
  // 400 orders is 8 pages, two order-history windows.
  const provider = fakeTrading212(400);
  vi.stubGlobal("fetch", provider.fetch);
  try {
    const result = await createTrading212Adapter({ token: "key", secret: "secret", baseUrl: "https://live.trading212.com" }).sync({ entity: "BV" });

    expect(result.problems).toEqual([]);
    expect(result.trades).toHaveLength(400);
    expect(result.retryAfter).toBeUndefined();
    // The budget headers say when the window reopens, so the sync waits it out
    // up front rather than spending a request to be told it is spent.
    expect(provider.rejections).toBe(0);
    expect(clock.now() - START_MS).toBeGreaterThanOrEqual(ORDER_HISTORY_PERIOD_MS);
  } finally {
    clock.restore();
  }
});

test("a sync too large for the wait budget reports retryAfter and keeps what it read", async () => {
  const clock = withVirtualClock();
  // 3000 orders is 60 pages, ten windows: past the 5-minute wait budget.
  const provider = fakeTrading212(3_000);
  vi.stubGlobal("fetch", provider.fetch);
  try {
    const result = await createTrading212Adapter({ token: "key", secret: "secret", baseUrl: "https://live.trading212.com" }).sync({ entity: "BV" });

    expect(result.problems).toEqual(["Trading 212 rate limit reached; the sync stopped early and resumes after the provider cooldown"]);
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades.length).toBeLessThan(3_000);
    expect(Date.parse(result.retryAfter!)).toBeGreaterThan(clock.now());
    // Holdings have their own budget, so they still come back.
    expect(result.positions).toHaveLength(1);
  } finally {
    clock.restore();
  }
});
