import { afterEach, expect, test, vi } from "vitest";
import { createInMemoryPriceStore } from "@lavega/adapters";
import type { InvestingDashboardData, Position, PriceBar, Trade } from "@lavega/core";
import {
  createPortfolioAgentTools,
  getPortfolioAgent,
  listPortfolioAgents,
  renderPortfolioSnapshot,
  resolveAgentConfig,
} from "./portfolioAgent.js";

afterEach(() => vi.unstubAllEnvs());

const position: Position = {
  entity: "personal",
  symbol: "AAPL",
  quantity: 2,
  averagePrice: 10,
  marketPrice: null,
  marketValue: null,
  currency: "EUR",
  asOf: "2026-08-19",
};
const trade: Trade = {
  id: "t1",
  entity: "personal",
  date: "2026-08-10",
  symbol: "AAPL",
  side: "buy",
  quantity: 2,
  price: 10,
  amount: 20,
  currency: "EUR",
  commission: 0,
};
const bars: PriceBar[] = [
  { symbol: "AAPL", date: "2026-08-18", close: 14, currency: "EUR" },
  { symbol: "AAPL", date: "2026-08-19", close: 15, currency: "EUR" },
];

async function tools() {
  const priceStore = createInMemoryPriceStore();
  await priceStore.upsert("local", bars);
  return createPortfolioAgentTools({
    readBrokerData: () => ({
      positions: [position],
      trades: [trade],
      dividends: [],
      cashBalances: [],
      cashFlows: [],
    }),
    priceStore,
  });
}

const executeOptions = () => ({ toolCallId: `call-${Math.random()}`, messages: [] }) as never;

test("get_positions returns the restored broker positions", async () => {
  expect(await (await tools()).get_positions.execute!({}, executeOptions())).toEqual([position]);
});

test("get_price returns the latest close and honours an as-of date", async () => {
  const agentTools = await tools();
  expect(await agentTools.get_price.execute!({ symbol: "aapl" }, executeOptions())).toEqual({
    symbol: "AAPL",
    date: "2026-08-19",
    close: 15,
    currency: "EUR",
  });
  expect(
    await agentTools.get_price.execute!({ symbol: "AAPL", date: "2026-08-18" }, executeOptions()),
  ).toMatchObject({ date: "2026-08-18", close: 14 });
  expect(await agentTools.get_price.execute!({ symbol: "MSFT" }, executeOptions())).toBeNull();
});

test("compute_portfolio_value delegates to the core portfolio calculation", async () => {
  expect(
    await (
      await tools()
    ).compute_portfolio_value.execute!({}, executeOptions()),
  ).toMatchObject({ date: "2026-08-19", value: 30 });
});

test("runPortfolioAgent refuses to start without an API key", async () => {
  const { runPortfolioAgent } = await import("./portfolioAgent.js");
  vi.stubEnv("LAVEGA_AGENT_API_KEY", "");
  expect(() => resolveAgentConfig()).toThrow("LAVEGA_AGENT_API_KEY is not set");
  await expect(runPortfolioAgent({ prompt: "hello" })).rejects.toThrow("LAVEGA_AGENT_API_KEY");
});

test("portfolio agent registry exposes distinct investor personas", () => {
  expect(listPortfolioAgents().map((agent) => agent.id)).toEqual([
    "warren_buffett",
    "charlie_munger",
    "bill_ackman",
    "ben_graham",
    "peter_lynch",
    "stanley_druckenmiller",
  ]);
  expect(getPortfolioAgent("bill_ackman").systemPrompt).toContain("activist investor lens");
  expect(getPortfolioAgent("unknown").id).toBe("warren_buffett");
});

test("compute_portfolio_value bounds price-store concurrency", async () => {
  let inflight = 0;
  let peak = 0;
  const priceStore = createInMemoryPriceStore();
  const symbols = Array.from({ length: 10 }, (_, index) => `SYM${index}`);
  await priceStore.upsert(
    "local",
    symbols.map((symbol) => ({ symbol, date: "2026-08-19", close: 1, currency: "EUR" })),
  );
  const instrumented = {
    ...priceStore,
    getRange: (async (...args: Parameters<typeof priceStore.getRange>) => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await priceStore.getRange(...args);
      } finally {
        inflight -= 1;
      }
    }) as typeof priceStore.getRange,
  };
  const agentTools = createPortfolioAgentTools({
    readBrokerData: () => ({
      positions: symbols.map((symbol) => ({ ...position, symbol })),
      trades: [],
      dividends: [],
      cashBalances: [],
      cashFlows: [],
    }),
    priceStore: instrumented,
  });
  await agentTools.compute_portfolio_value.execute!({}, executeOptions());
  expect(peak).toBeLessThanOrEqual(3);
});

test("portfolio snapshot renders user position facts for LLM input", () => {
  const dashboard: InvestingDashboardData = {
    dataVersion: 3,
    presentationCurrency: "EUR",
    portfolio: {
      "1M": [],
      "6M": [],
      "1Y": [],
      YTD: [],
      All: [
        {
          date: "2026-08-19",
          positionsValue: 30,
          cashValue: 0,
          value: 30,
          unpriced: [],
          forwardFilled: [],
          cashUnknown: [],
        },
      ],
    },
    benchmarks: [],
    externalCashFlows: [],
    allocation: {
      instrument: {
        buckets: [{ key: "AAPL", label: "AAPL", value: 30, unpriced: false }],
        unpriced: [],
      },
      entity: { buckets: [], unpriced: [] },
    },
    positions: [
      {
        symbol: "AAPL",
        entity: "personal",
        quantity: 2,
        currency: "EUR",
        asOf: "2026-08-19",
        marketValue: 30,
        portfolioWeight: 1,
        priceStatus: "priced",
        returns: {
          status: "broker-average",
          remainingCostBasis: 20,
          realizedCostBasisRemoved: null,
          unrealizedGain: 10,
          realizedGain: null,
          dividendsReceived: 0,
          totalReturn: 10,
          totalReturnPercentage: 0.5,
          sinceFirstBuyPercentage: null,
          firstBuyDate: "2026-08-10",
        },
      },
    ],
    position: null,
    problems: [],
  };

  expect(JSON.parse(renderPortfolioSnapshot(dashboard))).toMatchObject({
    dataVersion: 3,
    totalPricedValue: 30,
    topPositions: [{ symbol: "AAPL", weight: 1, totalReturnPercentage: 0.5 }],
  });
});
