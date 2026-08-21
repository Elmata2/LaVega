import { describe, expect, test } from "vitest";
import { buildIndexedSeries, computeReturnSeries, computeTimeWeightedReturnSeries, deriveChartMode, validateBenchmarkSymbols } from "./benchmarks.js";

describe("benchmark chart domain", () => {
  test("derives mode and rejects duplicate or fourth symbols", () => {
    expect(deriveChartMode([])).toBe("euros");
    expect(deriveChartMode(["^AEX"])).toBe("indexed");
    expect(() => validateBenchmarkSymbols(["^AEX", "^AEX"])).toThrow(/unique/);
    expect(() => validateBenchmarkSymbols(["A", "B", "C", "D"])).toThrow(/at most 3/);
  });

  test("keeps original missing anchor unknown and disconnects later gaps", () => {
    expect(computeReturnSeries([{ date: "2026-01-01", value: null }, { date: "2026-01-02", value: 10 }])).toEqual([
      { date: "2026-01-01", cumulativeReturn: null }, { date: "2026-01-02", cumulativeReturn: null },
    ]);
    const portfolio = [
      { date: "2026-01-01", positionsValue: 100, cashValue: null, value: 100, unpriced: [], forwardFilled: [], cashUnknown: [] },
      { date: "2026-01-02", positionsValue: 110, cashValue: null, value: 110, unpriced: [], forwardFilled: [], cashUnknown: [] },
    ];
    const indexed = buildIndexedSeries(portfolio, [{ symbol: "^AEX", name: "AEX", exchange: "AMS", currency: "EUR", points: [{ date: "2026-01-02", value: 900 }] }]);
    expect(indexed.map((point) => point.benchmarkReturns["^AEX"])).toEqual([null, null]);
  });

  test("removes end-of-day deposits from portfolio return", () => {
    const returns = computeTimeWeightedReturnSeries([
      { date: "2026-01-01", value: 100 }, { date: "2026-01-02", value: 150 }, { date: "2026-01-03", value: 165 },
    ], [{ date: "2026-01-02", amount: 50 }]);
    expect(returns.slice(0, 2)).toEqual([{ date: "2026-01-01", cumulativeReturn: 0 }, { date: "2026-01-02", cumulativeReturn: 0 }]);
    expect(returns[2]?.cumulativeReturn).toBeCloseTo(0.1);
  });
});
