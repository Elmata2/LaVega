/*
 * Eval fixtures (plan §3 WS5.9, #300).
 *
 * Each fixture is a conversation the scripted model plays against the REAL
 * registry: the tool calls it makes, the values it expects back, and the answer
 * it writes from those values. Changing a tool's name, argument or projection
 * makes a fixture fail loudly rather than silently changing the agent's answer.
 *
 * The source data is fixed here, so the run is deterministic and offline — the
 * same reason Sure's `llm-evals.yml` exists as a workflow rather than a manual
 * check. Values mirror the read models' contract: money decimal in the
 * presentation currency, weights fractions, unknown null.
 */

import { createInvestingTools } from "../tools/investingTools.js";
import type { InvestingToolSource } from "../tools/investingTools.js";
import type { EvalFixture } from "./harness.js";

const positionsSource: InvestingToolSource = {
  dashboard: async () => ({
    presentationCurrency: "EUR",
    dataVersion: 3,
    positions: [
      {
        symbol: "AAPL",
        description: "Apple Inc.",
        quantity: 3,
        currency: "USD",
        marketValue: 600,
        portfolioWeight: 0.6,
        priceStatus: "priced",
        returns: {
          remainingCostBasis: 420,
          unrealizedGain: 180,
          realizedGain: 0,
          dividendsReceived: 2,
          totalReturn: 182,
          totalReturnPercentage: 0.43,
          firstBuyDate: "2025-01-02",
        },
      },
    ],
    portfolio: { All: [{ date: "2026-11-10", value: 1000 }] },
  }),
  trades: async () => ({ trades: [], total: 0, truncated: false }),
  price: async () => null,
  fundamentals: async () => ({ consentRequired: true }),
  sectorExposure: async () => ({ sectors: [], sectorCoverage: {} }),
  agentMemory: async () => ({ available: false, problems: ["Agent memory needs a database"] }),
};

const tradesSource: InvestingToolSource = {
  dashboard: async () => ({}),
  trades: async ({ symbol, limit }) => ({
    trades: [
      { date: "2026-11-09", symbol: "AAPL", side: "buy", quantity: 2, price: 188, currency: "USD" },
    ]
      .filter((trade) => !symbol || trade.symbol === symbol)
      .slice(0, limit ?? 60),
    total: 1,
    truncated: false,
  }),
  price: async (symbol, date) =>
    symbol === "AAPL"
      ? { symbol, date: date ?? "2026-11-10", close: 190.5, currency: "USD" }
      : { symbol, found: false, problems: [`No stored price for ${symbol}`] },
  fundamentals: async () => ({ consentRequired: true }),
  sectorExposure: async () => ({ sectors: [], sectorCoverage: {} }),
  agentMemory: async () => ({ available: false, problems: ["Agent memory needs a database"] }),
};

const riskSource: InvestingToolSource = {
  dashboard: async () => ({
    presentationCurrency: "EUR",
    dataVersion: 4,
    positions: [],
    portfolio: { All: [{ date: "2026-11-10", value: 0 }] },
    risk: {
      defaultBenchmark: "^GSPC",
      byBenchmark: {
        "^GSPC": {
          "1Y": { risk: { status: "estimate", annualizedVolatility: 0.18, beta: 0.95 } },
        },
      },
    },
  }),
  trades: async () => ({ trades: [], total: 0, truncated: false }),
  price: async () => null,
  fundamentals: async () => ({ consentRequired: true }),
  sectorExposure: async () => ({
    sectors: [{ sector: "Technology", weight: 0.6 }],
    sectorCoverage: { provider: 1, inferred: 0, correction: 0, unknown: 0 },
    revision: 2,
  }),
  agentMemory: async () => ({ available: true, riskTolerance: "balanced", theses: [], goals: [] }),
};

export const EVAL_FIXTURES: readonly EvalFixture[] = [
  {
    id: "positions-and-value",
    description:
      "The owner asks what they hold and what the portfolio is worth. The model must call get_positions and get_portfolio_value and answer with the real symbol and total.",
    source: positionsSource,
    steps: [
      {
        name: "get_positions",
        arguments: {},
        resultContains: {
          presentationCurrency: "EUR",
          positions: [
            {
              symbol: "AAPL",
              quantity: 3,
              marketValue: 600,
              weight: 0.6,
              costBasis: 420,
            },
          ],
        },
      },
      {
        name: "get_portfolio_value",
        arguments: {},
        resultContains: { date: "2026-11-10", value: 1000, currency: "EUR" },
      },
    ],
    answer: (results) => {
      const positions = results[0] as {
        positions: Array<{ symbol: string; quantity: number }>;
      };
      const value = results[1] as { date: string; value: number; currency: string };
      const first = positions.positions[0]!;
      return `You hold ${first.quantity} ${first.symbol}. Total portfolio value: ${value.value} ${value.currency} (${value.date}).`;
    },
    expectAnswer: ["You hold 3 AAPL", "Total portfolio value: 1000 EUR"],
  },
  {
    id: "trades-and-price",
    description:
      "The owner asks about their latest AAPL trade and the price. The model must pass the symbol filter and read back the trade and close.",
    source: tradesSource,
    steps: [
      {
        name: "get_trades",
        arguments: { symbol: "AAPL", limit: 5 },
        resultContains: {
          trades: [{ date: "2026-11-09", symbol: "AAPL", side: "buy", quantity: 2, price: 188 }],
          total: 1,
          truncated: false,
        },
      },
      {
        name: "get_price",
        arguments: { symbol: "AAPL" },
        resultContains: { symbol: "AAPL", date: "2026-11-10", close: 190.5, currency: "USD" },
      },
    ],
    answer: (results) => {
      const trades = results[0] as { trades: Array<{ side: string; quantity: number }> };
      const price = results[1] as { close: number; currency: string };
      const trade = trades.trades[0]!;
      return `Latest AAPL trade: ${trade.side} ${trade.quantity}. Last close: ${price.close} ${price.currency}.`;
    },
    expectAnswer: ["buy 2", "190.5 USD"],
  },
  {
    id: "risk-and-sectors",
    description:
      "The owner asks how risky the portfolio is and where the weight sits. The model must read the default benchmark's 1Y risk and the sector exposure.",
    source: riskSource,
    steps: [
      {
        name: "get_risk",
        arguments: { range: "1Y" },
        resultContains: {
          range: "1Y",
          benchmark: "^GSPC",
          risk: { status: "estimate", annualizedVolatility: 0.18 },
        },
      },
      {
        name: "get_sector_exposure",
        arguments: {},
        resultContains: { sectors: [{ sector: "Technology", weight: 0.6 }] },
      },
    ],
    answer: (results) => {
      const risk = results[0] as { risk: { annualizedVolatility: number } };
      const sectors = results[1] as { sectors: Array<{ sector: string; weight: number }> };
      return `Annualized volatility ${risk.risk.annualizedVolatility}; largest sector ${sectors.sectors[0]!.sector} at ${sectors.sectors[0]!.weight}.`;
    },
    expectAnswer: ["Annualized volatility 0.18", "Technology at 0.6"],
  },
];

/** The whole registry, built from a fixture source, for the contract snapshot. */
export function evalRegistry() {
  return createInvestingTools(EVAL_FIXTURES[0]!.source);
}
