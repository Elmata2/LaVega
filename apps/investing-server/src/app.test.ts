import { expect, test, vi } from "vitest";
import { app, createApp } from "./app.js";
import { createInMemoryBenchmarkSelectionStore, createInMemoryPriceStore, createYahooPriceProvider } from "@lavega/adapters";
import { createProblemReporter } from "./observability.js";
import { emptyInvestingDashboard } from "@lavega/core";

const acceptedConsentStore = () => ({
  get: vi.fn(async () => ({ tenantId: "local", accepted: true, decidedAt: "2026-08-21T12:00:00.000Z", disclosureVersion: "yahoo-finance-v1" })),
  set: vi.fn(async () => undefined),
});

test("GET /health reports investing server health through Hono app.request", async () => {
  const response = await app.request("/health");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, service: "investing-server" });
});

test("dashboard route returns injected core-shaped read model and selected symbol", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push({
    symbol: "AAPL", entity: "personal", description: "Apple", quantity: 2, marketValue: 200, portfolioWeight: 1,
    priceStatus: "priced", currency: "USD", asOf: "2026-08-18",
    returns: { status: "available", remainingCostBasis: 180, realizedCostBasisRemoved: 0, unrealizedGain: 20, realizedGain: 0, dividendsReceived: 0, totalReturn: 20, totalReturnPercentage: 20 / 180, sinceFirstBuyPercentage: 20 / 180, firstBuyDate: "2026-01-02" },
  });
  const dashboardReader = vi.fn(async ({ symbol }: { symbol?: string }) => ({ ...dashboard, problems: symbol ? [`selected:${symbol}`] : [] }));
  const investingApp = createApp({ dashboardReader });

  const response = await investingApp.request("/api/investing/dashboard?symbol=aapl");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...dashboard, problems: ["selected:aapl"] });
  expect(dashboardReader).toHaveBeenCalledWith({ symbol: "aapl" });
});

test("dashboard route reports read-model failures without inventing values", async () => {
  const investingApp = createApp({ dashboardReader: vi.fn().mockRejectedValue(new Error("read failed")) });

  const response = await investingApp.request("/api/investing/dashboard");

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ...emptyInvestingDashboard(), problems: ["Dashboardgegevens konden niet worden geladen"] });
});

test("benchmark API persists ordered replace-whole selection and rejects invalid caps", async () => {
  const benchmarkSelectionStore = createInMemoryBenchmarkSelectionStore();
  const investingApp = createApp({ benchmarkSelectionStore, priceSyncTargets: () => [], priceSyncPaceMs: 0 });
  const saved = await investingApp.request("/api/investing/benchmarks", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbols: ["^AEX", "^GDAXI"] }) });
  expect(saved.status).toBe(200);
  expect(await (await investingApp.request("/api/investing/benchmarks")).json()).toEqual({ tenantId: "local", symbols: ["^AEX", "^GDAXI"] });
  const invalid = await investingApp.request("/api/investing/benchmarks", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbols: ["A", "B", "C", "D"] }) });
  expect(invalid.status).toBe(400);
});

test("benchmark search route returns results after persisted consent", async () => {
  const benchmarkSearch = vi.fn().mockResolvedValue({ results: [{ symbol: "^AEX", name: "AEX", exchange: "Amsterdam", currency: "EUR" }], fallback: false, problems: [] });
  const investingApp = createApp({ benchmarkSearch, marketDataConsentStore: acceptedConsentStore() });
  const response = await investingApp.request("/api/investing/benchmarks/search?q=AEX");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ results: [{ symbol: "^AEX" }], fallback: false });
  expect(benchmarkSearch).toHaveBeenCalledWith("AEX");
});

