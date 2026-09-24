import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, jsonSchema, tool, type ToolSet } from "ai";
import type {
  ChoiceQuestion,
  ChoiceResponse,
  ScoreQuestion,
  ScoreResponse,
} from "@typesafe-ai/sdk";
import {
  computePortfolioValueSeries,
  inCurrentShareUnits,
  type CashBalance,
  type CashFlow,
  type CashHistoryCoverage,
  type Dividend,
  type InvestingDashboardData,
  type Position,
  type SectorExposure,
  type Trade,
} from "@lavega/core";
import type { PriceStore } from "@lavega/adapters";
import { readPriceBars } from "./priceReader.js";
import {
  createSystemOneProvider,
  type SystemOneProvider,
  type SystemOneQuestion,
} from "./systemOne.js";

const TENANT_ID = "local";
export const DEFAULT_PORTFOLIO_CONVERSATION_MODEL = "inclusionai/ling-3.0-flash-fin:free";

export type PortfolioAgentBrokerData = {
  positions: Position[];
  trades: Trade[];
  dividends: Dividend[];
  cashBalances: CashBalance[];
  cashFlows: CashFlow[];
  cashCoverage?: CashHistoryCoverage[];
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
        const { positions, trades, dividends, cashBalances, cashFlows, cashCoverage } =
          deps.readBrokerData();
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
        const units = inCurrentShareUnits(positions, trades, bars);
        const series = computePortfolioValueSeries(
          units.positions,
          units.trades,
          bars,
          "EUR",
          deps.fxRate ?? IDENTITY_FX,
          { cashBalances, cashFlows, cashCoverage, dividends, today },
        );
        return series.at(-1) ?? null;
      },
    }),
  };
}

export type RunPortfolioAgentOptions = {
  model?: string;
  dashboard?: InvestingDashboardData;
  /** Sector exposure resolved by `sectorResolution.ts` from stored sector
   *  profiles. Absent or empty renders as `"unavailable"` — never as an
   *  entity name and never as a guessed industry. */
  sectors?: readonly SectorExposure[];
  provider?: SystemOneProvider;
  /** Session user charged for the TypeSafe call. */
  userId?: string;
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
  instructions: string;
  criteria: string;
};

export type PortfolioJudgmentChoice = PortfolioAgentSignal | "no_view";
export type PortfolioJudgment = {
  agentId: PortfolioAgentId;
  displayName: string;
  signal: ChoiceResponse | null;
  conviction: ScoreResponse | null;
};
export type PortfolioJudgmentRun = {
  judgments: PortfolioJudgment[];
  model: string;
  snapshotHash: string;
};
export type PortfolioConversationTurn = { role: "user" | "assistant"; content: string };
export type PortfolioConversationReply = {
  agentId: PortfolioAgentId;
  displayName: string;
  text: string;
  model: string;
  snapshotHash: string;
  judgment: { signal: PortfolioJudgmentChoice; confidence: number };
};
export type PortfolioConversationProvider = {
  reply(input: { model: string; system: string; prompt: string }): Promise<string>;
};
export type PortfolioJudgmentComposition = {
  signal: PortfolioJudgmentChoice;
  confidence: number;
  contributingAgents: number;
};

