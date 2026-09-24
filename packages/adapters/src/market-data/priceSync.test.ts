import { expect, test, vi } from "vitest";
import { blockedYahooFixture } from "./yahoo/__fixtures__/blocked.js";
import { rateLimitedYahooFixture } from "./yahoo/__fixtures__/rate-limited.js";
import { createYahooPriceProvider } from "./yahoo/priceProvider.js";
import { createInMemoryPriceStore } from "../prices/inMemoryPriceStore.js";
import { syncPrices } from "./priceSync.js";
import { YahooHttpClient } from "./yahoo/http.js";

const request = {
  ticker: "ASML",
  exchange: "AMS",
  symbol: "ASML",
  currency: "EUR",
  today: "2026-01-03",
};

function lane(provider: ReturnType<typeof createYahooPriceProvider>) {
  return [provider];
}

test("calls Yahoo directly without a consent gate", async () => {
  const fetchJsonWithCrumb = vi.fn(async () => ({ chart: { result: [] } }));
  const provider = createYahooPriceProvider({ client: { fetchJsonWithCrumb } as never });
  await provider.get(request);
  expect(fetchJsonWithCrumb).toHaveBeenCalledTimes(1);
});

test.each(["Yahoo Finance rate-limited price request", "Yahoo Finance blocked price request"])(
  "preserves provider problem %s through sync",
  async (problem) => {
    const store = createInMemoryPriceStore();
    const priceProviders = [
      { sourceKey: "yahoo", priority: 10, get: async () => ({ bars: [], problems: [problem] }) },
    ];
    await expect(
      syncPrices({
        store,
        tenantId: "local",
        priceProviders,
        request: {
          symbol: "ASML",
          ticker: "ASML",
          exchange: "AMS",
          currency: "EUR",
          today: "2026-01-01",
        },
      }),
    ).resolves.toMatchObject({ problems: [problem] });
  },
);

test.each([
  [rateLimitedYahooFixture, "rate-limited"],
  [blockedYahooFixture, "blocked"],
])("reports Yahoo HTTP fixture response %o as %s", async (fixture, expected) => {
  const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
    const target = String(url);
    if (target === "https://fc.yahoo.com/")
      return new Response("", { headers: { "set-cookie": "A=B; Path=/" } });
    if (target.includes("getcrumb")) return new Response("crumb");
    return new Response(fixture.body, { status: fixture.status });
  }) as unknown as typeof fetch;
  const provider = createYahooPriceProvider({ client: new YahooHttpClient(fetchFn, 20_000, 0) });
  await expect(provider.get(request)).resolves.toMatchObject({
    problems: [expect.stringContaining(expected)],
  });
});

test("a cache hit costs one store read, not two", async () => {
  /* Every warm symbol pays this round trip. In production the store is Neon,
   * where a re-read of the range just read costs about as much as the symbol
   * it serves, which is what caps warm-cache sync throughput. */
  const store = createInMemoryPriceStore();
  await store.upsert("local", [
    { symbol: "ASML", date: "2026-01-03", close: 10, currency: "EUR", split: 1 },
  ]);
  const getRange = vi.fn(store.getRange);
  const priceProviders = [
    {
      sourceKey: "yahoo",
      priority: 10,
      get: async () => {
        throw new Error("a cache hit must not reach a provider");
      },
    },
  ];

  const result = await syncPrices({
    store: { ...store, getRange },
    tenantId: "local",
    priceProviders,
    request: { ...request, today: "2026-01-03" },
  });

  expect(result.fetched).toBe(false);
  expect(result.bars).toHaveLength(1);
  expect(getRange).toHaveBeenCalledTimes(1);
});

