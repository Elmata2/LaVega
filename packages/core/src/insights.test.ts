import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import {
  IDLE_CASH_THRESHOLDS,
  INSIGHT_THRESHOLDS,
  SAVINGS_RATE_CHANGE_THRESHOLDS,
  SPENDING_ANOMALY_THRESHOLDS,
  idleCashInsights,
  savingsRateChangeInsights,
  spendingAnomalyInsights,
} from "./alerts.js";

const tx = (over: Partial<Tx> & { date: string; amount: number }): Tx => ({
  id: `${over.date}|${over.amount}|${over.category ?? ""}`,
  accountKey: "A",
  currency: "EUR",
  counterparty: "",
  description: "",
  category: "",
  manual: false,
  ...over,
});

const acc = (over: Partial<Account> = {}): Account => ({
  key: "A",
  iban: "A",
  name: "A",
  bank: "ING",
  entity: "BV1",
  currency: "EUR",
  balance: 5000,
  ...over,
});

/** April 2026 has 30 days; on 15 April the pace factor is exactly 2. Three
 *  complete baseline months of €100 give a €100 median. */
const aprilLedger = (): Tx[] => [
  tx({ id: "salary", date: "2026-01-01", amount: 1000, category: "Inkomen" }),
  tx({ id: "b1", date: "2026-01-05", amount: -100, category: "Boodschappen" }),
  tx({ id: "b2", date: "2026-02-05", amount: -100, category: "Boodschappen" }),
  tx({ id: "b3", date: "2026-03-05", amount: -100, category: "Boodschappen" }),
  tx({ id: "c1", date: "2026-04-10", amount: -62.5, category: "Boodschappen" }),
];

test("spending anomaly: exactly +25% projected is flagged medium, 24.98% is not", () => {
  const atBoundary = spendingAnomalyInsights({ txs: aprilLedger(), asOf: "2026-04-15" });
  expect(atBoundary).toHaveLength(1);
  expect(atBoundary[0].priority).toBe("medium");
  expect(atBoundary[0].facts).toEqual({
    category: "Boodschappen",
    direction: "above",
    projectedCents: 12500, // 6250 * 30/15
    baselineCents: 10000,
    deviationPct: 25,
  });
  expect(atBoundary[0].howCalculated.thresholds).toBe(SPENDING_ANOMALY_THRESHOLDS);
  expect(atBoundary[0].howCalculated.inputs.elapsedDays).toBe(15);

  const ledger = aprilLedger();
  ledger[4] = tx({ id: "c1", date: "2026-04-10", amount: -62.49, category: "Boodschappen" });
  expect(spendingAnomalyInsights({ txs: ledger, asOf: "2026-04-15" })).toEqual([]);
});

test("spending anomaly: 7 elapsed days are enough, 6 are too noisy", () => {
  expect(spendingAnomalyInsights({ txs: aprilLedger(), asOf: "2026-04-06" })).toEqual([]);
  const atDaySeven = spendingAnomalyInsights({ txs: aprilLedger(), asOf: "2026-04-07" });
  expect(atDaySeven).toHaveLength(1);
  expect(atDaySeven[0].facts.direction).toBe("above");
});

test("spending anomaly: exactly 50% is high priority, just below is medium", () => {
  const ledger = aprilLedger().map((t) => (t.id === "c1" ? tx({ ...t, amount: -75 }) : t));
  const high = spendingAnomalyInsights({ txs: ledger, asOf: "2026-04-15" });
  expect(high[0].priority).toBe("high");
  expect(high[0].facts.deviationPct).toBe(50);

  const below = ledger.map((t) => (t.id === "c1" ? tx({ ...t, amount: -74.99 }) : t));
  expect(spendingAnomalyInsights({ txs: below, asOf: "2026-04-15" })[0].priority).toBe("medium");
});

test("spending anomaly baseline is a median, so one outlier month cannot pull it", () => {
  const ledger = [
    tx({ id: "salary", date: "2026-01-01", amount: 1000, category: "Inkomen" }),
    tx({ id: "b1", date: "2026-01-05", amount: -100, category: "Boodschappen" }),
    tx({ id: "b2", date: "2026-02-05", amount: -1, category: "Boodschappen" }),
    tx({ id: "b3", date: "2026-03-05", amount: -200, category: "Boodschappen" }),
    tx({ id: "c1", date: "2026-04-10", amount: -62.5, category: "Boodschappen" }),
  ];
  const insights = spendingAnomalyInsights({ txs: ledger, asOf: "2026-04-15" });
  // Median €100 -> +25%. The mean (€103.67) would have hidden it at +20.6%.
  expect(insights).toHaveLength(1);
  expect(insights[0].facts.baselineCents).toBe(10000);
});

