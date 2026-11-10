import { describe, expect, test } from "vitest";
import { mkAccount, mkTx } from "../advisor/testkit.js";
import { MIN_HISTORY_PERIODS } from "../spendPercentile.js";
import { buildFactSheet } from "./factsheet.js";
import { emptyPlanPreferences } from "./preferences.js";
import { SPENDING_CALC_IDS, computeSpending, spendHistory } from "./spending.js";
import { AS_OF, planInput } from "./testkit.js";
import type { PlanInput } from "./types.js";
import { ownAccounts } from "../views.js";
import type { Tx } from "../model.js";

const ALL = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const ACC = (o = {}) => mkAccount("A1", { balance: 0, balanceDate: "2026-10-20", ...o });

/** Salary on day 2 and one spend per month; `amounts` is oldest-first, one per month. */
function history(amounts: number[], cat = "Boodschappen", key = "A1"): Tx[] {
  const months = ALL.slice(ALL.length - amounts.length);
  return months.flatMap((m, k) => [
    mkTx("Employer", `${m}-02`, 3000, { accountKey: key, category: "Salaris" }),
    mkTx("Shop", `${m}-15`, -amounts[k]!, { accountKey: key, category: cat }),
  ]);
}
const run = (txs: Tx[], over: Partial<PlanInput> = {}) =>
  computeSpending(planInput({ accounts: [ACC()], txs, ...over }));
const hist = (txs: Tx[], over = {}) => {
  const accounts = [ACC()];
  return spendHistory({
    txs,
    accounts,
    entityProfiles: [],
    rules: [],
    own: ownAccounts(accounts),
    asOf: AS_OF,
    mode: "separate",
    fxHistory: {},
    movedCategories: new Set(),
    ...over,
  });
};

describe("spendHistory", () => {
  test("full months only, newest unbroken run, asOf's own month dropped", () => {
    const txs = [...history([100, 100, 100]), mkTx("Shop", "2026-10-03", -50, { category: "Boodschappen" })];
    const h = hist(txs);
    expect(h.months).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(h.byCategory.get("Boodschappen")!.get("2026-09")).toBe(10_000);
    expect(h.byCategory.get("Boodschappen")!.has("2026-10")).toBe(false);
  });

  test("personal scope only, moved categories dropped, incoming ignored", () => {
    const biz = mkAccount("B1", { entity: "BV1", balance: 0, balanceDate: "2026-10-20" });
    const personal = ACC();
    const txs = [
      ...history([100, 100, 100]),
      ...history([999, 999, 999], "Boodschappen", "B1"),
      mkTx("Own", "2026-09-10", -777, { category: "Eigen overboeking" }),
    ];
    const h = spendHistory({
      txs,
      accounts: [personal, biz],
      entityProfiles: [{ entity: "BV1", scope: "business" }],
      rules: [],
      own: ownAccounts([personal, biz]),
      asOf: AS_OF,
      mode: "separate",
      fxHistory: {},
      movedCategories: new Set(["Eigen overboeking"]),
    });
    expect(h.byCategory.get("Boodschappen")!.get("2026-09")).toBe(10_000);
    expect(h.byCategory.has("Eigen overboeking")).toBe(false);
    expect(h.byCategory.has("Salaris")).toBe(false);
  });

  test("foreign rows: separate mode excludes and counts; convert without a rate excludes, with a rate converts", () => {
    const usd = (d: string) => mkTx("Shop", d, -110, { currency: "USD", category: "Reizen" });
    const txs = [...history([100, 100, 100]), usd("2026-09-12"), usd("2026-08-12")];
    const sep = hist(txs);
    expect(sep.excludedForeignCount).toBe(2);
    expect(sep.byCategory.has("Reizen")).toBe(false);
    const noRate = hist(txs, { mode: "convert" });
    expect(noRate.excludedForeignCount).toBe(2);
    const rated = hist(txs, {
      mode: "convert",
      fxHistory: { USD: { "2026-09-12": 1.1, "2026-08-12": 1.1 } },
    });
    expect(rated.excludedForeignCount).toBe(0);
    expect(rated.byCategory.get("Reizen")!.get("2026-09")).toBe(10_000);
  });

  test("accountKeys filters to those accounts; windowMonths keeps the newest", () => {
    const a1 = ACC();
    const a2 = mkAccount("C2", { balance: 0, balanceDate: "2026-10-20" });
    const txs = [...history([100, 100, 100, 100]), ...history([500, 500, 500, 500], "Reizen", "C2")];
    const base = {
      txs,
      accounts: [a1, a2],
      entityProfiles: [],
      rules: [],
      own: ownAccounts([a1, a2]),
      asOf: AS_OF,
      mode: "separate" as const,
      fxHistory: {},
      movedCategories: new Set<string>(),
    };
    const only = spendHistory({ ...base, accountKeys: new Set(["C2"]) });
    expect([...only.byCategory.keys()]).toEqual(["Reizen"]);
    const two = spendHistory({ ...base, windowMonths: 2 });
    expect(two.months).toEqual(["2026-08", "2026-09"]);
  });
});

