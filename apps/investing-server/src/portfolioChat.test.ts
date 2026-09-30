import { expect, test, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { CompanyFundamentals, InvestingDashboardData } from "@lavega/core";
import { createPortfolioChatAgent, namedSymbols, prefetchSymbols } from "./portfolioChat.js";

const holding = (symbol: string, marketValue: number | null, description?: string) => ({
  symbol,
  description,
  marketValue,
  portfolioWeight: null,
  returns: {
    remainingCostBasis: null,
    totalReturn: null,
    totalReturnPercentage: null,
    firstBuyDate: null,
  },
});
const dashboard = {
  presentationCurrency: "EUR",
  portfolio: { All: [] },
  problems: [],
  positions: [
    holding("AAPL", 5000, "Apple Inc"),
    holding("ASML", 2800, "ASML Holding NV"),
    holding("V", 900, "Visa Inc"),
    holding("VWRL", 700, "Vanguard FTSE All-World"),
    holding("MSFT", 3600, "Microsoft Corp"),
    holding("KO", 100, "Coca-Cola Co"),
    holding("PEP", 50, "PepsiCo Inc"),
  ],
} as unknown as InvestingDashboardData;

test("resolves holdings named by symbol or by name, and tickers the owner does not hold", () => {
  expect(namedSymbols("How does apple compare with NVDA?", dashboard)).toEqual(["AAPL", "NVDA"]);
  expect(namedSymbols("is asml too expensive vs its PE?", dashboard)).toEqual(["ASML"]);
  expect(namedSymbols("should I buy a ETF in the US", dashboard)).toEqual([]);
});

test("a one-letter symbol counts only when typed as written", () => {
  expect(namedSymbols("what about V?", dashboard)).toEqual(["V"]);
  expect(namedSymbols("what about v?", dashboard)).toEqual([]);
});

test("prefetches named symbols first, then the five largest holdings", () => {
  expect(prefetchSymbols("thoughts on pepsico?", dashboard)).toEqual([
    "PEP",
    "AAPL",
    "MSFT",
    "ASML",
    "V",
    "VWRL",
  ]);
});

test("fetches fundamentals before the model call and survives a failing symbol", async () => {
  const fetch = vi.fn(async (symbol: string) => {
    if (symbol === "MSFT") throw new Error("[503] down");
    return symbol === "VWRL"
      ? null
      : ({
          symbol,
          providerSymbol: symbol,
          name: `${symbol} company`,
          currency: "USD",
          priceCurrency: "USD",
          sector: null,
          industry: null,
          fetchedAt: "2026-09-29T00:00:00.000Z",
          snapshot: {},
          annual: [],
          quarterly: [],
          estimates: [],
        } as unknown as CompanyFundamentals);
  });
  const agent = await createPortfolioChatAgent({
    agentId: "peter_lynch",
    message: "What do you think of my portfolio?",
    context: {
      dashboard,
      sectors: null,
      trades: () => [],
      price: async () => null,
      fundamentals: { fetch },
    },
    model: new MockLanguageModelV4(),
  });

  expect(fetch).toHaveBeenCalledTimes(5);
  const instructions = String(
    (agent as unknown as { settings: { instructions: string } }).settings.instructions,
  );
  expect(instructions).toContain("You are Peter Lynch");
  expect(instructions).toContain("AAPL | AAPL company");
  expect(instructions).toContain("MSFT: fundamentals unavailable right now.");
  expect(instructions).toContain("VWRL: no company fundamentals");
  expect(instructions).toContain(
    "Write concise plain-text paragraphs without Markdown formatting: no headings, no bold or italic asterisks, no numbered or bulleted list syntax.",
  );
  expect(Object.keys(agent.tools).sort()).toEqual([
    "compute_portfolio_value",
    "get_fundamentals",
    "get_positions",
    "get_price",
    "get_risk",
    "get_sector_exposure",
    "get_trades",
  ]);
});
