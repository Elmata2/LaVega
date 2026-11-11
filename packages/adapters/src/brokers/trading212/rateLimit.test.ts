import { afterEach, expect, test, vi } from "vitest";
import { createTrading212Adapter } from "./adapter.js";
import {
  ORDER_HISTORY_PERIOD_MS,
  ORDER_HISTORY_SPACING_MS,
  ORDER_HISTORY_TABLE_MS,
  START_MS,
  TOTAL_ORDERS,
  fakeTrading212,
  withVirtualClock,
} from "./testProvider.js";

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
    expect(result.sections.trades.rows).toHaveLength(TOTAL_ORDERS);
    expect(result.sections.positions.rows).toHaveLength(1);
    // 150 orders at the provider maximum of 50 per page is 3 requests. The
    // first goes out at once, the second after the table interval (nothing was
    // seen yet), the third one header-stated spacing after that.
    expect(
      provider.requests.filter((path) => path.startsWith("/api/v0/equity/history/orders")),
    ).toHaveLength(3);
    expect(provider.rejections).toBe(0);
    expect(clock.now()).toBe(START_MS + ORDER_HISTORY_TABLE_MS + ORDER_HISTORY_SPACING_MS);
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
    expect(result.sections.trades.rows).toHaveLength(400);
    expect(result.retryAfter).toBeUndefined();
    // The budget headers say when the window reopens, so the sync waits it out
    // up front rather than spending a request to be told it is spent.
    expect(provider.rejections).toBe(0);
    expect(clock.now() - START_MS).toBeGreaterThanOrEqual(ORDER_HISTORY_PERIOD_MS);
    // Never more than the window allows: any 6 consecutive order pages span a
    // full window, which is what even pacing at period / limit gives.
    const times = provider.orderTimes;
    expect(times).toHaveLength(8);
    for (let index = 2; index < times.length; index += 1) {
      expect(times[index]! - times[index - 1]!).toBeGreaterThanOrEqual(ORDER_HISTORY_SPACING_MS);
    }
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
    expect(result.sections.trades.rows).toHaveLength(3_000);
    expect(result.retryAfter).toBeUndefined();
    expect(clock.now() - START_MS).toBeGreaterThan(5 * 60_000);
    expect(result.sections.positions.rows).toHaveLength(1);
  } finally {
    clock.restore();
  }
});

test("a host deadline stops before a slot that falls after it and leaves a resume cursor", async () => {
  const clock = withVirtualClock();
  const provider = fakeTrading212(400);
  vi.stubGlobal("fetch", provider.fetch);
  try {
    const result = await createTrading212Adapter({
      token: "key",
      secret: "secret",
      baseUrl: "https://live.trading212.com",
    }).sync({ entity: "BV", deadlineMs: START_MS + 10_000 });

    // Page 1 goes out at once and page 2 at +3 s. Page 3's slot is +13 s, after
    // the deadline minus one second (+9 s), so no request is sent for it.
    expect(result.sections.trades.status).toBe("partial");
    expect(result.sections.trades.rows).toHaveLength(100);
    expect(result.sections.positions.rows).toHaveLength(1);
    expect(result.resume?.ordersNextPagePath).toContain("cursor=100");
    expect(result.problems).toEqual(
      expect.arrayContaining([
        "Trading 212 sync paused before the host time limit; remaining history resumes on the next run",
      ]),
    );
    expect(result.retryAfter).toBe(
      new Date(START_MS + ORDER_HISTORY_TABLE_MS + ORDER_HISTORY_SPACING_MS).toISOString(),
    );
    expect(clock.now()).toBe(START_MS + ORDER_HISTORY_TABLE_MS);
    expect(
      provider.requests.filter((path) => path.startsWith("/api/v0/equity/history/orders")),
    ).toHaveLength(2);
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
    }).sync({ entity: "BV", deadlineMs: START_MS + 10_000 });
    const second = await createTrading212Adapter({
      token: "key",
      secret: "secret",
      baseUrl: "https://live.trading212.com",
    }).sync({ entity: "BV", resume: first.resume });

    expect(second.sections.trades.rows).toHaveLength(300);
    expect(second.sections.trades.status).toBe("complete");
    expect(second.resume).toBeUndefined();
    expect(second.problems).toEqual([]);
  } finally {
    clock.restore();
  }
});
