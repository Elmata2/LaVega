import { Hono } from "hono";
import { expect, test } from "vitest";
import { emptyInvestingDashboard, type Trade } from "@lavega/core";
import type { PortfolioChatContext } from "../portfolioChat.js";
import { attachMcpReadRoutes, MAX_MCP_TRADES } from "./readRoutes.js";

const trade = (overrides: Partial<Trade> & { date: string }): Trade => ({
  id: overrides.date,
  entity: "trading212",
  symbol: "AAPL",
  side: "buy",
  quantity: 1,
  price: 100,
  amount: 100,
  currency: "USD",
  commission: 0,
  ...overrides,
});

const context = (overrides: Partial<PortfolioChatContext> = {}): PortfolioChatContext => ({
  dashboard: emptyInvestingDashboard(),
  sectors: null,
  trades: () => [
    trade({ date: "2026-01-02", symbol: "MSFT" }),
    trade({ date: "2026-03-04", symbol: "AAPL" }),
    trade({ date: "2026-02-03", symbol: "AAPL" }),
  ],
  price: async (symbol, date) =>
    symbol === "AAPL" ? { symbol: "AAPL", date: date ?? "2026-03-04", close: 190.5, currency: "USD" } : null,
  fundamentals: { fetch: async () => null },
  ...overrides,
});

const appWith = (overrides: Partial<PortfolioChatContext> = {}, consent = true) => {
  const app = new Hono();
  attachMcpReadRoutes(app, {
    resolveTenantId: () => "user-1",
    context: async () => context(overrides),
    consent: async () => consent,
  });
  return app;
};

test("trades are newest first, capped and flagged when truncated", async () => {
  const res = await appWith().request("/api/investing/trades");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { trades: Trade[]; total: number; truncated: boolean };
  expect(body.trades.map((row) => row.date)).toEqual(["2026-03-04", "2026-02-03", "2026-01-02"]);
  expect(body.total).toBe(3);
  expect(body.truncated).toBe(false);
});

test("trades filter by symbol and by an explicit limit", async () => {
  const res = await appWith().request("/api/investing/trades?symbol=aapl&limit=1");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { trades: Trade[]; total: number; truncated: boolean };
  expect(body.trades.map((row) => row.symbol)).toEqual(["AAPL"]);
  expect(body.total).toBe(2);
  expect(body.truncated).toBe(true);
});

test("an invalid trade symbol is refused, not treated as a symbol", async () => {
  const res = await appWith().request("/api/investing/trades?symbol=%24%24%24");
  expect(res.status).toBe(400);
});

test("the trade limit never exceeds the read ceiling", async () => {
  const res = await appWith({
    trades: () => Array.from({ length: MAX_MCP_TRADES + 10 }, (_, index) =>
      trade({ date: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`, id: String(index) }),
    ),
  }).request("/api/investing/trades?limit=999");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { trades: Trade[]; total: number; truncated: boolean };
  expect(body.trades.length).toBe(MAX_MCP_TRADES);
  expect(body.total).toBe(MAX_MCP_TRADES + 10);
  expect(body.truncated).toBe(true);
});

test("a stored price is returned for the symbol", async () => {
  const res = await appWith().request("/api/investing/prices/aapl");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    symbol: "AAPL",
    date: "2026-03-04",
    close: 190.5,
    currency: "USD",
  });
});

test("a symbol with no stored bar is a 404, never a fabricated price", async () => {
  const res = await appWith().request("/api/investing/prices/TSLA");
  expect(res.status).toBe(404);
});

test("an invalid price date is refused", async () => {
  const res = await appWith().request("/api/investing/prices/AAPL?date=04-03-2026");
  expect(res.status).toBe(400);
});

test("fundamentals are consent-gated with a machine-readable 428", async () => {
  const res = await appWith({}, false).request("/api/investing/fundamentals/AAPL");
  expect(res.status).toBe(428);
  expect(await res.json()).toMatchObject({ consentRequired: true });
});

test("with consent, a symbol the provider does not know returns brief:null and a problem", async () => {
  const res = await appWith().request("/api/investing/fundamentals/AAPL");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ symbol: "AAPL", brief: null });
});

test("a provider failure is a safe 502, not an exception message", async () => {
  const res = await appWith({
    fundamentals: {
      fetch: async () => {
        throw new Error("upstream SQL detail that must not cross the boundary");
      },
    },
  }).request("/api/investing/fundamentals/AAPL");
  expect(res.status).toBe(502);
  expect(await res.text()).not.toContain("upstream SQL detail");
});
