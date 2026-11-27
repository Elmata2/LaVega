import type { CompanyFundamentals } from "@lavega/core";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";

export type StockJudgment = {
  agentId: string;
  displayName: string;
  signal: "bullish" | "bearish" | "neutral" | "no_view";
  confidence: number;
  bullishProbability: number | null;
  conviction: number | null;
  reasoning: string;
};
export type StockResearchReport = {
  symbol: string;
  company: CompanyFundamentals;
  judgments: StockJudgment[];
  model: string;
  generatedAt: string;
  expiresAt: string;
};
export type StockResearchResult = { report: StockResearchReport; reportToken: string };

export async function researchStock(symbol: string): Promise<StockResearchResult> {
  const response = await fetch("/api/agents/research/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbol: symbol.trim().toUpperCase() }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.problems?.[0] ?? "Stock research failed. Try again.");
  if (
    typeof payload.reportToken !== "string" ||
    !payload.report?.company?.snapshot ||
    !Array.isArray(payload.report?.judgments)
  )
    throw new Error("Stock research returned an invalid report. Try again.");
  return payload as StockResearchResult;
}

export function createStockResearchChat(reportToken: string, agentId: string): Chat<UIMessage> {
  return new Chat({
    id: `research-${agentId}`,
    transport: new DefaultChatTransport({
      api: "/api/agents/research/conversation",
      body: { reportToken, agentId },
    }),
  });
}

export type ResearchErrorCode = "history_limit" | "snapshot_expired" | "unknown";

export type ResearchConversationError = {
  code: ResearchErrorCode;
  message: string;
};

export function researchErrorMessage(error: Error): string {
  return parseResearchError(error).message;
}

export function parseResearchError(error: Error): ResearchConversationError {
  let code: ResearchErrorCode | null = null;
  let message = error.message || "Agent reply failed. Try again.";
  try {
    const parsed = JSON.parse(error.message) as { code?: unknown; problems?: unknown };
    if (
      parsed.code === "history_limit" ||
      parsed.code === "snapshot_expired" ||
      parsed.code === "unknown"
    ) {
      code = parsed.code;
    }
    if (Array.isArray(parsed.problems) && typeof parsed.problems[0] === "string") {
      message = parsed.problems[0];
    }
  } catch {}
  if (code === null) {
    if (/1–40 messages|30,000 character limit/i.test(message)) code = "history_limit";
    else if (/expir|refresh|rerun|re-run/i.test(message)) code = "snapshot_expired";
    else code = "unknown";
  }
  return { code, message };
}

export function researchPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "Unavailable" : `${(value * 100).toFixed(1)}%`;
}

export function researchAmount(
  value: number | null,
  currency: string | null,
  compact = false,
): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  const number = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    ...(compact ? { notation: "compact" as const } : {}),
  }).format(value);
  return `${currency ?? "Currency unavailable"} ${number}`;
}
