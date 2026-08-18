import { expect, test, vi } from "vitest";
import { app, createApp } from "./app.js";
import { createInMemoryPriceStore, createYahooPriceProvider } from "@lavega/adapters";

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
  expect(await (await investingApp.request("/api/market-data/consent")).json()).toEqual({ accepted: false });
  await investingApp.request("/api/market-data/consent", { method: "POST", body: JSON.stringify({ accepted: true }), headers: { "content-type": "application/json" } });
  expect(await (await investingApp.request("/api/market-data/consent")).json()).toEqual({ accepted: true });
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
