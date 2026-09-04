import { describe, expect, test } from "vitest";
import {
  alignBenchmarkValues,
  buildIndexedSeries,
  computeBenchmarkXirrSeries,
  computeReturnSeries,
  computeTimeWeightedReturnSeries,
  computeXirrSeries,
  deriveChartMode,
  solveXirr,
  validateBenchmarkSymbols,
} from "./benchmarks.js";

describe("benchmark chart domain", () => {
  test("derives mode and rejects duplicate or fourth symbols", () => {
    expect(deriveChartMode([])).toBe("euros");
    expect(deriveChartMode(["^AEX"])).toBe("indexed");
    expect(() => validateBenchmarkSymbols(["^AEX", "^AEX"])).toThrow(/unique/);
    expect(() => validateBenchmarkSymbols(["A", "B", "C", "D"])).toThrow(/at most 3/);
  });

  test("keeps original missing anchor unknown and disconnects later gaps", () => {
    expect(
      computeReturnSeries([
        { date: "2026-01-01", value: null },
        { date: "2026-01-02", value: 10 },
      ]),
    ).toEqual([
      { date: "2026-01-01", cumulativeReturn: null },
      { date: "2026-01-02", cumulativeReturn: null },
    ]);
    const portfolio = [
      {
        date: "2026-01-01",
        positionsValue: 100,
        cashValue: null,
        value: 100,
        unpriced: [],
        forwardFilled: [],
        cashUnknown: [],
      },
      {
        date: "2026-01-02",
        positionsValue: 110,
        cashValue: null,
        value: 110,
        unpriced: [],
        forwardFilled: [],
        cashUnknown: [],
      },
    ];
    const indexed = buildIndexedSeries(portfolio, [
      {
        symbol: "^AEX",
        name: "AEX",
        exchange: "AMS",
        currency: "EUR",
        points: [{ date: "2026-01-02", value: 900 }],
      },
    ]);
    expect(indexed.map((point) => point.benchmarkReturns["^AEX"])).toEqual([null, null]);
  });

  test("removes end-of-day deposits from portfolio return", () => {
    const returns = computeTimeWeightedReturnSeries(
      [
        { date: "2026-01-01", value: 100 },
        { date: "2026-01-02", value: 150 },
        { date: "2026-01-03", value: 165 },
      ],
      [{ date: "2026-01-02", amount: 50 }],
    );
    expect(returns.slice(0, 2)).toEqual([
      { date: "2026-01-01", cumulativeReturn: 0 },
      { date: "2026-01-02", cumulativeReturn: 0 },
    ]);
    expect(returns[2]?.cumulativeReturn).toBeCloseTo(0.1);
  });

  test("nets same-day owner flows and does not treat internal cash as external", () => {
    const points = [
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-02", value: 120 },
      { date: "2026-01-03", value: 132 },
    ];
    const returns = computeTimeWeightedReturnSeries(points, [
      { date: "2026-01-02", amount: 30 },
      { date: "2026-01-02", amount: -10 },
    ]);
    expect(returns.slice(0, 2)).toEqual([
      { date: "2026-01-01", cumulativeReturn: 0 },
      { date: "2026-01-02", cumulativeReturn: 0 },
    ]);
    expect(returns[2]?.cumulativeReturn).toBeCloseTo(0.1);
  });

  test("keeps zero starts and unknown gaps undefined, then starts a new valid chain", () => {
    const returns = computeTimeWeightedReturnSeries(
      [
        { date: "2026-01-01", value: 0 },
        { date: "2026-01-02", value: 100 },
        { date: "2026-01-03", value: null },
        { date: "2026-01-04", value: 120 },
        { date: "2026-01-05", value: 132 },
      ],
      [],
    );
    expect(returns.slice(0, 4)).toEqual([
      { date: "2026-01-01", cumulativeReturn: null },
      { date: "2026-01-02", cumulativeReturn: 0 },
      { date: "2026-01-03", cumulativeReturn: null },
      { date: "2026-01-04", cumulativeReturn: 0 },
    ]);
    expect(returns[4]?.cumulativeReturn).toBeCloseTo(0.1);
    expect(
      computeTimeWeightedReturnSeries(
        [
          { date: "2026-01-01", value: 100 },
          { date: "2026-01-02", value: 120 },
          { date: "2026-01-03", value: 130 },
        ],
        [{ date: "2026-01-02", amount: null }],
      ),
    ).toEqual([
      { date: "2026-01-01", cumulativeReturn: 0 },
      { date: "2026-01-02", cumulativeReturn: null },
      { date: "2026-01-03", cumulativeReturn: 0 },
    ]);
  });

  test("solves annualized return and rejects undefined cash-flow sets", () => {
    expect(
      solveXirr([
        { date: "2025-01-01", amount: -100 },
        { date: "2026-01-01", amount: 110 },
      ]),
    ).toBeCloseTo(0.1, 8);
    expect(solveXirr([{ date: "2025-01-01", amount: -100 }])).toBeNull();
    expect(
      solveXirr([
        { date: "2025-01-01", amount: -100 },
        { date: "2025-01-01", amount: 110 },
      ]),
    ).toBeNull();
    expect(
      solveXirr([
        { date: "2024-01-01", amount: -100 },
        { date: "2025-01-01", amount: 230 },
        { date: "2026-01-01", amount: -132 },
      ]),
    ).toBeNull();
  });

  test("computes since-window portfolio XIRR from owner flows only", () => {
    const result = computeXirrSeries(
      [
        { date: "2025-01-01", value: 100 },
        { date: "2025-07-01", value: 160 },
        { date: "2026-01-01", value: 176 },
      ],
      [{ date: "2025-07-01", amount: 50 }],
    );
    expect(result[0]?.xirr).toBeNull();
    expect(result[2]?.xirr).not.toBeNull();
    expect(result[2]?.xirr).toBeGreaterThan(0.1);
    expect(
      computeXirrSeries(
        [
          { date: "2025-01-01", value: null },
          { date: "2026-01-01", value: 100 },
        ],
        [],
      ).every(({ xirr }) => xirr === null),
    ).toBe(true);
    expect(
      computeXirrSeries(
        [
          { date: "2025-01-01", value: -10 },
          { date: "2026-01-01", value: 100 },
        ],
        [],
      ).every(({ xirr }) => xirr === null),
    ).toBe(true);
    expect(
      computeXirrSeries(
        [
          { date: "2025-01-01", value: 100 },
          { date: "2026-01-01", value: 120 },
        ],
        [{ date: "2025-06-01", amount: null }],
      )[1]?.xirr,
    ).toBeNull();
  });

  test("forward-fills benchmark closes for five business days only", () => {
    expect(
      alignBenchmarkValues(
        ["2026-01-02", "2026-01-09", "2026-01-12"],
        [{ date: "2026-01-02", value: 100 }],
      ),
    ).toEqual([
      { date: "2026-01-02", value: 100 },
      { date: "2026-01-09", value: 100 },
      { date: "2026-01-12", value: null },
    ]);
  });

  test("mirrors owner flows into benchmark units and requires every flow price", () => {
    const portfolio = [
      { date: "2025-01-01", value: 100 },
      { date: "2025-07-01", value: 155 },
      { date: "2026-01-01", value: 170 },
    ];
    const result = computeBenchmarkXirrSeries(
      portfolio,
      [
        { date: "2025-01-01", value: 100 },
        { date: "2025-07-01", value: 105 },
        { date: "2026-01-01", value: 110 },
      ],
      [{ date: "2025-07-01", amount: 50 }],
    );
    expect(result[2]?.xirr).toBeCloseTo(0.1, 2);

    const missingFlowPrice = computeBenchmarkXirrSeries(
      portfolio,
      [
        { date: "2025-01-01", value: 100 },
        { date: "2026-01-01", value: 110 },
      ],
      [{ date: "2025-07-01", amount: 50 }],
    );
    expect(missingFlowPrice[2]?.xirr).toBeNull();
  });
});
