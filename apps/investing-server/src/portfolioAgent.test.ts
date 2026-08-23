import { afterEach, expect, test, vi } from "vitest";
import { createInMemoryPriceStore } from "@lavega/adapters";
import type { Position, PriceBar, Trade } from "@lavega/core";
import { createPortfolioAgentTools, resolveAgentConfig } from "./portfolioAgent.js";

afterEach(() => vi.unstubAllEnvs());

const position: Position = { tenantId: "local", entity: "personal", symbol: "AAPL", quantity: 2, averagePrice: 10, marketPrice: null, marketValue: null, currency: "EUR", asOf: "2026-08-19" };
const trade: Trade = { id: "t1", tenantId: "local", entity: "personal", date: "2026-08-10", symbol: "AAPL", side: "buy", quantity: 2, price: 10, amount: 20, currency: "EUR", commission: 0 };
const bars: PriceBar[] = [
  { tenantId: "local", symbol: "AAPL", date: "2026-08-18", close: 14, currency: "EUR" },
  { tenantId: "local", symbol: "AAPL", date: "2026-08-19", close: 15, currency: "EUR" },
];

async function tools() {
  const priceStore = createInMemoryPriceStore();
  await priceStore.upsert(bars);
  return createPortfolioAgentTools({ readBrokerData: () => ({ positions: [position], trades: [trade], dividends: [], cashBalances: [], cashFlows: [] }), priceStore });
}

const executeOptions = () => ({ toolCallId: `call-${Math.random()}`, messages: [] }) as never;

test("get_positions returns the restored broker positions", async () => {
  expect(await (await tools()).get_positions.execute!({}, executeOptions())).toEqual([position]);
});

test("get_price returns the latest close and honours an as-of date", async () => {
  const agentTools = await tools();
  expect(await agentTools.get_price.execute!({ symbol: "aapl" }, executeOptions())).toEqual({ symbol: "AAPL", date: "2026-08-19", close: 15, currency: "EUR" });
  expect(await agentTools.get_price.execute!({ symbol: "AAPL", date: "2026-08-18" }, executeOptions())).toMatchObject({ date: "2026-08-18", close: 14 });
  expect(await agentTools.get_price.execute!({ symbol: "MSFT" }, executeOptions())).toBeNull();
});

test("compute_portfolio_value delegates to the core portfolio calculation", async () => {
  expect(await (await tools()).compute_portfolio_value.execute!({}, executeOptions())).toMatchObject({ date: "2026-08-19", value: 30 });
});

test("runPortfolioAgent refuses to start without an API key", async () => {
  const { runPortfolioAgent } = await import("./portfolioAgent.js");
  vi.stubEnv("LAVEGA_AGENT_API_KEY", "");
  expect(() => resolveAgentConfig()).toThrow("LAVEGA_AGENT_API_KEY is not set");
  await expect(runPortfolioAgent({ prompt: "hello" })).rejects.toThrow("LAVEGA_AGENT_API_KEY");
});
