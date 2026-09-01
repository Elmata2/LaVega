import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, jsonSchema, stepCountIs, tool, type ToolSet } from "ai";
import { computePortfolioValueSeries, type CashBalance, type CashFlow, type Dividend, type Position, type Trade } from "@lavega/core";
import type { PriceStore } from "@lavega/adapters";

const TENANT_ID = "local";

export type PortfolioAgentBrokerData = {
  positions: Position[];
  trades: Trade[];
  dividends: Dividend[];
  cashBalances: CashBalance[];
  cashFlows: CashFlow[];
};

export type PortfolioAgentDeps = {
  readBrokerData: () => PortfolioAgentBrokerData;
  priceStore: PriceStore;
  fxRate?: { base: string; date: string; rates: Record<string, number> };
};

const IDENTITY_FX = { base: "EUR", date: "0000-01-01", rates: { EUR: 1 } };

export function createPortfolioAgentTools(deps: PortfolioAgentDeps): ToolSet {
  const getPriceBar = async (symbol: string, date?: string) => {
    const bars = await deps.priceStore.getRange(TENANT_ID, symbol, date, date);
    return bars.filter((bar) => date === undefined || bar.date <= date).at(-1) ?? null;
  };

  return {
    get_positions: tool({
      description: "Current broker positions with symbol and quantity",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }),
      execute: async () => deps.readBrokerData().positions,
    }),
    get_price: tool({
      description: "Latest known closing price for a symbol, optionally as of a date (YYYY-MM-DD)",
      inputSchema: jsonSchema<{ symbol: string; date?: string }>({
        type: "object",
        properties: { symbol: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" } },
        required: ["symbol"],
        additionalProperties: false,
      }),
      execute: async ({ symbol, date }) => {
        const bar = await getPriceBar(symbol.trim().toUpperCase(), date);
        return bar ? { symbol: bar.symbol, date: bar.date, close: bar.close, currency: bar.currency } : null;
      },
    }),
    compute_portfolio_value: tool({
      description: "Latest computed total portfolio value in EUR with its date",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }),
      execute: async () => {
        const { positions, trades, dividends, cashBalances, cashFlows } = deps.readBrokerData();
        const symbols = [...new Set([...positions.map((position) => position.symbol), ...trades.map((trade) => trade.symbol)])];
        const bars = (await Promise.all(symbols.map((symbol) => deps.priceStore.getRange(TENANT_ID, symbol)))).flat();
        const today = bars.map((bar) => bar.date).sort().at(-1);
        const series = computePortfolioValueSeries(positions, trades, bars, "EUR", deps.fxRate ?? IDENTITY_FX, { cashBalances, cashFlows, dividends, today });
        return series.at(-1) ?? null;
      },
    }),
  };
}

export type RunPortfolioAgentOptions = {
  prompt: string;
  tools?: ToolSet;
  model?: string;
};

export function resolveAgentConfig(model?: string) {
  const apiKey = process.env.LAVEGA_AGENT_API_KEY?.trim();
  if (!apiKey) throw new Error("LAVEGA_AGENT_API_KEY is not set; configure an OpenAI-compatible API key to run the portfolio agent");
  return {
    apiKey,
    baseURL: process.env.LAVEGA_AGENT_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
    modelId: model?.trim() || process.env.LAVEGA_AGENT_MODEL?.trim(),
  };
}

export async function runPortfolioAgent({ prompt, tools, model }: RunPortfolioAgentOptions): Promise<string> {
  const config = resolveAgentConfig(model);
  if (!config.modelId) throw new Error("LAVEGA_AGENT_MODEL is not set and no model override was given");
  const provider = createOpenAICompatible({ name: "lavega-agent", baseURL: config.baseURL, apiKey: config.apiKey });
  const { text } = await generateText({ model: provider.chatModel(config.modelId), tools, stopWhen: stepCountIs(8), prompt });
  return text;
}
