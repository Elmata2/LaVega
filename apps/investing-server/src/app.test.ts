import { afterEach, expect, test, vi } from "vitest";
import { priceInstrumentKey } from "@lavega/core";
import type { PriceCoverage, SharedPriceBar, SharedPriceStore } from "@lavega/adapters";
import { createImmediatePartnerBudget } from "@lavega/adapters/src/partnerBudget/fakes.js";
import { PartnerBudgetUnavailable, PartnerWait } from "@lavega/adapters";
import { DateTime } from "effect";
import { app, createApp as createPacedApp } from "./app.js";

/* These tests are about routes and reads. Pacing of partner calls has its own
 * tests, so every slot is granted at once instead of sleeping real time. */
const createApp = (dependencies: Parameters<typeof createPacedApp>[0] = {}) =>
  createPacedApp({ partnerBudgetClient: createImmediatePartnerBudget(), ...dependencies });
import {
  createFrankfurterFxProvider,
  createInMemoryBenchmarkSelectionStore,
  createInMemoryInvestingLayoutStore,
  createInMemorySharedPriceStore,
  createYahooPriceProvider,
} from "@lavega/adapters";
import { createProblemReporter } from "./observability.js";
import { createMemorySyncRunStore } from "./syncRun.js";
import { createMemoryCashFlowStore } from "./cashFlowSuggestions.js";
import {
  buildCompositionProjection,
  buildRiskProjection,
  emptyInvestingDashboard,
  emptyRealizedReport,
} from "@lavega/core";
import type { PriceSyncTarget } from "./priceOrchestrator.js";
import { createInMemorySectorProfileStore } from "./inMemorySectorProfileStore.js";
import { createInMemoryAccountWrapperStore } from "./accountWrapperStore.js";
import { createInMemorySectorCorrectionStore } from "./sectorCorrectionStore.js";
import { createInMemorySectorInferenceSettingStore } from "./sectorInferenceSetting.js";

function pricedPosition(symbol: string, marketValue: number, description?: string) {
  return {
    symbol,
    entity: "personal" as const,
    ...(description ? { description } : {}),
    quantity: 1,
    marketValue,
    portfolioWeight: null,
    priceStatus: "priced" as const,
    currency: "EUR",
    asOf: "2026-08-18",
    returns: {
      status: "unpriced" as const,
      remainingCostBasis: 0,
      realizedCostBasisRemoved: 0,
      unrealizedGain: 0,
      realizedGain: 0,
      dividendsReceived: 0,
      totalReturn: 0,
      totalReturnPercentage: null,
      sinceFirstBuyPercentage: null,
      firstBuyDate: null,
    },
  };
}

const acceptedConsentStore = () => ({
  get: vi.fn(async () => ({
    tenantId: "local",
    accepted: true,
    decidedAt: "2026-08-21T12:00:00.000Z",
    disclosureVersion: "yahoo-finance-v1",
  })),
  set: vi.fn(async () => undefined),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("GET /health reports investing server health through Hono app.request", async () => {
  const response = await app.request("/health");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: true,
    service: "investing-server",
    sharedPriceStore: false,
  });
});

test("dashboard route returns injected core-shaped read model and selected symbol", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push({
    symbol: "AAPL",
    entity: "personal",
    description: "Apple",
    quantity: 2,
    marketValue: 200,
    portfolioWeight: 1,
    priceStatus: "priced",
    currency: "USD",
    asOf: "2026-08-18",
    returns: {
      status: "available",
      remainingCostBasis: 180,
      realizedCostBasisRemoved: 0,
      unrealizedGain: 20,
      realizedGain: 0,
      dividendsReceived: 0,
      totalReturn: 20,
      totalReturnPercentage: 20 / 180,
      sinceFirstBuyPercentage: 20 / 180,
      firstBuyDate: "2026-01-02",
    },
  });
  const dashboardReader = vi.fn(async ({ symbol }: { symbol?: string }) => ({
    ...dashboard,
    problems: symbol ? [`selected:${symbol}`] : [],
  }));
  const investingApp = createApp({ dashboardReader });

  const response = await investingApp.request("/api/investing/dashboard?symbol=aapl");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...dashboard, problems: ["selected:aapl"] });
  expect(dashboardReader).toHaveBeenCalledWith(expect.objectContaining({ symbol: "aapl" }));
});

test("dashboard route reports each phase it ran in Server-Timing", async () => {
  const investingApp = createApp({
    dashboardReader: async ({ timing }) => {
      await timing?.measure("stored", async () => null);
      return emptyInvestingDashboard();
    },
  });

  const response = await investingApp.request("/api/investing/dashboard");

  expect(response.headers.get("Server-Timing")).toMatch(/^stored;dur=\d+\.\d, total;dur=\d+\.\d$/);
});

test("dashboard route reports read-model failures without inventing values", async () => {
  const problemReporter = vi.fn();
  const investingApp = createApp({
    dashboardReader: vi.fn().mockRejectedValue(new Error("read failed")),
    problemReporter,
  });

  const response = await investingApp.request("/api/investing/dashboard");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ...emptyInvestingDashboard(),
    problems: ["Dashboard data could not be loaded"],
  });
  expect(problemReporter).toHaveBeenCalledWith({
    source: "dashboard-read",
    problems: ["read failed"],
  });
});

test("dashboard keeps available data when broker status storage fails", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.problems.push("Price data could not be fully loaded");
  const investingApp = createApp({
    dashboardReader: async () => dashboard,
    brokerReadability: async () => {
      throw new Error("database unavailable");
    },
  });

  const response = await investingApp.request("/api/investing/dashboard");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ...dashboard,
    problems: [
      "Price data could not be fully loaded",
      "Broker connection status could not be checked. Showing available data.",
    ],
  });
});

test("benchmark API persists ordered replace-whole selection and rejects invalid caps", async () => {
  const benchmarkSelectionStore = createInMemoryBenchmarkSelectionStore();
  const investingApp = createApp({
    benchmarkSelectionStore,
    priceSyncTargets: () => [],
  });
  const saved = await investingApp.request("/api/investing/benchmarks", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbols: ["^AEX", "^GDAXI"] }),
  });
  expect(saved.status).toBe(200);
  expect(await (await investingApp.request("/api/investing/benchmarks")).json()).toEqual({
    tenantId: "local",
    symbols: ["^AEX", "^GDAXI"],
  });
  const invalid = await investingApp.request("/api/investing/benchmarks", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbols: ["A", "B", "C", "D"] }),
  });
  expect(invalid.status).toBe(400);
});

test("benchmark API starts an unselected account on MSCI World", async () => {
  const benchmarkSelectionStore = createInMemoryBenchmarkSelectionStore();
  const investingApp = createApp({
    benchmarkSelectionStore,
    priceSyncTargets: () => [],
  });

  /* An account that never chose is measured against MSCI World instead of
   * leaving beta and alpha structurally unavailable. */
  expect(await (await investingApp.request("/api/investing/benchmarks")).json()).toEqual({
    tenantId: "local",
    symbols: ["IWDA.AS"],
  });

  await investingApp.request("/api/investing/benchmarks", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbols: ["^AEX"] }),
  });
  expect(await (await investingApp.request("/api/investing/benchmarks")).json()).toEqual({
    tenantId: "local",
    symbols: ["^AEX"],
  });

  /* Removing every choice returns the account to the default rather than to a
   * state where the card can never compute beta. */
  await investingApp.request("/api/investing/benchmarks", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbols: [] }),
  });
  expect(await (await investingApp.request("/api/investing/benchmarks")).json()).toEqual({
    tenantId: "local",
    symbols: ["IWDA.AS"],
  });
});

test("layout route persists per-tenant choices and drops unknown ids", async () => {
  const investingLayoutStore = createInMemoryInvestingLayoutStore();
  const investingApp = createApp({ investingLayoutStore });

  expect(await (await investingApp.request("/api/investing/layout")).json()).toEqual({
    modules: {},
    widgets: {},
  });

  const saved = await investingApp.request("/api/investing/layout", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      modules: { positions: false, "unknown-module": true },
      widgets: { sectors: false },
    }),
  });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({
    modules: { positions: false },
    widgets: { sectors: false },
  });
  expect(await (await investingApp.request("/api/investing/layout")).json()).toEqual({
    modules: { positions: false },
    widgets: { sectors: false },
  });
});

test("layout route rejects a body that is not a JSON object and keeps the stored layout", async () => {
  const investingApp = createApp({ investingLayoutStore: createInMemoryInvestingLayoutStore() });
  const put = (body: string) =>
    investingApp.request("/api/investing/layout", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
    });
  expect((await put(JSON.stringify({ modules: { agents: false }, widgets: {} }))).status).toBe(200);

  for (const body of ["not json", "null", "[]", '"layout"']) {
    const response = await put(body);
    expect(response.status, body).toBe(400);
  }
  expect(await (await investingApp.request("/api/investing/layout")).json()).toEqual({
    modules: { agents: false },
    widgets: {},
  });
});

test("a benchmark added via PUT during an already-running sync is fetched next by that same sync", async () => {
  // priceSyncTargets is wired to the real benchmark selection store, exactly as
  // apps/investing-server/src/index.ts wires it in production: PUT only ever
  // writes that store. Nothing here calls into the orchestrator that is running.
  const holdings: PriceSyncTarget[] = [
    {
      instrumentKey: `sym:${"ASML"}:${"EUR"}`,
      kind: "current",
      symbol: "ASML",
      ticker: "ASML",
      exchange: "AMS",
      currency: "EUR",
      backfillFrom: "2024-01-01",
    },
    {
      instrumentKey: `sym:${"ADYEN"}:${"EUR"}`,
      kind: "current",
      symbol: "ADYEN",
      ticker: "ADYEN",
      exchange: "AMS",
      currency: "EUR",
      backfillFrom: "2024-01-01",
    },
  ];
  const benchmarkSelectionStore = createInMemoryBenchmarkSelectionStore();
  const priceSyncTargets = vi.fn(async (tenantId: string) => {
    const { symbols } = await benchmarkSelectionStore.get(tenantId);
    return [
      ...symbols.map((symbol) => ({
        instrumentKey: symKey(symbol, "EUR"),
        kind: "benchmark" as const,
        symbol,
        ticker: symbol,
        exchange: "UNKNOWN",
        currency: "EUR",
        backfillFrom: "2024-01-01",
      })),
      ...holdings,
    ];
  });
  let releaseFirst!: () => void;
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const provider = {
    sourceKey: "yahoo",
    priority: 10,
    get: vi.fn(async (request: { symbol: string }) => {
      if (request.symbol === "ASML") await firstPending;
      return { bars: [], problems: [] };
    }),
  };
  const investingApp = createApp({
    provider: provider as never,
    benchmarkSelectionStore,
    priceSyncTargets,
    // The default 5 s throttle on the mid-sync re-check (see priceOrchestrator's
    // benchmarkRecheckEveryMs) would outlast this test's real-time window.
    priceSyncBenchmarkRecheckEveryMs: 0,
    marketDataConsentStore: acceptedConsentStore(),
  });

  const sync = investingApp.request("/api/prices/sync", { method: "POST" });
  await vi.waitFor(() =>
    expect(provider.get).toHaveBeenCalledWith(expect.objectContaining({ symbol: "ASML" })),
  );

  const put = await investingApp.request("/api/investing/benchmarks", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbols: ["^AEX"] }),
  });
  expect(put.status).toBe(200);

  releaseFirst();
  await sync;

  expect(provider.get.mock.calls.map(([request]) => request.symbol)).toEqual([
    "ASML",
    "^AEX",
    "ADYEN",
  ]);
});

test("benchmark search route returns results after persisted consent", async () => {
  const benchmarkSearch = vi.fn().mockResolvedValue({
    results: [{ symbol: "^AEX", name: "AEX", exchange: "Amsterdam", currency: "EUR" }],
    fallback: false,
    problems: [],
  });
  const investingApp = createApp({
    benchmarkSearch,
    marketDataConsentStore: acceptedConsentStore(),
  });
  const response = await investingApp.request("/api/investing/benchmarks/search?q=AEX");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ results: [{ symbol: "^AEX" }], fallback: false });
  expect(benchmarkSearch).toHaveBeenCalledWith("AEX");
});