describe("coverage and staleness", () => {
  const A2 = (o = {}) => mkAccount("A2", { balance: 0, balanceDate: "2026-04-30", ...o });
  const longHistory = ALL.flatMap((m) => [
    mkTx("Employer", `${m}-02`, 3000, { category: "Salaris" }),
    mkTx("Shop", `${m}-15`, -100, { category: "Boodschappen" }),
  ]);
  const stoppedA2 = [
    mkTx("Shop", "2026-03-10", -50, { accountKey: "A2", category: "Boodschappen" }),
    mkTx("Shop", "2026-04-10", -50, { accountKey: "A2", category: "Boodschappen" }),
  ];

  test("a current account that stopped in April blocks September: not-enough-data, missing names it", () => {
    const r = computeSpending(
      planInput({ accounts: [ACC(), A2()], txs: [...longHistory, ...stoppedA2] }),
    );
    expect(r.status).toBe("not-enough-data");
    expect(r.statusReason.key).toBe("data-stale");
    expect(r.missing).toEqual([{ kind: "account-stale", action: "connect-bank", ref: "A2" }]);
    expect(r.headline).toBeNull();
    expect(r.facts).toEqual([]);
    expect(r.figures.lastMonth).toBe("2026-04");
    expect(r.figures.firstMonth).toBe("2026-04");
  });

  test("the same stopped account as a savings account does not count", () => {
    const sav = A2({ type: "Spaarrekening" });
    const r = computeSpending(
      planInput({ accounts: [ACC(), sav], txs: [...longHistory, ...stoppedA2] }),
    );
    expect(r.figures.lastMonth).toBe("2026-09");
    expect(r.figures.firstMonth).toBe("2026-03");
    expect(r.status).toBe("on-track");
    expect(r.flat["spend_last_month"]).toEqual({ unit: "date", value: "2026-09-30" });
    expect(r.flat["spend_first_month"]).toEqual({ unit: "date", value: "2026-03-01" });
  });

  test("fresh data: lastMonth is the month before asOf", () => {
    const r = run(history([1, 2, 3, 4, 5, 6, 7].map((x) => x * 100)));
    expect(r.figures.firstMonth).toBe("2026-03");
    expect(r.figures.lastMonth).toBe("2026-09");
  });

  test("foreign rows excluded are counted in figures, flat and calc", () => {
    const usd = mkTx("Shop", "2026-09-12", -110, { currency: "USD", category: "Reizen" });
    const r = run([...history([100, 100, 100, 100, 100, 100, 100]), usd]);
    expect(r.figures.excludedForeignCount).toBe(1);
    expect(r.flat["spend_foreign_excluded"]).toEqual({ unit: "count", value: 1 });
    expect(r.calc.find((c) => c.id === "spend-months")!.inputs["foreign_excluded"]).toEqual({
      unit: "count",
      value: 1,
    });
  });
});

