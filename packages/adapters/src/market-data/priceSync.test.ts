import { expect, test, vi } from "vitest";
import { blockedYahooFixture } from "./yahoo/__fixtures__/blocked.js";
import { rateLimitedYahooFixture } from "./yahoo/__fixtures__/rate-limited.js";
import { createYahooPriceProvider } from "./yahoo/priceProvider.js";
import { priceInstrumentKey } from "@lavega/core";
import { createInMemorySharedPriceStore } from "../prices/sharedPriceStoreCore.js";
import type { PriceCoverage, SharedPriceBar, SharedPriceStore } from "../prices/PriceStore.js";
import { syncPrices } from "./priceSync.js";
import { YahooHttpClient } from "./yahoo/http.js";
import { createImmediatePartnerBudget } from "../partnerBudget/fakes.js";

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

/** The shared series key for a symbol as a caller with no ISIN computes it. */
const symKey = (symbol: string, currency = "EUR"): string =>
  priceInstrumentKey({ symbol, currency });

const withoutSymbol = (bars: readonly (SharedPriceBar & { symbol?: string })[]): SharedPriceBar[] =>
  bars.map(({ symbol: _symbol, ...bar }) => bar);

/** Test-side translation from the old per-tenant calls to the shared keys:
 *  production callers build the same `sym:`/`isin:` key from the instrument
 *  (issue #307), so these helpers only spell that boundary once. */
function legacy(store: SharedPriceStore) {
  return {
    async upsert(
      _tenant: string,
      bars: readonly (SharedPriceBar & { symbol?: string })[],
    ): Promise<void> {
      const groups = new Map<string, SharedPriceBar[]>();
      for (const bar of bars) {
        const key = symKey(bar.symbol ?? "", bar.currency);
        groups.set(key, [...(groups.get(key) ?? []), ...withoutSymbol([bar])]);
      }
      await Promise.all([...groups].map(([key, rows]) => store.upsert(key, rows)));
    },
    getRange(tenant: string, symbol: string, from?: string, to?: string) {
      void tenant;
      return store.getRange({ key: symKey(symbol) }, from, to);
    },
    lastDate(tenant: string, symbol: string) {
      void tenant;
      return store.lastDate({ key: symKey(symbol) });
    },
    async getCoverage(tenant: string, symbol: string, currency = "EUR") {
      void tenant;
      const coverage = await store.getCoverage({ key: symKey(symbol, currency) });
      return coverage === null ? null : { ...coverage, symbol };
    },
    putCoverage(_tenant: string, coverage: PriceCoverage) {
      const { symbol, ...rest } = coverage;
      return store.putCoverage(symKey(symbol, coverage.currency), {
        ...rest,
        provider: coverage.provider ?? "unknown",
      });
    },
    replaceRange(
      tenant: string,
      symbol: string,
      bars: readonly (SharedPriceBar & { symbol?: string })[],
      from?: string,
      to?: string,
    ) {
      void tenant;
      return store.replaceRange(symKey(symbol), withoutSymbol(bars), from, to);
    },
  };
}

/**
 * The run id the per-key claim is held under; one per sync call is what a slice
 * does.
 */
/** Coverage after a sync whose request carried an ISIN lives under the ISIN key:
 *  that is the series identity (issue #307). */
const coverageFor = (
  store: SharedPriceStore,
  input: { symbol: string; isin?: string; currency: string },
) =>
  store.getCoverage({
    key: priceInstrumentKey(input),
    alias: priceInstrumentKey({ symbol: input.symbol, currency: input.currency }),
  });

const RUN = "test-run";