test("backfills once and top-ups from PriceStore lastDate without wiping cache", async () => {
  const urls: string[] = [];
  const client = {
    fetchJsonWithCrumb: vi.fn(async (url: string) => {
      urls.push(url);
      const start = Number(url.match(/period1=(\d+)/)?.[1] ?? 1767225600);
      return {
        chart: { result: [{ timestamp: [start], indicators: { quote: [{ close: [100] }] } }] },
      };
    }),
  } as never;
  const store = createInMemoryPriceStore();
  const provider = createYahooPriceProvider({ client });
  const r = lane(provider);
  await expect(
    syncPrices({
      store,
      tenantId: "local",
      priceProviders: r,
      request: { ...request, today: "2026-01-01" },
    }),
  ).resolves.toMatchObject({ problems: [], fetched: true });
  await expect(
    syncPrices({
      store,
      tenantId: "local",
      priceProviders: r,
      request: { ...request, today: "2026-01-02" },
    }),
  ).resolves.toMatchObject({ problems: [], fetched: true });
  expect(urls[0]).toContain("range=5y");
  expect(urls[1]).toContain("period1=1767312000");
});

test("writes bars under the tenant the sync was asked for, not one a provider names", async () => {
  const client = {
    fetchJsonWithCrumb: vi.fn(async () => ({
      chart: { result: [{ timestamp: [1767225600], indicators: { quote: [{ close: [100] }] } }] },
    })),
  } as never;
  const store = createInMemoryPriceStore();
  await syncPrices({
    store,
    tenantId: "user-b",
    priceProviders: lane(createYahooPriceProvider({ client })),
    request: { ...request, today: "2026-01-02" },
  });

  await expect(store.getRange("user-b", "ASML")).resolves.toHaveLength(1);
  await expect(store.getRange("local", "ASML")).resolves.toEqual([]);
});

test("labels a London pence quote GBX so it cannot be read as pounds", async () => {
  const fetchJsonWithCrumb = vi.fn(async () => ({
    chart: {
      result: [
        {
          meta: { currency: "GBp" },
          timestamp: [Math.floor(Date.parse("2026-01-02T00:00:00Z") / 1000)],
          indicators: { quote: [{ close: [3592] }] },
        },
      ],
    },
  }));
  const provider = createYahooPriceProvider({ client: { fetchJsonWithCrumb } as never });
  const result = await provider.get({ ...request, symbol: "HLMAl_EQ", currency: "GBX" });
  expect(result?.bars.map((bar) => bar.currency)).toEqual(["GBX"]);
});

test("a provider now quoting pence refreshes history cached in pounds", async () => {
  const store = createInMemoryPriceStore();
  await store.upsert("local", [
    { symbol: "HLMAl_EQ", date: "2026-01-01", close: 3500, currency: "GBP", split: 1 },
    { symbol: "HLMAl_EQ", date: "2026-01-02", close: 3592, currency: "GBP", split: 1 },
  ]);
  const priceProviders = [
    {
      sourceKey: "yahoo",
      priority: 10,
      get: vi.fn(async () => ({
        bars: [
          { symbol: "HLMAl_EQ", date: "2026-01-01", close: 3500, currency: "GBX" },
          { symbol: "HLMAl_EQ", date: "2026-01-02", close: 3592, currency: "GBX" },
          { symbol: "HLMAl_EQ", date: "2026-01-03", close: 3604, currency: "GBX" },
        ],
        problems: [],
      })),
    },
  ];

  const result = await syncPrices({
    store,
    tenantId: "local",
    priceProviders,
    request: { ...request, symbol: "HLMAl_EQ", currency: "GBX", today: "2026-01-03" },
  });

  expect(priceProviders[0]!.get).toHaveBeenCalledWith(
    expect.objectContaining({ from: "2026-01-01", to: "2026-01-03" }),
  );
  expect(result.bars.map((bar) => bar.currency)).toEqual(["GBX", "GBX", "GBX"]);
});

test("fills history before the first cached bar once older trades arrive", async () => {
  const store = createInMemoryPriceStore();
  await store.upsert("local", [
    { symbol: "ASML", date: "2026-01-20", close: 100, currency: "EUR", split: 1 },
  ]);
  const get = vi.fn(async () => ({ bars: [], problems: [] }));

  await syncPrices({
    store,
    tenantId: "local",
    priceProviders: [{ sourceKey: "yahoo", priority: 10, get }],
    request: { ...request, backfillFrom: "2026-01-01", today: "2026-01-20" },
  });

  expect(get).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-01-01" }));
});

