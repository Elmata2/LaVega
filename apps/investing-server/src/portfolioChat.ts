import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  isStepCount,
  jsonSchema,
  tool,
  ToolLoopAgent,
  type Agent,
  type LanguageModel,
  type ToolSet,
} from "ai";
import {
  buildHistoricalRisk,
  renderFundamentalsBrief,
  renderPortfolioBrief,
  type FundamentalsProvider,
  type InvestingDashboardData,
  type RiskRange,
  type SectorExposure,
  type Trade,
} from "@lavega/core";
import type { PortfolioAgentId } from "./portfolioAgent.js";
import { PORTFOLIO_CHAT_PROFILES } from "./personaProfiles.js";
import { memoryTools, renderMemoryBrief, type ThreadMemory } from "./chatMemory.js";

export const DEFAULT_PORTFOLIO_CHAT_MODEL = "mistralai/mistral-small-2603";
const FALLBACK_PORTFOLIO_CHAT_MODELS = ["qwen/qwen3.8-flash"];
const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const PREFETCH_HOLDINGS = 5;
const PREFETCH_NAMED = 3;
const PREFETCH_TIMEOUT_MS = 5_000;
const MAX_STEPS = 5;
const MAX_TRADES = 60;
/* All-caps words a user types that are not tickers. */
const NOT_TICKERS = new Set([
  "AI",
  "CEO",
  "CFO",
  "EPS",
  "ETF",
  "EU",
  "EUR",
  "FCF",
  "GDP",
  "IPO",
  "OK",
  "PE",
  "ROE",
  "ROI",
  "UK",
  "US",
  "USA",
  "USD",
  "GBP",
  "VS",
]);

/** Everything one chat turn may read, already scoped to the tenant. */
export type PortfolioChatContext = {
  dashboard: InvestingDashboardData;
  sectors: readonly SectorExposure[] | null;
  trades: () => readonly Trade[];
  price: (
    symbol: string,
    date?: string,
  ) => Promise<{ symbol: string; date: string; close: number; currency: string } | null>;
  fundamentals: FundamentalsProvider;
};

export function resolvePortfolioChatModel(): LanguageModel {
  const apiKey = process.env.LAVEGA_AGENT_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("LAVEGA_AGENT_API_KEY or OPENROUTER_API_KEY is not set");
  const baseURL = process.env.LAVEGA_AGENT_BASE_URL?.trim() || OPENROUTER_URL;
  const modelId = process.env.LAVEGA_AGENT_MODEL?.trim() || DEFAULT_PORTFOLIO_CHAT_MODEL;
  return createOpenAICompatible({
    name: "lavega-agent",
    baseURL,
    apiKey,
    /* Mistral's shared OpenRouter pool answers 429 often. OpenRouter moves
     * to the next model in `models` itself, with no extra round trip. */
    transformRequestBody: (body) =>
      baseURL === OPENROUTER_URL
        ? { ...body, models: [modelId, ...FALLBACK_PORTFOLIO_CHAT_MODELS] }
        : body,
  }).chatModel(modelId);
}

/** Holdings the message names, by symbol or by the first word of their
 *  name, then all-caps words that look like tickers the user does not hold. */
export function namedSymbols(message: string, dashboard: InvestingDashboardData): string[] {
  const words = new Set(message.toLowerCase().match(/[a-z0-9.$]+/g) ?? []);
  const held = dashboard.positions
    .filter((position) => {
      const symbol = position.symbol.toLowerCase();
      if (words.has(symbol) || words.has(`$${symbol}`))
        return symbol.length > 2 || message.includes(position.symbol);
      const name = position.description?.toLowerCase().match(/[a-z0-9]+/)?.[0];
      return name !== undefined && name.length >= 4 && words.has(name);
    })
    .map((position) => position.symbol);
  const heldSet = new Set(held.map((symbol) => symbol.toUpperCase()));
  const other = [...message.matchAll(/(?:^|[^\w$])\$?([A-Z]{2,5}(?:\.[A-Z]{1,2})?)(?![\w.])/g)]
    .map((match) => match[1]!)
    .filter((symbol) => !NOT_TICKERS.has(symbol) && !heldSet.has(symbol));
  return [...new Set([...held, ...other])];
}

/** The symbols worth fetching before the first token: what the message
 *  names, then the largest holdings. */
export function prefetchSymbols(message: string, dashboard: InvestingDashboardData): string[] {
  const largest = [...dashboard.positions]
    .filter((position) => position.marketValue !== null)
    .sort((left, right) => right.marketValue! - left.marketValue!)
    .slice(0, PREFETCH_HOLDINGS)
    .map((position) => position.symbol);
  return [...new Set([...namedSymbols(message, dashboard).slice(0, PREFETCH_NAMED), ...largest])];
}

async function fundamentalsSection(provider: FundamentalsProvider, symbol: string) {
  try {
    const fundamentals = await Promise.race([
      provider.fetch(symbol),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timed out")), PREFETCH_TIMEOUT_MS).unref?.(),
      ),
    ]);
    return fundamentals
      ? renderFundamentalsBrief(fundamentals)
      : `${symbol}: no company fundamentals (a fund, or a symbol the provider does not know).`;
  } catch {
    return `${symbol}: fundamentals unavailable right now.`;
  }
}

/** One agent per conversation. The portfolio brief and fundamentals for
 *  the named and largest holdings are fetched in parallel before the model
 *  is called, so the first answer rarely waits on a tool round trip. */
