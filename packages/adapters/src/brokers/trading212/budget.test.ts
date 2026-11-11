import { DateTime } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import {
  createFailingPartnerBudget,
  createImmediatePartnerBudget,
} from "../../partnerBudget/fakes.js";
import {
  PartnerBudgetUnavailable,
  createMemoryPartnerBudgetClient,
  type PartnerSeen,
} from "../../partnerBudget/PartnerBudget.js";
import { createMemoryBrokerSyncStateStore, syncScheduledBrokers } from "../scheduledSync.js";
import { createTrading212Adapter } from "./adapter.js";
import {
  ORDER_HISTORY_TABLE_MS,
  START_MS,
  fakeTrading212,
  holding,
  order,
  withVirtualClock,
} from "./testProvider.js";

/* How the Trading 212 adapter uses the PartnerBudget: which key it asks for,
 * what it reports back, and what it does when the budget says wait or fails. */

const config = { token: "key", secret: "secret", baseUrl: "https://live.trading212.com" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const urlOf = (input: string | URL | Request) =>
  new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
const summary = { currency: "EUR", cash: { availableToTrade: 0, inPies: 0, reservedForOrders: 0 } };

test("two adapters that share one budget and one account never send history pages together", async () => {
  const clock = withVirtualClock();
  const provider = fakeTrading212(50);
  vi.stubGlobal("fetch", provider.fetch);
  try {
    const shared = createMemoryPartnerBudgetClient();
    await Promise.all([
      createTrading212Adapter({ ...config, partnerBudget: shared }).sync({ entity: "BV" }),
      createTrading212Adapter({ ...config, partnerBudget: shared }).sync({ entity: "BV" }),
    ]);
    const times = [...provider.orderTimes].sort((a, b) => a - b);
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(ORDER_HISTORY_TABLE_MS);
  } finally {
    clock.restore();
  }
});

test("the same two adapters with a budget each still send together: what sharing fixes", async () => {
  const clock = withVirtualClock();
  const provider = fakeTrading212(50);
  vi.stubGlobal("fetch", provider.fetch);
  try {
    await Promise.all([
      createTrading212Adapter({
        ...config,
        partnerBudget: createMemoryPartnerBudgetClient(),
      }).sync({ entity: "BV" }),
      createTrading212Adapter({
        ...config,
        partnerBudget: createMemoryPartnerBudgetClient(),
      }).sync({ entity: "BV" }),
    ]);
    const times = [...provider.orderTimes].sort((a, b) => a - b);
    expect(times[1]! - times[0]!).toBeLessThan(ORDER_HISTORY_TABLE_MS);
  } finally {
    clock.restore();
  }
});

test("an adapter given no budget paces itself with one of its own", async () => {
  const clock = withVirtualClock();
  const provider = fakeTrading212(150);
  vi.stubGlobal("fetch", provider.fetch);
  try {
    const adapter = createTrading212Adapter(config);
    await adapter.sync({ entity: "BV" });
    expect(provider.rejections).toBe(0);
    expect(clock.now()).toBeGreaterThan(START_MS);
  } finally {
    clock.restore();
  }
});

test("two accounts on one shared budget do not queue behind each other", async () => {
  const clock = withVirtualClock();
  const provider = fakeTrading212(50);
  vi.stubGlobal("fetch", provider.fetch);
  try {
    const shared = createMemoryPartnerBudgetClient();
    await Promise.all([
      createTrading212Adapter({ ...config, token: "key-a", partnerBudget: shared }).sync({
        entity: "BV",
      }),
      createTrading212Adapter({ ...config, token: "key-b", partnerBudget: shared }).sync({
        entity: "BV",
      }),
    ]);
    const times = [...provider.orderTimes].sort((a, b) => a - b);
    expect(times[1]! - times[0]!).toBeLessThan(ORDER_HISTORY_TABLE_MS);
  } finally {
    clock.restore();
  }
});

test("the budget key holds a hash of the API key, never the key", async () => {
  const clock = withVirtualClock();
  vi.stubGlobal("fetch", fakeTrading212(50).fetch);
  try {
    const budget = createImmediatePartnerBudget();
    await createTrading212Adapter({
      ...config,
      token: "super-secret-key",
      partnerBudget: budget,
    }).sync({ entity: "BV" });
    const keys = budget.calls.map((call) => call.key);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.partner).toBe("trading212");
      expect(key.scopeId).toMatch(/^[0-9a-f]{16}$/);
      expect(JSON.stringify(key)).not.toContain("super-secret-key");
    }
    expect(new Set(keys.map((key) => `${key.partner}:${key.endpoint}`))).toEqual(
      new Set([
        "trading212:positions",
        "trading212:account-summary",
        "trading212:history-orders",
        "trading212:history-transactions",
        "trading212:history-dividends",
      ]),
    );
  } finally {
    clock.restore();
  }
});

