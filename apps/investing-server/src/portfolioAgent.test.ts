import { expect, test } from "vitest";
import type { InvestingDashboardData } from "@lavega/core";
import {
  composePortfolioJudgments,
  portfolioJudgmentQuestions,
  runPortfolioAgent,
} from "./portfolioAgent.js";

function dashboard(): InvestingDashboardData {
  return {
    dataVersion: 3,
    presentationCurrency: "EUR",
    portfolio: {
      "1M": [], "6M": [], "1Y": [], YTD: [],
      All: [{ date: "2026-09-18", positionsValue: 100, cashValue: 0, value: 100, unpriced: [], forwardFilled: [], cashUnknown: [] }],
    },
    benchmarks: [], externalCashFlows: [],
    allocation: { instrument: { buckets: [], unpriced: [] }, entity: { buckets: [], unpriced: [] } },
    positions: [], position: null, problems: [],
  };
}

const choice = (value: "bullish" | "bearish" | "neutral" | "no_view", probability = 0.8) => ({
  type: "choice" as const,
  choice: value,
  confidence: probability,
  probabilities: { bullish: 0, bearish: 0, neutral: 0, no_view: 0, [value]: probability },
});
const score = (value = 3) => ({
  type: "score" as const,
  score: value,
  confidence: 0.8,
  legend: { 0: "none", 1: "weak", 2: "some", 3: "strong", 4: "very strong" },
  probabilities: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0 },
});

test("typed provider returns all personas from one request", async () => {
  const questions = portfolioJudgmentQuestions();
  const result = await runPortfolioAgent({
    dashboard: dashboard(),
    provider: {
      judge: async (request) => {
        expect(Object.keys(request.questions)).toHaveLength(12);
        return {
          model: "jev-test",
          usage: { inputTokens: 1, outputTokens: 1 },
          answers: Object.fromEntries(Object.keys(questions).map((key) => [key, key.endsWith("signal") ? choice("bullish") : score()])),
        };
      },
    },
  });
  expect(result.model).toBe("jev-test");
  expect(result.judgments).toHaveLength(6);
  expect(result.judgments[0]?.signal?.choice).toBe("bullish");
});

test("no view remains distinct from neutral and one missing answer leaves other personas usable", async () => {
  const questions = portfolioJudgmentQuestions();
  const result = await runPortfolioAgent({
    dashboard: dashboard(),
    provider: {
      judge: async () => ({
        model: "jev-test",
        usage: { inputTokens: 1, outputTokens: 1 },
        answers: Object.fromEntries(Object.keys(questions).flatMap((key) => key.startsWith("charlie_munger") ? [] : [[key, key.endsWith("signal") ? choice("no_view") : score()]])),
      }),
    },
  });
  expect(result.judgments[0]?.signal?.choice).toBe("no_view");
  expect(result.judgments.find((item) => item.agentId === "charlie_munger")?.signal).toBeNull();
});

test("composition reweights typed judgments without provider call", () => {
  const judgments = [
    { agentId: "warren_buffett" as const, displayName: "Warren Buffett", signal: choice("bullish"), conviction: score() },
    { agentId: "charlie_munger" as const, displayName: "Charlie Munger", signal: choice("bearish"), conviction: score() },
  ];
  expect(composePortfolioJudgments(judgments).signal).toBe("neutral");
  expect(composePortfolioJudgments(judgments, { charlie_munger: 2 }).signal).toBe("bearish");
});
