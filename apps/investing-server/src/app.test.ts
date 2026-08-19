import { expect, test, vi } from "vitest";
import { app, createApp } from "./app.js";
import { createInMemoryPriceStore, createMemoryYahooConsentStore, createYahooPriceProvider } from "@lavega/adapters";

test("GET /health reports investing server health through Hono app.request", async () => {
  const response = await app.request("/health");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, service: "investing-server" });
});

test("price sync requires server-readable consent before outbound requests", async () => {
  const fetchJsonWithCrumb = vi.fn();
  const investingApp = createApp({
    store: createInMemoryPriceStore(),
    provider: createYahooPriceProvider({ client: { fetchJsonWithCrumb } as never }),
  });
  const init = { method: "POST", body: JSON.stringify({ symbols: [{ symbol: "ASML", ticker: "ASML", exchange: "AMS", currency: "EUR" }] }), headers: { "content-type": "application/json" } } as const;
  const blocked = await investingApp.request("/api/prices/sync", init);
  expect(blocked.status).toBe(412);
  expect(fetchJsonWithCrumb).not.toHaveBeenCalled();
  expect((await (await investingApp.request("/api/market-data/consent")).json()).accepted).toBe(false);
  const consentResponse = await investingApp.request("/api/market-data/consent", { method: "POST", body: JSON.stringify({ accepted: true }), headers: { "content-type": "application/json" } });
  expect(consentResponse.headers.get("set-cookie")).toBeNull();
  expect((await (await investingApp.request("/api/market-data/consent")).json()).accepted).toBe(true);
});

test("persistent consent store keeps accepted installation across app instances", async () => {
  const consentStore = createMemoryYahooConsentStore();
  const firstApp = createApp({ consentStore });
  await firstApp.request("/api/market-data/consent", { method: "POST", body: JSON.stringify({ accepted: true }), headers: { "content-type": "application/json" } });

  const secondApp = createApp({ consentStore });
  const response = await secondApp.request("/api/market-data/consent");
  expect(response.status).toBe(200);
  expect((await response.json()).accepted).toBe(true);
});

test("fresh app does not trust consent cookie from an earlier installation", async () => {
  const freshApp = createApp({ provider: createYahooPriceProvider({ client: { fetchJsonWithCrumb: vi.fn() } as never }) });
  const response = await freshApp.request("/api/prices/sync", {
    method: "POST",
    headers: { cookie: "lavega-yahoo-consent=accepted", "content-type": "application/json" },
    body: JSON.stringify({ symbols: [] }),
  });
  expect(response.status).toBe(412);
});

test("fresh app accepts explicit browser consent header, not legacy cookie", async () => {
  const freshApp = createApp({ provider: createYahooPriceProvider({ client: { fetchJsonWithCrumb: vi.fn() } as never }) });
  const response = await freshApp.request("/api/prices/sync", {
    method: "POST",
    headers: { "x-lavega-yahoo-consent": "accepted", "content-type": "application/json" },
    body: JSON.stringify({ symbols: [] }),
  });
  expect(response.status).toBe(200);
});

test("router problems reach HTTP response unchanged", async () => {
  const consentStore = createMemoryYahooConsentStore(true);
  const provider = { sourceKey: "yahoo", priority: 10, get: vi.fn().mockResolvedValue({ bars: [], problems: ["Yahoo Finance rate-limited price request"] }) };
  const investingApp = createApp({ consentStore, provider: provider as never });
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
  const investingApp = createApp({ consentStore: createMemoryYahooConsentStore(true), provider: provider as never, identifierProvider: identifierProvider as never });
  await investingApp.request("/api/prices/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbols: [{ isin: "NL0010273215", currency: "EUR" }] }) });
  expect(identifierProvider.get).toHaveBeenCalledWith({ isin: "NL0010273215" });
  expect(provider.get).toHaveBeenCalledWith(expect.objectContaining({ symbol: "ASML", ticker: "ASML", exchange: "AMS" }));
});
