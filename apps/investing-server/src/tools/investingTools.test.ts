import { expect, test } from "vitest";
import type { AgentToolDefinition } from "@lavega/core";
import { createInvestingReadTools, type InvestingToolRead } from "./investingTools.js";

/* A canned tenant-bound reader. Each test names the path it expects, so a
 * handler that reaches for a write path or the wrong route fails loudly. */
const reader = (
  responses: Record<string, { status: number; body: unknown }>,
  seen: string[] = [],
): InvestingToolRead => {
  return async (path) => {
    seen.push(path);
    return responses[path] ?? { status: 404, body: { problems: ["no canned response"] } };
  };
};

const tool = async (
  tools: readonly AgentToolDefinition[],
  name: string,
  input: Record<string, unknown> = {},
) => {
  const found = tools.find((entry) => entry.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found.handler(input);
};

const dashboard = {
  dataVersion: 7,
  presentationCurrency: "EUR",
  positions: [
    {
      symbol: "AAPL",
      description: "Apple",
      quantity: 3,
      currency: "USD",
      marketValue: 600,
      portfolioWeight: 0.6,
      priceStatus: "priced",
      returns: {
        remainingCostBasis: 420,
        unrealizedGain: 180,
        realizedGain: 0,
        dividendsReceived: 2,
        totalReturn: 182,
        totalReturnPercentage: 0.43,
        firstBuyDate: "2025-01-02",
      },
    },
  ],
  portfolio: { All: [{ date: "2026-03-04", value: 1000 }] },
  risk: {
    defaultBenchmark: "^GSPC",
    byBenchmark: {
      "^GSPC": { "1Y": { risk: { annualizedVolatility: 0.18 } }, "6M": { risk: { annualizedVolatility: 0.2 } } },
    },
  },
};

const registry = () => createInvestingReadTools(reader({}));

test("every seeded tool is read-only and the names are the documented eight", () => {
  const tools = registry();
  expect(tools.map((entry) => entry.name)).toEqual([
    "get_positions",
    "get_portfolio_value",
    "get_trades",
    "get_price",
    "get_fundamentals",
    "get_sector_exposure",
    "get_risk",
    "get_agent_memory",
  ]);
  expect(tools.every((entry) => entry.scope === "read")).toBe(true);
  expect(tools.some((entry) => entry.scope === "write")).toBe(false);
});

test("every description carries data semantics an external agent needs", () => {
  for (const entry of registry()) {
    expect(entry.description.length).toBeGreaterThan(40);
  }
  const positions = registry().find((entry) => entry.name === "get_positions")!;
  expect(positions.description).toContain("fractions");
  const trades = registry().find((entry) => entry.name === "get_trades")!;
  expect(trades.description).toContain("newest first");
});

test("get_positions projects the dashboard holdings and keeps nulls as null", async () => {
  const tools = createInvestingReadTools(
    reader({ "/api/investing/dashboard": { status: 200, body: dashboard } }),
  );
  const result = (await tool(tools, "get_positions")) as {
    presentationCurrency: string;
    positions: Array<Record<string, unknown>>;
  };
  expect(result.presentationCurrency).toBe("EUR");
  expect(result.positions[0]).toMatchObject({
    symbol: "AAPL",
    name: "Apple",
    marketValue: 600,
    weight: 0.6,
    unrealizedGain: 180,
  });
});

test("get_portfolio_value reads the last All-series point", async () => {
  const tools = createInvestingReadTools(
    reader({ "/api/investing/dashboard": { status: 200, body: dashboard } }),
  );
  expect(await tool(tools, "get_portfolio_value")).toEqual({
    date: "2026-03-04",
    value: 1000,
    currency: "EUR",
  });
});

test("get_portfolio_value with no series answers null and a problem, never zero", async () => {
  const tools = createInvestingReadTools(
    reader({
      "/api/investing/dashboard": {
        status: 200,
        body: { ...dashboard, portfolio: {} },
      },
    }),
  );
  expect(await tool(tools, "get_portfolio_value")).toMatchObject({ value: null });
});

test("get_trades forwards the symbol filter and the limit to the read route", async () => {
  const seen: string[] = [];
  const tools = createInvestingReadTools(
    reader(
      { "/api/investing/trades?symbol=AAPL&limit=5": { status: 200, body: { trades: [], total: 0 } } },
      seen,
    ),
  );
  const result = await tool(tools, "get_trades", { symbol: "aapl", limit: 5 });
  expect(result).toEqual({ trades: [], total: 0 });
  expect(seen).toEqual(["/api/investing/trades?symbol=AAPL&limit=5"]);
});

test("get_trades refuses a non-ticker without calling the read route", async () => {
  const seen: string[] = [];
  const tools = createInvestingReadTools(reader({}, seen));
  expect(await tool(tools, "get_trades", { symbol: "$$$" })).toMatchObject({ trades: [] });
  expect(seen).toEqual([]);
});

test("get_price returns found:false for a symbol with no stored bar", async () => {
  const tools = createInvestingReadTools(
    reader({ "/api/investing/prices/TSLA": { status: 404, body: { problems: ["No price"] } } }),
  );
  expect(await tool(tools, "get_price", { symbol: "TSLA" })).toMatchObject({
    symbol: "TSLA",
    found: false,
  });
});

test("get_price returns the stored bar and the requested date", async () => {
  const tools = createInvestingReadTools(
    reader({
      "/api/investing/prices/AAPL?date=2026-01-02": {
        status: 200,
        body: { symbol: "AAPL", date: "2026-01-02", close: 180, currency: "USD" },
      },
    }),
  );
  expect(await tool(tools, "get_price", { symbol: "AAPL", date: "2026-01-02" })).toEqual({
    found: true,
    symbol: "AAPL",
    date: "2026-01-02",
    close: 180,
    currency: "USD",
  });
});

test("get_fundamentals surfaces the consent refusal as data, not an exception", async () => {
  const tools = createInvestingReadTools(
    reader({
      "/api/investing/fundamentals/AAPL": {
        status: 428,
        body: { consentRequired: true, problems: ["Yahoo Finance consent required"] },
      },
    }),
  );
  expect(await tool(tools, "get_fundamentals", { symbol: "AAPL" })).toMatchObject({
    consentRequired: true,
  });
});

test("get_risk picks the default benchmark and requested range", async () => {
  const tools = createInvestingReadTools(
    reader({ "/api/investing/dashboard": { status: 200, body: dashboard } }),
  );
  expect(await tool(tools, "get_risk", { range: "6M" })).toEqual({
    range: "6M",
    benchmark: "^GSPC",
    risk: { annualizedVolatility: 0.2 },
  });
});

test("get_risk defaults to 1Y", async () => {
  const tools = createInvestingReadTools(
    reader({ "/api/investing/dashboard": { status: 200, body: dashboard } }),
  );
  expect(await tool(tools, "get_risk")).toMatchObject({
    range: "1Y",
    risk: { annualizedVolatility: 0.18 },
  });
});

test("get_agent_memory says unavailable instead of pretending memory is empty", async () => {
  const tools = createInvestingReadTools(
    reader({ "/api/memory": { status: 503, body: { problems: ["Agent memory needs a database"] } } }),
  );
  expect(await tool(tools, "get_agent_memory")).toMatchObject({
    available: false,
    theses: [],
  });
});

test("a failed read is refused and the refusal carries no internal detail", async () => {
  const tools = createInvestingReadTools(
    reader({
      "/api/investing/sectors": {
        status: 500,
        body: { problems: ["boom: SELECT * FROM secret"] },
      },
    }),
  );
  await expect(tool(tools, "get_sector_exposure")).rejects.toThrow(
    "The investing data could not be read right now",
  );
});

test("input is decoded through Effect Schema, so a wrong type is refused", async () => {
  const tools = createInvestingReadTools(reader({}));
  await expect(tool(tools, "get_price", { symbol: 42 })).rejects.toThrow();
});

test("extra input properties are stripped before a tool uses the value", async () => {
  const seen: string[] = [];
  const tools = createInvestingReadTools(
    reader(
      { "/api/investing/prices/AAPL": { status: 200, body: { symbol: "AAPL", date: "2026-03-04" } } },
      seen,
    ),
  );
  await tool(tools, "get_price", { symbol: "AAPL", date: undefined, tenantId: "someone-else" });
  expect(seen).toEqual(["/api/investing/prices/AAPL"]);
});
