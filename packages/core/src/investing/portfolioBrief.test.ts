import { expect, test } from "vitest";
import type { InvestingDashboardData } from "./dashboard.js";
import { fundamentalsAggregates, type CompanyFundamentals } from "./fundamentals.js";
import { portfolioConcentration, renderPortfolioBrief } from "./portfolioBrief.js";

const holding = (
  symbol: string,
  marketValue: number,
  portfolioWeight: number,
  costBasis: number | null,
) => ({
  symbol,
  description: `${symbol} Inc`,
  marketValue,
  portfolioWeight,
  returns: {
    remainingCostBasis: costBasis,
    totalReturn: 100,
    totalReturnPercentage: 0.1,
    firstBuyDate: "2020-01-02",
  },
});
const dashboard = {
  presentationCurrency: "EUR",
  portfolio: { All: [{ date: "2026-09-28", value: 10_000 }] },
  problems: [],
  positions: [
    holding("B", 3000, 0.3, 2500),
    holding("A", 5000, 0.5, null),
    holding("C", 2000, 0.2, 1500),
  ],
} as unknown as InvestingDashboardData;

test("concentration sums the largest weights", () => {
  expect(portfolioConcentration(dashboard)).toEqual({
    largest: { symbol: "A", weight: 0.5 },
    top3: 1,
    top5: 1,
  });
});

test("the brief lists holdings by value and says what is missing", () => {
  const brief = renderPortfolioBrief(dashboard, null);
  expect(brief).toContain("Portfolio in EUR as of 2026-09-28: value 10,000, 3 holdings (3 priced)");
  expect(brief).toContain("(1 holdings without cost basis)");
  expect(brief.indexOf("A (A Inc)")).toBeLessThan(brief.indexOf("B (B Inc)"));
  expect(brief).toContain("Sectors: unavailable");
});

test("aggregates compute growth, margins and dilution from annual statements", () => {
  const period = (
    endDate: string,
    revenue: number,
    operatingIncome: number,
    dilutedShares: number,
  ) => ({
    endDate,
    revenue,
    operatingIncome,
    netIncome: operatingIncome,
    freeCashFlow: operatingIncome,
    dilutedEps: null,
    stockholdersEquity: null,
    dilutedShares,
  });
  const aggregates = fundamentalsAggregates({
    annual: [period("2025-12-31", 121, 36.3, 90), period("2023-12-31", 100, 20, 100)],
  } as unknown as CompanyFundamentals);
  expect(aggregates.years).toBe(1);
  expect(aggregates.revenueCagr).toBeCloseTo(0.21);
  expect(aggregates.operatingMarginTrend).toBeCloseTo(0.1);
  expect(aggregates.cashConversion).toBe(1);
  expect(aggregates.shareCountChange).toBeCloseTo(-0.1);
});
