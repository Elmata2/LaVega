import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { renderFundamentalsBrief, type CompanyFundamentals } from "@lavega/core";
import { getPortfolioAgent, type PortfolioAgentId } from "./portfolioAgent.js";
import { PORTFOLIO_CHAT_PROFILES } from "./personaProfiles.js";
import {
  createSystemOneProvider,
  type SystemOneProvider,
  type SystemOneQuestion,
} from "./systemOne.js";

export const STOCK_RESEARCH_AGENT_IDS = [
  "warren_buffett",
  "charlie_munger",
  "bill_ackman",
  "ben_graham",
  "peter_lynch",
] as const;
export type StockResearchAgentId = (typeof STOCK_RESEARCH_AGENT_IDS)[number];
export type StockResearchSignal = "bullish" | "bearish" | "neutral" | "no_view";
export type StockResearchJudgment = {
  agentId: StockResearchAgentId;
  displayName: string;
  signal: StockResearchSignal;
  confidence: number;
  bullishProbability: number | null;
  conviction: number | null;
  reasoning: string;
};
export type StockResearchReport = {
  symbol: string;
  company: CompanyFundamentals;
  judgments: StockResearchJudgment[];
  model: string;
  generatedAt: string;
  expiresAt: string;
};
const SIGNAL_CRITERIA = {
  bullish:
    "Reported business quality and valuation support a favorable view through this investing lens.",
  bearish:
    "Reported valuation or business risks support an unfavorable view through this investing lens.",
  neutral: "Reported strengths and risks are balanced or inconclusive through this investing lens.",
  no_view: "Reported facts do not contain the evidence this investing lens requires.",
};
export const REPORT_LIFETIME_MS = 60 * 60 * 1000;
const MAX_TOKEN_BYTES = 192_000;
const localSecret = randomBytes(32).toString("hex");