test("a 429 is reported to the budget, and the retry waits for the instant it named", async () => {
  const clock = withVirtualClock();
  const times: number[] = [];
  let ordersCalls = 0;
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  vi.stubGlobal("fetch", (async (input: string | URL | Request) => {
    const url = urlOf(input);
    if (url.pathname.endsWith("/positions")) return json([holding]);
    if (url.pathname.endsWith("/account/summary")) return json(summary);
    if (url.pathname.includes("/history/orders")) {
      times.push(Date.now());
      ordersCalls += 1;
      if (ordersCalls === 1) return json({ error: "Limited" }, 429, { "retry-after": "20" });
      return json({ items: [order(1)], nextPagePath: null });
    }
    return json({ items: [], nextPagePath: null });
  }) as typeof globalThis.fetch);
  try {
    const budget = createMemoryPartnerBudgetClient();
    const rejected = vi.spyOn(budget, "reject");
    const result = await createTrading212Adapter({ ...config, partnerBudget: budget }).sync({
      entity: "BV",
    });
    expect(result.problems).toEqual([]);
    expect(result.sections.trades.rows).toHaveLength(1);
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(rejected.mock.calls[0]![1]).toBe(START_MS + 20_000);
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(20_000);
  } finally {
    clock.restore();
  }
});

test("a cooldown the host cannot wait out is recorded for the next run before the sync pauses", async () => {
  const clock = withVirtualClock();
  vi.stubGlobal("fetch", (async (input: string | URL | Request) => {
    const url = urlOf(input);
    if (url.pathname.includes("/history/orders"))
      return new Response("{}", { status: 429, headers: { "retry-after": "30" } });
    if (url.pathname.endsWith("/positions"))
      return new Response(JSON.stringify([holding]), { status: 200 });
    if (url.pathname.endsWith("/account/summary"))
      return new Response(JSON.stringify(summary), { status: 200 });
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  }) as typeof globalThis.fetch);
  try {
    const budget = createImmediatePartnerBudget();
    const result = await createTrading212Adapter({ ...config, partnerBudget: budget }).sync({
      entity: "BV",
      deadlineMs: START_MS + 20_000,
    });
    expect(result.retryAfter).toBeDefined();
    expect(budget.calls).toContainEqual(
      expect.objectContaining({ call: "reject", untilMs: START_MS + 30_000 }),
    );
  } finally {
    clock.restore();
  }
});

test("the host deadline is handed to the budget with every slot request", async () => {
  const clock = withVirtualClock();
  vi.stubGlobal("fetch", fakeTrading212(50).fetch);
  try {
    const budget = createImmediatePartnerBudget();
    await createTrading212Adapter({ ...config, partnerBudget: budget }).sync({
      entity: "BV",
      deadlineMs: START_MS + 600_000,
    });
    const slots = budget.calls.filter((call) => call.call === "awaitSlot");
    expect(slots.length).toBeGreaterThan(0);
    for (const call of slots) {
      expect(call).toMatchObject({ deadlineMs: START_MS + 600_000 });
    }
  } finally {
    clock.restore();
  }
});

