import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, jsonSchema, stepCountIs, tool, type ToolSet } from "ai";
import { createHash } from "node:crypto";
import {
  computePortfolioValueSeries,
  type CashBalance,
  type CashFlow,
  type Dividend,
  type InvestingDashboardData,
  type Position,
  type Trade,
} from "@lavega/core";
import type { PriceStore } from "@lavega/adapters";
import { readPriceBars } from "./priceReader.js";

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
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => deps.readBrokerData().positions,
    }),
    get_price: tool({
      description: "Latest known closing price for a symbol, optionally as of a date (YYYY-MM-DD)",
      inputSchema: jsonSchema<{ symbol: string; date?: string }>({
        type: "object",
        properties: {
          symbol: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["symbol"],
        additionalProperties: false,
      }),
      execute: async ({ symbol, date }) => {
        const bar = await getPriceBar(symbol.trim().toUpperCase(), date);
        return bar
          ? { symbol: bar.symbol, date: bar.date, close: bar.close, currency: bar.currency }
          : null;
      },
    }),
    compute_portfolio_value: tool({
      description: "Latest computed total portfolio value in EUR with its date",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => {
        const { positions, trades, dividends, cashBalances, cashFlows } = deps.readBrokerData();
        const symbols = [
          ...new Set([
            ...positions.map((position) => position.symbol),
            ...trades.map((trade) => trade.symbol),
          ]),
        ];
        const { bars } = await readPriceBars(deps.priceStore, TENANT_ID, symbols);
        const today = bars
          .map((bar) => bar.date)
          .sort()
          .at(-1);
        const series = computePortfolioValueSeries(
          positions,
          trades,
          bars,
          "EUR",
          deps.fxRate ?? IDENTITY_FX,
          { cashBalances, cashFlows, dividends, today },
        );
        return series.at(-1) ?? null;
      },
    }),
  };
}

export type RunPortfolioAgentOptions = {
  prompt?: string;
  tools?: ToolSet;
  model?: string;
  agentId?: PortfolioAgentId;
  dashboard?: InvestingDashboardData;
};

export const PORTFOLIO_AGENT_IDS = [
  "warren_buffett",
  "charlie_munger",
  "bill_ackman",
  "ben_graham",
  "peter_lynch",
  "stanley_druckenmiller",
] as const;
export type PortfolioAgentId = (typeof PORTFOLIO_AGENT_IDS)[number];
export type PortfolioAgentSignal = "bullish" | "bearish" | "neutral";

export type PortfolioAgentDefinition = {
  id: PortfolioAgentId;
  displayName: string;
  description: string;
  investingStyle: string;
  systemPrompt: string;
};

export type PortfolioAgentInsight = {
  agentId: PortfolioAgentId;
  displayName: string;
  signal: PortfolioAgentSignal;
  confidence: number;
  summary: string;
  reasoning: string;
  insights: string[];
  model: string;
  snapshotHash: string;
};

const JSON_SCHEMA = [
  "Return JSON only:",
  "{",
  '  "signal": "bullish" | "bearish" | "neutral",',
  '  "confidence": number,',
  '  "summary": "one sentence",',
  '  "reasoning": "2-4 sentences",',
  '  "insights": ["specific portfolio insight", "specific portfolio insight"]',
  "}",
].join("\n");