test("spending anomaly: a baseline that is effectively zero suppresses", () => {
  const ledger = [
    tx({ id: "salary", date: "2026-01-01", amount: 1000, category: "Inkomen" }),
    tx({ id: "b1", date: "2026-01-05", amount: -100, category: "Boodschappen" }),
    // February and March have no Boodschappen row: the median is zero.
    tx({ id: "c1", date: "2026-04-10", amount: -200, category: "Boodschappen" }),
  ];
  expect(spendingAnomalyInsights({ txs: ledger, asOf: "2026-04-15" })).toEqual([]);
});

test("spending anomaly: a ledger that does not cover the baseline months suppresses", () => {
  const ledger = aprilLedger().filter((t) => t.date >= "2026-02-01");
  expect(spendingAnomalyInsights({ txs: ledger, asOf: "2026-04-15" })).toEqual([]);
});

test("spending anomaly ignores moved categories, excluded rows and non-EUR rows", () => {
  const moved = [
    ...aprilLedger(),
    tx({ id: "x", date: "2026-04-10", amount: -5000, category: "Eigen overboeking" }),
  ];
  expect(spendingAnomalyInsights({ txs: moved, asOf: "2026-04-15" })).toHaveLength(1);

  const excluded = aprilLedger().map((t) => (t.id === "c1" ? tx({ ...t, excluded: true }) : t));
  expect(spendingAnomalyInsights({ txs: excluded, asOf: "2026-04-15" })).toEqual([]);

  const foreign = aprilLedger().map((t) => (t.id === "c1" ? tx({ ...t, currency: "HUF" }) : t));
  expect(spendingAnomalyInsights({ txs: foreign, asOf: "2026-04-15" })).toEqual([]);
});

test("spending anomaly keeps only the three largest deviations", () => {
  const categories = ["A", "B", "C", "D"];
  const ledger: Tx[] = [
    tx({ id: "salary", date: "2026-01-01", amount: 1000, category: "Inkomen" }),
  ];
  for (const [index, category] of categories.entries()) {
    for (const month of ["01", "02", "03"]) {
      ledger.push(
        tx({ id: `b-${category}-${month}`, date: `2026-${month}-05`, amount: -100, category }),
      );
    }
    ledger.push(
      tx({ id: `c-${category}`, date: "2026-04-10", amount: -(70 + index * 10), category }),
    );
  }
  const insights = spendingAnomalyInsights({ txs: ledger, asOf: "2026-04-15" });
  expect(insights).toHaveLength(SPENDING_ANOMALY_THRESHOLDS.maxInsights);
  expect(insights.map((i) => i.facts.category)).toEqual(["D", "C", "B"]);
});

test("idle cash: exactly €5,000 with no booking in the window is one low nudge", () => {
  const insights = idleCashInsights({
    accounts: [acc({ balance: 5000 })],
    txs: [],
    asOf: "2026-08-01",
  });
  expect(insights).toHaveLength(1);
  expect(insights[0]).toMatchObject({
    kind: "idle-cash",
    priority: "low",
    facts: { accountKey: "A", accountName: "A", balanceCents: 500000, idleDays: 60 },
  });
  expect(insights[0].howCalculated.thresholds).toBe(IDLE_CASH_THRESHOLDS);

  expect(
    idleCashInsights({ accounts: [acc({ balance: 4999.99 })], txs: [], asOf: "2026-08-01" }),
  ).toEqual([]);
});

test("idle cash: a booking exactly 60 days ago ends the idle window", () => {
  expect(
    idleCashInsights({
      accounts: [acc()],
      txs: [tx({ id: "old", date: "2026-06-02", amount: -1 })], // exactly the cutoff
      asOf: "2026-08-01",
    }),
  ).toEqual([]);
  const insights = idleCashInsights({
    accounts: [acc()],
    txs: [tx({ id: "old", date: "2026-06-01", amount: -1 })], // one day older
    asOf: "2026-08-01",
  });
  expect(insights[0].facts.idleDays).toBe(61);
});

test("idle cash: savings counts, credit and investment do not, nor does an unknown balance", () => {
  const insights = idleCashInsights({
    accounts: [
      acc({ key: "S", name: "Spaarrekening", balance: 6000 }),
      acc({ key: "C", name: "Amex", balance: 9000 }),
      acc({ key: "I", name: "Beleggingsrekening", type: "Beleggingsrekening", balance: 8000 }),
      acc({ key: "U", balance: null }),
      acc({ key: "H", currency: "HUF", balance: 900000 }),
    ],
    txs: [],
    asOf: "2026-08-01",
  });
  expect(insights.map((i) => i.facts.accountKey)).toEqual(["S"]);
});

test("idle cash: sorted by balance and capped at two", () => {
  const insights = idleCashInsights({
    accounts: [
      acc({ key: "A", balance: 6000 }),
      acc({ key: "B", balance: 9000 }),
      acc({ key: "C", balance: 7000 }),
    ],
    txs: [],
    asOf: "2026-08-01",
  });
  expect(insights.map((i) => i.facts.accountKey)).toEqual(["B", "C"]);
});

