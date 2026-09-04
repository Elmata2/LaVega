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

const holding = {
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

function fakeTrading212(totalOrders = TOTAL_ORDERS): {
  fetch: typeof globalThis.fetch;
  requests: string[];
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
    get rejections() {
      return state.rejections;
    },
  };
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
    const result = await createTrading212Adapter({
      token: "key",
      secret: "secret",
      baseUrl: "https://live.trading212.com",
    }).sync({ entity: "BV" });

    expect(result.problems).toEqual([]);
    expect(result.trades).toHaveLength(TOTAL_ORDERS);
    expect(result.positions).toHaveLength(1);
    // 150 orders at the provider maximum of 50 per page is 3 requests, well
    // inside the 6-per-minute window: no waiting, no rejection.
    expect(
      provider.requests.filter((path) => path.startsWith("/api/v0/equity/history/orders")),
    ).toHaveLength(3);
    expect(clock.now()).toBe(START_MS);
  } finally {
    clock.restore();
  }
});

test("paces across windows instead of burning retries on rejected requests", async () => {
  const clock = withVirtualClock();
  // 400 orders is 8 pages, two order-history windows.
  const provider = fakeTrading212(400);
  const diagnostics = vi.fn();
  vi.stubGlobal("fetch", provider.fetch);
  try {
    const result = await createTrading212Adapter({
      token: "key",
      secret: "secret",
      baseUrl: "https://live.trading212.com",
      diagnostics,
    }).sync({ entity: "BV" });

    expect(result.problems).toEqual([]);
    expect(result.trades).toHaveLength(400);
    expect(result.retryAfter).toBeUndefined();
    // The budget headers say when the window reopens, so the sync waits it out
    // up front rather than spending a request to be told it is spent.
    expect(provider.rejections).toBe(0);
    expect(clock.now() - START_MS).toBeGreaterThanOrEqual(ORDER_HISTORY_PERIOD_MS);
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "wait",
        endpoint: "/api/v0/equity/history/orders",
        reason: "budget-exhausted",
      }),
    );
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "response",
        endpoint: "/api/v0/equity/history/orders",
        status: 200,
        remaining: 0,
      }),
    );
  } finally {
    clock.restore();
  }
});

test("large order history continues across every required provider window", async () => {
  const clock = withVirtualClock();
  // 3000 orders is 60 pages across ten provider windows. Initial sync must
  // finish instead of restarting from page one forever after a local cutoff.
  const provider = fakeTrading212(3_000);
  vi.stubGlobal("fetch", provider.fetch);
  try {
    const result = await createTrading212Adapter({
      token: "key",
      secret: "secret",
      baseUrl: "https://live.trading212.com",
    }).sync({ entity: "BV" });

    expect(result.problems).toEqual([]);
    expect(result.trades).toHaveLength(3_000);
    expect(result.retryAfter).toBeUndefined();
    expect(clock.now() - START_MS).toBeGreaterThan(5 * 60_000);
    expect(result.positions).toHaveLength(1);
  } finally {
    clock.restore();
  }
});

test("a host deadline stops before the rate-limit wait and leaves a resume cursor", async () => {
  const clock = withVirtualClock();
  const provider = fakeTrading212(400);
  vi.stubGlobal("fetch", provider.fetch);
  try {
    const result = await createTrading212Adapter({
      token: "key",
      secret: "secret",
      baseUrl: "https://live.trading212.com",
      deadlineMs: START_MS + 10_000,
    }).sync({ entity: "BV" });

    expect(result.tradesComplete).toBe(false);
    expect(result.trades).toHaveLength(300);
    expect(result.positions).toHaveLength(1);
    expect(result.resume?.ordersNextPagePath).toContain("cursor=300");
    expect(result.problems).toEqual(
      expect.arrayContaining([
        "Trading 212 sync paused before the host time limit; remaining history resumes on the next run",
      ]),
    );
    expect(result.retryAfter).toBeDefined();
    expect(clock.now()).toBe(START_MS);
    expect(
      provider.requests.filter((path) => path.startsWith("/api/v0/equity/history/orders")),
    ).toHaveLength(6);
  } finally {
    clock.restore();
  }
});

test("a resumed sync continues from the stored cursor and finishes the history", async () => {
  const clock = withVirtualClock();
  const provider = fakeTrading212(400);
  vi.stubGlobal("fetch", provider.fetch);
  try {
    const first = await createTrading212Adapter({
      token: "key",
      secret: "secret",
      baseUrl: "https://live.trading212.com",
      deadlineMs: START_MS + 10_000,
    }).sync({ entity: "BV" });
    const second = await createTrading212Adapter({
      token: "key",
      secret: "secret",
      baseUrl: "https://live.trading212.com",
    }).sync({ entity: "BV", resume: first.resume });

    expect(second.trades).toHaveLength(100);
    expect(second.tradesComplete).toBe(true);
    expect(second.resume).toBeUndefined();
    expect(second.problems).toEqual([]);
  } finally {
    clock.restore();
  }
});
