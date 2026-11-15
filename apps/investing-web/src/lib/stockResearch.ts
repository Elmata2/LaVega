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

export function researchErrorMessage(error: Error): string {
  try {
    const problems = JSON.parse(error.message).problems;
    if (Array.isArray(problems) && typeof problems[0] === "string") return problems[0];
  } catch {}
  return error.message || "Agent reply failed. Try again.";
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