test("a budget store that is down sends no request and pauses the sync", async () => {
  const clock = withVirtualClock();
  const provider = fakeTrading212(50);
  vi.stubGlobal("fetch", provider.fetch);
  try {
    const result = await createTrading212Adapter({
      ...config,
      partnerBudget: createFailingPartnerBudget(new PartnerBudgetUnavailable({ message: "down" })),
    }).sync({ entity: "BV" });
    expect(provider.requests).toEqual([]);
    // Our own outage is not a broker cooldown: no retryAfter, so it cannot outrank `force`.
    expect(result.retryAfter).toBeUndefined();
    expect(result.problems).toContain(
      "Trading 212 sync paused: the request budget store is unavailable",
    );
    expect(result.sections.positions.status).not.toBe("complete");
  } finally {
    clock.restore();
  }
});

function respondingWith(headers: Record<string, string>) {
  return (async (input: string | URL | Request) => {
    const url = urlOf(input);
    const base = { status: 200, headers: { "content-type": "application/json", ...headers } };
    if (url.pathname.endsWith("/positions")) return new Response(JSON.stringify([holding]), base);
    if (url.pathname.endsWith("/account/summary"))
      return new Response(JSON.stringify(summary), base);
    return new Response(JSON.stringify({ items: [], nextPagePath: null }), base);
  }) as typeof globalThis.fetch;
}

const observed = (budget: ReturnType<typeof createImmediatePartnerBudget>, endpoint: string) =>
  budget.calls.filter((call) => call.call === "observe" && call.key.endpoint === endpoint);

test("limit and period headers become the spacing period / limit, rounded up", async () => {
  const clock = withVirtualClock();
  vi.stubGlobal("fetch", respondingWith({ "x-ratelimit-limit": "3", "x-ratelimit-period": "10" }));
  try {
    const budget = createImmediatePartnerBudget();
    await createTrading212Adapter({ ...config, partnerBudget: budget }).sync({ entity: "BV" });
    expect(observed(budget, "positions")).toEqual([
      expect.objectContaining({ seen: { intervalMs: 3_334 } }),
    ]);
  } finally {
    clock.restore();
  }
});

test("remaining 0 with a reset time is observed as a block, whatever the other pair says", async () => {
  const clock = withVirtualClock();
  vi.stubGlobal(
    "fetch",
    respondingWith({
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String((START_MS + 7_000) / 1_000),
      "x-ratelimit-limit": "0",
      "x-ratelimit-period": "60",
    }),
  );
  try {
    const budget = createImmediatePartnerBudget();
    await createTrading212Adapter({ ...config, partnerBudget: budget }).sync({ entity: "BV" });
    const [call] = observed(budget, "positions");
    const seen = (call as { seen: PartnerSeen }).seen;
    expect(seen.remaining).toBe(0);
    expect(DateTime.toEpochMillis(seen.resetAt!)).toBe(START_MS + 7_000);
    // limit 0 is invalid, so the interval pair is ignored
    expect(seen.intervalMs).toBeUndefined();
  } finally {
    clock.restore();
  }
});

test("headers with a missing or invalid part are not reported at all", async () => {
  const clock = withVirtualClock();
  vi.stubGlobal(
    "fetch",
    respondingWith({
      "x-ratelimit-limit": "20",
      "x-ratelimit-period": "-60",
      "x-ratelimit-remaining": "4",
      "x-ratelimit-reset": "soon",
    }),
  );
  try {
    const budget = createImmediatePartnerBudget();
    await createTrading212Adapter({ ...config, partnerBudget: budget }).sync({ entity: "BV" });
    expect(budget.calls.filter((call) => call.call === "observe")).toEqual([]);
  } finally {
    clock.restore();
  }
});

