import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { isStepCount, ToolLoopAgent, type Agent, type LanguageModel, type ToolSet } from "ai";
import {
  renderFundamentalsBrief,
  renderPortfolioBrief,
  type FundamentalsProvider,
  type InvestingDashboardData,
  type SectorExposure,
  type Trade,
} from "@lavega/core";
import { getPortfolioAgent, type PortfolioAgentId } from "./portfolioAgent.js";
import { PORTFOLIO_CHAT_PROFILES } from "./personaProfiles.js";
import { renderMemoryBrief, type ThreadMemory } from "./chatMemory.js";
import { createInvestingTools } from "./tools/investingTools.js";
import {
  createChatInvestingSource,
  createMemoryToolDefinitions,
  toAiSdkTools,
} from "./tools/chatTools.js";
import {
  toolLoopStepPolicy,
  toolLoopTurnStatus,
  TOOL_LOOP_MAX_ROUNDS,
  type ToolLoopTurnStatus,
} from "./toolLoop.js";

export const DEFAULT_PORTFOLIO_CHAT_MODEL = "mistralai/mistral-small-2603";
const FALLBACK_PORTFOLIO_CHAT_MODELS = ["qwen/qwen3.8-flash"];
const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const PREFETCH_HOLDINGS = 5;
const PREFETCH_NAMED = 3;
const PREFETCH_TIMEOUT_MS = 5_000;
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
    /* `Output.object` is the letter and stock-research contract, and this flag
     * is what makes it real: without it the provider drops the schema and warns
     * `responseFormat ... only supported with structuredOutputs`, so the model
     * answers in prose and a caller that needs an object (the letter's
     * observations) gets strings it has to throw away. The provider then sends
     * `response_format: json_schema`. */
    supportsStructuredOutputs: true,
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

const guestSection = (host: PortfolioAgentId) =>
  `You were tagged into the owner's conversation with ${getPortfolioAgent(host).displayName}. Lines starting [Name] come from other agents; unlabelled lines are from the owner. Read the thread, then give your own view in your own voice. Disagree with ${getPortfolioAgent(host).displayName} when your lens says so. Do not repeat what was already said.`;

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
  /** Owner of the thread when `agentId` was tagged into it. */
  host?: PortfolioAgentId;
  /** Called once when the turn ends, with the hardened status (WS5.6). */
  onTurnStatus?: (status: ToolLoopTurnStatus) => void;
}): Promise<Agent<never, ToolSet>> {
  const { context, memory } = input;
  const symbols = prefetchSymbols(input.message, context.dashboard);
  const held = new Set(
    context.dashboard.positions.map((position) => position.symbol.toUpperCase()),
  );
  const named = namedSymbols(input.message, context.dashboard)
    .map((symbol) => symbol.toUpperCase())
    .filter((symbol) => held.has(symbol));
  /* The canonical keys of the same holdings (WS4.5, #297), so a thesis stored
   * under another broker's spelling of the same ISIN is still found. */
  const keysOf = (symbols: ReadonlySet<string>): string[] => {
    const keys = new Set<string>();
    for (const position of context.dashboard.positions) {
      if (!symbols.has(position.symbol.toUpperCase())) continue;
      if (position.instrumentKey) keys.add(position.instrumentKey);
    }
    return [...keys];
  };
  const [sections, summary] = await Promise.all([
    Promise.all(symbols.map((symbol) => fundamentalsSection(context.fundamentals, symbol))),
    /* A portfolio that read as empty is more likely a sync that has not
     * landed than a sale of everything, so it closes no thesis. */
    memory?.repository.summary({
      held: [...held],
      named,
      heldKeys: keysOf(held),
      namedKeys: keysOf(new Set(named)),
      closeUnheld: held.size > 0,
    }),
  ]);

  /* ONE registry, projected twice: the chat binds the in-process source and the
   * MCP surface binds the HTTP one (WS5.3). Memory tools are chat-only. */
  const tools: ToolSet = toAiSdkTools([
    ...createInvestingTools(createChatInvestingSource(context, memory)),
    ...(memory ? createMemoryToolDefinitions(memory, held) : []),
  ]);

  /* Loop accounting for the turn status (WS5.6): rounds run, and whether the
   * provider failed. `onEnd` may not fire when the provider throws. */
  let rounds = 0;
  let failed = false;
  return new ToolLoopAgent<never, ToolSet>({
    model: input.model ?? resolvePortfolioChatModel(),
    instructions: [
      PORTFOLIO_CHAT_PROFILES[input.agentId],
      input.host && input.host !== input.agentId ? guestSection(input.host) : "",
      `Portfolio brief:\n${renderPortfolioBrief(context.dashboard, context.sectors)}`,
      sections.length > 0 ? `Company fundamentals:\n\n${sections.join("\n\n")}` : "",
      summary ? renderMemoryBrief(summary, named) : "",
      `You have at most ${TOOL_LOOP_MAX_ROUNDS} rounds in this turn. The last round must answer the owner in text without calling a tool.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    stopWhen: isStepCount(TOOL_LOOP_MAX_ROUNDS),
    /* Round 8 is forced text: an empty tool set AND toolChoice none, so a
     * provider that cached a tool cannot still emit a call (WS5.6). */
    prepareStep: ({ stepNumber }) => {
      const policy = toolLoopStepPolicy(stepNumber);
      if (policy.activeTools === null) return {};
      return { toolChoice: policy.toolChoice, activeTools: policy.activeTools as never };
    },
    tools,
    onStepEnd: () => {
      rounds += 1;
    },
    onEnd: (event) => {
      input.onTurnStatus?.(
        toolLoopTurnStatus({
          rounds,
          hasText: typeof event.text === "string" && event.text.trim().length > 0,
          ...(failed ? { error: true } : {}),
        }),
      );
    },
  });
}