const PERSONAS: Record<PortfolioAgentId, PortfolioAgentDefinition> = {
  warren_buffett: {
    id: "warren_buffett",
    displayName: "Warren Buffett",
    description: "Quality business owner",
    investingStyle: "Durable moats, financial strength, fair price, long holding period.",
    instructions:
      "Review this portfolio as a long-term business owner. Educational analysis only. Never give individual trade instruction or invent facts. Name missing prices or cost basis when material.",
    criteria:
      "Focus on circle of competence, durable advantages, cash generation, financial strength, valuation discipline, concentration risk, and ten-year holding quality.",
  },
  charlie_munger: {
    id: "charlie_munger",
    displayName: "Charlie Munger",
    description: "Quality filter",
    investingStyle:
      "Avoid stupidity first: quality, predictability, incentives, low leverage, fair price.",
    instructions:
      "Review this portfolio with severe standards. Educational analysis only. Never give individual trade instruction or invent facts. Name missing prices or cost basis when material.",
    criteria:
      "Invert first. Look for failure risk, weak evidence, concentration, leverage-like exposure, bad cost basis, low-quality winners, and too-hard positions.",
  },
  bill_ackman: {
    id: "bill_ackman",
    displayName: "Bill Ackman",
    description: "Activist lens",
    investingStyle:
      "Concentrated high-quality brands, value unlock, catalysts, financial discipline.",
    instructions:
      "Review this portfolio through an activist investor lens. Educational analysis only. Never give individual trade instruction or invent facts. Name missing prices or cost basis when material.",
    criteria:
      "Look for concentrated conviction, implied brand strength, value-unlock evidence, catalysts, leverage or capital-allocation downside, and position size versus conviction.",
  },
  ben_graham: {
    id: "ben_graham",
    displayName: "Ben Graham",
    description: "Margin of safety",
    investingStyle: "Defensive value, downside protection, valuation discipline.",
    instructions:
      "Review this portfolio as a defensive investor. Educational analysis only. Never give individual trade instruction or invent facts. Name missing prices or cost basis when material.",
    criteria:
      "Focus on margin of safety, cost basis versus market value, overvaluation risk, position sizing, evidence quality, and protection from permanent loss.",
  },
  peter_lynch: {
    id: "peter_lynch",
    displayName: "Peter Lynch",
    description: "Growth at reasonable price",
    investingStyle: "Know what you own, simple story, growth visible in results.",
    instructions:
      "Review this portfolio for clear, understandable ownership stories. Educational analysis only. Never give individual trade instruction or invent facts. Name missing prices or cost basis when material.",
    criteria:
      "Look for winners, over-owned stories, stale losers, missing cost basis, diversification that hides ignorance, and whether large positions have simple ownership reasons.",
  },
  stanley_druckenmiller: {
    id: "stanley_druckenmiller",
    displayName: "Stanley Druckenmiller",
    description: "Asymmetric setup",
    investingStyle: "Inflections, concentration, risk control, asymmetric payoff.",
    instructions:
      "Review this portfolio for asymmetric setups and risk. Educational analysis only. Never give individual trade instruction or invent facts. Name missing prices or cost basis when material. Do not claim macro data not in state.",
    criteria:
      "Focus on price and return inflections, winners or losers, concentration, missing prices, reversal downside, and best-idea sizing versus weak diversification.",
  },
};

export function listPortfolioAgents(): PortfolioAgentDefinition[] {
  return PORTFOLIO_AGENT_IDS.map((id) => PERSONAS[id]);
}

export function isPortfolioAgentId(id: unknown): id is PortfolioAgentId {
  return typeof id === "string" && PORTFOLIO_AGENT_IDS.includes(id.trim() as PortfolioAgentId);
}

export function getPortfolioAgent(id: string | undefined): PortfolioAgentDefinition {
  const normalized = id?.trim() as PortfolioAgentId | undefined;
  if (normalized && PORTFOLIO_AGENT_IDS.includes(normalized)) return PERSONAS[normalized];
  return PERSONAS.warren_buffett;
}

export function resolvePortfolioConversationConfig() {
  const apiKey = process.env.LAVEGA_AGENT_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("LAVEGA_AGENT_API_KEY or OPENROUTER_API_KEY is not set");
  return {
    apiKey,
    baseURL: process.env.LAVEGA_AGENT_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
    model: process.env.LAVEGA_AGENT_MODEL?.trim() || DEFAULT_PORTFOLIO_CONVERSATION_MODEL,
  };
}