test("refetches bars stored before splits were recorded", async () => {
  const store = createInMemoryPriceStore();
  await store.upsert("local", [
    { symbol: "ASML", date: "2026-01-01", close: 100, currency: "EUR" },
    { symbol: "ASML", date: "2026-01-02", close: 101, currency: "EUR", split: 1 },
  ]);
  const get = vi.fn(async () => ({ bars: [], problems: [] }));

  await syncPrices({
    store,
    tenantId: "local",
    priceProviders: [{ sourceKey: "yahoo", priority: 10, get }],
    request,
  });

  expect(get).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-01-01" }));
});

test("a new split refetches the older bars so every close is in today's units", async () => {
  const store = createInMemoryPriceStore();
  await store.upsert("local", [
    { symbol: "ASML", date: "2026-01-01", close: 400, currency: "EUR", split: 1 },
    { symbol: "ASML", date: "2026-01-02", close: 404, currency: "EUR", split: 1 },
  ]);
  const get = vi.fn(async ({ from }: { from?: string }) => ({
    bars: [
      { symbol: "ASML", date: "2026-01-01", close: 100, currency: "EUR", split: 1 },
      { symbol: "ASML", date: "2026-01-02", close: 101, currency: "EUR", split: 1 },
      { symbol: "ASML", date: "2026-01-03", close: 102, currency: "EUR", split: 4 },
    ].filter((bar) => !from || bar.date >= from),
    problems: [],
  }));

  const result = await syncPrices({
    store,
    tenantId: "local",
    priceProviders: [{ sourceKey: "yahoo", priority: 10, get }],
    request,
  });

  expect(get.mock.calls.map(([call]) => call.from)).toEqual(["2026-01-03", "2026-01-01"]);
  expect(result.bars.map((bar) => bar.close)).toEqual([100, 101, 102]);
});

type Quote = { date: string; close: number };

/** A provider over a fixed market: answers any window with the sessions in it. */
function market(
  sessions: readonly Quote[],
  quote: { listing: string; currency: string } = { listing: "ASML.AS", currency: "EUR" },
) {
  const get = vi.fn(async ({ from, to }: { from?: string; to?: string }) => ({
    bars: sessions
      .filter((bar) => (!from || bar.date >= from) && (!to || bar.date <= to))
      .map((bar) => ({ symbol: "ASML", currency: quote.currency, split: 1, ...bar })),
    problems: [],
    listing: quote.listing,
  }));
  return { get, providers: [{ sourceKey: "stub", priority: 10, get }] };
}

const windows = (get: ReturnType<typeof market>["get"]) =>
  get.mock.calls.map(([call]) => [call.from, call.to]);

