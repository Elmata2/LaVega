import { expect, test } from "vitest";
import { mergeInPersonalNetWorth } from "./personalNetWorth.js";
import type { PortfolioValuePoint } from "./portfolio.js";

function pt(date: string, value: number | null): PortfolioValuePoint {
  return {
    date,
    positionsValue: value,
    cashValue: 0,
    value,
    unpriced: [],
    forwardFilled: [],
    cashUnknown: [],
  };
}

test("a date before the first total gets no personal part, and net worth equals the portfolio value alone", () => {
  const { points } = mergeInPersonalNetWorth(
    [pt("2026-01-01", 1000), pt("2026-01-02", 1100)],
    [{ date: "2026-01-02", totalCents: 500_00 }],
  );
  expect(points[0]).toMatchObject({ personalValue: null, netWorth: 1000 });
  expect(points[1]).toMatchObject({ personalValue: 500, netWorth: 1600 });
});

test("the latest total on or before a date is carried forward onto days with no total of their own", () => {
  const { points } = mergeInPersonalNetWorth(
    [pt("2026-01-01", 1000), pt("2026-01-02", 1000), pt("2026-01-05", 1000)],
    [{ date: "2026-01-01", totalCents: 200_00 }],
  );
  expect(points.map((p) => p.personalValue)).toEqual([200, 200, 200]);
});

test("a later total replaces the carried value from that date on", () => {
  const { points } = mergeInPersonalNetWorth(
    [pt("2026-01-01", 0), pt("2026-01-02", 0), pt("2026-01-03", 0)],
    [
      { date: "2026-01-01", totalCents: 100_00 },
      { date: "2026-01-03", totalCents: 300_00 },
    ],
  );
  expect(points.map((p) => p.personalValue)).toEqual([100, 100, 300]);
});

test("no totals at all leaves every point unchanged — the chart's 'unchanged when absent' contract", () => {
  const { points, latestPersonalDate } = mergeInPersonalNetWorth(
    [pt("2026-01-01", 500), pt("2026-01-02", 600)],
    [],
  );
  expect(points.map((p) => p.personalValue)).toEqual([null, null]);
  expect(points.map((p) => p.netWorth)).toEqual([500, 600]);
  expect(latestPersonalDate).toBeNull();
});

test("latestPersonalDate is the most recent total, for the chart's as-of label", () => {
  const { latestPersonalDate } = mergeInPersonalNetWorth(
    [pt("2026-01-05", 0)],
    [
      { date: "2026-01-01", totalCents: 100 },
      { date: "2026-01-03", totalCents: 200 },
    ],
  );
  expect(latestPersonalDate).toBe("2026-01-03");
});

test("a null portfolio value still lets a known personal total carry the net worth", () => {
  const { points } = mergeInPersonalNetWorth(
    [pt("2026-01-02", null)],
    [{ date: "2026-01-01", totalCents: 400_00 }],
  );
  expect(points[0]).toMatchObject({ personalValue: 400, netWorth: 400 });
});

test("both unknown means net worth is null, not zero", () => {
  const { points } = mergeInPersonalNetWorth([pt("2026-01-01", null)], []);
  expect(points[0]).toMatchObject({ personalValue: null, netWorth: null });
});

test("input order does not matter — totals and points are sorted internally", () => {
  const { points } = mergeInPersonalNetWorth(
    [pt("2026-01-03", 0), pt("2026-01-01", 0), pt("2026-01-02", 0)],
    [
      { date: "2026-01-03", totalCents: 300_00 },
      { date: "2026-01-01", totalCents: 100_00 },
    ],
  );
  expect(points.map((p) => [p.date, p.personalValue])).toEqual([
    ["2026-01-01", 100],
    ["2026-01-02", 100],
    ["2026-01-03", 300],
  ]);
});

test("portfolio-only fields (positionsValue, cashValue, value) are passed through untouched", () => {
  const source = pt("2026-01-01", 1000);
  const { points } = mergeInPersonalNetWorth([source], [{ date: "2026-01-01", totalCents: 500_00 }]);
  expect(points[0]!.positionsValue).toBe(source.positionsValue);
  expect(points[0]!.cashValue).toBe(source.cashValue);
  expect(points[0]!.value).toBe(source.value);
});