test("Yahoo search and price calls fail before consent, and consent alone fetches nothing", async () => {
  const marketDataConsentStore = {
    accepted: false,
    async get() {
      return {
        tenantId: "local",
        accepted: this.accepted,
        decidedAt: null,
        disclosureVersion: "yahoo-finance-v1",
      };
    },
    async set(decision: { accepted: boolean }) {
      this.accepted = decision.accepted;
    },
  };
  const provider = {
    sourceKey: "yahoo",
    priority: 10,
    get: vi.fn().mockResolvedValue({ bars: [], problems: [] }),
  };
  const investingApp = createApp({
    marketDataConsentStore,
    provider: provider as never,
    priceSyncTargets: () => [
      {
        instrumentKey: `sym:${"ASML"}:${"EUR"}`,
        kind: "current",
        symbol: "ASML",
        ticker: "ASML",
        exchange: "AMS",
        currency: "EUR",
        backfillFrom: "2026-01-01",
      },
    ],
  });

  expect((await investingApp.request("/api/investing/benchmarks/search?q=AEX")).status).toBe(428);
  expect((await investingApp.request("/api/prices/sync", { method: "POST" })).status).toBe(428);
  expect(provider.get).not.toHaveBeenCalled();
  const accepted = await investingApp.request("/api/market-data/consent", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accepted: true }),
  });
  expect(accepted.status).toBe(200);
  expect(await (await investingApp.request("/api/market-data/consent")).json()).toMatchObject({
    accepted: true,
  });
  /* Recording a decision fetches nothing on its own. Work started after the
   * response is not guaranteed to run on a serverless host, so the sync only
   * happens inside a request that waits for it. */
  expect(provider.get).not.toHaveBeenCalled();
  expect((await investingApp.request("/api/prices/sync", { method: "POST" })).status).toBe(200);
  expect(provider.get).toHaveBeenCalledOnce();
});

test("price sync uses Yahoo Finance after persisted consent", async () => {
  const fetchJsonWithCrumb = vi.fn();
  const investingApp = createApp({
    store: createInMemorySharedPriceStore(),
    provider: createYahooPriceProvider({ client: { fetchJsonWithCrumb } as never }),
    priceSyncTargets: () => [
      {
        instrumentKey: `sym:${"ASML"}:${"EUR"}`,
        kind: "current",
        symbol: "ASML",
        ticker: "ASML",
        exchange: "AMS",
        currency: "EUR",
        backfillFrom: "2026-01-01",
      },
    ],
    marketDataConsentStore: acceptedConsentStore(),
  });
  const response = await investingApp.request("/api/prices/sync", { method: "POST" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ total: 1, completed: 1, remainingSymbols: [] });
  expect(fetchJsonWithCrumb).toHaveBeenCalled();
});

test("router problems reach HTTP response unchanged", async () => {
  const provider = {
    sourceKey: "yahoo",
    priority: 10,
    get: vi
      .fn()
      .mockResolvedValue({ bars: [], problems: ["Yahoo Finance rate-limited price request"] }),
  };
  const investingApp = createApp({
    provider: provider as never,
    priceSyncTargets: () => [
      {
        instrumentKey: `sym:${"ASML"}:${"EUR"}`,
        kind: "current",
        symbol: "ASML",
        ticker: "ASML",
        exchange: "AMS",
        currency: "EUR",
        backfillFrom: "2026-01-01",
      },
    ],
    marketDataConsentStore: acceptedConsentStore(),
  });
  await investingApp.request("/api/prices/sync", { method: "POST" });
  expect(await (await investingApp.request("/api/prices/sync/status")).json()).toMatchObject({
    problems: ["ASML: Yahoo Finance rate-limited price request"],
  });
  expect(provider.get).toHaveBeenCalledOnce();
});

test("a closed position Yahoo confirms delisted does not flip Price history to problem", async () => {
  const provider = {
    sourceKey: "yahoo",
    priority: 10,
    get: vi.fn().mockResolvedValue({
      bars: [],
      problems: ["No listing found on Yahoo Finance for SKX (tried 1 symbol)"],
      notFound: true,
    }),
  };
  const investingApp = createApp({
    provider: provider as never,
    priceSyncTargets: () => [
      {
        instrumentKey: `sym:${"SKX_US_EQ"}:${"USD"}`,
        kind: "closed",
        symbol: "SKX_US_EQ",
        ticker: "SKX_US_EQ",
        exchange: "UNKNOWN",
        currency: "USD",
        backfillFrom: "2024-01-01",
      },
    ],
    marketDataConsentStore: acceptedConsentStore(),
  });

  await investingApp.request("/api/prices/sync", { method: "POST" });

  expect(await (await investingApp.request("/api/prices/sync/status")).json()).toMatchObject({
    status: "completed",
    problems: [],
  });
});

test("GET /api/config/status reports missing keys without returning key values", async () => {
  const llmKey = process.env.ANTHROPIC_API_KEY;
  const marketDataKey = process.env.MARKET_DATA_API_KEY;
  process.env.ANTHROPIC_API_KEY = "llm-response-redaction-secret";
  process.env.MARKET_DATA_API_KEY = "market-response-redaction-secret";

  try {
    const response = await app.request("/api/config/status");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("llm-response-redaction-secret");
    expect(body).not.toContain("market-response-redaction-secret");
    expect(body).toContain("ANTHROPIC_API_KEY");
    expect(body).toContain("MARKET_DATA_API_KEY");
  } finally {
    if (llmKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = llmKey;
    if (marketDataKey === undefined) delete process.env.MARKET_DATA_API_KEY;
    else process.env.MARKET_DATA_API_KEY = marketDataKey;
  }
});

test("market-data routes expose FX and identifier lanes", async () => {
  // The default fxProvider hits the real Frankfurter API; inject a fake HTTP
  // client so this test stays hermetic instead of depending on the network.
  const fxProvider = createFrankfurterFxProvider({
    client: {
      fetchJson: async () => ({ base: "EUR", date: "2026-08-22", rates: { USD: 1.1699 } }),
    },
  });
  const investingApp = createApp({ fxProvider });

  const response = await investingApp.request("/api/market-data/fx?from=EUR&to=USD");
  expect(response.status).toBe(200);
  expect((await response.json()).source).toBe("frankfurter");

  const invalid = await investingApp.request("/api/market-data/identifier");
  expect(invalid.status).toBe(400);
});

test("price sync resolves ISIN before asking price provider", async () => {
  const provider = {
    sourceKey: "yahoo",
    priority: 10,
    get: vi.fn().mockResolvedValue({ bars: [], problems: [] }),
  };
  const identifierProvider = {
    sourceKey: "openfigi",
    priority: 10,
    get: vi.fn().mockResolvedValue({
      match: { isin: "NL0010273215", ticker: "ASML", exchange: "AMS" },
      problems: [],
    }),
  };
  const investingApp = createApp({
    provider: provider as never,
    identifierProvider: identifierProvider as never,
    priceSyncTargets: () => [
      {
        instrumentKey: `isin:${"NL0010273215"}:${"EUR"}`,
        kind: "current",
        symbol: "ASML",
        ticker: "ASML",
        exchange: "UNKNOWN",
        isin: "NL0010273215",
        currency: "EUR",
        backfillFrom: "2026-01-01",
      },
    ],
    marketDataConsentStore: acceptedConsentStore(),
  });
  await investingApp.request("/api/prices/sync", { method: "POST" });
  expect(provider.get).toHaveBeenCalled();
  expect(identifierProvider.get).toHaveBeenCalledWith(
    expect.objectContaining({ isin: "NL0010273215" }),
  );
  expect(provider.get).toHaveBeenCalledWith(
    expect.objectContaining({ symbol: "ASML", ticker: "ASML", exchange: "AMS" }),
  );
});

test.each(["CPRX_US_EQ", "MASI_US_EQ", "SKX_US_EQ"])(
  "price sync preserves Trading 212 ticker %s and ISIN for Yahoo resolution",
  async (ticker) => {
    const isin = "US0000000001";
    const provider = {
      sourceKey: "yahoo",
      priority: 10,
      get: vi.fn().mockResolvedValue({ bars: [], problems: [] }),
    };
    const identifierProvider = {
      sourceKey: "openfigi",
      priority: 10,
      get: vi.fn().mockResolvedValue({
        match: { isin, ticker: "OTHER", exchange: "US" },
        problems: [],
      }),
    };
    const investingApp = createApp({
      provider: provider as never,
      identifierProvider: identifierProvider as never,
      priceSyncTargets: () => [
        {
          instrumentKey: priceInstrumentKey({ symbol: ticker, currency: "USD", isin }),
          kind: "current",
          symbol: ticker,
          ticker,
          exchange: "UNKNOWN",
          isin,
          currency: "USD",
          backfillFrom: "2026-01-01",
        },
      ],
      marketDataConsentStore: acceptedConsentStore(),
    });

    await investingApp.request("/api/prices/sync", { method: "POST" });

    expect(identifierProvider.get).not.toHaveBeenCalled();
    expect(provider.get).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: ticker, ticker, exchange: "UNKNOWN", isin }),
    );
  },
);

test.each([
  {
    name: "known US listing",
    isin: "US8740391003",
    matchIsin: "US8740391003",
    exchange: "US",
    resolved: true,
  },
  {
    name: "unknown exchange",
    isin: "US8740391003",
    matchIsin: "US8740391003",
    exchange: "UNKNOWN",
    resolved: false,
  },
  {
    name: "missing ISIN",
    isin: undefined,
    matchIsin: "US8740391003",
    exchange: "US",
    resolved: false,
  },
  {
    name: "different ISIN",
    isin: "US8740391003",
    matchIsin: "US0000000001",
    exchange: "US",
    resolved: false,
  },
])(
  "default Yahoo provider resolves a missing encoded listing only with $name",
  async ({ isin, matchIsin, exchange, resolved }) => {
    const requested: string[] = [];
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://fc.yahoo.com/")
          return new Response("", { headers: { "set-cookie": "A=B; Path=/" } });
        if (url.includes("getcrumb")) return new Response("crumb-value");
        if (url.includes("/v1/finance/search")) return json({ quotes: [] });
        const symbol = decodeURIComponent(new URL(url).pathname.split("/").at(-1)!);
        requested.push(symbol);
        if (symbol === "TSM")
          return json({
            chart: {
              result: [
                {
                  meta: { currency: "USD" },
                  timestamp: [Date.parse("2026-01-01T00:00:00Z") / 1000],
                  indicators: { quote: [{ close: [200] }] },
                },
              ],
            },
          });
        return new Response(
          JSON.stringify({
            chart: { result: null, error: { code: "Not Found", description: "No data found" } },
          }),
          { status: 404 },
        );
      }),
    );
    const identifierProvider = {
      sourceKey: "openfigi",
      priority: 10,
      get: vi.fn().mockResolvedValue({
        match: { isin: matchIsin, ticker: "TSM", exchange },
        problems: [],
      }),
    };
    const store = createInMemorySharedPriceStore();
    const investingApp = createApp({
      store,
      identifierProvider: identifierProvider as never,
      priceSyncTargets: () => [
        {
          instrumentKey: priceInstrumentKey({
            symbol: "TSFAd_EQ",
            currency: "EUR",
            ...(isin ? { isin } : {}),
          }),
          kind: "current",
          symbol: "TSFAd_EQ",
          ticker: "TSFAd_EQ",
          exchange: "UNKNOWN",
          ...(isin ? { isin } : {}),
          currency: "EUR",
          backfillFrom: "2026-01-01",
          today: "2026-01-02",
        },
      ],
      marketDataConsentStore: acceptedConsentStore(),
    });

    expect((await investingApp.request("/api/prices/sync", { method: "POST" })).status).toBe(200);

    if (isin)
      expect(identifierProvider.get).toHaveBeenCalledWith(expect.objectContaining({ isin }));
    else expect(identifierProvider.get).not.toHaveBeenCalled();
    expect(requested[0]).toBe("TSFA.DE");
    if (resolved) {
      expect(requested).toContain("TSM");
      expect(
        await store.getCoverage({
          key: `isin:${String(isin).toUpperCase()}:EUR`,
          alias: symKey("TSFAd_EQ"),
        }),
      ).toMatchObject({
        listing: "TSM",
        currency: "USD",
      });
      expect(
        await store.getRange({
          key: `isin:${String(isin).toUpperCase()}:EUR`,
          alias: symKey("TSFAd_EQ"),
        }),
      ).toEqual([{ date: "2026-01-01", close: 200, currency: "USD", split: 1 }]);
    } else {
      expect(requested).toEqual(["TSFA.DE"]);
      expect(await legacyPrices(store).getCoverage("local", "TSFAd_EQ")).toBeNull();
      expect(await legacyPrices(store).getRange("local", "TSFAd_EQ")).toEqual([]);
    }
  },
);

