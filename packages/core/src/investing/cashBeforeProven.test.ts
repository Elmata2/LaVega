import { expect, test } from "vitest";
import { buildIndexedSeries } from "./benchmarks.js";
import { buildHistoricalRisk } from "./risk.js";
import { emptyInvestingDashboard } from "./dashboard.js";
import type { CashBalance, CashFlow, CashHistoryCoverage } from "./model.js";
import { computePortfolioValueSeries } from "./portfolio.js";
import { FX_RATES } from "./__fixtures__/portfolio.js";

const flow = (id: string, date: string, amount: number): CashFlow => ({
  id,
  entity: "personal",
  broker: "ibkr",
  date,
  currency: "EUR",
  amount,
  kind: amount > 0 ? "deposit" : "withdrawal",
});
const balance = (amount: number, asOf: string): CashBalance => ({
  entity: "personal",
  broker: "ibkr",
  currency: "EUR",
  amount,
  asOf,
});
const coverage = (status: "complete" | "unknown"): CashHistoryCoverage =>
  status === "complete"
    ? {
        entity: "personal",
        broker: "ibkr",
        tradeCash: "cash-flows",
        status,
        from: "2025-10-06",
        to: "2026-10-05",
      }
    : { entity: "personal", broker: "ibkr", tradeCash: "cash-flows", status, reason: "unproven" };

/* IBKR's statement history opens 2025-10-06 and its balance is dated at the end;
 * movements before the window are reported but the window's opening balance is
 * not (history does not close: 1000 of funding is missing). */
const cashFlows = [
  flow("pre-first", "2025-08-04", 100),
  flow("pre-deposit", "2025-09-01", 5000),
  flow("pre-fee", "2025-09-10", -20),
  flow("in-deposit", "2025-11-03", 2000),
  flow("in-withdrawal", "2026-03-02", -300),
];
const walkable = [
  flow("pre-first", "2025-08-04", -1),
  flow("pre-fee", "2025-09-10", -20),
  ...cashFlows.slice(-2),
];
const series = (status: "complete" | "unknown", flows: CashFlow[] = cashFlows) =>
  computePortfolioValueSeries([], [], [], "EUR", FX_RATES, {
    cashBalances: [balance(1500, "2025-10-06"), balance(3180, "2026-10-05")],
    cashFlows: flows,
    cashCoverage: [coverage(status)],
    today: "2026-10-05",
  });
const on = (points: ReturnType<typeof series>, date: string) =>
  points.find((p) => p.date === date)!;

test("a proven window with movements before it does not invent a flat balance", () => {
  const points = series("complete");
  const pre = points.filter((p) => p.date < "2025-10-06");
  expect(pre[0]?.date).toBe("2025-08-04");
  /* Opening 1500 vs 5080 of reported pre-window net flow: the walk overdraws. */
  for (const p of pre.filter((q) => q.date < "2025-09-01")) {
    expect(p.cashValue).toBeNull();
    expect(p.cashUnknown).toEqual(["ibkr:EUR"]);
  }
  expect(on(points, "2025-10-06")).toMatchObject({ cashValue: 1500, cashUnknown: [] });
  expect(on(points, "2025-12-01").cashValue).toBe(3500);
  expect(on(points, "2026-04-01").cashValue).toBe(3200);
});

test("P1: a day's lines undone in either order give the same walked balance", () => {
  const day = "2025-09-01";
  const run = (flows: CashFlow[]) =>
    computePortfolioValueSeries([], [], [], "EUR", FX_RATES, {
      cashBalances: [balance(502, "2025-10-06")],
      cashFlows: [flow("first", "2025-08-01", 1), ...flows],
      cashCoverage: [coverage("unknown")],
      today: "2025-10-06",
    });
  const deposit = flow("dep", day, 2000);
  const buy = flow("buy", day, -1500);
  for (const flows of [
    [deposit, buy],
    [buy, deposit],
  ]) {
    const points = run(flows);
    expect(on(points, "2025-08-29")).toMatchObject({ cashValue: 2, cashUnknown: [] });
    expect(on(points, day).cashValue).toBe(502);
  }
});