/** `syncPrices` with the key computed the one way production computes it. */
function syncWith(
  input: Omit<Parameters<typeof syncPrices>[0], "key" | "owner" | "alias"> & {
    /** Leftover from the per-tenant contract; ignored by the shared store. */
    tenantId?: string;
    /** The run id this call claims the key under. */
    owner?: string;
  },
) {
  const key = priceInstrumentKey(input.request);
  const alias = key.startsWith("isin:")
    ? priceInstrumentKey({ symbol: input.request.symbol, currency: input.request.currency })
    : undefined;
  return syncPrices({ ...input, key, ...(alias ? { alias } : {}), owner: input.owner ?? RUN });
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
    const store = createInMemorySharedPriceStore();
    const priceProviders = [
      { sourceKey: "yahoo", priority: 10, get: async () => ({ bars: [], problems: [problem] }) },
    ];
    await expect(
      syncWith({
        store,
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
  const provider = createYahooPriceProvider({
    client: new YahooHttpClient(fetchFn, 20_000, 0, {
      partnerBudget: createImmediatePartnerBudget(),
    }),
  });
  await expect(provider.get(request)).resolves.toMatchObject({
    problems: [expect.stringContaining(expected)],
  });
});

test("a cache hit costs one store read, not two", async () => {
  /* Every warm symbol pays this round trip. In production the store is Neon,
   * where a re-read of the range just read costs about as much as the symbol
   * it serves, which is what caps warm-cache sync throughput. */
  const store = createInMemorySharedPriceStore();
  await legacy(store).upsert("local", [
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

  const result = await syncWith({
    store: { ...store, getRange },
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
  const store = createInMemorySharedPriceStore();
  const provider = createYahooPriceProvider({ client });
  const r = lane(provider);
  await expect(
    syncWith({
      store,
      priceProviders: r,
      request: { ...request, today: "2026-01-01" },
    }),
  ).resolves.toMatchObject({ problems: [], fetched: true });
  await expect(
    syncWith({
      store,
      priceProviders: r,
      request: { ...request, today: "2026-01-02" },
    }),
  ).resolves.toMatchObject({ problems: [], fetched: true });
  expect(urls[0]).toContain("range=5y");
  expect(urls[1]).toContain("period1=1767312000");
});

test("writes one shared series under the instrument key, not one per caller", async () => {
  const client = {
    fetchJsonWithCrumb: vi.fn(async () => ({
      chart: { result: [{ timestamp: [1767225600], indicators: { quote: [{ close: [100] }] } }] },
    })),
  } as never;
  const store = createInMemorySharedPriceStore();
  const priceProviders = lane(createYahooPriceProvider({ client }));
  await syncWith({ store, priceProviders, request: { ...request, today: "2026-01-01" } });
  // A second caller of the same instrument gets the stored series for free.
  const second = await syncWith({
    store,
    priceProviders: lane(createYahooPriceProvider({ client })),
    request: { ...request, today: "2026-01-01" },
  });

  expect(second).toMatchObject({ fetched: false, problems: [] });
  await expect(store.getRange({ key: symKey("ASML") })).resolves.toHaveLength(1);
  await expect(store.getRange({ key: symKey("MSFT") })).resolves.toEqual([]);
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

test("a currency change is a new series key and does not misread the old pounds", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).upsert("local", [
    { symbol: "HLMAl_EQ", date: "2026-01-01", close: 3500, currency: "GBP", split: 1 },
    { symbol: "HLMAl_EQ", date: "2026-01-02", close: 3592, currency: "GBP", split: 1 },
  ]);
  const get = vi.fn(async (_request: { from?: string; to?: string }) => ({
    bars: [
      { symbol: "HLMAl_EQ", date: "2026-01-01", close: 3500, currency: "GBX" },
      { symbol: "HLMAl_EQ", date: "2026-01-02", close: 3592, currency: "GBX" },
      { symbol: "HLMAl_EQ", date: "2026-01-03", close: 3604, currency: "GBX" },
    ],
    problems: [],
  }));
  const priceProviders = [{ sourceKey: "yahoo", priority: 10, get }];

  const result = await syncWith({
    store,
    priceProviders,
    request: { ...request, symbol: "HLMAl_EQ", currency: "GBX", today: "2026-01-03" },
  });

  /* `GBP` and `GBX` are different series keys (issue #307), so the pence series
   * starts empty and the old pounds history is neither read nor rewritten. */
  expect(get.mock.calls[0]?.[0]).toMatchObject({ to: "2026-01-03" });
  expect(get.mock.calls[0]?.[0]?.from).toBeUndefined();
  expect(result.bars.map((bar) => bar.currency)).toEqual(["GBX", "GBX", "GBX"]);
  await expect(store.getRange({ key: symKey("HLMAl_EQ", "GBP") })).resolves.toHaveLength(2);
});

test("fills history before the first cached bar once older trades arrive", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).upsert("local", [
    { symbol: "ASML", date: "2026-01-20", close: 100, currency: "EUR", split: 1 },
  ]);
  const get = vi.fn(async () => ({ bars: [], problems: [] }));

  await syncWith({
    store,
    priceProviders: [{ sourceKey: "yahoo", priority: 10, get }],
    request: { ...request, backfillFrom: "2026-01-01", today: "2026-01-20" },
  });

  expect(get).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-01-01" }));
});

test("refetches bars stored before splits were recorded", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).upsert("local", [
    { symbol: "ASML", date: "2026-01-01", close: 100, currency: "EUR" },
    { symbol: "ASML", date: "2026-01-02", close: 101, currency: "EUR", split: 1 },
  ]);
  const get = vi.fn(async () => ({ bars: [], problems: [] }));

  await syncWith({
    store,
    priceProviders: [{ sourceKey: "yahoo", priority: 10, get }],
    request,
  });

  expect(get).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-01-01" }));
});

test("a new split refetches the older bars so every close is in today's units", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).upsert("local", [
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

  const result = await syncWith({
    store,
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
  const store = createInMemorySharedPriceStore();
  const history = weekdays("2024-06-03", "2025-09-30");
  await legacy(store).upsert("local", asBars(history.filter((bar) => bar.date >= "2025-01-02")));
  const { get, providers } = market(history);

  const result = await syncWith({
    store,
    priceProviders: providers,
    request: { ...request, backfillFrom: "2024-06-03", today: "2025-09-30" },
  });

  expect(windows(get)).toEqual([["2024-06-03", "2025-01-01"]]);
  expect(result.bars[0]?.date).toBe("2024-06-03");
  expect(result.problems).toEqual([]);
});

test("the same request twice over complete coverage fetches history once", async () => {
  const store = createInMemorySharedPriceStore();
  const { get, providers } = market(weekdays("2025-06-02", "2025-09-30"));
  const sync = () =>
    syncWith({
      store,
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
  const store = createInMemorySharedPriceStore();
  const { get, providers } = market(weekdays("2025-01-01", "2025-01-10"));
  const sync = (today: string) =>
    syncWith({
      store,
      priceProviders: providers,
      request: { ...request, currency: "USD", backfillFrom: "2025-01-01", today },
    });

  await sync("2025-01-08");
  await sync("2025-01-10");

  expect(windows(get)).toEqual([
    ["2025-01-01", "2025-01-08"],
    ["2025-01-09", "2025-01-10"],
  ]);
  await expect(legacy(store).getCoverage("local", "ASML", "USD")).resolves.toMatchObject({
    symbol: "ASML",
    from: "2025-01-01",
    to: "2025-01-10",
    listing: "ASML.AS",
    currency: "EUR",
    provider: "stub",
    listingStart: "2025-01-01",
  });
});

test("a provider that now quotes another listing refreshes the whole history", async () => {
  const store = createInMemorySharedPriceStore();
  const sessions = weekdays("2025-01-01", "2025-01-10");
  const amsterdam = market(sessions);
  const nasdaq = market(
    sessions.map((bar) => ({ ...bar, close: 110 })),
    { listing: "ASML", currency: "USD" },
  );
  const sync = (priceProviders: typeof amsterdam.providers, today: string) =>
    syncWith({
      store,
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
  await expect(legacy(store).getCoverage("local", "ASML")).resolves.toMatchObject({
    from: "2025-01-01",
    to: "2025-01-10",
    listing: "ASML",
    currency: "USD",
  });
});

test("an empty holiday prefix is asked for once, not on every sync", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).upsert("local", asBars([{ date: "2025-01-02", close: 100 }]));
  const { get, providers } = market([{ date: "2025-01-02", close: 100 }]);
  const sync = () =>
    syncWith({
      store,
      priceProviders: providers,
      request: { ...request, backfillFrom: "2025-01-01", today: "2025-01-02" },
    });

  await expect(sync()).resolves.toMatchObject({ problems: [] });
  await expect(sync()).resolves.toMatchObject({ fetched: false });

  expect(windows(get)).toEqual([["2025-01-01", "2025-01-01"]]);
});

test("a failed prefix keeps the cache and still stores the new suffix", async () => {
  const store = createInMemorySharedPriceStore();
  const coverage = {
    symbol: "ASML",
    from: "2025-01-06",
    to: "2025-01-10",
    listing: "ASML.AS",
    currency: "EUR",
  };
  await legacy(store).upsert("local", asBars(weekdays("2025-01-06", "2025-01-10")));
  await legacy(store).putCoverage("local", coverage);
  const get = vi.fn(async ({ from, to }: { from?: string; to?: string }) =>
    from === "2025-01-01"
      ? { bars: [], problems: ["Yahoo Finance rate-limited price request"] }
      : { bars: asBars(weekdays(from!, to!)), problems: [], listing: "ASML.AS" },
  );

  const result = await syncWith({
    store,
    priceProviders: [{ sourceKey: "stub", priority: 10, get }],
    request: { ...request, backfillFrom: "2025-01-01", today: "2025-01-14" },
  });

  expect(result.problems).toEqual(["Yahoo Finance rate-limited price request"]);
  expect(result.bars.map((bar) => bar.date)).toEqual(
    weekdays("2025-01-06", "2025-01-14").map((bar) => bar.date),
  );
  await expect(legacy(store).getCoverage("local", "ASML")).resolves.toMatchObject({
    ...coverage,
    to: "2025-01-14",
    provider: "stub",
  });
});

test("a failed refresh leaves the cached history and its coverage as they were", async () => {
  const store = createInMemorySharedPriceStore();
  const coverage = {
    symbol: "ASML",
    from: "2025-01-06",
    to: "2025-01-07",
    listing: "ASML.AS",
    currency: "EUR",
  };
  const cached = asBars(weekdays("2025-01-06", "2025-01-07"));
  await legacy(store).upsert("local", cached);
  await legacy(store).putCoverage("local", coverage);
  const get = vi.fn(async ({ from }: { from?: string }) =>
    from === "2025-01-08"
      ? {
          bars: [{ symbol: "ASML", date: "2025-01-08", close: 90, currency: "GBP", split: 1 }],
          problems: [],
          listing: "ASML.L",
        }
      : { bars: [], problems: ["Yahoo Finance blocked price request"] },
  );

  const result = await syncWith({
    store,
    priceProviders: [{ sourceKey: "stub", priority: 10, get }],
    request: { ...request, backfillFrom: "2025-01-06", today: "2025-01-08" },
  });

  expect(result).toMatchObject({ bars: cached, problems: ["Yahoo Finance blocked price request"] });
  await expect(legacy(store).getCoverage("local", "ASML")).resolves.toEqual({
    ...coverage,
    provider: "unknown",
  });
});

test("a refresh to another listing drops cached sessions that listing did not trade", async () => {
  const store = createInMemorySharedPriceStore();
  const sessions = weekdays("2025-01-15", "2025-01-24");
  const amsterdam = market(sessions);
  const nasdaq = market(
    sessions.filter((bar) => bar.date !== "2025-01-20"),
    { listing: "ASML", currency: "USD" },
  );
  const sync = (priceProviders: typeof amsterdam.providers, today: string) =>
    syncWith({
      store,
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

test("an empty trading-day suffix is asked for once, not on every sync", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).putCoverage("local", {
    symbol: "ASML",
    from: "2025-01-01",
    to: "2025-01-01",
    listing: "ASML.AS",
    currency: "EUR",
  });
  await legacy(store).upsert("local", asBars([{ date: "2025-01-01", close: 100 }]));
  const { get, providers } = market([{ date: "2025-01-01", close: 100 }]);
  const sync = (today: string) =>
    syncWith({
      store,
      priceProviders: providers,
      request: { ...request, backfillFrom: "2025-01-01", today },
    });

  const result = await sync("2025-01-02");

  expect(result.problems).toEqual([]);
  expect(windows(get)).toEqual([["2025-01-02", "2025-01-02"]]);
  await expect(legacy(store).getCoverage("local", "ASML")).resolves.toMatchObject({
    to: "2025-01-02",
  });

  get.mockClear();
  await sync("2025-01-02");
  expect(get).not.toHaveBeenCalled();
});

test("a held position's quiet day within the missed-days window is not a problem", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).putCoverage("local", {
    symbol: "ASML",
    from: "2025-01-01",
    to: "2025-01-01",
    listing: "ASML.AS",
    currency: "EUR",
  });
  await legacy(store).upsert("local", asBars([{ date: "2025-01-01", close: 100 }]));
  const { get, providers } = market([{ date: "2025-01-01", close: 100 }]);

  const result = await syncWith({
    store,
    priceProviders: providers,
    request: {
      ...request,
      kind: "current" as const,
      backfillFrom: "2025-01-01",
      today: "2025-01-02",
    },
  });

  expect(result.problems).toEqual([]);
  expect(windows(get)).toEqual([["2025-01-02", "2025-01-02"]]);
  await expect(legacy(store).getCoverage("local", "ASML")).resolves.toMatchObject({
    to: "2025-01-02",
  });
});

test("a held position silent for more than 5 business days reports a problem every run", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).putCoverage("local", {
    symbol: "ASML",
    from: "2025-01-01",
    to: "2025-01-01",
    listing: "ASML.AS",
    currency: "EUR",
  });
  await legacy(store).upsert("local", asBars([{ date: "2025-01-01", close: 100 }]));
  const get = vi.fn(async () => ({ bars: [], problems: [], listing: "ASML.AS" }));
  const priceProviders = [{ sourceKey: "stub", priority: 10, get }];
  const sync = () =>
    syncWith({
      store,
      priceProviders,
      request: {
        ...request,
        kind: "current" as const,
        backfillFrom: "2025-01-01",
        today: "2025-01-10",
      },
    });

  const result = await sync();

  expect(result.problems).toEqual(["no prices since 2025-01-01"]);
  await expect(legacy(store).getCoverage("local", "ASML")).resolves.toMatchObject({
    to: "2025-01-01",
  });

  get.mockClear();
  const second = await sync();

  expect(get).toHaveBeenCalled();
  expect(second.problems).toEqual(["no prices since 2025-01-01"]);
});

test("a closed position Yahoo confirms gone is marked delisted, not a problem", async () => {
  const store = createInMemorySharedPriceStore();
  const get = vi.fn(async () => ({
    bars: [],
    problems: ["No listing found on Yahoo Finance for SKX (tried 1 symbol)"],
    notFound: true,
  }));
  const priceProviders = [{ sourceKey: "yahoo", priority: 10, get }];
  const sync = (today: string) =>
    syncWith({
      store,
      priceProviders,
      request: {
        ...request,
        symbol: "SKX_US_EQ",
        ticker: "SKX_US_EQ",
        kind: "closed" as const,
        today,
      },
    });

  const result = await sync("2026-01-01");

  expect(result.problems).toEqual([]);
  await expect(legacy(store).getCoverage("local", "SKX_US_EQ")).resolves.toMatchObject({
    delistedSince: "2026-01-01",
  });

  get.mockClear();
  await sync("2026-01-02");
  expect(get).not.toHaveBeenCalled();
});

test("an unresolved identifier never freezes a closed position as delisted", async () => {
  const store = createInMemorySharedPriceStore();
  const get = vi.fn(async () => ({
    bars: [],
    problems: ["No listing found on Yahoo Finance for XS00PF000003 (tried 1 symbol)"],
    notFound: true,
  }));
  const priceProviders = [{ sourceKey: "yahoo", priority: 10, get }];
  const sync = (today: string) =>
    syncWith({
      store,
      priceProviders,
      request: {
        ...request,
        symbol: "XS00PF000003",
        ticker: "XS00PF000003",
        kind: "closed" as const,
        today,
      },
      // OpenFIGI was rate-limited: the not-found answer settles nothing.
      allowDelist: false,
    });

  const result = await sync("2026-01-01");

  expect(result.problems).toEqual([
    "No listing found on Yahoo Finance for XS00PF000003 (tried 1 symbol)",
  ]);
  await expect(legacy(store).getCoverage("local", "XS00PF000003")).resolves.toBeNull();

  /* Nothing was frozen, so the next run asks the provider again. */
  get.mockClear();
  await sync("2026-01-02");
  expect(get).toHaveBeenCalled();
});

test("a held position Yahoo confirms gone still reports a problem", async () => {
  const store = createInMemorySharedPriceStore();
  const get = vi.fn(async () => ({
    bars: [],
    problems: ["No listing found on Yahoo Finance for SBGL (tried 1 symbol)"],
    notFound: true,
  }));
  const priceProviders = [{ sourceKey: "yahoo", priority: 10, get }];

  const result = await syncWith({
    store,
    priceProviders,
    request: {
      ...request,
      symbol: "SBGL_US_EQ",
      ticker: "SBGL_US_EQ",
      kind: "current" as const,
      today: "2026-01-01",
    },
  });

  expect(result.problems).toEqual(["No listing found on Yahoo Finance for SBGL (tried 1 symbol)"]);
  await expect(legacy(store).getCoverage("local", "SBGL_US_EQ", "USD")).resolves.toBeNull();
});

test("a re-bought position clears its stale delistedSince once bars arrive again", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).putCoverage("local", {
    symbol: "SKX_US_EQ",
    from: "2020-01-01",
    to: "2025-12-31",
    listing: "SKX",
    currency: "USD",
    delistedSince: "2026-01-01",
  });
  await legacy(store).upsert("local", [
    { symbol: "SKX_US_EQ", date: "2025-12-31", close: 60, currency: "USD", split: 1 },
  ]);
  const get = vi.fn(async () => ({
    bars: [{ symbol: "SKX_US_EQ", date: "2026-01-02", close: 65, currency: "USD", split: 1 }],
    problems: [],
    listing: "SKX",
  }));
  const priceProviders = [{ sourceKey: "yahoo", priority: 10, get }];

  await syncWith({
    store,
    priceProviders,
    request: {
      ...request,
      symbol: "SKX_US_EQ",
      ticker: "SKX_US_EQ",
      currency: "USD",
      kind: "current" as const,
      backfillFrom: "2020-01-01",
      today: "2026-01-02",
    },
  });

  await expect(legacy(store).getCoverage("local", "SKX_US_EQ", "USD")).resolves.toMatchObject({
    delistedSince: undefined,
  });
});

test("a closed position that stops resolving mid-sync is marked delisted from the suffix path", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).putCoverage("local", {
    symbol: "SKX_US_EQ",
    from: "2020-01-01",
    to: "2025-12-31",
    listing: "SKX",
    currency: "USD",
  });
  await legacy(store).upsert("local", [
    { symbol: "SKX_US_EQ", date: "2025-12-31", close: 60, currency: "USD", split: 1 },
  ]);
  const get = vi.fn(async () => ({
    bars: [],
    problems: ["No listing found on Yahoo Finance for SKX (tried 1 symbol)"],
    notFound: true,
  }));
  const priceProviders = [{ sourceKey: "yahoo", priority: 10, get }];

  const result = await syncWith({
    store,
    priceProviders,
    request: {
      ...request,
      symbol: "SKX_US_EQ",
      ticker: "SKX_US_EQ",
      currency: "USD",
      kind: "closed" as const,
      backfillFrom: "2020-01-01",
      today: "2026-01-01",
    },
  });

  expect(result.problems).toEqual([]);
  await expect(legacy(store).getCoverage("local", "SKX_US_EQ", "USD")).resolves.toMatchObject({
    delistedSince: "2026-01-01",
  });
});

