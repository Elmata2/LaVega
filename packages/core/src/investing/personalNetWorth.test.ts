import { expect, test } from "vitest";
import type { Account } from "../model.js";
import {
  latestPersonalNetWorthTotal,
  mergeInPersonalNetWorth,
  personalShareAccounts,
} from "./personalNetWorth.js";
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
  const { points } = mergeInPersonalNetWorth(
    [source],
    [{ date: "2026-01-01", totalCents: 500_00 }],
  );
  expect(points[0]!.positionsValue).toBe(source.positionsValue);
  expect(points[0]!.cashValue).toBe(source.cashValue);
  expect(points[0]!.value).toBe(source.value);
});

/* WS4.7 (#298): the Personal share and the portfolio series split the owner's
 * money by scope, so a contribution moves the same euro from one side to the
 * other and the combined net worth never counts it twice or drops it. */

const account = (over: Partial<Account>): Account => ({
  key: "bank",
  iban: "",
  name: "Betaalrekening",
  bank: "ING",
  entity: "Privé",
  currency: "EUR",
  balance: 0,
  ...over,
});

test("the Personal share leaves investment accounts to Investing", () => {
  const accounts = [
    account({ key: "bank", type: "Betaalrekening", balance: 9000 }),
    account({ key: "broker", type: "Beleggingsrekening", balance: 1000 }),
    // LaVega has no crypto account type; an explicit crypto spelling is still
    // investment-scope money, so it stays on Investing's side too.
    account({ key: "wallet", type: "Crypto", balance: 250 }),
  ];
  expect(personalShareAccounts(accounts).map((row) => row.key)).toEqual(["bank"]);
});

test("a contribution moves the same euro between the two sides without changing net worth", () => {
  // Before: the bank holds all 10.000, the broker reports nothing.
  const before = mergeInPersonalNetWorth(
    [pt("2026-03-10", 0)],
    [{ date: "2026-03-10", totalCents: 1_000_000 }],
  );
  expect(before.points[0]).toMatchObject({ personalValue: 10_000, netWorth: 10_000 });

  // After a 1.000 contribution: the bank share drops to 9.000 and the portfolio
  // reports the 1.000, so the combined figure is unchanged, counted once.
  const after = mergeInPersonalNetWorth(
    [pt("2026-03-10", 1000)],
    [{ date: "2026-03-10", totalCents: 900_000 }],
  );
  expect(after.points[0]).toMatchObject({ personalValue: 9_000, netWorth: 10_000 });
});

test("latestPersonalNetWorthTotal picks the newest row and carries its citation (#300 WS5.5)", () => {
  const provenance = { source: "Annual report", grade: "B" as const, date: "2026-09-30" };
  expect(latestPersonalNetWorthTotal([])).toBeNull();
  expect(
    latestPersonalNetWorthTotal([
      { date: "2026-08-31", totalCents: 100 },
      { date: "2026-09-30", totalCents: 200, provenance },
      { date: "2026-07-31", totalCents: 50 },
    ]),
  ).toEqual({ date: "2026-09-30", totalCents: 200, provenance });
});