export function normalizeResearchSymbol(value: unknown): string {
  if (typeof value !== "string") throw new Error("Ticker is required");
  const symbol = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(symbol))
    throw new Error("Ticker must contain 1–20 letters, numbers, or market suffix characters");
  return symbol;
}
export function isStockResearchAgentId(value: unknown): value is StockResearchAgentId {
  return (
    typeof value === "string" && STOCK_RESEARCH_AGENT_IDS.includes(value as StockResearchAgentId)
  );
}
export function stockResearchQuestions(): Record<string, SystemOneQuestion> {
  return Object.fromEntries(
    STOCK_RESEARCH_AGENT_IDS.flatMap((agentId) => {
      const instructions = `${PORTFOLIO_CHAT_PROFILES[agentId]}\nThis is a single-company research report, not a portfolio. No portfolio, holdings, trades or macro data are supplied. Judge only the supplied company financials. Missing evidence must remain missing. Educational lens simulation, not the real person's opinion.`;
      return [
        [
          `${agentId}.signal`,
          { type: "choice", instructions, criteria: SIGNAL_CRITERIA } satisfies SystemOneQuestion,
        ],
        [
          `${agentId}.conviction`,
          {
            type: "score",
            instructions: `${instructions}\nScore strength of the available evidence, not expected investment return.`,
            criteria: [
              "No usable evidence",
              "Weak and incomplete evidence",
              "Some direct company evidence",
              "Strong and consistent company evidence",
              "Very strong evidence with little material uncertainty",
            ],
          } satisfies SystemOneQuestion,
        ],
      ];
    }),
  );
}
function percent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? Math.round(value * 1000) / 10
    : null;
}
export async function runStockResearch(input: {
  company: CompanyFundamentals;
  tenantId: string;
  provider?: SystemOneProvider;
  now?: number;
}): Promise<StockResearchReport> {
  const result = await (
    input.provider ?? createSystemOneProvider({ userId: input.tenantId })
  ).judge({
    state: {
      companyFinancials: renderFundamentalsBrief(input.company),
      fetchedAt: input.company.fetchedAt,
    },
    questions: stockResearchQuestions(),
  });
  const judgments = STOCK_RESEARCH_AGENT_IDS.map((agentId): StockResearchJudgment => {
    const answer = result.answers[`${agentId}.signal`];
    const score = result.answers[`${agentId}.conviction`];
    const signal =
      answer?.type === "choice" && Object.hasOwn(SIGNAL_CRITERIA, answer.choice)
        ? (answer.choice as StockResearchSignal)
        : "no_view";
    const conviction =
      score?.type === "score" &&
      Number.isFinite(score.score) &&
      score.score >= 0 &&
      score.score <= 4
        ? Math.round((score.score / 4) * 1000) / 10
        : null;
    const validChoice = answer?.type === "choice" && Object.hasOwn(SIGNAL_CRITERIA, answer.choice);
    return {
      agentId,
      displayName: getPortfolioAgent(agentId).displayName,
      signal,
      confidence: validChoice
        ? (percent(answer.probabilities[signal]) ?? percent(answer.confidence) ?? 0)
        : 0,
      bullishProbability: validChoice ? percent(answer.probabilities.bullish) : null,
      conviction: validChoice ? conviction : null,
      reasoning: SIGNAL_CRITERIA[signal],
    };
  });
  const now = input.now ?? Date.now();
  return {
    symbol: input.company.symbol,
    company: input.company,
    judgments,
    model: result.model,
    generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + REPORT_LIFETIME_MS).toISOString(),
  };
}
function resolveSecret(secret?: string): string {
  const configured = secret?.trim() || process.env.LAVEGA_ENCRYPTION_KEY?.trim();
  if (configured) return configured;
  if (process.env.VERCEL || process.env.NODE_ENV === "production")
    throw new Error("Research report signing requires LAVEGA_ENCRYPTION_KEY");
  return localSecret;
}
export function assertResearchSigningConfigured(secret?: string): void {
  resolveSecret(secret);
}
function signature(payload: string, secret?: string): Buffer {
  return createHmac("sha256", resolveSecret(secret))
    .update(`lavega-stock-research-v1:${payload}`)
    .digest();
}
export function signResearchReport(
  report: StockResearchReport,
  tenantId: string,
  secret?: string,
): string {
  const payload = Buffer.from(JSON.stringify({ version: 1, tenantId, report })).toString(
    "base64url",
  );
  const token = `${payload}.${signature(payload, secret).toString("base64url")}`;
  if (token.length > MAX_TOKEN_BYTES) throw new Error("Research report exceeds size limit");
  return token;
}
export function verifyResearchReport(
  token: unknown,
  tenantId: string,
  secret?: string,
  now = Date.now(),
): StockResearchReport {
  if (typeof token !== "string" || token.length > MAX_TOKEN_BYTES)
    throw new Error("Invalid research report token");
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part)))
    throw new Error("Invalid research report token");
  const supplied = Buffer.from(parts[1]!, "base64url");
  const expected = signature(parts[0]!, secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    throw new Error("Invalid research report signature");
  const data = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8"));
  const report = data.report as StockResearchReport | undefined;
  if (
    data.version !== 1 ||
    data.tenantId !== tenantId ||
    !report ||
    !report.company ||
    report.company.symbol !== report.symbol ||
    normalizeResearchSymbol(report.symbol) !== report.symbol ||
    !report.company.snapshot ||
    typeof report.company.snapshot !== "object" ||
    typeof report.company.fetchedAt !== "string" ||
    typeof report.model !== "string" ||
    !Array.isArray(report.company.annual) ||
    !Array.isArray(report.company.quarterly) ||
    !Array.isArray(report.company.estimates) ||
    !Array.isArray(report.judgments) ||
    report.judgments.length !== 5 ||
    !report.judgments.every(
      (item, index) =>
        item &&
        item.agentId === STOCK_RESEARCH_AGENT_IDS[index] &&
        Object.hasOwn(SIGNAL_CRITERIA, item.signal) &&
        typeof item.confidence === "number" &&
        Number.isFinite(item.confidence) &&
        item.confidence >= 0 &&
        item.confidence <= 100 &&
        (item.bullishProbability === null ||
          (typeof item.bullishProbability === "number" &&
            Number.isFinite(item.bullishProbability) &&
            item.bullishProbability >= 0 &&
            item.bullishProbability <= 100)) &&
        (item.conviction === null ||
          (typeof item.conviction === "number" &&
            Number.isFinite(item.conviction) &&
            item.conviction >= 0 &&
            item.conviction <= 100)) &&
        typeof item.reasoning === "string",
    )
  )
    throw new Error("Invalid research report schema or owner");
  const expiry = Date.parse(report.expiresAt);
  const issued = Date.parse(report.generatedAt);
  if (
    !Number.isFinite(expiry) ||
    !Number.isFinite(issued) ||
    expiry - issued !== REPORT_LIFETIME_MS ||
    issued > now + 60_000 ||
    now >= expiry
  )
    throw new Error("Research report expired; research this ticker again");
  return report;
}
export function stockResearchChatInstructions(
  report: StockResearchReport,
  agentId: PortfolioAgentId,
): string {
  return `${PORTFOLIO_CHAT_PROFILES[agentId]}\n\nThis conversation concerns only ${report.symbol}. Override portfolio assumptions: no holdings, trades, portfolio or external tools are available. Use only the server-verified company snapshot below. Do not invent missing facts or current prices. Explain limitations and do not claim to be the real investor. Confidence measures classification certainty, not probability of investment profit. Write concise plain-text paragraphs without Markdown formatting.\n\nCompany snapshot fetched ${report.company.fetchedAt}:\n${renderFundamentalsBrief(report.company)}\n\nEarlier typed lens judgment:\n${JSON.stringify(report.judgments.find((item) => item.agentId === agentId))}`;
}