test("broker sync route forwards force and keeps problems in response", async () => {
  const brokerSync = vi.fn(async (force: boolean) => ({
    outcomes: [{ status: "synced" }],
    problems: force ? ["ibkr: unavailable"] : [],
  }));
  const investingApp = createApp({ brokerSync });
  const response = await investingApp.request("/api/brokers/sync?force=true", { method: "POST" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    outcomes: [{ status: "synced" }],
    problems: ["ibkr: unavailable"],
  });
  expect(brokerSync).toHaveBeenCalledWith(true, ["holdings", "history"], undefined, false);
  await investingApp.request("/api/brokers/sync?force=true&rebuildOrders=true", {
    method: "POST",
  });
  expect(brokerSync).toHaveBeenLastCalledWith(true, ["holdings", "history"], undefined, true);
});

test("broker sync passes host deadline to broker work", async () => {
  const brokerSync = vi.fn(async () => ({ outcomes: [], problems: [] }));
  const investingApp = createApp({ brokerSync, priceSyncDeadline: () => 1_234 });

  const response = await investingApp.request("/api/brokers/sync", { method: "POST" });

  expect(response.status).toBe(200);
  expect(brokerSync).toHaveBeenCalledWith(false, ["holdings", "history"], 1_234, false);
});

test("broker sync starts server-side price orchestration despite broker problems", async () => {
  const provider = {
    sourceKey: "yahoo",
    priority: 10,
    get: vi.fn().mockResolvedValue({ bars: [], problems: [] }),
  };
  const investingApp = createApp({
    brokerSync: vi.fn(async () => ({ outcomes: [], problems: ["ibkr: unavailable"] })),
    provider: provider as never,
    priceSyncTargets: () => [
      {
        instrumentKey: `sym:${"CLOSED"}:${"EUR"}`,
        kind: "closed",
        symbol: "CLOSED",
        ticker: "CLOSED",
        exchange: "UNKNOWN",
        currency: "EUR",
        backfillFrom: "2024-01-01",
      },
    ],
    marketDataConsentStore: acceptedConsentStore(),
  });

  await investingApp.request("/api/brokers/sync", { method: "POST" });
  expect(provider.get).toHaveBeenCalledOnce();
});

test("the holdings lane request never starts price sync", async () => {
  const provider = {
    sourceKey: "yahoo",
    priority: 10,
    get: vi.fn().mockResolvedValue({ bars: [], problems: [] }),
  };
  const brokerSync = vi.fn(async () => ({ outcomes: [], problems: [] }));
  const investingApp = createApp({
    brokerSync,
    provider: provider as never,
    priceSyncTargets: () => [
      {
        instrumentKey: symKey("CLOSED", "EUR"),
        kind: "closed",
        symbol: "CLOSED",
        ticker: "CLOSED",
        exchange: "UNKNOWN",
        currency: "EUR",
        backfillFrom: "2024-01-01",
      },
    ],
    marketDataConsentStore: acceptedConsentStore(),
  });

  const response = await investingApp.request("/api/brokers/sync?lane=holdings", {
    method: "POST",
  });

  expect(response.status).toBe(200);
  expect(brokerSync).toHaveBeenCalledWith(false, ["holdings"], undefined, false);
  expect(provider.get).not.toHaveBeenCalled();
});

test("the history lane request starts price sync and asks only for history", async () => {
  const provider = {
    sourceKey: "yahoo",
    priority: 10,
    get: vi.fn().mockResolvedValue({ bars: [], problems: [] }),
  };
  const brokerSync = vi.fn(async () => ({ outcomes: [], problems: [] }));
  const investingApp = createApp({
    brokerSync,
    provider: provider as never,
    priceSyncTargets: () => [
      {
        instrumentKey: symKey("CLOSED", "EUR"),
        kind: "closed",
        symbol: "CLOSED",
        ticker: "CLOSED",
        exchange: "UNKNOWN",
        currency: "EUR",
        backfillFrom: "2024-01-01",
      },
    ],
    marketDataConsentStore: acceptedConsentStore(),
  });

  await investingApp.request("/api/brokers/sync?lane=history", { method: "POST" });

  expect(brokerSync).toHaveBeenCalledWith(false, ["history"], undefined, false);
  expect(provider.get).toHaveBeenCalledOnce();
});

test("an unknown lane is rejected without starting any work", async () => {
  const brokerSync = vi.fn(async () => ({ outcomes: [], problems: [] }));
  const investingApp = createApp({ brokerSync });

  const response = await investingApp.request("/api/brokers/sync?lane=everything", {
    method: "POST",
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ problems: ["Unknown lane: everything"] });
  expect(brokerSync).not.toHaveBeenCalled();
});

test("broker sync route converts unexpected failures into a useful response", async () => {
  const investingApp = createApp({
    brokerSync: vi.fn().mockRejectedValue(new Error("adapter failed")),
  });
  const response = await investingApp.request("/api/brokers/sync", { method: "POST" });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    outcomes: [],
    problems: ["Broker synchronization failed"],
  });
});

test("broker credentials route stores validated IBKR credentials without returning secrets", async () => {
  const configureBroker = vi.fn(async () => undefined);
  const investingApp = createApp({ configureBroker });
  const response = await investingApp.request("/api/brokers/credentials", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      broker: "ibkr",
      token: "flex-token",
      queryId: "123456",
      passphrase: "vault-passphrase",
    }),
  });

  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  expect(configureBroker).toHaveBeenCalledWith({
    broker: "ibkr",
    token: "flex-token",
    queryId: "123456",
    passphrase: "vault-passphrase",
  });
});

test("broker vault routes report status and unlock without returning passphrase", async () => {
  const credentialStatus = vi.fn(async () => "locked" as const);
  const unlockCredentials = vi.fn(async () => true);
  const investingApp = createApp({ credentialStatus, unlockCredentials });

  const statusResponse = await investingApp.request("/api/brokers/credentials/status");
  expect(await statusResponse.json()).toEqual({ status: "locked", passphrase: "required" });

  const unlockResponse = await investingApp.request("/api/brokers/credentials/unlock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passphrase: "vault-passphrase" }),
  });
  expect(unlockResponse.status).toBe(204);
  expect(await unlockResponse.text()).toBe("");
  expect(unlockCredentials).toHaveBeenCalledWith("vault-passphrase");
});

test("broker vault unlock rejects wrong passphrase without leaking details", async () => {
  const investingApp = createApp({ unlockCredentials: vi.fn(async () => false) });
  const response = await investingApp.request("/api/brokers/credentials/unlock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passphrase: "wrong" }),
  });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ problems: ["Vault could not be unlocked"] });
});

test("broker sync logs every returned problem with context and redacts secrets", async () => {
  const write = vi.fn();
  const brokerSync = vi.fn(async () => ({
    outcomes: [],
    problems: ["ibkr: request failed", "token=super-secret"],
  }));
  const investingApp = createApp({ brokerSync, problemReporter: createProblemReporter({ write }) });

  await investingApp.request("/api/brokers/sync", { method: "POST" });

  expect(write).toHaveBeenCalledOnce();
  expect(write.mock.calls[0]?.[0]).toContain('"source":"broker-sync"');
  expect(write.mock.calls[0]?.[0]).toContain("ibkr: request failed");
  expect(write.mock.calls[0]?.[0]).not.toContain("super-secret");
});

test("reporting stays disabled when SENTRY_DSN is absent", () => {
  const write = vi.fn();
  const sentry = { captureException: vi.fn() };
  const reporter = createProblemReporter({ write, sentry });

  reporter({ source: "broker-sync", problems: ["ibkr: unavailable"] });

  expect(write).toHaveBeenCalledOnce();
  expect(sentry.captureException).not.toHaveBeenCalled();
});

test("without a database the cache route clears the local shared store", async () => {
  const store = createInMemorySharedPriceStore();
  const onPriceDataChanged = vi.fn();
  const clearPriceCache = vi.fn(async () => undefined);
  await legacyPrices(store).upsert("local", [
    { symbol: "ASML", date: "2026-01-01", close: 100, currency: "EUR" },
  ]);
  const response = await createApp({
    store,
    clearPriceCache,
    onPriceDataChanged,
  }).request("/api/prices/cache", { method: "DELETE" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ deleted: true });
  expect(clearPriceCache).toHaveBeenCalledOnce();
  expect(onPriceDataChanged).toHaveBeenCalledOnce();
});

test("with a database the cache route refuses: prices are shared, not one user's", async () => {
  const store = createInMemorySharedPriceStore();
  const response = await createApp({ store, sharedPriceStore: true }).request("/api/prices/cache", {
    method: "DELETE",
  });
  expect(response.status).toBe(405);
  expect(await response.json()).toMatchObject({
    problems: ["Shared price data cannot be cleared from one account"],
  });
});

test("summary route composes metrics, cached sectors, and top positions; sector failure degrades to Unknown", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push(
    {
      symbol: "AAPL",
      entity: "personal",
      quantity: 1,
      marketValue: 300,
      portfolioWeight: null,
      priceStatus: "priced",
      currency: "EUR",
      asOf: "2026-08-18",
      returns: {
        status: "unpriced",
        remainingCostBasis: 0,
        realizedCostBasisRemoved: 0,
        unrealizedGain: 0,
        realizedGain: 0,
        dividendsReceived: 0,
        totalReturn: 0,
        totalReturnPercentage: null,
        sinceFirstBuyPercentage: null,
        firstBuyDate: null,
      },
    },
    {
      symbol: "MYST",
      entity: "personal",
      quantity: 1,
      marketValue: 100,
      portfolioWeight: null,
      priceStatus: "priced",
      currency: "EUR",
      asOf: "2026-08-18",
      returns: {
        status: "unpriced",
        remainingCostBasis: 0,
        realizedCostBasisRemoved: 0,
        unrealizedGain: 0,
        realizedGain: 0,
        dividendsReceived: 0,
        totalReturn: 0,
        totalReturnPercentage: null,
        sinceFirstBuyPercentage: null,
        firstBuyDate: null,
      },
    },
  );
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  const sectorProfile = vi.fn(async () => null);
  const investingApp = createApp({
    dashboardReader: vi.fn(async () => ({
      ...dashboard,
      risk: buildRiskProjection(dashboard),
      composition: buildCompositionProjection(dashboard.positions),
      problems: [],
    })),
    sectorProfile,
    sectorStore,
    marketDataConsentStore: acceptedConsentStore(),
  });

  const response = await investingApp.request("/api/investing/summary");
  /* #309: even with consent, the summary reads stored profiles only. */
  expect(sectorProfile).not.toHaveBeenCalled();
  expect(response.status).toBe(200);
  const payload = (await response.json()) as {
    metrics: unknown;
    sectors: Array<{ sector: string; weight: number }>;
    topPositions: Array<{ symbol: string; weight: number }>;
  };
  expect(payload.metrics).toMatchObject({
    dailyVolatility: null,
    beta: null,
    maxDrawdown: null,
    observationDays: 0,
  });
  expect(payload.sectors).toEqual([
    { sector: "Technology", weight: 0.75 },
    { sector: "Unknown", weight: 0.25 },
  ]);
  expect(payload.topPositions).toEqual([
    { symbol: "AAPL", weight: 0.75 },
    { symbol: "MYST", weight: 0.25 },
  ]);
});