test("an end-of-day overdraw still ends the walk", () => {
  const points = computePortfolioValueSeries([], [], [], "EUR", FX_RATES, {
    cashBalances: [balance(100, "2025-10-06")],
    cashFlows: [
      flow("first", "2025-08-01", 1),
      flow("dep", "2025-09-01", 2000),
      flow("buy", "2025-09-01", -1500),
    ],
    cashCoverage: [coverage("unknown")],
    today: "2025-10-06",
  });
  expect(on(points, "2025-08-29").cashValue).toBeNull();
});

test("P2: a real pre-window deposit is not turned into a loss", () => {
  const points = computePortfolioValueSeries([], [], [], "EUR", FX_RATES, {
    cashBalances: [balance(3000, "2025-10-06"), balance(3000, "2026-10-05")],
    cashFlows: [flow("pre-dep", "2025-09-01", 10000)],
    cashCoverage: [coverage("complete")],
    today: "2026-10-05",
  });
  const pre = points.filter((p) => p.date < "2025-09-01");
  for (const p of pre) expect(p.cashValue).toBeNull();
  const indexed = buildIndexedSeries(points, [], []);
  expect(indexed.at(-1)?.portfolioReturn ?? 0).toBeGreaterThan(-0.01);
});

test("no movement before the window: the opening balance is the estimate", () => {
  const points = series("complete", cashFlows.slice(-2));
  for (const p of points.filter((q) => q.date < "2025-10-06")) {
    expect(p.cashValue).toBe(1500);
  }
  expect(on(points, "2025-11-03").cashValue).toBe(3500);
});

test("a movement on the window's first day is not carried back as an opening balance", () => {
  const elsewhere: CashFlow = { ...flow("other-usd", "2025-08-04", 10), currency: "USD" };
  const points = series("complete", [
    elsewhere,
    flow("first-day", "2025-10-06", 2000),
    ...cashFlows.slice(-2),
  ]);
  const before = points.filter((q) => q.date < "2025-10-06");
  expect(before.length).toBeGreaterThan(0);
  for (const p of before) expect(p.cashUnknown).toContain("ibkr:EUR");
});

test("where the walk back succeeds, proven and unproven agree before the window", () => {
  const flows = walkable;
  const proven = series("complete", flows);
  const unproven = series("unknown", flows);
  const pre = proven.filter((q) => q.date < "2025-10-06");
  expect(pre.length).toBeGreaterThan(30);
  for (const p of pre) {
    const other = on(unproven, p.date);
    expect(p.cashValue).toBe(other.cashValue);
    expect(p.cashUnknown).toEqual(other.cashUnknown);
    expect(p.cashEstimated).toEqual(other.cashEstimated);
  }
  expect(on(proven, "2025-09-09").cashValue).toBe(1520);
});

test("the return chain is not reset at the window start", () => {
  const points = series("complete", walkable);
  const indexed = buildIndexedSeries(points, [], []);
  expect(indexed.every((p) => p.cashUnknown.length === 0)).toBe(true);
  const first = points[0]!.value!;
  const last = points.at(-1)!.value!;
  expect(indexed.at(-1)?.portfolioReturn).toBeCloseTo(last / first - 1, 10);
  const atWindowStart = points.find((p) => p.date === "2025-10-06")!.value!;
  expect(indexed.find((p) => p.date === "2025-10-06")?.portfolioReturn).toBeCloseTo(
    atWindowStart / first - 1,
    10,
  );
});

test("risk keeps every pre-window day as a valid return", () => {
  const points = series("complete", walkable);
  const dash = {
    ...emptyInvestingDashboard("EUR"),
    portfolio: { "1M": points, "6M": points, "1Y": points, YTD: points, All: points },
  };
  const report = buildHistoricalRisk(dash, "1Y");
  expect(report.metrics.observationDays).toBe(points.length - 1);
});