const PERSONAS: Record<PortfolioAgentId, PortfolioAgentDefinition> = {
  warren_buffett: {
    id: "warren_buffett",
    displayName: "Warren Buffett",
    description: "Quality business owner",
    investingStyle: "Durable moats, financial strength, fair price, long holding period.",
    systemPrompt: [
      "You are a Warren Buffett-style portfolio analyst. You review one user's real positions as a long-term business owner, not a trader.",
      "Focus on circle of competence, durable competitive advantages, stable cash generation, financial strength, valuation discipline, concentration risk, and whether the user could hold the businesses for ten years.",
      "Be neutral when prices, costs, or business evidence are missing. Do not invent company facts outside the provided portfolio data.",
      JSON_SCHEMA,
    ].join("\n\n"),
  },
  charlie_munger: {
    id: "charlie_munger",
    displayName: "Charlie Munger",
    description: "Quality filter",
    investingStyle:
      "Avoid stupidity first: quality, predictability, incentives, low leverage, fair price.",
    systemPrompt: [
      "You are a Charlie Munger-style portfolio analyst. You review one user's real positions with severe standards.",
      "Invert first: what could make this portfolio fail? Look for weak position evidence, concentration in things the user may not understand, leverage-like exposure, bad cost basis, low-quality winners, and too-hard positions.",
      "Prefer a small number of unmistakably good holdings over many mediocre ideas. Be blunt, but use only provided portfolio data.",
      JSON_SCHEMA,
    ].join("\n\n"),
  },
  bill_ackman: {
    id: "bill_ackman",
    displayName: "Bill Ackman",
    description: "Activist lens",
    investingStyle:
      "Concentrated high-quality brands, value unlock, catalysts, financial discipline.",
    systemPrompt: [
      "You are a Bill Ackman-style portfolio analyst. You review one user's real positions through an activist investor lens.",
      "Look for concentrated high-conviction holdings, brand or platform strength implied by position choice, underperformance where operational change could unlock value, catalysts, downside from leverage or poor capital allocation, and whether position size matches conviction.",
      "Do not claim actual activism facts unless provided. If catalyst data is absent, say data is absent.",
      JSON_SCHEMA,
    ].join("\n\n"),
  },
  ben_graham: {
    id: "ben_graham",
    displayName: "Ben Graham",
    description: "Margin of safety",
    investingStyle: "Defensive value, downside protection, valuation discipline.",
    systemPrompt: [
      "You are a Ben Graham-style portfolio analyst. You review one user's real positions as a defensive investor.",
      "Focus on margin of safety, cost basis versus market value, overvaluation risk, position sizing, liquidity of evidence, and protection against permanent loss.",
      "Speculative growth gets little credit unless the provided numbers show adequate downside protection. Use only provided data.",
      JSON_SCHEMA,
    ].join("\n\n"),
  },
  peter_lynch: {
    id: "peter_lynch",
    displayName: "Peter Lynch",
    description: "Growth at reasonable price",
    investingStyle: "Know what you own, simple story, growth visible in results.",
    systemPrompt: [
      "You are a Peter Lynch-style portfolio analyst. You review one user's real positions and ask whether the portfolio has clear, understandable stories.",
      "Look for winners the user may let run, over-owned story stocks, stale losers, missing cost basis, diversification that hides ignorance, and whether each large position has a simple reason to own it.",
      "Plain language only. If the story is not visible from provided data, mark it as unknown.",
      JSON_SCHEMA,
    ].join("\n\n"),
  },
  stanley_druckenmiller: {
    id: "stanley_druckenmiller",
    displayName: "Stanley Druckenmiller",
    description: "Asymmetric setup",
    investingStyle: "Inflections, concentration, risk control, asymmetric payoff.",
    systemPrompt: [
      "You are a Stanley Druckenmiller-style portfolio analyst. You review one user's real positions for asymmetric setups and risk.",
      "Focus on recent price and return inflections, large winners or losers, position concentration, missing prices, downside if the current trend reverses, and whether the portfolio is sized around the best idea or diluted across weak ones.",
      "You have no macro data unless it is in the snapshot. Do not pretend otherwise.",
      JSON_SCHEMA,
    ].join("\n\n"),
  },
};

export function listPortfolioAgents(): PortfolioAgentDefinition[] {
  return PORTFOLIO_AGENT_IDS.map((id) => PERSONAS[id]);
}

export function getPortfolioAgent(id: string | undefined): PortfolioAgentDefinition {
  const normalized = id?.trim() as PortfolioAgentId | undefined;
  if (normalized && PORTFOLIO_AGENT_IDS.includes(normalized)) return PERSONAS[normalized];
  return PERSONAS.warren_buffett;
}

export function resolveAgentConfig(model?: string) {
  const apiKey = process.env.LAVEGA_AGENT_API_KEY?.trim();
  if (!apiKey)
    throw new Error(
      "LAVEGA_AGENT_API_KEY is not set; configure an OpenAI-compatible API key to run the portfolio agent",
    );
  return {
    apiKey,
    baseURL: process.env.LAVEGA_AGENT_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
    modelId: model?.trim() || process.env.LAVEGA_AGENT_MODEL?.trim(),
  };
}