export async function createPortfolioChatAgent(input: {
  agentId: PortfolioAgentId;
  message: string;
  context: PortfolioChatContext;
  /** Absent without a database: the turn then runs without memory. */
  memory?: ThreadMemory;
  model?: LanguageModel;
}): Promise<Agent<never, ToolSet>> {
  const { context, memory } = input;
  const symbols = prefetchSymbols(input.message, context.dashboard);
  const held = new Set(
    context.dashboard.positions.map((position) => position.symbol.toUpperCase()),
  );
  const named = namedSymbols(input.message, context.dashboard)
    .map((symbol) => symbol.toUpperCase())
    .filter((symbol) => held.has(symbol));
  const [sections, summary] = await Promise.all([
    Promise.all(symbols.map((symbol) => fundamentalsSection(context.fundamentals, symbol))),
    /* A portfolio that read as empty is more likely a sync that has not
     * landed than a sale of everything, so it closes no thesis. */
    memory?.repository.summary({
      held: [...held],
      named,
      closeUnheld: held.size > 0,
    }),
  ]);
  const noArguments = jsonSchema<Record<string, never>>({
    type: "object",
    properties: {},
    additionalProperties: false,
  });
  return new ToolLoopAgent<never, ToolSet>({
    model: input.model ?? resolvePortfolioChatModel(),
    instructions: [
      PORTFOLIO_CHAT_PROFILES[input.agentId],
      `Portfolio brief:\n${renderPortfolioBrief(context.dashboard, context.sectors)}`,
      sections.length > 0 ? `Company fundamentals:\n\n${sections.join("\n\n")}` : "",
      summary ? renderMemoryBrief(summary, named) : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    stopWhen: isStepCount(MAX_STEPS),
    tools: {
      ...(memory ? memoryTools(memory, held) : {}),
      get_positions: tool({
        description:
          "Every holding with weight, market value, cost basis, returns and first buy date. Weights and returns are fractions.",
        inputSchema: noArguments,
        execute: async () =>
          context.dashboard.positions.map((position) => ({
            symbol: position.symbol,
            name: position.description ?? null,
            quantity: position.quantity,
            currency: position.currency,
            marketValue: position.marketValue,
            weight: position.portfolioWeight,
            priceStatus: position.priceStatus,
            costBasis: position.returns.remainingCostBasis,
            unrealizedGain: position.returns.unrealizedGain,
            realizedGain: position.returns.realizedGain,
            dividendsReceived: position.returns.dividendsReceived,
            totalReturn: position.returns.totalReturn,
            totalReturnPercentage: position.returns.totalReturnPercentage,
            firstBuyDate: position.returns.firstBuyDate,
          })),
      }),
      get_price: tool({
        description: "Closing price for a symbol, the latest or the last one on or before a date.",
        inputSchema: jsonSchema<{ symbol: string; date?: string }>({
          type: "object",
          properties: {
            symbol: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD" },
          },
          required: ["symbol"],
          additionalProperties: false,
        }),
        execute: async ({ symbol, date }) => context.price(symbol.trim().toUpperCase(), date),
      }),
      compute_portfolio_value: tool({
        description: `Latest total portfolio value in ${context.dashboard.presentationCurrency} with its date.`,
        inputSchema: noArguments,
        execute: async () => {
          const latest = context.dashboard.portfolio.All.at(-1);
          return latest
            ? {
                date: latest.date,
                value: latest.value,
                currency: context.dashboard.presentationCurrency,
              }
            : null;
        },
      }),
      get_fundamentals: tool({
        description:
          "Company financials for any symbol: valuation, margins, returns, balance sheet, up to 5 years of statements, recent quarters and analyst estimates.",
        inputSchema: jsonSchema<{ symbol: string }>({
          type: "object",
          properties: { symbol: { type: "string" } },
          required: ["symbol"],
          additionalProperties: false,
        }),
        execute: async ({ symbol }) => fundamentalsSection(context.fundamentals, symbol.trim()),
      }),
      get_sector_exposure: tool({
        description: "Portfolio weight by sector, with funds looked through to their holdings.",
        inputSchema: noArguments,
        execute: async () => context.sectors ?? "Sector exposure is unavailable.",
      }),
      get_risk: tool({
        description:
          "Historical risk of the portfolio against its benchmark: volatility, drawdown, beta and coverage.",
        inputSchema: jsonSchema<{ range?: RiskRange }>({
          type: "object",
          properties: { range: { type: "string", enum: ["6M", "1Y", "All"] } },
          additionalProperties: false,
        }),
        execute: async ({ range }) => buildHistoricalRisk(context.dashboard, range ?? "1Y").risk,
      }),
      get_trades: tool({
        description: `The owner's trades, newest first, at most ${MAX_TRADES}, optionally for one symbol.`,
        inputSchema: jsonSchema<{ symbol?: string }>({
          type: "object",
          properties: { symbol: { type: "string" } },
          additionalProperties: false,
        }),
        execute: async ({ symbol }) =>
          context
            .trades()
            .filter(
              (trade) => !symbol || trade.symbol.toUpperCase() === symbol.trim().toUpperCase(),
            )
            .sort((left, right) => right.date.localeCompare(left.date))
            .slice(0, MAX_TRADES)
            .map(({ date, symbol, side, quantity, price, currency }) => ({
              date,
              symbol,
              side,
              quantity,
              price,
              currency,
            })),
      }),
    },
  });
}
