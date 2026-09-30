import { expect, test } from "vitest";
import { fetchYahooFundamentals, toCompanyFundamentals } from "./fundamentals.js";
import type { YahooHttpClient } from "./http.js";

const now = new Date("2026-09-29T00:00:00Z");

test("drops ratios Yahoo derives across currencies for a cross-listing", () => {
  const fundamentals = toCompanyFundamentals(
    "ASML",
    "ASML",
    {
      price: { longName: "ASML Holding N.V.", currency: "USD", regularMarketPrice: { raw: 1000 } },
      financialData: {
        financialCurrency: "EUR",
        currentPrice: { raw: 1000 },
        returnOnEquity: { raw: 0.5 },
      },
      defaultKeyStatistics: {
        priceToBook: { raw: 1571 },
        enterpriseValue: { raw: 1 },
        enterpriseToEbitda: { raw: 2 },
      },
      summaryDetail: { trailingPE: { raw: 35 } },
    },
    new Map([
      [
        "annualTotalRevenue",
        new Map([
          ["2024-12-31", 28e9],
          ["2025-12-31", 32e9],
        ]),
      ],
      ["annualNetIncome", new Map([["2025-12-31", 9e9]])],
    ]),
    now,
  );

  expect(fundamentals.currency).toBe("EUR");
  expect(fundamentals.priceCurrency).toBe("USD");
  expect(fundamentals.snapshot).toMatchObject({
    trailingPe: 35,
    returnOnEquity: 0.5,
    priceToBook: null,
    enterpriseValue: null,
    enterpriseToEbitda: null,
  });
  expect(
    fundamentals.annual.map((period) => [period.endDate, period.revenue, period.netIncome]),
  ).toEqual([
    ["2025-12-31", 32e9, 9e9],
    ["2024-12-31", 28e9, null],
  ]);
});

test("resolves null when Yahoo knows no company, and rejects on an outage", async () => {
  const notFound = {
    fetchJsonWithCrumb: async () => {
      throw new Error("[404] Not Found");
    },
  } as unknown as YahooHttpClient;
  await expect(fetchYahooFundamentals("NOPE", notFound, now)).resolves.toBeNull();

  const down = {
    fetchJsonWithCrumb: async () => {
      throw new Error("[503] unavailable");
    },
  } as unknown as YahooHttpClient;
  await expect(fetchYahooFundamentals("ASML", down, now)).rejects.toThrow("[503]");
});
