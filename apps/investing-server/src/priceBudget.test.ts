import {
  PartnerBudget,
  YahooHttpClient,
  createInMemoryPriceStore,
  createPartnerBudgetClient,
  createYahooFundamentalsProvider,
  createYahooPriceProvider,
  fetchYahooSectorProfile,
  isPartnerBudgetStop,
  syncPrices,
  type PartnerBudgetStore,
  type PartnerBudgetClient,
} from "@lavega/adapters";
import { createInMemorySectorProfileStore } from "./inMemorySectorProfileStore.js";
import { resolvePortfolioSectors } from "./sectorResolution.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createInMemoryPriceSyncProgressStore,
  createPriceOrchestrator,
  type PriceSyncTarget,
} from "./priceOrchestrator.js";

/* The price run on the partner budget, end to end: orchestrator, price sync,
 * Yahoo provider and client, with a fake clock and a fake Yahoo. */

const START = Date.parse("2031-01-01T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});
afterEach(() => {
  vi.useRealTimers();
});

const chart = {
  chart: {
    result: [
      {
        meta: { currency: "EUR" },
        timestamp: [Date.parse("2030-12-30T00:00:00Z") / 1000],
        indicators: { quote: [{ close: [100] }] },
      },
    ],
  },
};

function fakeYahoo() {
  const times: number[] = [];
  const charts: number[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    times.push(Date.now());
    if (url === "https://fc.yahoo.com/")
      return new Response("", { headers: { "set-cookie": "A=B; Path=/" } });
    if (url.includes("getcrumb")) return new Response("crumb-value");
    charts.push(Date.now());
    return new Response(JSON.stringify(chart));
  });
  return { fetchFn, times, charts };
}

const targets = (tenant: string, count: number): PriceSyncTarget[] =>
  Array.from({ length: count }, (_, index) => ({
    kind: "current" as const,
    symbol: `${tenant}-SYM${index}`,
    ticker: `${tenant}-SYM${index}`,
    exchange: "UNKNOWN",
    currency: "EUR",
    listing: `${tenant}${index}`,
    backfillFrom: "2030-12-01",
    today: "2031-01-01",
  }));

/** One tenant's orchestrator over the one shared client, as `createApp` builds it. */
function orchestratorFor(
  tenant: string,
  count: number,
  client: YahooHttpClient,
  store = createInMemoryPriceStore(),
  pauseMarginMs = 0,
) {
  return createPriceOrchestrator({
    discover: () => targets(tenant, count),
    progressStore: createInMemoryPriceSyncProgressStore(),
    pauseMarginMs,
    sync: async (target, tenantId, { deadline }) =>
      syncPrices({
        store,
        tenantId,
        request: target,
        priceProviders: [createYahooPriceProvider({ client: client.withDeadline(deadline) })],
      }),
  });
}

/** Distances between neighbouring request times, in time order. */
const gaps = (times: number[]) => {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted.slice(1).map((time, index) => time - sorted[index]!);
};

test("two tenants on one budget make 20 Yahoo requests at no more than one per 300 ms", async () => {
  const yahoo = fakeYahoo();
  const budget = createPartnerBudgetClient(PartnerBudget.memoryLayer);
  // Hosted, each request builds its own app and so its own client: they share the budget, nothing else.
  const clients = [1, 2].map(
    () => new YahooHttpClient(yahoo.fetchFn, 20_000, 1, { partnerBudget: budget }),
  );

  const runs = [
    orchestratorFor("alice", 10, clients[0]!).run("alice"),
    orchestratorFor("bob", 10, clients[1]!).run("bob"),
  ];
  await vi.advanceTimersByTimeAsync(120_000);
  const results = await Promise.all(runs);

  expect(results.map((progress) => progress.status)).toEqual(["completed", "completed"]);
  expect(yahoo.charts).toHaveLength(20);
  // Each client negotiates its own crumb: two cookie and two crumb requests, on the same key.
  expect(yahoo.times).toHaveLength(24);
  const spacing = gaps(yahoo.times);
  expect(spacing).toHaveLength(23);
  expect(Math.min(...spacing)).toBeGreaterThanOrEqual(300);
});

test("the same two tenants with a budget of their own each overlap: what the shared budget fixes", async () => {
  const yahoo = fakeYahoo();
  const clients = [1, 2].map(
    () =>
      new YahooHttpClient(yahoo.fetchFn, 20_000, 1, {
        partnerBudget: createPartnerBudgetClient(PartnerBudget.memoryLayer),
      }),
  );

  const runs = [
    orchestratorFor("alice", 10, clients[0]!).run("alice"),
    orchestratorFor("bob", 10, clients[1]!).run("bob"),
  ];
  await vi.advanceTimersByTimeAsync(120_000);
  await Promise.all(runs);

  expect(Math.min(...gaps(yahoo.times))).toBeLessThan(300);
});