test("summary route reads a renamed holding's stored sector under the ticker price sync resolved it to, without a provider call", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push({
    symbol: "OAC_US_EQ",
    entity: "personal",
    quantity: 1,
    marketValue: 100,
    portfolioWeight: null,
    priceStatus: "priced",
    currency: "USD",
    asOf: "2026-08-18",
    returns: {
      status: "unpriced",
      remainingCostBasis: 0,
      realizedCostBasisRemoved: 0,
      unrealizedGain: 0,
      realizedGain: 0,
      dividendsReceived: 0,
      totalReturn: 0,
      totalReturnPercentage: null,
      sinceFirstBuyPercentage: null,
      firstBuyDate: null,
    },
  });
  const store = createInMemorySharedPriceStore();
  // The series key carries the position's currency; the coverage records the
  // listing's quote currency (issue #307).
  await store.putCoverage("sym:OAC_US_EQ:USD", {
    from: "2026-01-01",
    to: "2026-09-01",
    listing: "HIMS",
    currency: "USD",
    provider: "yahoo",
  });
  const sectorProfile = vi.fn(async (symbol: string) =>
    symbol === "HIMS"
      ? {
          kind: "stock" as const,
          sector: "Healthcare",
          industry: "Health Information Services",
          source: "provider" as const,
        }
      : null,
  );
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("HIMS", {
    kind: "stock",
    sector: "Healthcare",
    industry: "Health Information Services",
    source: "provider",
  });
  const investingApp = createApp({
    dashboardReader: vi.fn(async () => ({ ...dashboard, problems: [] })),
    store,
    sectorProfile,
    sectorStore,
    marketDataConsentStore: acceptedConsentStore(),
  });

  const response = await investingApp.request("/api/investing/summary");

  expect(response.status).toBe(200);
  const payload = (await response.json()) as { sectors: Array<{ sector: string; weight: number }> };
  expect(payload.sectors).toEqual([{ sector: "Healthcare", weight: 1 }]);
  expect(sectorProfile).not.toHaveBeenCalled();
});

test("GET sectors with consent still fetches a never-attempted symbol under its listing ticker and stores the profile", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push(pricedPosition("OAC_US_EQ", 100));
  const store = createInMemorySharedPriceStore();
  // The series key carries the position's currency; the coverage records the
  // listing's quote currency (issue #307).
  await store.putCoverage("sym:OAC_US_EQ:EUR", {
    from: "2026-01-01",
    to: "2026-09-01",
    listing: "HIMS",
    currency: "USD",
    provider: "yahoo",
  });
  const sectorStore = createInMemorySectorProfileStore();
  const sectorProfile = vi.fn(async (symbol: string) =>
    symbol === "HIMS"
      ? {
          kind: "stock" as const,
          sector: "Healthcare",
          industry: "Health Information Services",
          source: "provider" as const,
        }
      : null,
  );
  const investingApp = createApp({
    dashboardReader: async () => dashboard,
    store,
    sectorProfile,
    sectorStore,
    marketDataConsentStore: acceptedConsentStore(),
  });

  const response = await investingApp.request("/api/investing/sectors");

  expect(response.status).toBe(200);
  expect(((await response.json()) as { sectors: unknown }).sectors).toEqual([
    { sector: "Healthcare", weight: 1 },
  ]);
  expect(sectorProfile).toHaveBeenCalledWith("HIMS", { deadlineMs: expect.any(Number) });
  expect(sectorProfile).not.toHaveBeenCalledWith("OAC_US_EQ", expect.anything());
  expect(await sectorStore.get("HIMS")).toMatchObject({ sector: "Healthcare" });
});

test("summary route includes a position's description in top positions when set", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push({
    symbol: "AAPL",
    entity: "personal",
    description: "Apple Inc.",
    quantity: 1,
    marketValue: 100,
    portfolioWeight: null,
    priceStatus: "priced",
    currency: "EUR",
    asOf: "2026-08-18",
    returns: {
      status: "unpriced",
      remainingCostBasis: 0,
      realizedCostBasisRemoved: 0,
      unrealizedGain: 0,
      realizedGain: 0,
      dividendsReceived: 0,
      totalReturn: 0,
      totalReturnPercentage: null,
      sinceFirstBuyPercentage: null,
      firstBuyDate: null,
    },
  });
  const investingApp = createApp({
    dashboardReader: async () => ({
      ...dashboard,
      composition: buildCompositionProjection(dashboard.positions),
      problems: [],
    }),
    sectorProfile: vi.fn(async () => ({
      kind: "stock" as const,
      sector: "Technology",
      industry: "Hardware",
      source: "provider" as const,
    })),
  });

  const response = await investingApp.request("/api/investing/summary");
  const payload = (await response.json()) as {
    topPositions: Array<{ symbol: string; weight: number; description?: string }>;
  };

  expect(response.status).toBe(200);
  expect(payload.topPositions).toEqual([{ symbol: "AAPL", weight: 1, description: "Apple Inc." }]);
});

test("summary route negotiates the Yahoo crumb at most once across positions and requests", async () => {
  const crumbRequests = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://fc.yahoo.com/")) {
        return new Response(null, { status: 200, headers: { "set-cookie": "A=1; Path=/" } });
      }
      if (url.startsWith("https://query2.finance.yahoo.com/v1/test/getcrumb")) {
        crumbRequests();
        return new Response("test-crumb", { status: 200 });
      }
      if (url.includes("/v10/finance/quoteSummary/")) {
        return new Response(
          JSON.stringify({
            quoteSummary: {
              result: [{ assetProfile: { sector: "Technology", industry: "Software" } }],
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    }),
  );

  const dashboard = emptyInvestingDashboard();
  const returns = {
    status: "unpriced" as const,
    remainingCostBasis: 0,
    realizedCostBasisRemoved: 0,
    unrealizedGain: 0,
    realizedGain: 0,
    dividendsReceived: 0,
    totalReturn: 0,
    totalReturnPercentage: null,
    sinceFirstBuyPercentage: null,
    firstBuyDate: null,
  };
  dashboard.positions.push(
    {
      symbol: "AAPL",
      entity: "personal",
      quantity: 1,
      marketValue: 300,
      portfolioWeight: null,
      priceStatus: "priced",
      currency: "EUR",
      asOf: "2026-08-18",
      returns,
    },
    {
      symbol: "MSFT",
      entity: "personal",
      quantity: 1,
      marketValue: 100,
      portfolioWeight: null,
      priceStatus: "priced",
      currency: "EUR",
      asOf: "2026-08-18",
      returns,
    },
  );
  // No sectorProfile / sectorHttpClient override: this exercises the actual
  // default wiring in createApp, not a test double standing in for it.
  // Consent must be accepted, or the route never calls Yahoo at all.
  const investingApp = createApp({
    dashboardReader: vi.fn(async () => ({ ...dashboard, problems: [] })),
    marketDataConsentStore: acceptedConsentStore(),
  });

  const first = await investingApp.request("/api/investing/summary");
  const second = await investingApp.request("/api/investing/summary");

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(crumbRequests.mock.calls.length).toBeLessThanOrEqual(1);
});

test("summary route reports failures as 503 problem payload", async () => {
  const investingApp = createApp({ dashboardReader: vi.fn().mockRejectedValue(new Error("down")) });
  const response = await investingApp.request("/api/investing/summary");
  expect(response.status).toBe(503);
});

test("summary reads the dashboard's risk projection and rejects invalid risk selectors", async () => {
  const report = {
    metrics: {
      dailyVolatility: 0.01,
      annualizedVolatility: 0.16,
      beta: 1.1,
      alpha: 0.02,
      maxDrawdown: -0.2,
      observationDays: 60,
      excludedIntervals: 0,
      pairedObservationDays: 60,
      startDate: "2026-01-01",
      endDate: "2026-04-01",
    },
    risk: {
      status: "estimate" as const,
      basis: "account" as const,
      range: "1Y" as const,
      from: "2026-01-01",
      to: "2026-04-01",
      drawdownFrom: null,
      minimumObservations: 60,
      benchmark: null,
      benchmarks: [],
      reasons: [],
      missingHoldings: [],
      missingPrices: [],
      coverage: 1,
      currency: "EUR",
    },
  };
  const dashboard = {
    ...emptyInvestingDashboard(),
    risk: {
      byBenchmark: { "": { "6M": report, "1Y": report, All: report } },
      defaultBenchmark: null,
    },
  };
  const app = createApp({ dashboardReader: async () => dashboard });
  const response = await app.request("/api/investing/summary?range=1Y");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    metrics: { annualizedVolatility: 0.16, maxDrawdown: -0.2, beta: 1.1, observationDays: 60 },
    risk: { status: "estimate", range: "1Y", benchmark: null },
  });
  expect((await app.request("/api/investing/summary?range=invalid")).status).toBe(400);
  expect((await app.request("/api/investing/summary?benchmark=NOT_SELECTED")).status).toBe(400);
});

test("summary reads a configured benchmark's projection entry for that benchmark", async () => {
  const report = {
    metrics: {
      dailyVolatility: null,
      annualizedVolatility: null,
      beta: null,
      alpha: null,
      maxDrawdown: null,
      observationDays: 0,
      excludedIntervals: 0,
      pairedObservationDays: 0,
      startDate: null,
      endDate: null,
    },
    risk: {
      status: "unavailable" as const,
      basis: "account" as const,
      range: "6M" as const,
      from: null,
      to: null,
      drawdownFrom: null,
      minimumObservations: 60,
      benchmark: { symbol: "SP500", name: "S&P 500", currency: "EUR" },
      benchmarks: [],
      reasons: [],
      missingHoldings: [],
      missingPrices: [],
      coverage: null,
      currency: "EUR",
    },
  };
  const empty = emptyInvestingDashboard();
  const dashboard = {
    ...empty,
    benchmarks: [
      {
        symbol: "SP500",
        name: "S&P 500",
        exchange: "NYSE Arca",
        currency: "EUR",
        converted: false,
        points: [],
      },
    ],
    risk: {
      byBenchmark: { SP500: { "6M": report, "1Y": report, All: report } },
      defaultBenchmark: "SP500",
    },
  };
  const app = createApp({ dashboardReader: async () => dashboard });
  const selected = await app.request("/api/investing/summary?range=6M&benchmark=SP500");
  expect(selected.status).toBe(200);
  expect(await selected.json()).toMatchObject({
    risk: { status: "unavailable", range: "6M", benchmark: { symbol: "SP500" } },
  });
  const defaulted = await app.request("/api/investing/summary?range=6M");
  expect(defaulted.status).toBe(200);
  expect(await defaulted.json()).toMatchObject({ risk: { benchmark: { symbol: "SP500" } } });
});

test("tenant-scoped routes read and write under the resolved tenant, not the local default", async () => {
  const benchmarkSelectionStore = {
    get: vi.fn(async (tenantId: string) => ({ tenantId, symbols: ["^GSPC"] })),
    set: vi.fn(async () => undefined),
  };
  const marketDataConsentStore = {
    get: vi.fn(async (tenantId: string) => ({
      tenantId,
      accepted: true,
      decidedAt: null,
      disclosureVersion: "yahoo-finance-v1",
    })),
    set: vi.fn(async () => undefined),
  };
  const investingApp = createApp({
    resolveTenantId: () => "user-123",
    benchmarkSelectionStore,
    marketDataConsentStore,
  });

  const benchmarks = await investingApp.request("/api/investing/benchmarks");
  expect(benchmarks.status).toBe(200);
  expect(benchmarkSelectionStore.get).toHaveBeenCalledWith("user-123");

  const stored = await investingApp.request("/api/investing/benchmarks", {
    method: "PUT",
    body: JSON.stringify({ symbols: ["^AEX"] }),
    headers: { "content-type": "application/json" },
  });
  expect(stored.status).toBe(200);
  expect(benchmarkSelectionStore.set).toHaveBeenCalledWith({
    tenantId: "user-123",
    symbols: ["^AEX"],
  });

  const consent = await investingApp.request("/api/market-data/consent", {
    method: "PUT",
    body: JSON.stringify({ accepted: true }),
    headers: { "content-type": "application/json" },
  });
  expect(consent.status).toBe(200);
  expect(marketDataConsentStore.set).toHaveBeenCalledWith(
    expect.objectContaining({ tenantId: "user-123", accepted: true }),
  );
});

