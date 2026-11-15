import { vi } from "vitest";

// Trading 212 publishes a numeric rate limit per endpoint in its OpenAPI
// description (https://docs.trading212.com/_spec/api.json):
//   GET /api/v0/equity/history/orders  ->  20 req / 1m0s, cursor paging, limit default 20 / max 50
//   GET /api/v0/equity/positions       ->  1 req / 1s
// Every response carries x-ratelimit-limit / -period / -remaining / -reset / -used.
// No Retry-After header is documented or sent.
//
// The fake provider below is deliberately stricter than that: 6 per window, so a
// guard that bursts the way the old per-sync limiter did is caught by a 429.
// Pacing now comes from the PartnerBudget: the table interval first, then the
// spacing `period / limit` the response headers state (10 s here).
export const ORDER_HISTORY_LIMIT = 6;
export const ORDER_HISTORY_PERIOD_MS = 60_000;
/** period / limit, as the headers state it */
export const ORDER_HISTORY_SPACING_MS = ORDER_HISTORY_PERIOD_MS / ORDER_HISTORY_LIMIT;
/** table interval of trading212:history-orders, used until a response is seen */
export const ORDER_HISTORY_TABLE_MS = 3_000;
export const POSITIONS_LIMIT = 1;
export const POSITIONS_PERIOD_MS = 1_000;
export const TOTAL_ORDERS = 150;

export const START_MS = Date.parse("2026-08-19T12:00:00.000Z");

type Bucket = { limit: number; periodMs: number; start: number; used: number };

/**
 * Runs the adapter with a virtual clock: setTimeout fires on the next microtask
 * and advances Date.now() by its delay instead of waiting. A 60s provider
 * cooldown therefore costs no wall time, and the fake provider below sees the
 * same clock the adapter does.
 */
export function withVirtualClock(): { restore: () => void; now: () => number } {
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

export function order(index: number) {
  return {
    fill: {
      id: 900_000 + index,
      filledAt: "2026-08-18T10:15:00Z",
      price: 10,
      quantity: 1,
      type: "TRADE",
    },
    order: {
      id: 800_000 + index,
      ticker: `SYM${index}_US_EQ`,
      side: index % 2 === 0 ? "BUY" : "SELL",
      currency: "EUR",
      instrument: {
        ticker: `SYM${index}_US_EQ`,
        isin: `US${String(index).padStart(10, "0")}`,
        name: `Symbol ${index}`,
        currency: "EUR",
      },
    },
  };
}

export const holding = {
  averagePricePaid: 150.25,
  createdAt: "2026-08-18T12:00:00Z",
  currentPrice: 175.5,
  instrument: {
    ticker: "AAPL_US_EQ",
    isin: "US0378331005",
    name: "Apple Inc.",
    currency: "USD",
  },
  quantity: 3,
  walletImpact: {
    currency: "USD",
    currentValue: 526.5,
  },
};

export function fakeTrading212(totalOrders = TOTAL_ORDERS): {
  fetch: typeof globalThis.fetch;
  requests: string[];
  /** Date.now() of each order-history request, on the test's virtual clock. */
  orderTimes: number[];
  rejections: number;
} {
  const orders = Array.from({ length: totalOrders }, (_, index) => order(index));
  const buckets = new Map<string, Bucket>([
    [
      "orders",
      { limit: ORDER_HISTORY_LIMIT, periodMs: ORDER_HISTORY_PERIOD_MS, start: START_MS, used: 0 },
    ],
    [
      "positions",
      { limit: POSITIONS_LIMIT, periodMs: POSITIONS_PERIOD_MS, start: START_MS, used: 0 },
    ],
  ]);
  const requests: string[] = [];
  const orderTimes: number[] = [];
  const state = { rejections: 0 };

  const headers = (bucket: Bucket) => ({
    "x-ratelimit-limit": String(bucket.limit),
    "x-ratelimit-period": String(bucket.periodMs / 1_000),
    "x-ratelimit-remaining": String(Math.max(0, bucket.limit - bucket.used)),
    "x-ratelimit-reset": String(Math.ceil((bucket.start + bucket.periodMs) / 1_000)),
    "x-ratelimit-used": String(bucket.used),
  });

  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    requests.push(`${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/account/summary")) {
      return new Response(
        JSON.stringify({
          currency: "EUR",
          cash: { availableToTrade: 0, inPies: 0, reservedForOrders: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (
      url.pathname.endsWith("/history/transactions") ||
      url.pathname.endsWith("/history/dividends")
    ) {
      return new Response(JSON.stringify({ items: [], nextPagePath: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const name = url.pathname.endsWith("/positions") ? "positions" : "orders";
    if (name === "orders") orderTimes.push(Date.now());
    const bucket = buckets.get(name)!;
    if (Date.now() - bucket.start >= bucket.periodMs) {
      bucket.start = Date.now();
      bucket.used = 0;
    }
    if (bucket.used >= bucket.limit) {
      state.rejections += 1;
      return new Response(JSON.stringify({ error: "Limited" }), {
        status: 429,
        headers: headers(bucket),
      });
    }
    bucket.used += 1;
    if (name === "positions") {
      return new Response(JSON.stringify([holding]), {
        status: 200,
        headers: { ...headers(bucket), "content-type": "application/json" },
      });
    }
    const size = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 50);
    const cursor = Number(url.searchParams.get("cursor") ?? 0) || 0;
    const items = orders.slice(cursor, cursor + size);
    const next =
      cursor + size < orders.length
        ? `/api/v0/equity/history/orders?limit=${size}&cursor=${cursor + size}`
        : null;
    return new Response(JSON.stringify({ items, nextPagePath: next }), {
      status: 200,
      headers: { ...headers(bucket), "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  return {
    fetch: fetchImpl,
    requests,
    orderTimes,
    get rejections() {
      return state.rejections;
    },
  };
}