test("a resolved listing is fetched directly on the next sync, not re-derived", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).putCoverage("local", {
    symbol: "SBGL_US_EQ",
    from: "2025-01-01",
    to: "2025-01-01",
    listing: "SBSW",
    currency: "USD",
  });
  await legacy(store).upsert("local", [
    { symbol: "SBGL_US_EQ", date: "2025-01-01", close: 10, currency: "USD", split: 1 },
  ]);
  const get = vi.fn(async (_request: { listing?: string }) => ({
    bars: [{ symbol: "SBGL_US_EQ", date: "2025-01-02", close: 11, currency: "USD", split: 1 }],
    problems: [],
    listing: "SBSW",
  }));
  const priceProviders = [{ sourceKey: "yahoo", priority: 10, get }];

  await syncWith({
    store,
    priceProviders,
    request: {
      ...request,
      symbol: "SBGL_US_EQ",
      ticker: "SBGL_US_EQ",
      currency: "USD",
      isin: "US82575P1075",
      backfillFrom: "2025-01-01",
      today: "2025-01-02",
    },
  });

  expect(get).toHaveBeenCalledTimes(1);
  expect(get.mock.calls[0]?.[0]).toMatchObject({ listing: "SBSW", isin: "US82575P1075" });
});

test("a stored listing that 404s triggers exactly one re-resolution once confirmed", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).putCoverage("local", {
    symbol: "SBGL_US_EQ",
    from: "2025-01-01",
    to: "2025-01-01",
    listing: "OLDSYM",
    currency: "USD",
    listingMissingSince: "2025-01-01",
  });
  await legacy(store).upsert("local", [
    { symbol: "SBGL_US_EQ", date: "2025-01-01", close: 10, currency: "USD", split: 1 },
  ]);
  const get = vi.fn(async ({ listing }: { listing?: string }) =>
    listing === "OLDSYM"
      ? {
          bars: [],
          problems: ["No listing found on Yahoo Finance for OLDSYM (tried 1 symbol)"],
          notFound: true,
        }
      : {
          bars: [
            { symbol: "SBGL_US_EQ", date: "2025-01-02", close: 11, currency: "USD", split: 1 },
          ],
          problems: [],
          listing: "NEWSYM",
        },
  );
  const priceProviders = [{ sourceKey: "yahoo", priority: 10, get }];

  const result = await syncWith({
    store,
    priceProviders,
    now: () => new Date("2025-01-02T12:00:00.000Z"),
    request: {
      ...request,
      symbol: "SBGL_US_EQ",
      ticker: "SBGL_US_EQ",
      currency: "USD",
      isin: "US82575P1075",
      kind: "current" as const,
      backfillFrom: "2025-01-01",
      today: "2025-01-02",
    },
  });

  expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls[0]?.[0]).toMatchObject({ listing: "OLDSYM" });
  expect(get.mock.calls[1]?.[0]?.listing).toBeUndefined();
  expect(result.problems).toEqual([]);
  await expect(
    coverageFor(store, { symbol: "SBGL_US_EQ", isin: "US82575P1075", currency: "USD" }),
  ).resolves.toMatchObject({
    listing: "NEWSYM",
    listingMissingSince: undefined,
  });
});