test("Yahoo search and price calls fail before consent, then stored consent starts sync", async () => {
  const marketDataConsentStore = {
    accepted: false,
    async get() { return { tenantId: "local", accepted: this.accepted, decidedAt: null, disclosureVersion: "yahoo-finance-v1" }; },
    async set(decision: { accepted: boolean }) { this.accepted = decision.accepted; },
  };
  const provider = { sourceKey: "yahoo", priority: 10, get: vi.fn().mockResolvedValue({ bars: [], problems: [] }) };
  const investingApp = createApp({ marketDataConsentStore, provider: provider as never, priceSyncTargets: () => [{ kind: "current", symbol: "ASML", ticker: "ASML", exchange: "AMS", currency: "EUR", backfillFrom: "2026-01-01" }], priceSyncPaceMs: 0 });

  expect((await investingApp.request("/api/investing/benchmarks/search?q=AEX")).status).toBe(428);
  expect((await investingApp.request("/api/prices/sync", { method: "POST" })).status).toBe(428);
  expect(provider.get).not.toHaveBeenCalled();
  const accepted = await investingApp.request("/api/market-data/consent", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ accepted: true }) });
  expect(accepted.status).toBe(200);
  await vi.waitFor(() => expect(provider.get).toHaveBeenCalledOnce());
  expect(await (await investingApp.request("/api/market-data/consent")).json()).toMatchObject({ accepted: true });
});

test("price sync uses Yahoo Finance after persisted consent", async () => {
  const fetchJsonWithCrumb = vi.fn();
  const investingApp = createApp({
    store: createInMemoryPriceStore(),
    provider: createYahooPriceProvider({ client: { fetchJsonWithCrumb } as never }),
    priceSyncTargets: () => [{ kind: "current", symbol: "ASML", ticker: "ASML", exchange: "AMS", currency: "EUR", backfillFrom: "2026-01-01" }],
    priceSyncPaceMs: 0,
    marketDataConsentStore: acceptedConsentStore(),
  });
  const response = await investingApp.request("/api/prices/sync", { method: "POST" });
  expect(response.status).toBe(202);
  await vi.waitFor(() => expect(fetchJsonWithCrumb).toHaveBeenCalled());
});

test("router problems reach HTTP response unchanged", async () => {
  const provider = { sourceKey: "yahoo", priority: 10, get: vi.fn().mockResolvedValue({ bars: [], problems: ["Yahoo Finance rate-limited price request"] }) };
  const investingApp = createApp({ provider: provider as never, priceSyncTargets: () => [{ kind: "current", symbol: "ASML", ticker: "ASML", exchange: "AMS", currency: "EUR", backfillFrom: "2026-01-01" }], priceSyncPaceMs: 0, marketDataConsentStore: acceptedConsentStore() });
  await investingApp.request("/api/prices/sync", { method: "POST" });
  await vi.waitFor(async () => expect(await (await investingApp.request("/api/prices/sync/status")).json()).toMatchObject({ problems: ["ASML: Yahoo Finance rate-limited price request"] }));
  expect(provider.get).toHaveBeenCalledOnce();
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
  const response = await app.request("/api/market-data/fx?from=EUR&to=USD");
  expect(response.status).toBe(200);
  expect((await response.json()).source).toBe("frankfurter");

  const invalid = await app.request("/api/market-data/identifier");
  expect(invalid.status).toBe(400);
});

test("price sync resolves ISIN before asking price provider", async () => {
  const provider = { sourceKey: "yahoo", priority: 10, get: vi.fn().mockResolvedValue({ bars: [], problems: [] }) };
  const identifierProvider = { sourceKey: "openfigi", priority: 10, get: vi.fn().mockResolvedValue({ match: { isin: "NL0010273215", ticker: "ASML", exchange: "AMS" }, problems: [] }) };
  const investingApp = createApp({ provider: provider as never, identifierProvider: identifierProvider as never, priceSyncTargets: () => [{ kind: "current", symbol: "ASML", ticker: "ASML", exchange: "UNKNOWN", isin: "NL0010273215", currency: "EUR", backfillFrom: "2026-01-01" }], priceSyncPaceMs: 0, marketDataConsentStore: acceptedConsentStore() });
  await investingApp.request("/api/prices/sync", { method: "POST" });
  await vi.waitFor(() => expect(provider.get).toHaveBeenCalled());
  expect(identifierProvider.get).toHaveBeenCalledWith({ isin: "NL0010273215" });
  expect(provider.get).toHaveBeenCalledWith(expect.objectContaining({ symbol: "ASML", ticker: "ASML", exchange: "AMS" }));
});