export async function runPortfolioAgent({
  prompt,
  tools,
  model,
  agentId,
  dashboard,
}: RunPortfolioAgentOptions): Promise<PortfolioAgentInsight> {
  const config = resolveAgentConfig(model);
  if (!config.modelId)
    throw new Error("LAVEGA_AGENT_MODEL is not set and no model override was given");
  const provider = createOpenAICompatible({
    name: "lavega-agent",
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
  const agent = getPortfolioAgent(agentId);
  const userPrompt = prompt ?? buildPortfolioAgentPrompt(agent, dashboard);
  const { text } = await generateText({
    model: provider.chatModel(config.modelId),
    tools,
    stopWhen: tools ? stepCountIs(8) : undefined,
    system: dashboard ? agent.systemPrompt : undefined,
    prompt: userPrompt,
  });
  if (!dashboard) {
    return {
      agentId: agent.id,
      displayName: agent.displayName,
      signal: "neutral",
      confidence: 0,
      summary: text,
      reasoning: text,
      insights: [],
      model: config.modelId,
      snapshotHash: "",
    };
  }
  return parsePortfolioAgentResponse(text, agent, config.modelId, portfolioSnapshotHash(dashboard));
}

export function buildPortfolioAgentPrompt(
  agent: PortfolioAgentDefinition,
  dashboard: InvestingDashboardData | undefined,
): string {
  if (!dashboard) return `Give a concise ${agent.displayName} view on this portfolio.`;
  return [
    `Agent: ${agent.displayName}`,
    "Task: read this user's current personal investing positions and give one new agent-specific insight.",
    "Rules: educational analysis only, no individualized trade instruction, no invented data, mention missing prices or missing cost basis when relevant.",
    "",
    "Portfolio snapshot:",
    renderPortfolioSnapshot(dashboard),
  ].join("\n");
}

export function renderPortfolioSnapshot(dashboard: InvestingDashboardData): string {
  const latestValue = dashboard.portfolio.All.at(-1);
  const priced = dashboard.positions.filter((position) => position.marketValue !== null);
  const totalValue = priced.reduce((sum, position) => sum + (position.marketValue ?? 0), 0);
  const topPositions = [...dashboard.positions]
    .sort((left, right) => (right.marketValue ?? -1) - (left.marketValue ?? -1))
    .slice(0, 12)
    .map((position) => ({
      symbol: position.symbol,
      entity: position.entity,
      description: position.description ?? null,
      quantity: round(position.quantity, 6),
      marketValue: round(position.marketValue, 2),
      weight: round(position.portfolioWeight, 4),
      priceStatus: position.priceStatus,
      returnStatus: position.returns.status,
      totalReturn: round(position.returns.totalReturn, 2),
      totalReturnPercentage: round(position.returns.totalReturnPercentage, 4),
      firstBuyDate: position.returns.firstBuyDate,
    }));
  return JSON.stringify(
    {
      dataVersion: dashboard.dataVersion,
      currency: dashboard.presentationCurrency,
      latestValue,
      totalPricedValue: round(totalValue, 2),
      positionCount: dashboard.positions.length,
      pricedPositionCount: priced.length,
      unpriced: dashboard.allocation.instrument.unpriced,
      allocation: dashboard.allocation.instrument.buckets.slice(0, 10),
      sectors: dashboard.allocation.entity.buckets.slice(0, 10),
      topPositions,
      problems: dashboard.problems,
    },
    null,
    2,
  );
}

function parsePortfolioAgentResponse(
  text: string,
  agent: PortfolioAgentDefinition,
  model: string,
  snapshotHash: string,
): PortfolioAgentInsight {
  const parsed = extractJsonObject(text);
  const rawSignal = String(parsed.signal ?? "").toLowerCase();
  const signal: PortfolioAgentSignal =
    rawSignal === "bullish" || rawSignal === "bearish" || rawSignal === "neutral"
      ? rawSignal
      : "neutral";
  const confidence = clamp(Number(parsed.confidence), 0, 100);
  const reasoning = String(parsed.reasoning ?? parsed.summary ?? "");
  const summary = String(parsed.summary ?? reasoning);
  const insights = Array.isArray(parsed.insights)
    ? parsed.insights
        .map((item) => String(item))
        .filter(Boolean)
        .slice(0, 5)
    : [];
  return {
    agentId: agent.id,
    displayName: agent.displayName,
    signal,
    confidence,
    summary,
    reasoning,
    insights,
    model,
    snapshotHash,
  };
}

function extractJsonObject(text: string): Record<string, unknown> {
  const fence = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/.exec(text);
  if (fence) return JSON.parse(fence[1]!);
  try {
    return JSON.parse(text.trim()) as Record<string, unknown>;
  } catch {
    const start = text.indexOf("{");
    if (start < 0) throw new Error("Portfolio agent returned no JSON object");
    let depth = 0;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) return JSON.parse(text.slice(start, index + 1)) as Record<string, unknown>;
      }
    }
    throw new Error("Portfolio agent returned incomplete JSON");
  }
}

function portfolioSnapshotHash(dashboard: InvestingDashboardData): string {
  return createHash("sha256").update(renderPortfolioSnapshot(dashboard)).digest("hex").slice(0, 24);
}

function round(value: number | null | undefined, digits: number): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
