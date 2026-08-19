import { expect, test, vi } from "vitest";
import { app, createApp } from "./app.js";
import { createInMemoryPriceStore, createYahooPriceProvider } from "@lavega/adapters";
import { createProblemReporter } from "./observability.js";
import { emptyInvestingDashboard } from "@lavega/core";

test("GET /health reports investing server health through Hono app.request", async () => {
  const response = await app.request("/health");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, service: "investing-server" });
});

test("dashboard route returns injected core-shaped read model and selected symbol", async () => {
  const dashboard = emptyInvestingDashboard();
  dashboard.positions.push({ symbol: "AAPL", entity: "personal", description: "Apple", quantity: 2, marketValue: 200, currency: "USD", asOf: "2026-08-18" });
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

test("price sync uses Yahoo Finance without a browser consent gate", async () => {
  const fetchJsonWithCrumb = vi.fn();
  const investingApp = createApp({
    store: createInMemoryPriceStore(),
    provider: createYahooPriceProvider({ client: { fetchJsonWithCrumb } as never }),
  });
  const init = { method: "POST", body: JSON.stringify({ symbols: [{ symbol: "ASML", ticker: "ASML", exchange: "AMS", currency: "EUR" }] }), headers: { "content-type": "application/json" } } as const;
  const response = await investingApp.request("/api/prices/sync", init);
  expect(response.status).toBe(200);
  expect(fetchJsonWithCrumb).toHaveBeenCalled();
});

test("router problems reach HTTP response unchanged", async () => {
  const provider = { sourceKey: "yahoo", priority: 10, get: vi.fn().mockResolvedValue({ bars: [], problems: ["Yahoo Finance rate-limited price request"] }) };
  const investingApp = createApp({ provider: provider as never });
  const response = await investingApp.request("/api/prices/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbols: [{ symbol: "ASML", ticker: "ASML", exchange: "AMS", currency: "EUR" }] }),
  });
  expect(await response.json()).toMatchObject({ problems: ["Yahoo Finance rate-limited price request"] });
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
  const investingApp = createApp({ provider: provider as never, identifierProvider: identifierProvider as never });
  await investingApp.request("/api/prices/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbols: [{ isin: "NL0010273215", currency: "EUR" }] }) });
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
  await store.upsert([{ tenantId: "local", symbol: "ASML", date: "2026-01-01", close: 100, currency: "EUR" }]);
  const response = await createApp({ store }).request("/api/prices/cache", { method: "DELETE" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ deleted: true });
  expect(await store.getRange("ASML", "2026-01-01", "2026-01-01")).toEqual([]);
});
