import { generateText, jsonSchema, Output, type LanguageModel } from "ai";
import { renderFundamentalsBrief, type CompanyFundamentals } from "@lavega/core";
import { resolvePortfolioChatModel } from "./portfolioChat.js";
import { getPortfolioAgent, PORTFOLIO_AGENT_IDS, type PortfolioAgentId } from "./portfolioAgent.js";
import { PORTFOLIO_CHAT_PROFILES } from "./personaProfiles.js";
import {
  createSystemOneProvider,
  type SystemOneProvider,
  type SystemOneQuestion,
} from "./systemOne.js";

export const STOCK_RESEARCH_AGENT_IDS = PORTFOLIO_AGENT_IDS;
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
const REASONING_TIMEOUT_MS = 20_000;
const MAX_REASON_CHARS = 320;
const REPORT_LIFETIME_MS = 60 * 60 * 1000;
const MAX_TOKEN_BYTES = 192_000;
const localSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
  byte.toString(16).padStart(2, "0"),
).join("");
const encoder = new TextEncoder();
function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function decodeBase64Url(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) =>
    char.charCodeAt(0),
  );
}

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
function stockResearchQuestions(): Record<string, SystemOneQuestion> {
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
  model?: LanguageModel;
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
  const reasons = await explainJudgments(input.company, judgments, input.model);
  const now = input.now ?? Date.now();
  return {
    symbol: input.company.symbol,
    company: input.company,
    judgments: judgments.map((judgment) => ({
      ...judgment,
      reasoning: reasons[judgment.agentId] ?? judgment.reasoning,
    })),
    model: result.model,
    generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + REPORT_LIFETIME_MS).toISOString(),
  };
}
/** One language-model call that explains each typed signal through its own
 *  lens. Jev keeps the signal; a lens without a usable reason keeps its criterion. */
async function explainJudgments(
  company: CompanyFundamentals,
  judgments: readonly StockResearchJudgment[],
  model: LanguageModel | undefined,
): Promise<Partial<Record<StockResearchAgentId, string>>> {
  try {
    const { output } = await generateText({
      model: model ?? resolvePortfolioChatModel(),
      abortSignal: AbortSignal.timeout(REASONING_TIMEOUT_MS),
      output: Output.object({
        schema: jsonSchema<Record<string, unknown>>({
          type: "object",
          properties: Object.fromEntries(
            STOCK_RESEARCH_AGENT_IDS.map((agentId) => [agentId, { type: "string" }]),
          ),
        }),
      }),
      instructions: `You write the short reason behind investor-lens signals on one company. A separate typed judge already decided each signal below. Never change, soften, or contradict it. Explain why that lens reaches it for this company.
Rules for every reason:
- At most two sentences and under ${MAX_REASON_CHARS} characters, in plain text without Markdown.
- Argue from that lens's own priorities, so each reason differs from the others.
- A bullish or bearish reason argues for its signal. Only a neutral reason weighs both sides.
- Cite one or two concrete figures from the company snapshot. Never invent a number.
- For no_view, name the evidence this lens needs that the snapshot lacks.
- This is an educational lens simulation, not the real person's opinion.
Return one JSON object whose keys are exactly ${STOCK_RESEARCH_AGENT_IDS.join(", ")} and whose values are the reasons.`,
      prompt: `Company snapshot for ${company.symbol} fetched ${company.fetchedAt}:\n${renderFundamentalsBrief(company)}\n\n${judgments
        .map(
          (judgment) =>
            `## ${judgment.agentId} (${judgment.displayName}): signal ${judgment.signal}\n${PORTFOLIO_CHAT_PROFILES[judgment.agentId]}`,
        )
        .join("\n\n")}`,
    });
    return Object.fromEntries(
      STOCK_RESEARCH_AGENT_IDS.flatMap((agentId) => {
        const reason = output[agentId];
        return typeof reason === "string" &&
          reason.trim() &&
          reason.trim().length <= MAX_REASON_CHARS * 2
          ? [[agentId, reason.trim()]]
          : [];
      }),
    );
  } catch {
    return {};
  }
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
function signingKey(secret?: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(resolveSecret(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function signResearchReport(
  report: StockResearchReport,
  tenantId: string,
  secret?: string,
): Promise<string> {
  const payload = encodeBase64Url(encoder.encode(JSON.stringify({ version: 1, tenantId, report })));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    encoder.encode(`lavega-stock-research-v1:${payload}`),
  );
  const token = `${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
  if (token.length > MAX_TOKEN_BYTES) throw new Error("Research report exceeds size limit");
  return token;
}
export async function verifyResearchReport(
  token: unknown,
  tenantId: string,
  secret?: string,
  now = Date.now(),
): Promise<StockResearchReport> {
  if (typeof token !== "string" || token.length > MAX_TOKEN_BYTES)
    throw new Error("Invalid research report token");
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part)))
    throw new Error("Invalid research report token");
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret),
    decodeBase64Url(parts[1]!) as Uint8Array<ArrayBuffer>,
    encoder.encode(`lavega-stock-research-v1:${parts[0]!}`),
  );
  if (!valid) throw new Error("Invalid research report signature");
  const data = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]!)));
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
    report.judgments.length !== STOCK_RESEARCH_AGENT_IDS.length ||
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