test("a single 404 on a locked listing is not enough to re-resolve", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).putCoverage("local", {
    symbol: "SBGL_US_EQ",
    from: "2025-01-01",
    to: "2025-01-01",
    listing: "OLDSYM",
    currency: "USD",
  });
  await legacy(store).upsert("local", [
    { symbol: "SBGL_US_EQ", date: "2025-01-01", close: 10, currency: "USD", split: 1 },
  ]);
  const get = vi.fn(async (_request: { listing?: string }) => ({
    bars: [],
    problems: ["No listing found on Yahoo Finance for OLDSYM (tried 1 symbol)"],
    notFound: true,
  }));
  const priceProviders = [{ sourceKey: "yahoo", priority: 10, get }];

  const result = await syncWith({
    store,
    priceProviders,
    now: () => new Date("2025-01-02T00:00:00.000Z"),
    request: {
      ...request,
      symbol: "SBGL_US_EQ",
      ticker: "SBGL_US_EQ",
      currency: "USD",
      isin: "US82575P1075",
      kind: "current" as const,
      backfillFrom: "2025-01-01",
      today: "2025-01-02",
    },
  });

  expect(get).toHaveBeenCalledTimes(1);
  expect(get.mock.calls[0]?.[0]).toMatchObject({ listing: "OLDSYM" });
  expect(result.problems).toEqual([
    "No listing found on Yahoo Finance for OLDSYM (tried 1 symbol)",
  ]);
  await expect(
    coverageFor(store, { symbol: "SBGL_US_EQ", isin: "US82575P1075", currency: "USD" }),
  ).resolves.toMatchObject({
    listing: "OLDSYM",
    listingMissingSince: "2025-01-02T00:00:00.000Z",
  });
});