test("a slot after the deadline minus one second sends no request and the run pauses, not fails", async () => {
  const yahoo = fakeYahoo();
  const budget = createPartnerBudgetClient(PartnerBudget.memoryLayer);
  const client = new YahooHttpClient(yahoo.fetchFn, 20_000, 1, { partnerBudget: budget });
  const deadline = START + 3_000;

  const run = orchestratorFor("alice", 20, client).run("alice", deadline);
  await vi.advanceTimersByTimeAsync(30_000);
  const progress = await run;

  expect(progress.status).toBe("paused");
  expect(progress.problems).toEqual([]);
  expect(progress.completed).toBeGreaterThan(0);
  expect(progress.completed + progress.remainingSymbols.length).toBe(20);
  expect(progress.remainingSymbols.length).toBeGreaterThan(0);
  // Nothing was sent for a slot later than deadline - 1 s.
  expect(Math.max(...yahoo.times)).toBeLessThanOrEqual(deadline - 1_000);
});

test("a budget store that is down sends no Yahoo request and the run pauses with the reason", async () => {
  const yahoo = fakeYahoo();
  const down: PartnerBudgetStore = {
    reserve: () => Promise.reject(new Error("connection refused")),
    reserveBefore: () => Promise.reject(new Error("connection refused")),
    blockedUntil: () => Promise.reject(new Error("connection refused")),
    observe: () => Promise.reject(new Error("connection refused")),
    reject: () => Promise.reject(new Error("connection refused")),
  };
  const budget: PartnerBudgetClient = createPartnerBudgetClient(PartnerBudget.storeLayer(down));
  const client = new YahooHttpClient(yahoo.fetchFn, 20_000, 1, { partnerBudget: budget });

  const run = orchestratorFor("alice", 5, client).run("alice");
  await vi.advanceTimersByTimeAsync(30_000);
  const progress = await run;

  expect(yahoo.fetchFn).not.toHaveBeenCalled();
  expect(progress.status).toBe("paused");
  expect(progress.message).toBe(
    "Price synchronization paused: the shared request budget is unavailable",
  );
  expect(progress.problems).toEqual([]);
  expect(progress.remainingSymbols).toHaveLength(5);
});

test("20 sector reads that each hit a blocked budget send nothing and leave the queue where it was", async () => {
  const yahoo = fakeYahoo();
  const budget = createPartnerBudgetClient(PartnerBudget.memoryLayer);
  const client = new YahooHttpClient(yahoo.fetchFn, 20_000, 1, { partnerBudget: budget });
  await budget.reject({ partner: "yahoo", endpoint: "any", scopeId: "shared" }, START + 120_000);
  const store = createInMemorySectorProfileStore();

  for (let read = 0; read < 20; read += 1) {
    const pending = resolvePortfolioSectors([{ symbol: `S${read}`, marketValue: 10 }], {
      store,
      fetchProfile: (symbol, options) =>
        fetchYahooSectorProfile(symbol, client.withDeadline(options?.deadlineMs)),
    });
    await vi.advanceTimersByTimeAsync(0);
    const { sectorBySymbol } = await pending;
    expect(sectorBySymbol.get(`S${read}`)).toBe("Unknown");
    expect(await store.lastProviderAttempt(`S${read}`)).toBeNull();
  }
  // No read waited for the block or sent a request, and no refused read took a slot.
  expect(yahoo.fetchFn).not.toHaveBeenCalled();
  expect(Date.now()).toBe(START);
  // Once the block ends, the next price run starts at its end: the refused reads
  // did not queue 20 intervals ahead of it.
  await vi.advanceTimersByTimeAsync(120_000);
  const run = orchestratorFor("alice", 1, client).run("alice");
  await vi.advanceTimersByTimeAsync(30_000);
  const progress = await run;
  expect(progress.status).toBe("completed");
  expect(Math.min(...yahoo.times)).toBe(START + 120_000);
});

test("a fundamentals fetch under a 120 s block returns inside its 10 s deadline", async () => {
  const yahoo = fakeYahoo();
  const budget = createPartnerBudgetClient(PartnerBudget.memoryLayer);
  const client = new YahooHttpClient(yahoo.fetchFn, 20_000, 1, { partnerBudget: budget });
  await budget.reject({ partner: "yahoo", endpoint: "any", scopeId: "shared" }, START + 120_000);
  const provider = createYahooFundamentalsProvider(client, { budgetMs: 10_000 });

  const outcome = provider.fetch("AAPL").catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(10_000);
  const error = await outcome;
  expect(isPartnerBudgetStop(error)).toBe(true);
  expect(Date.now()).toBeLessThanOrEqual(START + 10_000);
  expect(yahoo.fetchFn).not.toHaveBeenCalled();
});