test("tenant defaults to the local tenant when no resolver is injected", async () => {
  const benchmarkSelectionStore = {
    get: vi.fn(async (tenantId: string) => ({ tenantId, symbols: [] })),
    set: vi.fn(async () => undefined),
  };
  const investingApp = createApp({ benchmarkSelectionStore });

  await investingApp.request("/api/investing/benchmarks");

  expect(benchmarkSelectionStore.get).toHaveBeenCalledWith("local");
});

test("the status route says whether a passphrase is used at all", async () => {
  const investingApp = createApp({
    credentialStatus: vi.fn(async () => "empty" as const),
    passphraseMode: () => "unused",
  });

  const response = await investingApp.request("/api/brokers/credentials/status");

  expect(await response.json()).toEqual({ status: "empty", passphrase: "unused" });
});

test("credentials are accepted without a passphrase when the server holds the key", async () => {
  const configureBroker = vi.fn(async () => undefined);
  const investingApp = createApp({ configureBroker, passphraseMode: () => "unused" });

  const response = await investingApp.request("/api/brokers/credentials", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ broker: "trading212", token: "api-key", secret: "api-secret" }),
  });

  expect(response.status).toBe(204);
  expect(configureBroker).toHaveBeenCalledWith({
    broker: "trading212",
    token: "api-key",
    queryId: undefined,
    secret: "api-secret",
    passphrase: undefined,
  });
});

test("a passphrase-locked vault still refuses credentials without one", async () => {
  const investingApp = createApp({ configureBroker: vi.fn(async () => undefined) });

  const response = await investingApp.request("/api/brokers/credentials", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ broker: "trading212", token: "api-key", secret: "api-secret" }),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ problems: ["passphrase is required"] });
});

test("health answers under /api/ too, because that is the only path a mount forwards", async () => {
  const runtime = createApp();

  const response = await runtime.request("/api/investing/health");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: true,
    service: "investing-server",
    sharedPriceStore: false,
  });
});

test("detailed health fails when Trading 212 data is stale", async () => {
  const runtime = createApp({
    healthCheck: async () => ({
      status: "degraded",
      storage: "neon",
      checks: {
        database: "ok",
        migrationLedger: "ok",
        tenantIsolation: "enforced",
        vault: "ok",
        trading212Credentials: "configured",
        trading212Sync: "stale",
        snapshot: "loaded",
      },
      trading212: { lastSyncedAt: "2026-09-18T12:00:00.000Z", positions: 3 },
    }),
  });

  const response = await runtime.request("/api/investing/health/detail");

  expect(response.status).toBe(503);
  expect((await response.json()).checks.trading212Sync).toBe("stale");
});

test("summary stays 200 when sector lookup fails after a priced dashboard", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push({
    symbol: "AAPL",
    entity: "personal",
    description: "Apple",
    quantity: 2,
    marketValue: 200,
    portfolioWeight: 1,
    priceStatus: "priced",
    currency: "USD",
    asOf: "2026-08-18",
    returns: {
      status: "available",
      remainingCostBasis: 180,
      realizedCostBasisRemoved: 0,
      unrealizedGain: 20,
      realizedGain: 0,
      dividendsReceived: 0,
      totalReturn: 20,
      totalReturnPercentage: 20 / 180,
      sinceFirstBuyPercentage: 20 / 180,
      firstBuyDate: "2026-01-02",
    },
  });
  dashboard.composition = buildCompositionProjection(dashboard.positions);
  const investingApp = createApp({
    dashboardReader: async () => dashboard,
    sectorProfile: vi.fn().mockRejectedValue(new Error("yahoo down")),
  });

  const response = await investingApp.request("/api/investing/summary");
  const body = (await response.json()) as { topPositions: { symbol: string }[]; sectors: unknown };

  expect(response.status).toBe(200);
  expect(body.topPositions).toEqual([{ symbol: "AAPL", weight: 1, description: "Apple" }]);
  expect(body.sectors).toBeDefined();
});

test("summary route does not fetch sector profiles without market data consent", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push({
    symbol: "AAPL",
    entity: "personal",
    quantity: 1,
    marketValue: 100,
    portfolioWeight: null,
    priceStatus: "priced",
    currency: "EUR",
    asOf: "2026-08-18",
    returns: {
      status: "unpriced",
      remainingCostBasis: 0,
      realizedCostBasisRemoved: 0,
      unrealizedGain: 0,
      realizedGain: 0,
      dividendsReceived: 0,
      totalReturn: 0,
      totalReturnPercentage: null,
      sinceFirstBuyPercentage: null,
      firstBuyDate: null,
    },
  });
  const sectorProfile = vi.fn(async () => ({
    kind: "stock" as const,
    sector: "Technology",
    industry: "Hardware",
    source: "provider" as const,
  }));
  // No marketDataConsentStore override: the default starts unaccepted, exactly
  // like a tenant who has never seen the Yahoo Finance disclosure.
  const investingApp = createApp({
    dashboardReader: vi.fn(async () => ({ ...dashboard, problems: [] })),
    sectorProfile,
  });

  const response = await investingApp.request("/api/investing/summary");

  expect(response.status).toBe(200);
  expect(sectorProfile).not.toHaveBeenCalled();
});

/* TRADING 212 GEBRUIKT EEN SLEUTELPAAR — sleutel als gebruikersnaam, geheim als
 * wachtwoord, samen Basic-gecodeerd. Hun eigen documentatie zegt het met zoveel
 * woorden, en dit is hier één ronde lang verkeerd gelezen: de eis is toen
 * weggehaald op de aanname dat er één credential was.
 *
 * Die aanname maakte het erger dan de wrijving die hij moest wegnemen. Opslaan
 * met een leeg geheim levert `base64("key:")` op, en dat authenticeert per
 * definitie nooit — een 401 waar het formulier zelf de oorzaak van was, en niet
 * te onderscheiden van een verkeerde sleutel. */
test("a Trading 212 connection needs both halves of the key pair", async () => {
  const investingApp = createApp({ configureBroker: vi.fn(async () => undefined) });
  const response = await investingApp.request("/api/brokers/credentials", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      broker: "trading212",
      token: "t212-api-key",
      passphrase: "vault-passphrase",
    }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ problems: ["secret is required for trading212"] });
});

/* De sleutel zelf blijft wél verplicht — zonder die is er niets om mee te
 * verbinden, en dat is een echte fout in plaats van een verzonnen eis. */
test("a Trading 212 connection still demands the key itself", async () => {
  const investingApp = createApp({ configureBroker: vi.fn(async () => undefined) });
  const response = await investingApp.request("/api/brokers/credentials", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ broker: "trading212", secret: "", passphrase: "vault-passphrase" }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ problems: ["token is required"] });
});

test("GET position sector reads the resolved sector for that symbol", async () => {
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  const investingApp = createApp({ sectorStore });

  const response = await investingApp.request("/api/investing/positions/AAPL/sector");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    kind: "stock",
    sector: "Technology",
    source: "provider",
  });
});

test("GET position sector reports Unknown for a symbol with no profile and no correction", async () => {
  const investingApp = createApp({});
  const response = await investingApp.request("/api/investing/positions/MYST/sector");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ kind: "unknown", sector: "Unknown", source: "unknown" });
});

test("GET position sector finds a renamed holding's profile under the ticker price sync resolved it to", async () => {
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("HIMS", {
    kind: "stock",
    sector: "Healthcare",
    industry: "Health Information Services",
    source: "provider",
  });
  const store = createInMemorySharedPriceStore();
  // The series key carries the position's currency; the coverage records the
  // listing's quote currency (issue #307).
  await store.putCoverage("sym:OAC_US_EQ:EUR", {
    from: "2026-01-01",
    to: "2026-09-01",
    listing: "HIMS",
    currency: "USD",
    provider: "yahoo",
  });
  const investingApp = createApp({ store, sectorStore });

  const response = await investingApp.request("/api/investing/positions/OAC_US_EQ/sector");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    kind: "stock",
    sector: "Healthcare",
    source: "provider",
  });
});

test("GET position sector reports an inferred profile's confidence when inference is enabled and consented", async () => {
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("MYST", {
    kind: "stock",
    sector: "Healthcare",
    industry: "Unknown",
    source: "inferred",
    specificity: "sector",
    confidence: 0.82,
    inferredAt: "2026-09-01T00:00:00.000Z",
  });
  const sectorInferenceSettingStore = createInMemorySectorInferenceSettingStore();
  await sectorInferenceSettingStore.set("local", true);
  const investingApp = createApp({
    sectorStore,
    sectorInferenceSettingStore,
    marketDataConsentStore: acceptedConsentStore(),
  });

  const response = await investingApp.request("/api/investing/positions/MYST/sector");

  expect(await response.json()).toEqual({
    kind: "stock",
    sector: "Healthcare",
    source: "inferred",
    confidence: 0.82,
  });
});

test("GET position sector hides an inferred profile as Unknown when the owner's inference setting is off", async () => {
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("MYST", {
    kind: "stock",
    sector: "Healthcare",
    industry: "Unknown",
    source: "inferred",
    specificity: "sector",
    confidence: 0.82,
    inferredAt: "2026-09-01T00:00:00.000Z",
  });
  // sectorInferenceSettingStore defaults to disabled.
  const investingApp = createApp({ sectorStore, marketDataConsentStore: acceptedConsentStore() });

  const response = await investingApp.request("/api/investing/positions/MYST/sector");

  expect(await response.json()).toEqual({ kind: "stock", sector: "Unknown", source: "unknown" });
});

test("GET position sector hides an inferred profile as Unknown when market-data consent is off, even with inference enabled", async () => {
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("MYST", {
    kind: "stock",
    sector: "Healthcare",
    industry: "Unknown",
    source: "inferred",
    specificity: "sector",
    confidence: 0.82,
    inferredAt: "2026-09-01T00:00:00.000Z",
  });
  const sectorInferenceSettingStore = createInMemorySectorInferenceSettingStore();
  await sectorInferenceSettingStore.set("local", true);
  // marketDataConsentStore defaults to not accepted.
  const investingApp = createApp({ sectorStore, sectorInferenceSettingStore });

  const response = await investingApp.request("/api/investing/positions/MYST/sector");

  expect(await response.json()).toEqual({ kind: "stock", sector: "Unknown", source: "unknown" });
});

test("GET position sector reports a cached no-match inference as unknown, not as a confident inference", async () => {
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("MYST", {
    kind: "stock",
    sector: "Unknown",
    industry: "Unknown",
    source: "inferred",
    specificity: "sector",
    confidence: 0,
    inferredAt: "2026-09-01T00:00:00.000Z",
  });
  const investingApp = createApp({ sectorStore });

  const response = await investingApp.request("/api/investing/positions/MYST/sector");

  expect(await response.json()).toEqual({ kind: "stock", sector: "Unknown", source: "unknown" });
});

test("GET position sector reports a fund with no single sector, since it's split across holdings", async () => {
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("VFEM.L", {
    kind: "fund",
    weights: [
      { sector: "Technology", weight: 0.3 },
      { sector: "Healthcare", weight: 0.5 },
    ],
    source: "provider",
  });
  const investingApp = createApp({ sectorStore });

  const response = await investingApp.request("/api/investing/positions/VFEM.L/sector");

  expect(await response.json()).toEqual({ kind: "fund", sector: null, source: "provider" });
});