test("a second 404 one minute after the first is still unconfirmed", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).putCoverage("local", {
    symbol: "SBGL_US_EQ",
    from: "2025-01-01",
    to: "2025-01-01",
    listing: "OLDSYM",
    currency: "USD",
    listingMissingSince: "2025-01-02T00:00:00.000Z",
  });
  await legacy(store).upsert("local", [
    { symbol: "SBGL_US_EQ", date: "2025-01-01", close: 10, currency: "USD", split: 1 },
  ]);
  const get = vi.fn(async (_request: { listing?: string }) => ({
    bars: [],
    problems: ["No listing found on Yahoo Finance for OLDSYM (tried 1 symbol)"],
    notFound: true,
  }));
  const priceProviders = [{ sourceKey: "yahoo", priority: 10, get }];

  const result = await syncWith({
    store,
    priceProviders,
    now: () => new Date("2025-01-02T00:01:00.000Z"),
    request: {
      ...request,
      symbol: "SBGL_US_EQ",
      ticker: "SBGL_US_EQ",
      currency: "USD",
      isin: "US82575P1075",
      kind: "current" as const,
      backfillFrom: "2025-01-01",
      today: "2025-01-02",
    },
  });

  expect(get).toHaveBeenCalledTimes(1);
  expect(result.problems).toEqual([
    "No listing found on Yahoo Finance for OLDSYM (tried 1 symbol)",
  ]);
  await expect(
    coverageFor(store, { symbol: "SBGL_US_EQ", isin: "US82575P1075", currency: "USD" }),
  ).resolves.toMatchObject({
    listing: "OLDSYM",
    listingMissingSince: "2025-01-02T00:00:00.000Z",
  });
});