function weekdays(from: string, to: string): Quote[] {
  const sessions: Quote[] = [];
  for (let day = new Date(`${from}T00:00:00Z`); day <= new Date(`${to}T00:00:00Z`);) {
    if (day.getUTCDay() % 6 !== 0)
      sessions.push({ date: day.toISOString().slice(0, 10), close: 100 });
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return sessions;
}

const asBars = (sessions: readonly Quote[]) =>
  sessions.map((bar) => ({ symbol: "ASML", currency: "EUR", split: 1, ...bar }));

test("seeded January to September, a June backfill asks only for the missing prefix", async () => {
  const store = createInMemoryPriceStore();
  const history = weekdays("2024-06-03", "2025-09-30");
  await store.upsert("local", asBars(history.filter((bar) => bar.date >= "2025-01-02")));
  const { get, providers } = market(history);

  const result = await syncPrices({
    store,
    tenantId: "local",
    priceProviders: providers,
    request: { ...request, backfillFrom: "2024-06-03", today: "2025-09-30" },
  });

  expect(windows(get)).toEqual([["2024-06-03", "2025-01-01"]]);
  expect(result.bars[0]?.date).toBe("2024-06-03");
  expect(result.problems).toEqual([]);
});

test("the same request twice over complete coverage fetches history once", async () => {
  const store = createInMemoryPriceStore();
  const { get, providers } = market(weekdays("2025-06-02", "2025-09-30"));
  const sync = () =>
    syncPrices({
      store,
      tenantId: "local",
      priceProviders: providers,
      request: { ...request, backfillFrom: "2025-06-01", today: "2025-09-30" },
    });

  await sync();
  const second = await sync();

  expect(windows(get)).toEqual([["2025-06-01", "2025-09-30"]]);
  expect(second).toMatchObject({ fetched: false, problems: [] });
  expect(second.bars[0]?.date).toBe("2025-06-02");
});

test("a listing quoted in another currency than the broker's is not refetched", async () => {
  const store = createInMemoryPriceStore();
  const { get, providers } = market(weekdays("2025-01-01", "2025-01-10"));
  const sync = (today: string) =>
    syncPrices({
      store,
      tenantId: "local",
      priceProviders: providers,
      request: { ...request, currency: "USD", backfillFrom: "2025-01-01", today },
    });

  await sync("2025-01-08");
  await sync("2025-01-10");

  expect(windows(get)).toEqual([
    ["2025-01-01", "2025-01-08"],
    ["2025-01-09", "2025-01-10"],
  ]);
  await expect(store.getCoverage("local", "ASML")).resolves.toEqual({
    symbol: "ASML",
    from: "2025-01-01",
    to: "2025-01-10",
    listing: "ASML.AS",
    currency: "EUR",
  });
});

test("a provider that now quotes another listing refreshes the whole history", async () => {
  const store = createInMemoryPriceStore();
  const sessions = weekdays("2025-01-01", "2025-01-10");
  const amsterdam = market(sessions);
  const nasdaq = market(
    sessions.map((bar) => ({ ...bar, close: 110 })),
    { listing: "ASML", currency: "USD" },
  );
  const sync = (priceProviders: typeof amsterdam.providers, today: string) =>
    syncPrices({
      store,
      tenantId: "local",
      priceProviders,
      request: { ...request, backfillFrom: "2025-01-01", today },
    });

  await sync(amsterdam.providers, "2025-01-08");
  const result = await sync(nasdaq.providers, "2025-01-10");

  expect(windows(nasdaq.get)).toEqual([
    ["2025-01-09", "2025-01-10"],
    ["2025-01-01", "2025-01-10"],
  ]);
  expect(new Set(result.bars.map((bar) => `${bar.currency} ${bar.close}`))).toEqual(
    new Set(["USD 110"]),
  );
  await expect(store.getCoverage("local", "ASML")).resolves.toMatchObject({
    from: "2025-01-01",
    to: "2025-01-10",
    listing: "ASML",
    currency: "USD",
  });
});

test("an empty holiday prefix is asked for once, not on every sync", async () => {
  const store = createInMemoryPriceStore();
  await store.upsert("local", asBars([{ date: "2025-01-02", close: 100 }]));
  const { get, providers } = market([{ date: "2025-01-02", close: 100 }]);
  const sync = () =>
    syncPrices({
      store,
      tenantId: "local",
      priceProviders: providers,
      request: { ...request, backfillFrom: "2025-01-01", today: "2025-01-02" },
    });

  await expect(sync()).resolves.toMatchObject({ problems: [] });
  await expect(sync()).resolves.toMatchObject({ fetched: false });

  expect(windows(get)).toEqual([["2025-01-01", "2025-01-01"]]);
});

test("a failed prefix keeps the cache and still stores the new suffix", async () => {
  const store = createInMemoryPriceStore();
  const coverage = {
    symbol: "ASML",
    from: "2025-01-06",
    to: "2025-01-10",
    listing: "ASML.AS",
    currency: "EUR",
  };
  await store.upsert("local", asBars(weekdays("2025-01-06", "2025-01-10")));
  await store.putCoverage("local", coverage);
  const get = vi.fn(async ({ from, to }: { from?: string; to?: string }) =>
    from === "2025-01-01"
      ? { bars: [], problems: ["Yahoo Finance rate-limited price request"] }
      : { bars: asBars(weekdays(from!, to!)), problems: [], listing: "ASML.AS" },
  );

  const result = await syncPrices({
    store,
    tenantId: "local",
    priceProviders: [{ sourceKey: "stub", priority: 10, get }],
    request: { ...request, backfillFrom: "2025-01-01", today: "2025-01-14" },
  });

  expect(result.problems).toEqual(["Yahoo Finance rate-limited price request"]);
  expect(result.bars.map((bar) => bar.date)).toEqual(
    weekdays("2025-01-06", "2025-01-14").map((bar) => bar.date),
  );
  await expect(store.getCoverage("local", "ASML")).resolves.toEqual({
    ...coverage,
    to: "2025-01-14",
  });
});

test("a failed refresh leaves the cached history and its coverage as they were", async () => {
  const store = createInMemoryPriceStore();
  const coverage = {
    symbol: "ASML",
    from: "2025-01-06",
    to: "2025-01-07",
    listing: "ASML.AS",
    currency: "EUR",
  };
  const cached = asBars(weekdays("2025-01-06", "2025-01-07"));
  await store.upsert("local", cached);
  await store.putCoverage("local", coverage);
  const get = vi.fn(async ({ from }: { from?: string }) =>
    from === "2025-01-08"
      ? {
          bars: [{ symbol: "ASML", date: "2025-01-08", close: 90, currency: "GBP", split: 1 }],
          problems: [],
          listing: "ASML.L",
        }
      : { bars: [], problems: ["Yahoo Finance blocked price request"] },
  );

  const result = await syncPrices({
    store,
    tenantId: "local",
    priceProviders: [{ sourceKey: "stub", priority: 10, get }],
    request: { ...request, backfillFrom: "2025-01-06", today: "2025-01-08" },
  });

  expect(result).toMatchObject({ bars: cached, problems: ["Yahoo Finance blocked price request"] });
  await expect(store.getCoverage("local", "ASML")).resolves.toEqual(coverage);
});

test("a refresh to another listing drops cached sessions that listing did not trade", async () => {
  const store = createInMemoryPriceStore();
  const sessions = weekdays("2025-01-15", "2025-01-24");
  const amsterdam = market(sessions);
  const nasdaq = market(
    sessions.filter((bar) => bar.date !== "2025-01-20"),
    { listing: "ASML", currency: "USD" },
  );
  const sync = (priceProviders: typeof amsterdam.providers, today: string) =>
    syncPrices({
      store,
      tenantId: "local",
      priceProviders,
      request: { ...request, backfillFrom: "2025-01-15", today },
    });

  await sync(amsterdam.providers, "2025-01-22");
  await sync(nasdaq.providers, "2025-01-24");
  nasdaq.get.mockClear();
  const settled = await sync(nasdaq.providers, "2025-01-24");

  expect(nasdaq.get).not.toHaveBeenCalled();
  expect(settled.fetched).toBe(false);
  expect(settled.bars.map((bar) => bar.date)).not.toContain("2025-01-20");
  expect(new Set(settled.bars.map((bar) => bar.currency))).toEqual(new Set(["USD"]));
});

test("a cache written before splits were recorded refreshes once, then settles", async () => {
  const store = createInMemoryPriceStore();
  const sessions = weekdays("2025-01-06", "2025-01-10");
  await store.upsert(
    "local",
    sessions.map((bar) => ({ symbol: "ASML", currency: "EUR", ...bar })),
  );
  const { get, providers } = market(sessions);
  const sync = () =>
    syncPrices({
      store,
      tenantId: "local",
      priceProviders: providers,
      request: { ...request, backfillFrom: "2025-01-06", today: "2025-01-10" },
    });

  await sync();
  await expect(sync()).resolves.toMatchObject({ fetched: false });

  expect(windows(get)).toEqual([["2025-01-06", "2025-01-10"]]);
});