test("PUT position sector rejects a label outside the GICS set", async () => {
  const investingApp = createApp({});
  const response = await investingApp.request("/api/investing/positions/AAPL/sector", {
    method: "PUT",
    body: JSON.stringify({ sector: "Not A Sector" }),
    headers: { "content-type": "application/json" },
  });
  expect(response.status).toBe(400);
});

test("PUT position sector then GET reflects the correction immediately, no provider call", async () => {
  const sectorProfile = vi.fn();
  const investingApp = createApp({ sectorProfile });

  const put = await investingApp.request("/api/investing/positions/AAPL/sector", {
    method: "PUT",
    body: JSON.stringify({ sector: "Healthcare" }),
    headers: { "content-type": "application/json" },
  });
  expect(put.status).toBe(204);

  const response = await investingApp.request("/api/investing/positions/AAPL/sector");
  expect(await response.json()).toEqual({
    kind: "stock",
    sector: "Healthcare",
    source: "correction",
  });
  expect(sectorProfile).not.toHaveBeenCalled();
});

test("GET position sector never touches the provider or the classifier", async () => {
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  const sectorProfile = vi.fn();
  const sectorClassifier = vi.fn();
  const investingApp = createApp({ sectorStore, sectorProfile, sectorClassifier });

  await investingApp.request("/api/investing/positions/AAPL/sector");

  expect(sectorProfile).not.toHaveBeenCalled();
  expect(sectorClassifier).not.toHaveBeenCalled();
});

test("GET position sector: a fund's cached profile outranks a stale owner correction, and the correction isn't reported", async () => {
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 1 }],
    source: "provider",
  });
  const sectorCorrectionStore = createInMemorySectorCorrectionStore();
  await sectorCorrectionStore.set("local", "VFEM.L", "Energy");
  const investingApp = createApp({ sectorStore, sectorCorrectionStore });

  const response = await investingApp.request("/api/investing/positions/VFEM.L/sector");

  expect(await response.json()).toEqual({ kind: "fund", sector: null, source: "provider" });
});

test("PUT position sector rejects a fund symbol, since a fund's sector is its weight vector", async () => {
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 1 }],
    source: "provider",
  });
  const investingApp = createApp({ sectorStore });

  const response = await investingApp.request("/api/investing/positions/VFEM.L/sector", {
    method: "PUT",
    body: JSON.stringify({ sector: "Healthcare" }),
    headers: { "content-type": "application/json" },
  });

  expect(response.status).toBe(422);
});

test("PUT position sector is accepted for a symbol with no stored profile yet", async () => {
  const investingApp = createApp({});
  const response = await investingApp.request("/api/investing/positions/AAPL/sector", {
    method: "PUT",
    body: JSON.stringify({ sector: "Healthcare" }),
    headers: { "content-type": "application/json" },
  });
  expect(response.status).toBe(204);
});

test("DELETE position sector clears the correction and reverts to automatic resolution", async () => {
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  const investingApp = createApp({ sectorStore });

  await investingApp.request("/api/investing/positions/AAPL/sector", {
    method: "PUT",
    body: JSON.stringify({ sector: "Healthcare" }),
    headers: { "content-type": "application/json" },
  });
  const cleared = await investingApp.request("/api/investing/positions/AAPL/sector", {
    method: "DELETE",
  });
  expect(cleared.status).toBe(204);

  const response = await investingApp.request("/api/investing/positions/AAPL/sector");
  expect(await response.json()).toEqual({
    kind: "stock",
    sector: "Technology",
    source: "provider",
  });
});

test("sector-correction routes read and write under the resolved tenant", async () => {
  const sectorCorrectionStore = createInMemorySectorCorrectionStore();
  const investingApp = createApp({ resolveTenantId: () => "user-123", sectorCorrectionStore });

  await investingApp.request("/api/investing/positions/AAPL/sector", {
    method: "PUT",
    body: JSON.stringify({ sector: "Healthcare" }),
    headers: { "content-type": "application/json" },
  });

  expect(await sectorCorrectionStore.get("user-123", "AAPL")).toBe("Healthcare");
  expect(await sectorCorrectionStore.get("local", "AAPL")).toBeNull();
});

test("the sector-inference setting defaults to disabled and can be turned on", async () => {
  const investingApp = createApp({});

  const before = await investingApp.request("/api/investing/sector-inference");
  expect(await before.json()).toEqual({ enabled: false, available: false });

  const put = await investingApp.request("/api/investing/sector-inference", {
    method: "PUT",
    body: JSON.stringify({ enabled: true }),
    headers: { "content-type": "application/json" },
  });
  expect(put.status).toBe(200);

  const after = await investingApp.request("/api/investing/sector-inference");
  expect(await after.json()).toEqual({ enabled: true, available: false });
});

test("the sector-inference setting is isolated per tenant", async () => {
  const sectorInferenceSettingStore = createInMemorySectorInferenceSettingStore();
  const investingApp = createApp({
    resolveTenantId: () => "user-123",
    sectorInferenceSettingStore,
  });

  await investingApp.request("/api/investing/sector-inference", {
    method: "PUT",
    body: JSON.stringify({ enabled: true }),
    headers: { "content-type": "application/json" },
  });

  expect(await sectorInferenceSettingStore.get("user-123")).toBe(true);
  expect(await sectorInferenceSettingStore.get("local")).toBe(false);
});

test("sector inference rejects a non-boolean enabled value", async () => {
  const investingApp = createApp({});
  const response = await investingApp.request("/api/investing/sector-inference", {
    method: "PUT",
    body: JSON.stringify({ enabled: "yes" }),
    headers: { "content-type": "application/json" },
  });
  expect(response.status).toBe(400);
});

test("infer requires market-data consent before it will classify anything", async () => {
  const sectorClassifier = vi.fn();
  const sectorInferenceSettingStore = createInMemorySectorInferenceSettingStore();
  await sectorInferenceSettingStore.set("local", true);
  const investingApp = createApp({ sectorClassifier, sectorInferenceSettingStore });

  const response = await investingApp.request("/api/investing/sectors/infer", { method: "POST" });

  expect(response.status).toBe(428);
  expect(sectorClassifier).not.toHaveBeenCalled();
});

test("infer requires the owner's inference setting to be on, even with consent given", async () => {
  const sectorClassifier = vi.fn();
  const investingApp = createApp({
    sectorClassifier,
    marketDataConsentStore: acceptedConsentStore(),
  });

  const response = await investingApp.request("/api/investing/sectors/infer", { method: "POST" });

  expect(response.status).toBe(428);
  expect(sectorClassifier).not.toHaveBeenCalled();
});

test("infer rejects a non-array exclude instead of silently ignoring it", async () => {
  const sectorInferenceSettingStore = createInMemorySectorInferenceSettingStore();
  await sectorInferenceSettingStore.set("local", true);
  const investingApp = createApp({
    marketDataConsentStore: acceptedConsentStore(),
    sectorInferenceSettingStore,
    sectorClassifier: vi.fn(),
  });

  const response = await investingApp.request("/api/investing/sectors/infer", {
    method: "POST",
    body: JSON.stringify({ exclude: "BOOM" }),
    headers: { "content-type": "application/json" },
  });

  expect(response.status).toBe(400);
});

test("infer reads sector corrections once per request, not once per candidate", async () => {
  const sectorInferenceSettingStore = createInMemorySectorInferenceSettingStore();
  await sectorInferenceSettingStore.set("local", true);
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push(
    pricedPosition("AAPL", 100),
    pricedPosition("MSFT", 100),
    pricedPosition("GOOG", 100),
  );
  const sectorCorrectionStore = createInMemorySectorCorrectionStore();
  const getAll = vi.spyOn(sectorCorrectionStore, "getAll");
  const sectorClassifier = vi.fn(async () => ({ kind: "no-match" as const }));
  const investingApp = createApp({
    dashboardReader: async () => ({ ...dashboard, problems: [] }),
    marketDataConsentStore: acceptedConsentStore(),
    sectorInferenceSettingStore,
    sectorCorrectionStore,
    sectorClassifier,
  });

  await investingApp.request("/api/investing/sectors/infer", { method: "POST" });

  expect(getAll).toHaveBeenCalledTimes(1);
});

test("summary route reports a sector-coverage breakdown alongside the sector exposure", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push(pricedPosition("AAPL", 100));
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  const investingApp = createApp({
    dashboardReader: async () => ({ ...dashboard, problems: [] }),
    sectorStore,
  });

  const response = await investingApp.request("/api/investing/summary");
  const body = (await response.json()) as { sectorCoverage: Record<string, number> };

  expect(body.sectorCoverage).toEqual({ provider: 1, inferred: 0, correction: 0, unknown: 0 });
});

test("summary route never calls the classifier, even when one is configured and inference is enabled", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push(pricedPosition("MYST", 100, "Myst Robotics"));
  const sectorInferenceSettingStore = createInMemorySectorInferenceSettingStore();
  await sectorInferenceSettingStore.set("local", true);
  const sectorClassifier = vi.fn();
  const investingApp = createApp({
    dashboardReader: async () => ({ ...dashboard, problems: [] }),
    marketDataConsentStore: acceptedConsentStore(),
    sectorInferenceSettingStore,
    sectorClassifier,
  });

  const response = await investingApp.request("/api/investing/summary");

  expect(response.status).toBe(200);
  expect(sectorClassifier).not.toHaveBeenCalled();
});

test("a correction wins immediately in the very next summary", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push(pricedPosition("AAPL", 100));
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  const investingApp = createApp({
    dashboardReader: async () => ({ ...dashboard, problems: [] }),
    sectorStore,
  });

  await investingApp.request("/api/investing/positions/AAPL/sector", {
    method: "PUT",
    body: JSON.stringify({ sector: "Healthcare" }),
    headers: { "content-type": "application/json" },
  });

  const response = await investingApp.request("/api/investing/summary");
  const body = (await response.json()) as { sectors: Array<{ sector: string; weight: number }> };

  expect(body.sectors).toEqual([{ sector: "Healthcare", weight: 1 }]);
});

test("summary route hides an inferred profile's sector when the owner's inference setting is off, counting it as unknown", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push(pricedPosition("MYST", 100));
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("MYST", {
    kind: "stock",
    sector: "Healthcare",
    industry: "Unknown",
    source: "inferred",
    specificity: "sector",
    confidence: 0.82,
    inferredAt: "2026-09-01T00:00:00.000Z",
  });
  // sectorInferenceSettingStore defaults to disabled.
  const investingApp = createApp({
    dashboardReader: async () => ({ ...dashboard, problems: [] }),
    sectorStore,
    marketDataConsentStore: acceptedConsentStore(),
  });

  const response = await investingApp.request("/api/investing/summary");
  const body = (await response.json()) as {
    sectors: Array<{ sector: string; weight: number }>;
    sectorCoverage: Record<string, number>;
  };

  expect(body.sectors).toEqual([{ sector: "Unknown", weight: 1 }]);
  expect(body.sectorCoverage).toEqual({ provider: 0, inferred: 0, correction: 0, unknown: 1 });
});

test("summary route shows an inferred profile's sector once the owner's inference setting and consent are both on", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push(pricedPosition("MYST", 100));
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("MYST", {
    kind: "stock",
    sector: "Healthcare",
    industry: "Unknown",
    source: "inferred",
    specificity: "sector",
    confidence: 0.82,
    inferredAt: "2026-09-01T00:00:00.000Z",
  });
  const sectorInferenceSettingStore = createInMemorySectorInferenceSettingStore();
  await sectorInferenceSettingStore.set("local", true);
  const investingApp = createApp({
    dashboardReader: async () => ({ ...dashboard, problems: [] }),
    sectorStore,
    sectorInferenceSettingStore,
    marketDataConsentStore: acceptedConsentStore(),
  });

  const response = await investingApp.request("/api/investing/summary");
  const body = (await response.json()) as { sectors: Array<{ sector: string; weight: number }> };

  expect(body.sectors).toEqual([{ sector: "Healthcare", weight: 1 }]);
});