test("a second 404 confirmed 25 hours after the first triggers exactly one re-resolution", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).putCoverage("local", {
    symbol: "SBGL_US_EQ",
    from: "2025-01-01",
    to: "2025-01-01",
    listing: "OLDSYM",
    currency: "USD",
    listingMissingSince: "2025-01-01T00:00:00.000Z",
  });
  await legacy(store).upsert("local", [
    { symbol: "SBGL_US_EQ", date: "2025-01-01", close: 10, currency: "USD", split: 1 },
  ]);
  const get = vi.fn(async ({ listing }: { listing?: string }) =>
    listing === "OLDSYM"
      ? {
          bars: [],
          problems: ["No listing found on Yahoo Finance for OLDSYM (tried 1 symbol)"],
          notFound: true,
        }
      : {
          bars: [
            { symbol: "SBGL_US_EQ", date: "2025-01-02", close: 11, currency: "USD", split: 1 },
          ],
          problems: [],
          listing: "NEWSYM",
        },
  );
  const priceProviders = [{ sourceKey: "yahoo", priority: 10, get }];

  const result = await syncWith({
    store,
    priceProviders,
    now: () => new Date("2025-01-02T01:00:00.000Z"),
    request: {
      ...request,
      symbol: "SBGL_US_EQ",
      ticker: "SBGL_US_EQ",
      currency: "USD",
      isin: "US82575P1075",
      kind: "current" as const,
      backfillFrom: "2025-01-01",
      today: "2025-01-02",
    },
  });

  expect(get).toHaveBeenCalledTimes(2);
  expect(result.problems).toEqual([]);
  await expect(
    coverageFor(store, { symbol: "SBGL_US_EQ", isin: "US82575P1075", currency: "USD" }),
  ).resolves.toMatchObject({
    listing: "NEWSYM",
    listingMissingSince: undefined,
  });
});

test("a resolved listing confirmed dead twice reports the problem without a second re-resolution", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).putCoverage("local", {
    symbol: "SBGL_US_EQ",
    from: "2025-01-01",
    to: "2025-01-01",
    listing: "OLDSYM",
    currency: "USD",
    listingMissingSince: "2025-01-01T00:00:00.000Z",
  });
  await legacy(store).upsert("local", [
    { symbol: "SBGL_US_EQ", date: "2025-01-01", close: 10, currency: "USD", split: 1 },
  ]);
  const get = vi.fn(async () => ({
    bars: [],
    problems: ["No listing found on Yahoo Finance for OLDSYM (tried 1 symbol)"],
    notFound: true,
  }));
  const priceProviders = [{ sourceKey: "yahoo", priority: 10, get }];

  const result = await syncWith({
    store,
    priceProviders,
    now: () => new Date("2025-01-02T12:00:00.000Z"),
    request: {
      ...request,
      symbol: "SBGL_US_EQ",
      ticker: "SBGL_US_EQ",
      currency: "USD",
      isin: "US82575P1075",
      kind: "current" as const,
      backfillFrom: "2025-01-01",
      today: "2025-01-02",
    },
  });

  expect(get).toHaveBeenCalledTimes(2);
  expect(result.problems).toEqual([
    "No listing found on Yahoo Finance for OLDSYM (tried 1 symbol)",
  ]);
  await expect(
    coverageFor(store, { symbol: "SBGL_US_EQ", isin: "US82575P1075", currency: "USD" }),
  ).resolves.toMatchObject({
    listing: "OLDSYM",
    listingMissingSince: "2025-01-01T00:00:00.000Z",
  });
});

test("a resolved symbol's first sync still applies currency preference", async () => {
  const store = createInMemorySharedPriceStore();
  const fetchJsonWithCrumb = vi
    .fn()
    .mockResolvedValueOnce({
      quotes: [
        { symbol: "SBSWN.MX", exchange: "MEX" },
        { symbol: "SBSW", exchange: "NYQ" },
      ],
    })
    .mockResolvedValueOnce({ chart: { result: [{ meta: { currency: "MXN" } }] } })
    .mockResolvedValueOnce({ chart: { result: [{ meta: { currency: "USD" } }] } })
    .mockResolvedValueOnce({
      chart: {
        result: [
          {
            meta: { currency: "USD" },
            timestamp: [Math.floor(Date.parse("2025-01-01T00:00:00Z") / 1000)],
            indicators: { quote: [{ close: [10] }] },
          },
        ],
      },
    });
  const provider = createYahooPriceProvider({ client: { fetchJsonWithCrumb } as never });

  await syncWith({
    store,
    priceProviders: [provider],
    request: {
      ticker: "SBGL_US_EQ",
      exchange: "UNKNOWN",
      symbol: "SBGL_US_EQ",
      currency: "USD",
      isin: "US82575P1075",
      today: "2025-01-01",
    },
  });

  expect(fetchJsonWithCrumb).toHaveBeenCalledTimes(4);
  await expect(
    coverageFor(store, { symbol: "SBGL_US_EQ", isin: "US82575P1075", currency: "USD" }),
  ).resolves.toMatchObject({
    listing: "SBSW",
  });
});

test("a confirmed re-resolution to a different-currency listing refreshes instead of merging", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).putCoverage("local", {
    symbol: "SBGL_US_EQ",
    from: "2025-01-01",
    to: "2025-01-01",
    listing: "OLDSYM",
    currency: "USD",
    listingMissingSince: "2025-01-01",
  });
  await legacy(store).upsert("local", [
    { symbol: "SBGL_US_EQ", date: "2025-01-01", close: 10, currency: "USD", split: 1 },
  ]);
  const get = vi.fn(async ({ listing }: { listing?: string }) =>
    listing === "OLDSYM"
      ? {
          bars: [],
          problems: ["No listing found on Yahoo Finance for OLDSYM (tried 1 symbol)"],
          notFound: true,
        }
      : {
          bars: [
            { symbol: "SBGL_US_EQ", date: "2025-01-02", close: 12, currency: "EUR", split: 1 },
          ],
          problems: [],
          listing: "NEWSYM",
        },
  );
  const priceProviders = [{ sourceKey: "yahoo", priority: 10, get }];

  const result = await syncWith({
    store,
    priceProviders,
    now: () => new Date("2025-01-02T12:00:00.000Z"),
    request: {
      ...request,
      symbol: "SBGL_US_EQ",
      ticker: "SBGL_US_EQ",
      currency: "USD",
      isin: "US82575P1075",
      kind: "current" as const,
      backfillFrom: "2025-01-01",
      today: "2025-01-02",
    },
  });

  expect(result.problems).toEqual([]);
  expect(result.bars.every((bar) => bar.currency === "EUR")).toBe(true);
  await expect(
    coverageFor(store, { symbol: "SBGL_US_EQ", isin: "US82575P1075", currency: "USD" }),
  ).resolves.toMatchObject({
    listing: "NEWSYM",
    currency: "EUR",
  });
});