test("a store that goes down mid-history keeps the resume cursor, carries no retryAfter, and a forced sync is not skipped", async () => {
  const clock = withVirtualClock();
  const provider = fakeTrading212(150);
  vi.stubGlobal("fetch", provider.fetch);
  try {
    const healthy = createMemoryPartnerBudgetClient();
    let historyCalls = 0;
    let down = true;
    const flaky: typeof healthy = {
      ...healthy,
      awaitSlot: async (key, deadlineMs) => {
        if (down && key.endpoint === "history-orders" && (historyCalls += 1) > 1)
          throw new PartnerBudgetUnavailable({ message: "down" });
        await healthy.awaitSlot(key, deadlineMs);
      },
    };
    const adapter = createTrading212Adapter({ ...config, partnerBudget: flaky });
    const first = await adapter.sync({ entity: "BV" });
    expect(first.resume).toBeDefined();
    expect(first.retryAfter).toBeUndefined();
    expect(first.problems).toContain(
      "Trading 212 sync paused: the request budget store is unavailable",
    );
    expect(first.sections.trades.rows.length).toBeGreaterThan(0);

    // The scheduler stores no cooldown, so `force` is not blocked by one.
    const operations = createMemoryBrokerSyncStateStore();
    const credentials = {
      getCredentials: async () => ({
        broker: "trading212",
        tenantId: "t",
        token: "key",
        secret: "secret",
      }),
      putCredentials: async () => undefined,
    } as never;
    const run = (force: boolean) =>
      syncScheduledBrokers({
        adapters: [{ broker: "trading212", adapter }],
        credentials,
        operations,
        tenantId: "t",
        entity: "BV",
        force,
        now: new Date(clock.now()),
      });
    historyCalls = 0;
    const outage = await run(false);
    expect(outage.outcomes[0]?.status).toBe("problem");
    expect(outage.problems.join(" ")).not.toContain("rate-limited by the broker");
    down = false;
    const forced = await run(true);
    expect(forced.outcomes[0]?.status).not.toBe("skipped");
    expect(forced.problems.join(" ")).not.toContain("rate-limited by the broker");
  } finally {
    clock.restore();
  }
});

test("a store that fails to record the headers of a 2xx response does not discard the data", async () => {
  const clock = withVirtualClock();
  vi.stubGlobal("fetch", respondingWith({ "x-ratelimit-limit": "3", "x-ratelimit-period": "10" }));
  try {
    const healthy = createMemoryPartnerBudgetClient();
    const diagnostics = vi.fn();
    const result = await createTrading212Adapter({
      ...config,
      diagnostics,
      partnerBudget: { ...healthy, observe: () => Promise.reject(new Error("observe down")) },
    }).sync({ entity: "BV" });
    expect(result.sections.positions.rows).toHaveLength(1);
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ type: "budget-observe-failed", message: "observe down" }),
    );
  } finally {
    clock.restore();
  }
});

test("the budget-exhausted wait is reported only when it lasted at least 250 ms", async () => {
  const clock = withVirtualClock();
  vi.stubGlobal("fetch", fakeTrading212(50).fetch);
  try {
    const waits = (spacingMs: number) => {
      const diagnostics = vi.fn();
      const healthy = createMemoryPartnerBudgetClient();
      return {
        diagnostics,
        adapter: createTrading212Adapter({
          ...config,
          diagnostics,
          partnerBudget: {
            ...healthy,
            awaitSlot: async (key, deadlineMs) => {
              await healthy.awaitSlot(key, deadlineMs);
              await new Promise((resolve) => setTimeout(resolve, spacingMs));
            },
          },
        }),
      };
    };
    const short = waits(249);
    await short.adapter.sync({ entity: "BV" });
    expect(short.diagnostics).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: "budget-exhausted" }),
    );
    const long = waits(250);
    await long.adapter.sync({ entity: "BV" });
    expect(long.diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "budget-exhausted" }),
    );
  } finally {
    clock.restore();
  }
});