test("summary route reads sector corrections once per request, not once per position", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push(
    pricedPosition("AAPL", 100),
    pricedPosition("MSFT", 100),
    pricedPosition("GOOG", 100),
  );
  const sectorCorrectionStore = createInMemorySectorCorrectionStore();
  const getAll = vi.spyOn(sectorCorrectionStore, "getAll");
  const investingApp = createApp({
    dashboardReader: async () => ({ ...dashboard, problems: [] }),
    sectorCorrectionStore,
  });

  await investingApp.request("/api/investing/summary");

  expect(getAll).toHaveBeenCalledTimes(1);
});

test("GET sector-inference reports availability based on whether a classifier is configured", async () => {
  const withClassifier = createApp({ sectorClassifier: vi.fn() });
  const withoutClassifier = createApp({});

  expect(
    await (await withClassifier.request("/api/investing/sector-inference")).json(),
  ).toMatchObject({
    available: true,
  });
  expect(
    await (await withoutClassifier.request("/api/investing/sector-inference")).json(),
  ).toMatchObject({
    available: false,
  });
});

test("GET sectors returns the value-weighted exposure and coverage from the sector read", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push(pricedPosition("AAPL", 100));
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  const investingApp = createApp({ dashboardReader: async () => dashboard, sectorStore });

  const response = await investingApp.request("/api/investing/sectors");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    sectors: [{ sector: "Technology", weight: 1 }],
    sectorCoverage: { provider: 1, inferred: 0, correction: 0, unknown: 0 },
    revision: 0,
  });
});

test("a correction write raises the sector revision so the very next sector read shows it", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push(pricedPosition("AAPL", 100));
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  const investingApp = createApp({ dashboardReader: async () => dashboard, sectorStore });

  const before = (await (await investingApp.request("/api/investing/sectors")).json()) as {
    sectors: Array<{ sector: string }>;
    revision: number;
  };
  expect(before.sectors).toEqual([{ sector: "Technology", weight: 1 }]);
  expect(before.revision).toBe(0);

  await investingApp.request("/api/investing/positions/AAPL/sector", {
    method: "PUT",
    body: JSON.stringify({ sector: "Healthcare" }),
    headers: { "content-type": "application/json" },
  });

  const after = (await (await investingApp.request("/api/investing/sectors")).json()) as {
    sectors: Array<{ sector: string; weight: number }>;
    revision: number;
  };
  expect(after.sectors).toEqual([{ sector: "Healthcare", weight: 1 }]);
  expect(after.revision).toBe(1);
});

test("a price run hands its deadline to every partner slot: OpenFIGI, the crumb and the chart", async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("openfigi"))
        return new Response(JSON.stringify([{ data: [{ ticker: "ASML", exchCode: "NA" }] }]));
      if (url === "https://fc.yahoo.com/")
        return new Response("", { headers: { "set-cookie": "A=B; Path=/" } });
      if (url.includes("getcrumb")) return new Response("crumb");
      return new Response(
        JSON.stringify({
          chart: {
            result: [
              {
                meta: { currency: "EUR" },
                timestamp: [1_700_000_000],
                indicators: { quote: [{ close: [100] }] },
              },
            ],
          },
        }),
      );
    }),
  );
  const partnerBudget = createImmediatePartnerBudget();
  const deadline = Date.now() + 3_600_000;
  const investingApp = createPacedApp({
    partnerBudgetClient: partnerBudget,
    priceSyncDeadline: () => deadline,
    priceSyncTargets: () => [
      {
        instrumentKey: `isin:${"NL0010273215"}:${"EUR"}`,
        kind: "current",
        symbol: "ASML",
        ticker: "ASML",
        exchange: "AMS",
        currency: "EUR",
        isin: "NL0010273215",
        backfillFrom: "2026-01-01",
      },
    ],
    marketDataConsentStore: acceptedConsentStore(),
  });
  try {
    const response = await investingApp.request("/api/prices/sync", { method: "POST" });
    expect(response.status).toBe(200);
  } finally {
    vi.unstubAllGlobals();
  }

  const slots = partnerBudget.calls.filter((call) => call.call === "awaitSlot");
  expect(new Set(slots.map((call) => call.key.partner))).toEqual(new Set(["openfigi", "yahoo"]));
  expect(slots.length).toBe(urls.length);
  // The two crumb slots belong to the shared negotiation, which has its own 10 s
  // bound; every other slot carries the run's deadline.
  const own = slots.filter((call) => call.deadlineMs === deadline);
  const negotiation = slots.filter((call) => call.deadlineMs !== deadline);
  expect(negotiation).toHaveLength(2);
  for (const call of negotiation) {
    expect(call.key.partner).toBe("yahoo");
    expect(call.deadlineMs).toBeLessThanOrEqual(Date.now() + 10_000);
    expect(call.deadlineMs).toBeGreaterThan(Date.now());
  }
  expect(own).toHaveLength(slots.length - 2);
});

/* A budget stop on the OpenFIGI fallback is "no slot", not "no such listing".
 * Only a genuine Yahoo and OpenFIGI answer may mark a closed position delisted. */
test.each([
  ["PartnerBudgetUnavailable", () => new PartnerBudgetUnavailable({ message: "store down" })],
  ["PartnerWait", () => new PartnerWait({ until: DateTime.makeUnsafe(Date.now() + 600_000) })],
])(
  "a closed position whose OpenFIGI slot fails with %s is not recorded as delisted",
  async (_name, makeError) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://fc.yahoo.com/")
          return new Response("", { headers: { "set-cookie": "A=B; Path=/" } });
        if (url.includes("getcrumb")) return new Response("crumb");
        if (url.includes("/search")) return new Response(JSON.stringify({ quotes: [] }));
        return new Response(
          JSON.stringify({ chart: { result: null, error: { code: "Not Found" } } }),
          {
            status: 404,
          },
        );
      }),
    );
    const immediate = createImmediatePartnerBudget();
    const partnerBudget = {
      ...immediate,
      awaitSlot: async (key: { partner: string }, deadlineMs?: number) => {
        if (key.partner === "openfigi") throw makeError();
        await immediate.awaitSlot(key as never, deadlineMs);
      },
    };
    const store = createInMemorySharedPriceStore();
    const investingApp = createPacedApp({
      partnerBudgetClient: partnerBudget,
      store,
      priceSyncDeadline: () => Date.now() + 3_600_000,
      priceSyncTargets: () => [
        {
          instrumentKey: `isin:${"US8740391003"}:${"EUR"}`,
          kind: "closed",
          symbol: "GONEd_EQ",
          ticker: "GONEd_EQ",
          exchange: "UNKNOWN",
          currency: "EUR",
          isin: "US8740391003",
          backfillFrom: "2026-01-01",
        },
      ],
      marketDataConsentStore: acceptedConsentStore(),
    });
    try {
      const response = await investingApp.request("/api/prices/sync", { method: "POST" });
      const progress = (await response.json()) as { status: string; problems: string[] };
      expect(progress.status).toBe("paused");
      expect(progress.problems).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
    const coverage = await legacyPrices(store).getCoverage("local", "GONEd_EQ");
    expect(coverage?.delistedSince).toBeUndefined();
    expect(coverage?.listingMissingSince).toBeUndefined();
  },
);

test("the identifier route answers 503 with problems when the budget has no slot", async () => {
  const identifierProvider = {
    sourceKey: "openfigi",
    priority: 10,
    get: vi.fn(async () => {
      throw new PartnerBudgetUnavailable({ message: "store down" });
    }),
  };
  const investingApp = createApp({ identifierProvider: identifierProvider as never });
  const response = await investingApp.request("/api/market-data/identifier?isin=NL0010273215");
  expect(response.status).toBe(503);
  const body = (await response.json()) as { problems: string[] };
  expect(body.problems.length).toBeGreaterThan(0);
});

test("report route serves the dashboard's realised section", async () => {
  const report = emptyRealizedReport("EUR", "2026-11-11", ["A label needs attention."]);
  const investingApp = createApp({
    dashboardReader: async () => ({ ...emptyInvestingDashboard(), realized: report }),
  });

  const response = await investingApp.request("/api/investing/reports/realized");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(report);
});

test("report route degrades to an empty report when the read fails", async () => {
  const problemReporter = vi.fn();
  const investingApp = createApp({
    dashboardReader: vi.fn().mockRejectedValue(new Error("read failed")),
    problemReporter,
  });

  const response = await investingApp.request("/api/investing/reports/realized");

  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    notice: string;
    problems: string[];
    disposals: unknown[];
  };
  expect(body.disposals).toEqual([]);
  expect(body.notice).toMatch(/does not file taxes/);
  expect(body.problems).toEqual(["The realised report could not be loaded."]);
  expect(problemReporter).toHaveBeenCalledWith({
    source: "realized-report-read",
    problems: ["read failed"],
  });
});

test("account-wrapper route persists labels, drops unknown ones and rejects a non-array body", async () => {
  const accountWrapperStore = createInMemoryAccountWrapperStore();
  const investingApp = createApp({ accountWrapperStore });

  const put = await investingApp.request("/api/investing/account-wrappers", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      entries: [
        { broker: "trading212", account: "ISA", wrapper: "isa" },
        { broker: "ibkr", account: "Main", wrapper: "not-a-wrapper" },
      ],
    }),
  });
  expect(put.status).toBe(200);
  expect(await put.json()).toEqual({
    tenantId: "local",
    entries: [{ broker: "trading212", account: "ISA", wrapper: "isa" }],
  });

  const get = await investingApp.request("/api/investing/account-wrappers");
  expect(await get.json()).toEqual({
    tenantId: "local",
    entries: [{ broker: "trading212", account: "ISA", wrapper: "isa" }],
  });

  const rejected = await investingApp.request("/api/investing/account-wrappers", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entries: "nope" }),
  });
  expect(rejected.status).toBe(400);
});

/** The test-side translation from the old per-tenant price calls to the shared
 *  instrument keys (issue #307); production callers build the same keys. */
const symKey = (symbol: string, currency = "EUR"): string =>
  priceInstrumentKey({ symbol, currency });
function legacyPrices(store: SharedPriceStore) {
  return {
    async upsert(
      _tenant: string,
      bars: readonly (SharedPriceBar & { symbol?: string })[],
    ): Promise<void> {
      const groups = new Map<string, SharedPriceBar[]>();
      for (const bar of bars) {
        const key = symKey(bar.symbol ?? "", bar.currency);
        const { symbol: _symbol, ...rest } = bar;
        groups.set(key, [...(groups.get(key) ?? []), rest]);
      }
      await Promise.all([...groups].map(([key, rows]) => store.upsert(key, rows)));
    },
    async getRange(tenant: string, symbol: string, from?: string, to?: string) {
      void tenant;
      return store.getRange({ key: symKey(symbol) }, from, to);
    },
    async getCoverage(tenant: string, symbol: string) {
      void tenant;
      const coverage = await store.getCoverage({ key: symKey(symbol) });
      return coverage === null ? null : { ...coverage, symbol };
    },
    async putCoverage(_tenant: string, coverage: PriceCoverage) {
      const { symbol, ...rest } = coverage;
      return store.putCoverage(symKey(symbol, coverage.currency), {
        ...rest,
        provider: "unknown",
      });
    },
  };
}

test("POST /api/sync/continue refuses the wrong caller and validates runId and hop", async () => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
  const syncRun = createApp({
    syncRunStore: createMemorySyncRunStore(),
    syncRunBackground: async () => undefined,
  });
  const body = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ tenantId: "local", runId: "run-1", hop: 1, ...over });
  const send = (payload: string, authorized = true) =>
    syncRun.request("/api/sync/continue", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorized ? { authorization: "Bearer cron-secret" } : {}),
      },
      body: payload,
    });

  // No bearer secret: the route is machine-only.
  expect((await send(body(), false)).status).toBe(401);
  // Hop above MAX_HOPS is a schema-level 400, not a silent no-op.
  expect((await send(body({ hop: 21 }))).status).toBe(400);
  expect((await send(body({ runId: "" }))).status).toBe(400);
  // A run id that is not the stored one is accepted and does no work.
  const accepted = await send(body({ runId: "not-the-run" }));
  expect(accepted.status).toBe(202);
  expect(await accepted.json()).toEqual({ accepted: false });
});