test("re-resolution prefers the currency already on record over the broker's stated one", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).putCoverage("local", {
    symbol: "SBGL_US_EQ",
    from: "2025-01-01",
    to: "2025-01-01",
    listing: "OLDSYM",
    currency: "USD",
    listingMissingSince: "2025-01-01",
  });
  await legacy(store).upsert("local", [
    { symbol: "SBGL_US_EQ", date: "2025-01-01", close: 10, currency: "USD", split: 1 },
  ]);
  const get = vi.fn(async ({ listing, currency }: { listing?: string; currency?: string }) => {
    if (listing === "OLDSYM")
      return {
        bars: [],
        problems: ["No listing found on Yahoo Finance for OLDSYM (tried 1 symbol)"],
        notFound: true,
      };
    return currency === "USD"
      ? {
          bars: [
            { symbol: "SBGL_US_EQ", date: "2025-01-02", close: 11, currency: "USD", split: 1 },
          ],
          problems: [],
          listing: "NEWSYM",
        }
      : {
          bars: [],
          problems: ["No listing found on Yahoo Finance for NEWSYM (tried 1 symbol)"],
          notFound: true,
        };
  });
  const priceProviders = [{ sourceKey: "yahoo", priority: 10, get }];

  const result = await syncWith({
    store,
    priceProviders,
    now: () => new Date("2025-01-02T12:00:00.000Z"),
    request: {
      ...request,
      symbol: "SBGL_US_EQ",
      ticker: "SBGL_US_EQ",
      currency: "USD",
      isin: "US82575P1075",
      kind: "current" as const,
      backfillFrom: "2025-01-01",
      today: "2025-01-02",
    },
  });

  expect(result.problems).toEqual([]);
  expect(get.mock.calls[1]?.[0]).toMatchObject({ currency: "USD" });
  await expect(
    coverageFor(store, { symbol: "SBGL_US_EQ", isin: "US82575P1075", currency: "USD" }),
  ).resolves.toMatchObject({
    listing: "NEWSYM",
    currency: "USD",
  });
});

test("a cache written before splits were recorded refreshes once, then settles", async () => {
  const store = createInMemorySharedPriceStore();
  const sessions = weekdays("2025-01-06", "2025-01-10");
  await legacy(store).upsert(
    "local",
    sessions.map((bar) => ({ symbol: "ASML", currency: "EUR", ...bar })),
  );
  const { get, providers } = market(sessions);
  const sync = () =>
    syncWith({
      store,
      priceProviders: providers,
      request: { ...request, backfillFrom: "2025-01-06", today: "2025-01-10" },
    });

  await sync();
  await expect(sync()).resolves.toMatchObject({ fetched: false });

  expect(windows(get)).toEqual([["2025-01-06", "2025-01-10"]]);
});

/* WS4.5 (#297): provider affinity, listing-start clamp, provisional refetch. */

test("an unavailable assigned provider is skipped, not replaced by another one", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).upsert("local", asBars(weekdays("2025-01-06", "2025-01-07")));
  await legacy(store).putCoverage("local", {
    symbol: "ASML",
    from: "2025-01-06",
    to: "2025-01-07",
    listing: "ASML.AS",
    currency: "EUR",
    provider: "yahoo",
  });
  const marketstack = vi.fn(async () => ({
    bars: [{ symbol: "ASML", date: "2025-01-08", close: 100, currency: "EUR" }],
    problems: [],
    listing: "ASML.AS",
  }));

  const result = await syncWith({
    store,
    priceProviders: [{ sourceKey: "marketstack", priority: 20, get: marketstack }],
    request: { ...request, backfillFrom: "2025-01-06", today: "2025-01-08" },
  });

  expect(marketstack).not.toHaveBeenCalled();
  expect(result).toMatchObject({ fetched: false, problems: [expect.stringContaining("skipped")] });
  await expect(legacy(store).getCoverage("local", "ASML")).resolves.toMatchObject({
    provider: "yahoo",
  });
});

test("an assigned provider that is available is the only one asked", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).upsert("local", asBars(weekdays("2025-01-06", "2025-01-07")));
  await legacy(store).putCoverage("local", {
    symbol: "ASML",
    from: "2025-01-06",
    to: "2025-01-07",
    listing: "ASML.AS",
    currency: "EUR",
    provider: "yahoo",
  });
  const preferred = vi.fn(async ({ from, to }: { from?: string; to?: string }) => ({
    bars: asBars(weekdays(from ?? "2025-01-08", to ?? "2025-01-08")),
    problems: [],
    listing: "ASML.AS",
  }));
  const other = vi.fn(async () => ({ bars: [], problems: ["must not be asked"] }));

  await syncWith({
    store,
    priceProviders: [
      { sourceKey: "yahoo", priority: 10, get: preferred },
      { sourceKey: "marketstack", priority: 20, get: other },
    ],
    request: { ...request, backfillFrom: "2025-01-06", today: "2025-01-08" },
  });

  expect(other).not.toHaveBeenCalled();
  expect(preferred).toHaveBeenCalled();
});

test("a backfill is clamped to the persisted listing start", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).upsert("local", asBars(weekdays("2025-01-06", "2025-01-07")));
  await legacy(store).putCoverage("local", {
    symbol: "ASML",
    from: "2025-01-06",
    to: "2025-01-07",
    listing: "ASML.AS",
    currency: "EUR",
    listingStart: "2025-01-06",
  });
  const get = vi.fn(async () => ({ bars: [], problems: [] }));

  const result = await syncWith({
    store,
    priceProviders: [{ sourceKey: "stub", priority: 10, get }],
    request: { ...request, backfillFrom: "2020-01-01", today: "2025-01-07" },
  });

  expect(get).not.toHaveBeenCalled();
  expect(result.fetched).toBe(false);
});