test("broker sync route forwards force and keeps problems in response", async () => {
  const brokerSync = vi.fn(async (force: boolean) => ({ outcomes: [{ status: "synced" }], problems: force ? ["ibkr: unavailable"] : [] }));
  const investingApp = createApp({ brokerSync });
  const response = await investingApp.request("/api/brokers/sync?force=true", { method: "POST" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ outcomes: [{ status: "synced" }], problems: ["ibkr: unavailable"] });
  expect(brokerSync).toHaveBeenCalledWith(true);
});

test("broker sync starts server-side price orchestration despite broker problems", async () => {
  const provider = { sourceKey: "yahoo", priority: 10, get: vi.fn().mockResolvedValue({ bars: [], problems: [] }) };
  const investingApp = createApp({
    brokerSync: vi.fn(async () => ({ outcomes: [], problems: ["ibkr: unavailable"] })),
    provider: provider as never,
    priceSyncTargets: () => [{ kind: "closed", symbol: "CLOSED", ticker: "CLOSED", exchange: "UNKNOWN", currency: "EUR", backfillFrom: "2024-01-01" }],
    priceSyncPaceMs: 0,
    marketDataConsentStore: acceptedConsentStore(),
  });

  await investingApp.request("/api/brokers/sync", { method: "POST" });
  await vi.waitFor(() => expect(provider.get).toHaveBeenCalledOnce());
});

test("broker sync status route exposes safe progress counters", async () => {
  const progress = { status: "waiting" as const, pages: 6, ordersRead: 300, positionsRead: 0, waitUntil: "2026-08-19T14:00:00.000Z", remaining: 0, updatedAt: "2026-08-19T13:59:00.000Z", message: null };
  const investingApp = createApp({ brokerSyncStatus: () => progress });
  const response = await investingApp.request("/api/brokers/sync/status");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(progress);
});

test("broker sync route converts unexpected failures into a useful response", async () => {
  const investingApp = createApp({ brokerSync: vi.fn().mockRejectedValue(new Error("adapter failed")) });
  const response = await investingApp.request("/api/brokers/sync", { method: "POST" });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ outcomes: [], problems: ["Broker synchronization failed"] });
});

test("broker credentials route stores validated IBKR credentials without returning secrets", async () => {
  const configureBroker = vi.fn(async () => undefined);
  const investingApp = createApp({ configureBroker });
  const response = await investingApp.request("/api/brokers/credentials", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ broker: "ibkr", token: "flex-token", queryId: "123456", passphrase: "vault-passphrase" }),
  });

  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  expect(configureBroker).toHaveBeenCalledWith({ broker: "ibkr", token: "flex-token", queryId: "123456", passphrase: "vault-passphrase" });
});