test("POST /api/sync/refresh names the missing CRON_SECRET on a hosted host", async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("CRON_SECRET", "");
  const syncRun = createApp({});

  const response = await syncRun.request("/api/sync/refresh", { method: "POST" });

  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).toContain("CRON_SECRET");
});

/* Jev-03 (issue #136): the app is the tenant-aware caller of the identifier
 * seam. It supplies the owner's override, and it passes the model-selection
 * flag only when market-data consent AND the owner's enable setting agree. */

import {
  createInMemoryIdentifierOverrideStore,
  createInMemoryIdentifierSelectionSettingStore,
} from "./identifierSelectionStore.js";

const identifierProviderReturning = () => {
  const calls: unknown[] = [];
  return {
    calls,
    provider: {
      sourceKey: "openfigi",
      priority: 10,
      get: vi.fn(async (request: unknown) => {
        calls.push(request);
        return {
          match: { isin: "NL0010273215", ticker: "ASML", exchange: "AMS" },
          problems: [],
          resolution: { tier: "provider", confidence: null, candidates: [] },
        };
      }),
    },
  };
};

const acceptedConsent = () => ({
  get: vi.fn(async () => ({
    tenantId: "local",
    accepted: true,
    decidedAt: "2026-11-11T00:00:00.000Z",
    disclosureVersion: "yahoo-finance-v1",
  })),
  set: vi.fn(async () => undefined),
});

test("identifier selection is allowed only with market-data consent AND the enable setting", async () => {
  const { calls, provider } = identifierProviderReturning();
  const setting = createInMemoryIdentifierSelectionSettingStore();
  const consent = acceptedConsent();

  const withoutSetting = createApp({
    identifierProvider: provider as never,
    marketDataConsentStore: consent as never,
    identifierSelectionSettingStore: setting,
  });
  await withoutSetting.request("/api/market-data/identifier?isin=NL0010273215");
  expect(calls.at(-1)).toMatchObject({ isin: "NL0010273215", allowModelSelection: false });

  await setting.set("local", true);
  const withSetting = createApp({
    identifierProvider: provider as never,
    marketDataConsentStore: consent as never,
    identifierSelectionSettingStore: setting,
  });
  await withSetting.request("/api/market-data/identifier?isin=NL0010273215&name=ASML&currency=EUR");
  expect(calls.at(-1)).toMatchObject({
    isin: "NL0010273215",
    allowModelSelection: true,
    instrument: { name: "ASML", currency: "EUR" },
  });

  // Consent is the other half of the gate.
  const noConsent = createApp({
    identifierProvider: provider as never,
    marketDataConsentStore: {
      get: async () => ({
        tenantId: "local",
        accepted: false,
        decidedAt: null,
        disclosureVersion: "yahoo-finance-v1",
      }),
      set: async () => undefined,
    } as never,
    identifierSelectionSettingStore: setting,
  });
  await noConsent.request("/api/market-data/identifier?isin=NL0010273215");
  expect(calls.at(-1)).toMatchObject({ allowModelSelection: false });
});

test("the owner's identifier override is passed to the seam and outranks it", async () => {
  const { calls, provider } = identifierProviderReturning();
  const overrides = createInMemoryIdentifierOverrideStore();
  await overrides.set("local", { NL0010273215: { ticker: "ASML", exchange: "AMS" } });
  const investingApp = createApp({
    identifierProvider: provider as never,
    identifierOverrideStore: overrides,
  });

  await investingApp.request("/api/market-data/identifier?isin=nl0010273215");

  expect(calls.at(-1)).toMatchObject({
    isin: "NL0010273215",
    override: { ticker: "ASML", exchange: "AMS" },
  });
});

test("the identifier-selection and override routes persist per tenant and validate input", async () => {
  const setting = createInMemoryIdentifierSelectionSettingStore();
  const overrides = createInMemoryIdentifierOverrideStore();
  const investingApp = createApp({
    identifierSelectionSettingStore: setting,
    identifierOverrideStore: overrides,
    identifierSelectorForTenant: () => undefined,
  });

  const initial = await investingApp.request("/api/investing/identifier-selection");
  expect(await initial.json()).toEqual({ enabled: false, available: true });

  const put = await investingApp.request("/api/investing/identifier-selection", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  expect(put.status).toBe(200);
  expect(await setting.get("local")).toBe(true);

  const putOverrides = await investingApp.request("/api/investing/identifier-overrides", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      overrides: {
        nl0010273215: { ticker: "asml", exchange: "ams" },
        "not-an-isin": { ticker: "X" },
        NL0000000002: { ticker: "" },
      },
    }),
  });
  expect(await putOverrides.json()).toEqual({
    overrides: { NL0010273215: { ticker: "ASML", exchange: "AMS" } },
  });
  const read = await investingApp.request("/api/investing/identifier-overrides");
  expect(await read.json()).toEqual({
    overrides: { NL0010273215: { ticker: "ASML", exchange: "AMS" } },
  });
});

const cashFlowSuggestion = (over: Record<string, unknown> = {}) => ({
  broker: "trading212",
  typeKey: "NEW_KIND",
  rawType: "NEW_KIND",
  kind: "withdrawal" as const,
  confidence: 0.82,
  state: "pending" as const,
  amount: 100,
  sign: 1 as const,
  currency: "EUR",
  description: "Trading 212 NEW_KIND",
  createdAt: "2026-11-11T10:00:00.000Z",
  ...over,
});

test("cash-flow suggestions are listed with their sign-change flag and have no effect on rules", async () => {
  const cashFlowStore = createMemoryCashFlowStore();
  await cashFlowStore.saveSuggestions([cashFlowSuggestion() as never]);
  const syncRun = createApp({ cashFlowStore });

  const list = (await (await syncRun.request("/api/investing/cash-flow-suggestions")).json()) as {
    enabled: boolean;
    count: number;
    pending: Array<Record<string, unknown>>;
  };
  expect(list).toMatchObject({ enabled: false, count: 1 });
  expect(list.pending[0]).toMatchObject({
    rawType: "NEW_KIND",
    kind: "withdrawal",
    confidence: 0.82,
    amount: 100,
    sign: 1,
    signChange: true,
  });
  // An unconfirmed suggestion is not a rule.
  const rules = (await (await syncRun.request("/api/investing/cash-flow-rules")).json()) as {
    rules: unknown[];
  };
  expect(rules.rules).toEqual([]);
});

test("a sign-changing confirmation needs the acknowledged before/after, then creates the rule", async () => {
  const cashFlowStore = createMemoryCashFlowStore();
  await cashFlowStore.saveSuggestions([cashFlowSuggestion() as never]);
  const syncRun = createApp({ cashFlowStore });
  const confirm = (body: Record<string, unknown>) =>
    syncRun.request("/api/investing/cash-flow-suggestions/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        broker: "trading212",
        typeKey: "NEW_KIND",
        kind: "withdrawal",
        ...body,
      }),
    });

  const refused = await confirm({});
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({
    reason: "sign-change-unacknowledged",
    before: 100,
    after: -100,
  });
  expect(await cashFlowStore.listRules()).toEqual([]);

  const accepted = await confirm({ acknowledgeSignChange: true });
  expect(accepted.status).toBe(200);
  const body = (await accepted.json()) as { rule: Record<string, unknown> };
  expect(body.rule).toMatchObject({
    broker: "trading212",
    typeKey: "NEW_KIND",
    kind: "withdrawal",
  });
  expect(await cashFlowStore.listRules()).toHaveLength(1);
  // The suggestion is resolved, so it leaves the pending list.
  const list = (await (await syncRun.request("/api/investing/cash-flow-suggestions")).json()) as {
    count: number;
  };
  expect(list.count).toBe(0);
});

test("a non-sign-changing confirmation creates the rule without acknowledgement", async () => {
  const cashFlowStore = createMemoryCashFlowStore();
  await cashFlowStore.saveSuggestions([cashFlowSuggestion({ kind: "deposit" }) as never]);
  const syncRun = createApp({ cashFlowStore });

  const response = await syncRun.request("/api/investing/cash-flow-suggestions/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ broker: "trading212", typeKey: "NEW_KIND", kind: "deposit" }),
  });

  expect(response.status).toBe(200);
  expect(await cashFlowStore.listRules()).toEqual([
    expect.objectContaining({ kind: "deposit", broker: "trading212", typeKey: "NEW_KIND" }),
  ]);
});

test("a rejection is remembered and creates no rule", async () => {
  const cashFlowStore = createMemoryCashFlowStore();
  await cashFlowStore.saveSuggestions([cashFlowSuggestion({ kind: "deposit" }) as never]);
  const syncRun = createApp({ cashFlowStore });

  const response = await syncRun.request("/api/investing/cash-flow-suggestions/reject", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ broker: "trading212", typeKey: "NEW_KIND" }),
  });

  expect(response.status).toBe(200);
  expect((await cashFlowStore.listSuggestions())[0]!.state).toBe("rejected");
  expect(await cashFlowStore.listRules()).toEqual([]);
});

test("invalid confirmations are 400 and an unknown type is 404", async () => {
  const cashFlowStore = createMemoryCashFlowStore();
  await cashFlowStore.saveSuggestions([cashFlowSuggestion({ kind: "deposit" }) as never]);
  const syncRun = createApp({ cashFlowStore });
  const confirm = (body: Record<string, unknown>) =>
    syncRun.request("/api/investing/cash-flow-suggestions/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  expect((await confirm({ broker: "trading212", typeKey: "NEW_KIND", kind: "other" })).status).toBe(
    400,
  );
  expect(
    (await confirm({ broker: "trading212", typeKey: "NEW_KIND", kind: "nonsense" })).status,
  ).toBe(400);
  expect(
    (await confirm({ broker: "trading212", typeKey: "UNKNOWN_KIND", kind: "deposit" })).status,
  ).toBe(404);
});

test("the suggestion step is gated on an explicit owner setting, default off", async () => {
  const cashFlowStore = createMemoryCashFlowStore();
  const syncRun = createApp({ cashFlowStore });

  expect(
    await (await syncRun.request("/api/investing/cash-flow-suggestions/settings")).json(),
  ).toEqual({ enabled: false });
  const put = await syncRun.request("/api/investing/cash-flow-suggestions/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  expect(put.status).toBe(200);
  expect(await cashFlowStore.suggestionsEnabled()).toBe(true);
  expect(
    (await (await syncRun.request("/api/investing/cash-flow-rules")).json()) as {
      enabled: boolean;
    },
  ).toMatchObject({ enabled: true });
});

test("rules are exportable owner data and removable", async () => {
  const cashFlowStore = createMemoryCashFlowStore();
  await cashFlowStore.saveRules([
    {
      broker: "trading212",
      typeKey: "NEW_KIND",
      kind: "deposit",
      confirmedAt: "2026-11-11T10:00:00.000Z",
    },
  ]);
  const syncRun = createApp({ cashFlowStore });

  const exported = (await (await syncRun.request("/api/investing/cash-flow-rules")).json()) as {
    rules: unknown[];
  };
  expect(exported.rules).toEqual([
    {
      broker: "trading212",
      typeKey: "NEW_KIND",
      kind: "deposit",
      confirmedAt: "2026-11-11T10:00:00.000Z",
    },
  ]);

  const removed = await syncRun.request("/api/investing/cash-flow-rules/remove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ broker: "trading212", typeKey: "NEW_KIND" }),
  });
  expect(removed.status).toBe(200);
  expect(await cashFlowStore.listRules()).toEqual([]);
});