test("a provisional close is refetched inside its window and finalised after it", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).upsert("local", asBars(weekdays("2025-01-06", "2025-01-09")));
  await legacy(store).putCoverage("local", {
    symbol: "ASML",
    from: "2025-01-06",
    to: "2025-01-09",
    listing: "ASML.AS",
    currency: "EUR",
    provisionalThrough: "2025-01-09",
  });
  const get = vi.fn(async () => ({
    bars: [
      { symbol: "ASML", date: "2025-01-09", close: 101, currency: "EUR", split: 1 },
      { symbol: "ASML", date: "2025-01-10", close: 102, currency: "EUR", split: 1 },
    ],
    problems: [],
    listing: "ASML.AS",
    provisionalThrough: "2025-01-10",
  }));

  const result = await syncWith({
    store,
    priceProviders: [{ sourceKey: "stub", priority: 10, get }],
    request: { ...request, backfillFrom: "2025-01-06", today: "2025-01-10" },
  });

  expect(get).toHaveBeenCalledWith(
    expect.objectContaining({ from: "2025-01-09", to: "2025-01-10" }),
  );
  expect(result.bars.at(-1)).toMatchObject({ date: "2025-01-10", close: 102 });
  await expect(legacy(store).getCoverage("local", "ASML")).resolves.toMatchObject({
    provisionalThrough: "2025-01-10",
  });
});

test("a provisional close older than its window is accepted as final", async () => {
  const store = createInMemorySharedPriceStore();
  await legacy(store).upsert("local", asBars(weekdays("2025-01-06", "2025-01-09")));
  await legacy(store).putCoverage("local", {
    symbol: "ASML",
    from: "2025-01-06",
    to: "2025-01-09",
    listing: "ASML.AS",
    currency: "EUR",
    provisionalThrough: "2025-01-09",
  });
  const get = vi.fn(async () => ({ bars: [], problems: [] }));

  await syncWith({
    store,
    priceProviders: [{ sourceKey: "stub", priority: 10, get }],
    request: { ...request, backfillFrom: "2025-01-06", today: "2025-01-20" },
  });

  expect(get).not.toHaveBeenCalledWith(expect.objectContaining({ from: "2025-01-09" }));
});

/* ---------- issue #307 acceptance, unit-provable without a database ---------- */

test("criterion 1: one tenant's sync leaves the other with zero provider requests", async () => {
  const store = createInMemorySharedPriceStore();
  let providerCalls = 0;
  const provider = {
    sourceKey: "yahoo",
    priority: 10,
    get: async ({ to }: { to?: string }) => {
      providerCalls += 1;
      return { bars: asBars(weekdays("2026-01-01", to ?? "2026-01-01")), problems: [] };
    },
  };
  const run = (owner: string) =>
    syncWith({
      store,
      owner,
      priceProviders: [provider],
      request: {
        symbol: "AAPL",
        ticker: "AAPL",
        exchange: "UNKNOWN",
        currency: "USD",
        isin: "US0378331005",
        backfillFrom: "2026-01-01",
        today: "2026-01-05",
      },
    });

  // Tenant A holds the instrument and pays for the one backfill.
  await run("run-a");
  const firstCalls = providerCalls;
  // Tenant B holds the same instrument: same key, stored bars, no request.
  const second = await run("run-b");

  expect(firstCalls).toBeGreaterThan(0);
  expect(providerCalls).toBe(firstCalls);
  expect(second.fetched).toBe(false);
  expect(second.bars.length).toBeGreaterThan(0);
  expect(second.bars.every((bar) => bar.symbol === "AAPL")).toBe(true);
});

test("criterion 2: the same plain ticker under two ISINs is two series", async () => {
  const store = createInMemorySharedPriceStore();
  const providerFor = (close: number) => ({
    sourceKey: "yahoo",
    priority: 10,
    get: async () => ({
      bars: [{ symbol: "AAPL", date: "2026-01-02", close, currency: "USD", split: 1 }],
      problems: [],
    }),
  });
  const request = (isin: string) => ({
    symbol: "AAPL",
    ticker: "AAPL",
    exchange: "UNKNOWN",
    currency: "USD",
    isin,
    backfillFrom: "2026-01-02",
    today: "2026-01-02",
  });

  await syncWith({
    store,
    owner: "run-a",
    priceProviders: [providerFor(100)],
    request: request("US0378331005"),
  });
  await syncWith({
    store,
    owner: "run-b",
    priceProviders: [providerFor(200)],
    request: request("CA0378331005"),
  });

  const first = await store.getRange({ key: "isin:US0378331005:USD" });
  const second = await store.getRange({ key: "isin:CA0378331005:USD" });
  expect(first.map((bar) => bar.close)).toEqual([100]);
  expect(second.map((bar) => bar.close)).toEqual([200]);
});

test("criterion 7: a refused claim is pending, and the next slice completes with no request", async () => {
  const store = createInMemorySharedPriceStore();
  let providerCalls = 0;
  const priceProviders = [
    {
      sourceKey: "yahoo",
      priority: 10,
      get: async () => {
        providerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { bars: asBars(weekdays("2026-01-01", "2026-01-02")), problems: [] };
      },
    },
  ];
  const run = (owner: string) =>
    syncWith({
      store,
      owner,
      priceProviders,
      request: {
        symbol: "AAPL",
        ticker: "AAPL",
        exchange: "UNKNOWN",
        currency: "USD",
        isin: "US0378331005",
        backfillFrom: "2026-01-01",
        today: "2026-01-02",
      },
    });

  const [first, second] = await Promise.all([run("run-a"), run("run-b")]);
  const results = [first, second];
  // Exactly one backfill reached the provider; the other was told to wait.
  expect(providerCalls).toBe(1);
  expect(results.filter((result) => result.pending === true)).toHaveLength(1);
  const pending = results.find((result) => result.pending === true)!;
  const winner = results.find((result) => result.pending !== true)!;
  expect(pending.bars).toEqual([]);
  expect(winner.bars.length).toBeGreaterThan(0);

  // Next slice: the rows the winner wrote answer, and still no provider call.
  const resumed = await run("run-c");
  expect(providerCalls).toBe(1);
  expect(resumed.fetched).toBe(false);
  expect(resumed.bars.length).toBeGreaterThan(0);
});

test("calling syncWith on a key another owner still holds is pending", async () => {
  const store = createInMemorySharedPriceStore();
  const key = priceInstrumentKey({ symbol: "AAPL", currency: "USD" });
  expect(await store.claim(key, "other-run", 60_000)).toBe(true);
  const result = await syncWith({
    store,
    priceProviders: [],
    request: {
      symbol: "AAPL",
      ticker: "AAPL",
      exchange: "UNKNOWN",
      currency: "USD",
      backfillFrom: "2026-01-01",
      today: "2026-01-03",
    },
  });
  expect(result).toMatchObject({ pending: true, fetched: false, bars: [] });
});