function createPortfolioConversationProvider(
  config: ReturnType<typeof resolvePortfolioConversationConfig>,
): PortfolioConversationProvider {
  const provider = createOpenAICompatible({
    name: "lavega-agent",
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
  return {
    async reply(input) {
      const { text } = await generateText({
        model: provider.chatModel(input.model),
        system: input.system,
        prompt: input.prompt,
        abortSignal: AbortSignal.timeout(60_000),
      });
      return text;
    },
  };
}

export async function runPortfolioConversation({
  agentId,
  prompt,
  history,
  dashboard,
  sectors,
  judgment,
  provider,
}: {
  agentId: PortfolioAgentId;
  prompt: string;
  history: readonly PortfolioConversationTurn[];
  dashboard: InvestingDashboardData;
  sectors?: readonly SectorExposure[];
  judgment: PortfolioJudgmentRun;
  provider?: PortfolioConversationProvider;
}): Promise<PortfolioConversationReply> {
  const agent = getPortfolioAgent(agentId);
  const selected = judgment.judgments.find((item) => item.agentId === agentId);
  const signal = selected?.signal?.choice;
  const choice: PortfolioJudgmentChoice =
    signal === "bullish" || signal === "bearish" || signal === "neutral" || signal === "no_view"
      ? signal
      : "no_view";
  const probability = selected?.signal?.probabilities?.[choice];
  const confidence =
    typeof probability === "number" && Number.isFinite(probability)
      ? Math.round(Math.max(0, Math.min(1, probability)) * 100)
      : 0;
  let model: string;
  let conversationProvider: PortfolioConversationProvider;
  if (provider) {
    model = "injected";
    conversationProvider = provider;
  } else {
    const config = resolvePortfolioConversationConfig();
    model = config.model;
    conversationProvider = createPortfolioConversationProvider(config);
  }
  const text = await conversationProvider.reply({
    model,
    system: `${agent.instructions}\n${agent.criteria}\nEducational analysis only. Do not give trade instructions. Use only provided portfolio facts.`,
    prompt: [
      "Typed Jev judgment for this lens:",
      JSON.stringify({ signal: choice, confidence }),
      "Portfolio snapshot:",
      renderPortfolioConversationSnapshot(dashboard, sectors),
      "Conversation so far:",
      history.map((turn) => `${turn.role}: ${turn.content}`).join("\n"),
      "User question:",
      prompt,
    ].join("\n\n"),
  });
  return {
    agentId,
    displayName: agent.displayName,
    text,
    model,
    snapshotHash: judgment.snapshotHash,
    judgment: { signal: choice, confidence },
  };
}

export async function runPortfolioAgent({
  model,
  dashboard,
  sectors,
  provider,
  userId,
}: RunPortfolioAgentOptions): Promise<PortfolioJudgmentRun> {
  const judge = provider ?? createSystemOneProvider({ userId });
  if (!dashboard) throw new Error("Portfolio dashboard is required for typed judgments");
  const result = await judge.judge({
    state: JSON.parse(renderPortfolioSnapshot(dashboard, sectors)),
    questions: portfolioJudgmentQuestions(),
    model: model?.trim() || undefined,
  });
  return {
    judgments: PORTFOLIO_AGENT_IDS.map((agentId) => ({
      agentId,
      displayName: PERSONAS[agentId].displayName,
      signal: choiceAnswer(result.answers[questionKey(agentId, "signal")]),
      conviction: scoreAnswer(result.answers[questionKey(agentId, "conviction")]),
    })),
    model: result.model,
    snapshotHash: await portfolioSnapshotHash(dashboard, sectors),
  };
}

type JudgmentDimension = "signal" | "conviction";
function questionKey(agentId: PortfolioAgentId, dimension: JudgmentDimension): string {
  return `${agentId}.${dimension}`;
}

export function portfolioJudgmentQuestions(): Record<string, SystemOneQuestion> {
  return Object.fromEntries(
    PORTFOLIO_AGENT_IDS.flatMap((agentId) => {
      const agent = PERSONAS[agentId];
      const instructions = `${agent.instructions}\n${agent.criteria}`;
      return [
        [
          questionKey(agentId, "signal"),
          {
            type: "choice",
            instructions,
            criteria: {
              bullish: "Evidence in state supports this lens.",
              bearish: "Evidence in state warns against this lens.",
              neutral: "State has balanced or inconclusive evidence for this lens.",
              no_view:
                "State lacks evidence this lens needs. This is absence of view, not neutral.",
            },
          } satisfies ChoiceQuestion,
        ],
        [
          questionKey(agentId, "conviction"),
          {
            type: "score",
            instructions: `${instructions}\nScore certainty of signal evidence, not expected return or correctness.`,
            criteria: [
              "No usable evidence.",
              "Weak, incomplete evidence.",
              "Some direct portfolio evidence.",
              "Strong, consistent portfolio evidence.",
              "Very strong direct evidence with little material uncertainty.",
            ],
          } satisfies ScoreQuestion,
        ],
      ];
    }),
  );
}

function choiceAnswer(answer: unknown): ChoiceResponse | null {
  return answer && typeof answer === "object" && (answer as { type?: unknown }).type === "choice"
    ? (answer as ChoiceResponse)
    : null;
}

function scoreAnswer(answer: unknown): ScoreResponse | null {
  return answer && typeof answer === "object" && (answer as { type?: unknown }).type === "score"
    ? (answer as ScoreResponse)
    : null;
}

export function composePortfolioJudgments(
  judgments: readonly PortfolioJudgment[],
  weights: Partial<Record<PortfolioAgentId, number>> = {},
): PortfolioJudgmentComposition {
  let totalWeight = 0;
  let weightedSignal = 0;
  let weightedConfidence = 0;
  let contributingAgents = 0;
  for (const judgment of judgments) {
    const choice = judgment.signal?.choice;
    if (choice !== "bullish" && choice !== "bearish" && choice !== "neutral") continue;
    const weight = Math.max(0, weights[judgment.agentId] ?? 1);
    if (weight === 0) continue;
    const confidence = probabilityForChoice(judgment.signal!);
    const direction = choice === "bullish" ? 1 : choice === "bearish" ? -1 : 0;
    totalWeight += weight;
    weightedSignal += direction * weight;
    weightedConfidence += confidence * weight;
    contributingAgents += 1;
  }
  if (totalWeight === 0) return { signal: "no_view", confidence: 0, contributingAgents: 0 };
  return {
    signal: weightedSignal > 0 ? "bullish" : weightedSignal < 0 ? "bearish" : "neutral",
    confidence: Number(((weightedConfidence / totalWeight) * 100).toFixed(2)),
    contributingAgents,
  };
}

function probabilityForChoice(answer: ChoiceResponse): number {
  const probability = answer.probabilities[answer.choice];
  return typeof probability === "number" && Number.isFinite(probability)
    ? Math.max(0, Math.min(1, probability))
    : 0;
}

export function renderPortfolioSnapshot(
  dashboard: InvestingDashboardData,
  sectors?: readonly SectorExposure[],
): string {
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
      /* Entities are the user's own legal wrappers (private, business), not
       * industry sectors. They kept the `sectors` name once, which told the
       * model "private" was a sector. Each now says what it is. */
      entityAllocation: dashboard.allocation.entity.buckets.slice(0, 10),
      sectors: sectors && sectors.length > 0 ? sectors.slice(0, 10) : "unavailable",
      topPositions,
      problems: dashboard.problems.slice(0, 20),
    },
    null,
    2,
  );
}

export function renderPortfolioConversationSnapshot(
  dashboard: InvestingDashboardData,
  sectors?: readonly SectorExposure[],
): string {
  return JSON.stringify({
    ...JSON.parse(renderPortfolioSnapshot(dashboard, sectors)),
    positions: dashboard.positions.map((position) => ({
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
    })),
  });
}

export async function portfolioSnapshotHash(
  dashboard: InvestingDashboardData,
  sectors?: readonly SectorExposure[],
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(renderPortfolioSnapshot(dashboard, sectors)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

function round(value: number | null | undefined, digits: number): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}