/** Two complete months (Jan, Feb 2026) with the given spending; income is the
 *  same in both so the rate difference is spending-only. */
const savingsLedger = (januarySpend: number, februarySpend: number): Tx[] => [
  tx({ id: "i1", date: "2026-01-02", amount: 1000, category: "Inkomen" }),
  tx({ id: "s1", date: "2026-01-10", amount: -januarySpend, category: "Wonen & energie" }),
  tx({ id: "i2", date: "2026-02-02", amount: 1000, category: "Inkomen" }),
  tx({ id: "s2", date: "2026-02-10", amount: -februarySpend, category: "Wonen & energie" }),
  // The partial current month must never enter the comparison.
  tx({ id: "i3", date: "2026-03-02", amount: 9999, category: "Inkomen" }),
];

test("savings-rate change: exactly 5pp is flagged medium, 4.9pp is not", () => {
  const atBoundary = savingsRateChangeInsights({
    txs: savingsLedger(800, 750),
    asOf: "2026-03-10",
  });
  expect(atBoundary).toHaveLength(1);
  expect(atBoundary[0]).toMatchObject({
    kind: "savings-rate-change",
    priority: "medium",
    facts: {
      month: "2026-02",
      currentRatePct: 25,
      previousRatePct: 20,
      changePp: 5,
      direction: "up",
    },
  });
  expect(atBoundary[0].howCalculated.thresholds).toBe(SAVINGS_RATE_CHANGE_THRESHOLDS);
  expect(savingsRateChangeInsights({ txs: savingsLedger(800, 751), asOf: "2026-03-10" })).toEqual(
    [],
  );
});

test("savings-rate change: exactly 10pp is high priority, and a drop is a drop", () => {
  const up = savingsRateChangeInsights({ txs: savingsLedger(800, 700), asOf: "2026-03-10" });
  expect(up[0].priority).toBe("high");
  expect(up[0].facts.changePp).toBe(10);

  const down = savingsRateChangeInsights({ txs: savingsLedger(800, 900), asOf: "2026-03-10" });
  expect(down[0].facts).toMatchObject({
    direction: "down",
    currentRatePct: 10,
    previousRatePct: 20,
  });
  expect(down[0].priority).toBe("high");
});

test("savings-rate change: a month with no income suppresses instead of guessing", () => {
  const noIncome = savingsLedger(800, 750).filter((t) => t.id !== "i2");
  expect(savingsRateChangeInsights({ txs: noIncome, asOf: "2026-03-10" })).toEqual([]);
});

test("savings-rate change: a ledger that does not cover the previous month suppresses", () => {
  const ledger = savingsLedger(800, 750).filter((t) => t.date >= "2026-01-02");
  expect(savingsRateChangeInsights({ txs: ledger, asOf: "2026-03-10" })).toHaveLength(1);
  const short = ledger.filter((t) => t.date >= "2026-02-01");
  expect(savingsRateChangeInsights({ txs: short, asOf: "2026-03-10" })).toEqual([]);
});

test("savings-rate change ignores moved categories, excluded rows and non-EUR rows", () => {
  const withTransfer = [
    ...savingsLedger(800, 750),
    tx({ id: "x", date: "2026-02-11", amount: -9000, category: "Eigen overboeking" }),
  ];
  expect(savingsRateChangeInsights({ txs: withTransfer, asOf: "2026-03-10" })).toHaveLength(1);

  const excluded = savingsLedger(800, 750).map((t) =>
    t.id === "s2" ? tx({ ...t, excluded: true }) : t,
  );
  expect(
    savingsRateChangeInsights({ txs: excluded, asOf: "2026-03-10" })[0].facts.currentRatePct,
  ).toBe(100);

  const foreign = savingsLedger(800, 750).map((t) =>
    t.id === "s2" ? tx({ ...t, currency: "HUF" }) : t,
  );
  expect(
    savingsRateChangeInsights({ txs: foreign, asOf: "2026-03-10" })[0].facts.currentRatePct,
  ).toBe(100);
});

test("insight threshold tables are exported and keyed by kind", () => {
  expect(SPENDING_ANOMALY_THRESHOLDS).toEqual({
    minElapsedDays: 7,
    minBaselineCents: 5000,
    deviationPct: 25,
    highPriorityPct: 50,
    baselineMonths: 3,
    maxInsights: 3,
  });
  expect(INSIGHT_THRESHOLDS["spending-anomaly"]).toBe(SPENDING_ANOMALY_THRESHOLDS);
  expect(INSIGHT_THRESHOLDS["idle-cash"]).toBe(IDLE_CASH_THRESHOLDS);
  expect(INSIGHT_THRESHOLDS["savings-rate-change"]).toBe(SAVINGS_RATE_CHANGE_THRESHOLDS);
});