describe("computeSpending", () => {
  test("5 months: not-enough-data, totals present, percentile null with te-weinig-geschiedenis", () => {
    const r = run(history([100, 100, 100, 100, 100]));
    expect(r.figures.months).toBe(5);
    expect(r.status).toBe("not-enough-data");
    expect(r.statusReason.key).toBe("history-short-6m");
    expect(r.missing).toEqual([{ kind: "history-6m", action: "connect-bank" }]);
    const row = r.figures.rows[0]!;
    expect(row.lastMonthCents).toBe(10_000);
    expect(row.percentile).toBeNull();
    expect(row.percentileReason).toBe("te-weinig-geschiedenis");
    expect(r.headline).toEqual({ unit: "cents", value: 10_000 });
  });

  test(`${MIN_HISTORY_PERIODS} months is still not-enough-data: percentiles need ${MIN_HISTORY_PERIODS + 1}`, () => {
    const r = run(history([100, 200, 300, 400, 500, 600]));
    expect(r.figures.months).toBe(6);
    expect(r.status).toBe("not-enough-data");
    expect(r.statusReason.key).toBe("history-short-6m");
    expect(r.figures.rows[0]!.percentile).toBeNull();
    expect(r.figures.rows[0]!.percentileReason).toBe("te-weinig-geschiedenis");
  });

  test("7 months: on-track and the percentile comes from categorySpendPercentiles (highest of 6 earlier -> 6/6)", () => {
    const r = run(history([100, 200, 300, 400, 500, 600, 700]));
    const row = r.figures.rows[0]!;
    expect(row.percentile).toBe(1);
    expect(r.status).toBe("on-track");
    expect(row.percentileReason).toBeNull();
    expect(r.calc.map((c) => c.id)).toContain("spend-percentile");
  });

  test("last month, 3-month average, 12-month median over only the months present, trend6", () => {
    const r = run(history([100, 100, 100, 100, 100, 200, 400]));
    const row = r.figures.rows[0]!;
    expect(row.lastMonthCents).toBe(40_000);
    expect(row.avg3Cents).toBe(Math.round((10_000 + 20_000 + 40_000) / 3));
    expect(row.median12Cents).toBe(10_000);
    expect(row.trend6).toEqual([10_000, 10_000, 10_000, 10_000, 20_000, 40_000]);
    const months = r.calc.find((c) => c.id === "spend-months")!;
    expect(months.inputs["categories_in_facts"]).toEqual({ unit: "count", value: 1 });
    const step = r.calc.find((c) => c.id === "spend-median")!;
    expect(step.inputs["months_used"]).toEqual({ unit: "count", value: 7 });
  });

  test("limit 400: 420 then 410 -> overLimitMonths 2 -> attention; 420 then 390 -> 0", () => {
    const prefs = emptyPlanPreferences();
    (prefs.categoryLimits as Mut)["Boodschappen"] = { cents: 40_000, at: "2026-10-01" };
    const base = [300, 300, 300, 300, 300];
    const over = run(history([...base, 420, 410]), { preferences: prefs });
    expect(over.figures.rows[0]!.overLimitMonths).toBe(2);
    expect(over.figures.rows[0]!.limitCents).toBe(40_000);
    expect(over.status).toBe("attention");
    expect(over.statusReason.key).toBe("over-limit");
    expect(over.statusReason.params).toEqual({ months: 2 });
    // six months over: the headline carries the same run the row shows
    const long = run(history([300, 420, 410, 430, 440, 450, 460]), { preferences: prefs });
    expect(long.figures.rows[0]!.overLimitMonths).toBe(6);
    expect(long.statusReason.params).toEqual({ months: 6 });
    const ok = run(history([...base, 420, 390]), { preferences: prefs });
    expect(ok.figures.rows[0]!.overLimitMonths).toBe(0);
    expect(ok.status).toBe("on-track");
    expect(ok.statusReason.key).toBe("within-limits");
  });

  test("short history keeps not-enough-data even when a limit is exceeded", () => {
    const prefs = emptyPlanPreferences();
    (prefs.categoryLimits as Mut)["Boodschappen"] = { cents: 100, at: "2026-10-01" };
    const r = run(history([500, 500, 500]), { preferences: prefs });
    expect(r.status).toBe("not-enough-data");
    expect(r.figures.rows[0]!.overLimitMonths).toBe(3);
  });

  test("no limits and 6+ months -> on-track no-limits; benchmark null; link constant", () => {
    const r = run(history([1, 2, 3, 4, 5, 6, 7].map((x) => x * 100)));
    expect(r.statusReason.key).toBe("no-limits");
    expect(r.figures.externalBenchmark).toBeNull();
    expect(r.figures.budgetAdviceLink).toBe("nibud-persoonlijk-budgetadvies");
  });

  test("no data: months 0, headline null, not-enough-data", () => {
    const r = computeSpending(planInput());
    expect(r.figures.months).toBe(0);
    expect(r.headline).toBeNull();
    expect(r.status).toBe("not-enough-data");
  });

  test("every output is an integer cent; calc ids are declared", () => {
    const r = run(history([101, 203, 307, 401, 509, 601, 703]));
    for (const row of r.figures.rows) {
      for (const v of [row.lastMonthCents, row.avg3Cents, row.median12Cents!, ...row.trend6])
        expect(Number.isInteger(v)).toBe(true);
    }
    for (const c of r.calc) expect(SPENDING_CALC_IDS).toContain(c.id);
  });

  test("fact ids: category names are hashed and the whole set passes buildFactSheet", () => {
    const prefs = emptyPlanPreferences();
    (prefs.categoryLimits as Mut)["Boodschappen & Zo"] = { cents: 20_000, at: "2026-10-01" };
    const r = run(history([100, 200, 300, 400, 500, 600, 700].map((x) => x * 100), "Boodschappen & Zo"), {
      preferences: prefs,
    });
    expect(r.facts.length).toBeGreaterThanOrEqual(4);
    expect(r.facts.some((f) => /boodschappen|zo/i.test(f.factId))).toBe(false);
    expect(() => buildFactSheet(r.facts, { locale: "nl", asOf: AS_OF })).not.toThrow();
    const kinds = new Set(r.facts.map((f) => f.factId.split(":")[0]));
    expect(kinds).toEqual(
      new Set(["spend_last_month", "spend_median12", "spend_trend", "spend_over_limit"]),
    );
    const over = r.facts.find((f) => f.factId.startsWith("spend_over_limit"))!;
    expect(over.polarity).toBe("negative");
    expect(over.mustMention).toBe(false);
    const trend = r.facts.find((f) => f.factId.startsWith("spend_trend"))!;
    expect(trend.trend?.direction).toBe("up");
  });
});

type Mut = Record<string, { cents: number; at: string }>;
