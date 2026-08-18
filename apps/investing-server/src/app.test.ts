import { expect, test } from "vitest";
import { app } from "./app.js";

test("GET /health reports investing server health through Hono app.request", async () => {
  const response = await app.request("/health");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, service: "investing-server" });
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