test("broker vault routes report status and unlock without returning passphrase", async () => {
  const credentialStatus = vi.fn(async () => "locked" as const);
  const unlockCredentials = vi.fn(async () => true);
  const investingApp = createApp({ credentialStatus, unlockCredentials });

  const statusResponse = await investingApp.request("/api/brokers/credentials/status");
  expect(await statusResponse.json()).toEqual({ status: "locked" });

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
  const brokerSync = vi.fn(async () => ({ outcomes: [], problems: ["ibkr: request failed", "token=super-secret"] }));
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

test("price cache delete purges store and returns success", async () => {
  const store = createInMemoryPriceStore();
  const onPriceDataChanged = vi.fn();
  await store.upsert([{ tenantId: "local", symbol: "ASML", date: "2026-01-01", close: 100, currency: "EUR" }]);
  const response = await createApp({ store, onPriceDataChanged }).request("/api/prices/cache", { method: "DELETE" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ deleted: true });
  expect(await store.getRange("local", "ASML", "2026-01-01", "2026-01-01")).toEqual([]);
  expect(onPriceDataChanged).toHaveBeenCalledOnce();
});

test("summary route composes metrics, cached sectors, and top positions; sector failure degrades to Unknown", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push(
    { symbol: "AAPL", entity: "personal", quantity: 1, marketValue: 300, portfolioWeight: null, priceStatus: "priced", currency: "EUR", asOf: "2026-08-18", returns: { status: "unpriced", remainingCostBasis: 0, realizedCostBasisRemoved: 0, unrealizedGain: 0, realizedGain: 0, dividendsReceived: 0, totalReturn: 0, totalReturnPercentage: null, sinceFirstBuyPercentage: null, firstBuyDate: null } },
    { symbol: "MYST", entity: "personal", quantity: 1, marketValue: 100, portfolioWeight: null, priceStatus: "priced", currency: "EUR", asOf: "2026-08-18", returns: { status: "unpriced", remainingCostBasis: 0, realizedCostBasisRemoved: 0, unrealizedGain: 0, realizedGain: 0, dividendsReceived: 0, totalReturn: 0, totalReturnPercentage: null, sinceFirstBuyPercentage: null, firstBuyDate: null } },
  );
  const investingApp = createApp({
    dashboardReader: vi.fn(async () => ({ ...dashboard, problems: [] })),
    sectorProfile: vi.fn(async (symbol: string) => symbol === "MYST" ? null : { sector: "Technology", industry: "Hardware" }),
    sectorStore: (() => {
      const map = new Map<string, { sector: string; industry: string }>();
      return { get: async (symbol: string) => map.get(symbol) ?? null, set: async (symbol: string, profile: { sector: string; industry: string }) => void map.set(symbol, profile) };
    })(),
  });

  const response = await investingApp.request("/api/investing/summary");
  expect(response.status).toBe(200);
  const payload = await response.json() as { metrics: unknown; sectors: Array<{ sector: string; weight: number }>; topPositions: Array<{ symbol: string; weight: number }> };
  expect(payload.metrics).toMatchObject({ dailyVolatility: null, beta: null, maxDrawdown: null, observationDays: 0 });
  expect(payload.sectors).toEqual([{ sector: "Technology", weight: 0.75 }, { sector: "Unknown", weight: 0.25 }]);
  expect(payload.topPositions).toEqual([{ symbol: "AAPL", weight: 0.75 }, { symbol: "MYST", weight: 0.25 }]);
});

test("summary route reports failures as 503 problem payload", async () => {
  const investingApp = createApp({ dashboardReader: vi.fn().mockRejectedValue(new Error("down")) });
  const response = await investingApp.request("/api/investing/summary");
  expect(response.status).toBe(503);
});

test("tenant-scoped routes read and write under the resolved tenant, not the local default", async () => {
  const benchmarkSelectionStore = { get: vi.fn(async (tenantId: string) => ({ tenantId, symbols: ["^GSPC"] })), set: vi.fn(async () => undefined) };
  const marketDataConsentStore = { get: vi.fn(async (tenantId: string) => ({ tenantId, accepted: true, decidedAt: null, disclosureVersion: "yahoo-finance-v1" })), set: vi.fn(async () => undefined) };
  const investingApp = createApp({ resolveTenantId: () => "user-123", benchmarkSelectionStore, marketDataConsentStore });

  const benchmarks = await investingApp.request("/api/investing/benchmarks");
  expect(benchmarks.status).toBe(200);
  expect(benchmarkSelectionStore.get).toHaveBeenCalledWith("user-123");

  const stored = await investingApp.request("/api/investing/benchmarks", { method: "PUT", body: JSON.stringify({ symbols: ["^AEX"] }), headers: { "content-type": "application/json" } });
  expect(stored.status).toBe(200);
  expect(benchmarkSelectionStore.set).toHaveBeenCalledWith({ tenantId: "user-123", symbols: ["^AEX"] });

  const consent = await investingApp.request("/api/market-data/consent", { method: "PUT", body: JSON.stringify({ accepted: true }), headers: { "content-type": "application/json" } });
  expect(consent.status).toBe(200);
  expect(marketDataConsentStore.set).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "user-123", accepted: true }));
});

test("tenant defaults to the local tenant when no resolver is injected", async () => {
  const benchmarkSelectionStore = { get: vi.fn(async (tenantId: string) => ({ tenantId, symbols: [] })), set: vi.fn(async () => undefined) };
  const investingApp = createApp({ benchmarkSelectionStore });

  await investingApp.request("/api/investing/benchmarks");

  expect(benchmarkSelectionStore.get).toHaveBeenCalledWith("local");
});
