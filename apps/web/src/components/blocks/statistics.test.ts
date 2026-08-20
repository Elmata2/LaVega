import { expect, test } from "vitest";
import type { Tx } from "@lavega/core";
import { categorize } from "@lavega/core";
import {
  bucketUnit,
  categoryGrowth,
  categoryPerWindow,
  categoryShare,
  MIN_WEEKDAY_DAYS,
  monthAxisLabel,
  movedTotals,
  newestTxDate,
  presetWindow,
  weekdaySpend,
  windowTotals,
} from "./statistics";
import { freshTxs, own, rules, txs } from "./fixtures";

const DEFAULT_CATEGORY = categorize(txs[1], rules, own); // Albert Heijn, via the Dutch defaults

/** The fixture's newest transaction — every preset window ends here. */
const ANCHOR = "2026-08-11";
const YEAR = presetWindow("12m", ANCHOR);

test("newestTxDate takes the clock from the data, never from Date.now", () => {
  expect(newestTxDate(txs)).toBe(ANCHOR);
  expect(newestTxDate([])).toBeNull();
});

test("presetWindow resolves each preset into a real range", () => {
  // A week is seven days back, inclusive; a month is the last thirty days —
  // both rolling, both drawn in buckets that never cut a calendar month.
  expect(presetWindow("1w", ANCHOR)).toEqual({ start: "2026-08-05", end: ANCHOR });
  expect(presetWindow("1m", ANCHOR)).toEqual({ start: "2026-07-13", end: ANCHOR });
  expect(presetWindow("3m", ANCHOR)).toEqual({ start: "2026-06-01", end: ANCHOR });
  expect(presetWindow("6m", ANCHOR)).toEqual({ start: "2026-03-01", end: ANCHOR });
  expect(presetWindow("12m", ANCHOR)).toEqual({ start: "2025-09-01", end: ANCHOR });
});

test("bucketUnit picks a bucket the window can actually fill", () => {
  expect(bucketUnit(presetWindow("1w", ANCHOR))).toBe("dag");
  expect(bucketUnit(presetWindow("1m", ANCHOR))).toBe("week");
  expect(bucketUnit(presetWindow("1m", "2026-02-28"))).toBe("week");
  expect(bucketUnit(presetWindow("3m", ANCHOR))).toBe("maand");
  expect(bucketUnit(presetWindow("12m", ANCHOR))).toBe("maand");
  // A hand-picked range is measured the same way — it is a range, not a preset.
  expect(bucketUnit({ start: "2026-08-01", end: "2026-08-10" })).toBe("dag");
  expect(bucketUnit({ start: "2026-06-01", end: "2026-07-15" })).toBe("week");
});

test("categoryPerWindow returns one group per month and one bar per major category", () => {
  const s = categoryPerWindow(txs, rules, own, YEAR, 4);
  expect(s.unit).toBe("maand");
  expect(s.buckets.map((b) => b.key)).toEqual(["2026-06", "2026-07", "2026-08"]);
  // Ranked by total spend in the window: Inkoop 2.980, boodschappen 420,50, Energie 250.
  expect(s.categories).toEqual(["Inkoop", DEFAULT_CATEGORY, "Energie"]);
  expect(s.values).toEqual([
    [0, 420.5, 0],
    [1_880, 0, 0],
    [1_100, 0, 250],
  ]);
  // Which categories are major is core's per-window call; nothing here is
  // above the cap or under the floor, so nothing is folded away.
  expect(s.selection?.hidden).toEqual([]);
  expect(s.windowDays).toBe(64);
});

test("categoryPerWindow clamps the window to the span the data covers", () => {
  // Twelve months requested, three months held: nine extra groups would each be
  // a bar of zero, which claims a month of no spending that was never observed.
  const s = categoryPerWindow(txs, rules, own, YEAR, 4);
  expect(s.covered).toEqual({ start: "2026-06-09", end: ANCHOR });
  expect(s.buckets).toHaveLength(3);
  // And a window entirely outside the data covers nothing at all — no buckets,
  // rather than a row of zeroes.
  const before = categoryPerWindow(txs, rules, own, { start: "2025-01-01", end: "2025-03-01" }, 4);
  expect(before.covered).toBeNull();
  expect(before.buckets).toEqual([]);
  expect(before.categories).toEqual([]);
});

test("categoryPerWindow marks a bucket the window only partly covers", () => {
  const s = categoryPerWindow(txs, rules, own, YEAR, 4);
  // June starts on the 9th (the first transaction) and August stops at the
  // 11th — neither is a whole month, and the tooltip says so.
  expect(s.buckets[0].partial).toBe(true);
  expect(s.buckets[0].title).toBe("jun 2026 — alleen 9 jun t/m 30 jun");
  expect(s.buckets[1].partial).toBe(false);
  expect(s.buckets[1].title).toBe("jul 2026");
  expect(s.buckets[2].partial).toBe(true);
});

test("categoryPerWindow buckets a one-week window per day", () => {
  const s = categoryPerWindow(txs, rules, own, presetWindow("1w", ANCHOR), 4);
  expect(s.unit).toBe("dag");
  // 5–11 August, clamped to the newest transaction on the 11th.
  expect(s.buckets.map((b) => b.key)).toEqual(["2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11"]);
  expect(s.buckets.every((b) => !b.partial)).toBe(true);
  expect(s.categories).toEqual(["Inkoop"]);
  // Only the 11th holds spending; the other days were observed and were empty.
  expect(s.values.map((v) => v[0])).toEqual([0, 0, 0, 0, 0, 0, 1_100]);
  expect(s.buckets.map((b) => b.hasData)).toEqual([false, false, false, false, false, false, true]);
});

test("categoryPerWindow buckets a month-long window per week", () => {
  const s = categoryPerWindow(txs, rules, own, presetWindow("1m", ANCHOR), 4);
  expect(s.unit).toBe("week");
  // 13 July – 11 August, in Monday-first weeks; the last one is cut short by
  // the window and says so rather than looking like a full week.
  expect(s.buckets.map((b) => b.key)).toEqual([
    "2026-07-13",
    "2026-07-20",
    "2026-07-27",
    "2026-08-03",
    "2026-08-10",
  ]);
  expect(s.buckets.map((b) => b.partial)).toEqual([false, false, false, false, true]);
  expect(s.buckets[4].title).toBe("Week van 10 aug — alleen 10 aug t/m 11 aug");
  const inkoop = s.categories.indexOf("Inkoop");
  const energie = s.categories.indexOf("Energie");
  expect(s.values[3][energie]).toBe(250); // 3 August
  expect(s.values[4][inkoop]).toBe(1_100); // 11 August
});

test("categoryPerWindow ranks the categories inside THIS window, against a floor scaled to it", () => {
  // Over the year Inkoop is the biggest category; over the first fortnight of
  // June it does not exist at all, and boodschappen is the only one there is.
  const june = categoryPerWindow(txs, rules, own, { start: "2026-06-01", end: "2026-06-14" }, 4);
  expect(june.categories).toEqual([DEFAULT_CATEGORY]);
  expect(june.selection?.hidden).toEqual([]);

  // The floor is core's, and it is a rate scaled to the window: six days of
  // June carry a far lower bar than sixty-four days of summer.
  expect(june.windowDays).toBe(6);
  expect(june.selection?.thresholdOut).toBeCloseTo((25 * 6) / 30, 6);
  const year = categoryPerWindow(txs, rules, own, YEAR, 4);
  expect(year.selection?.thresholdOut).toBeCloseTo((25 * 64) / 30, 6);

  // What the chart's cap pushes out is reported separately from what the floor
  // dropped — they are different facts about the same window.
  const capped = categoryPerWindow(txs, rules, own, YEAR, 1);
  expect(capped.categories).toEqual(["Inkoop"]);
  expect(capped.selection?.hidden.map((h) => h.category)).toEqual([DEFAULT_CATEGORY, "Energie"]);
  expect(capped.selection?.hidden.every((h) => h.belowThreshold)).toBe(false);
});

test("categoryPerWindow folds away a category that is small FOR THIS WINDOW", () => {
  // € 20 of "Zorg" against sixty-four days is under core's floor (€ 53,33);
  // against the six days it happened in, it is not.
  const withSmall: Tx[] = [
    ...txs,
    { ...txs[1], id: "s1", date: "2026-06-10", amount: -20, counterparty: "Apotheek", description: "Zorg", category: "Zorg", manual: true },
  ];
  const year = categoryPerWindow(withSmall, rules, own, YEAR, 4);
  expect(year.categories).not.toContain("Zorg");
  expect(year.selection?.hidden.map((h) => [h.category, h.belowThreshold])).toEqual([["Zorg", true]]);

  const week = categoryPerWindow(withSmall, rules, own, { start: "2026-06-08", end: "2026-06-13" }, 4);
  expect(week.categories).toContain("Zorg");
  expect(week.selection?.hidden).toEqual([]);
});

test("categoryPerWindow marks a month with no data at all, so it is never drawn as zero", () => {
  // January and March have transactions; February has none — an interior gap
  // that clamping the window's ends cannot remove.
  const gap: Tx[] = [
    { ...txs[0], id: "g1", date: "2026-01-15", amount: -100, counterparty: "Albert Heijn" },
    { ...txs[0], id: "g2", date: "2026-03-15", amount: -100, counterparty: "Albert Heijn" },
  ];
  const s = categoryPerWindow(gap, rules, own, { start: "2026-01-01", end: "2026-03-31" }, 4);
  expect(s.unit).toBe("maand");
  expect(s.buckets.map((b) => b.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
  expect(s.buckets.map((b) => b.hasData)).toEqual([true, false, true]);
});

test("monthAxisLabel keeps month labels unique once the window passes a year", () => {
  expect(monthAxisLabel("2026-08", 12)).toBe("aug");
  expect(monthAxisLabel("2026-08", 18)).toBe("aug '26");
  expect(monthAxisLabel("2025-08", 18)).toBe("aug '25");
});

test("windowTotals reports what came in and went out inside the window", () => {
  const year = windowTotals(txs, rules, own, YEAR);
  expect(year.inTotal).toBeCloseTo(12_000 + 9_500, 6);
  expect(year.outTotal).toBeCloseTo(420.5 + 1_880 + 250 + 1_100, 6);

  // A shorter window is a smaller total, not a rescaled one: no per-month
  // average is extrapolated out of eleven days.
  const august = windowTotals(txs, rules, own, presetWindow("1m", ANCHOR));
  expect(august.inTotal).toBe(0);
  expect(august.outTotal).toBeCloseTo(250 + 1_100, 6);

  // A window the data does not reach into covers nothing.
  const gap = windowTotals(txs, rules, own, { start: "2025-01-01", end: "2025-02-01" });
  expect(gap.covered).toBeNull();
  expect(gap.inTotal).toBe(0);
  expect(gap.outTotal).toBe(0);
});

test("weekdaySpend averages per OCCURRENCE of the weekday, not per transaction", () => {
  const w = weekdaySpend(txs, rules, own, YEAR);
  expect(w.spanDays).toBe(64);
  const by = Object.fromEntries(w.rows.map((r) => [r.short, r]));

  // Tuesday holds two transactions (420,50 + 1.100) and occurred ten times in
  // the window, so it costs 152,05 on an average Tuesday — not 1.520,50.
  expect(by.di.total).toBeCloseTo(1_520.5, 6);
  expect(by.di.occurrences).toBe(10);
  expect(by.di.average).toBeCloseTo(152.05, 6);

  // Thursday's single 1.880 over nine Thursdays is still the peak.
  expect(by.do.average).toBeCloseTo(1_880 / 9, 6);
  expect(w.peak?.label).toBe("Donderdag");
  expect(w.peak?.index).toBe(3);
  expect(w.peak?.pctVsAverage).toBeGreaterThan(0);

  // A weekday that occurred but was never spent on is genuinely 0 — measured.
  expect(by.wo.occurrences).toBe(9);
  expect(by.wo.average).toBe(0);
});

test("weekdaySpend leaves an unobserved weekday null, never zero", () => {
  // Two days of history: only Friday and Saturday ever occurred.
  const w = weekdaySpend(freshTxs, rules, own, presetWindow("12m", "2026-08-15"));
  expect(w.spanDays).toBe(2);
  expect(w.spanDays).toBeLessThan(MIN_WEEKDAY_DAYS);
  const by = Object.fromEntries(w.rows.map((r) => [r.short, r]));
  expect(by.vr.occurrences).toBe(1);
  expect(by.vr.average).toBeCloseTo(20, 6);
  expect(by.za.average).toBeCloseTo(30, 6);
  // Monday never happened inside the window — unknown, not free.
  expect(by.ma.occurrences).toBe(0);
  expect(by.ma.average).toBeNull();
});

test("weekdaySpend reports nothing at all rather than a flat week with no data", () => {
  const w = weekdaySpend([], rules, own, YEAR);
  expect(w.spanDays).toBe(0);
  expect(w.peak).toBeNull();
  expect(w.dayAverage).toBeNull();
  expect(w.rows.every((r) => r.average === null)).toBe(true);
});

/* ─────────────────── item 1: the donut said € 2 miljoen ───────────────────
 *
 * Measured before anything was changed (20 August): with two deposits into his
 * own savings/broker accounts in the window, "Sparen & beleggen" took 98% of the
 * ring and the period's "uitgaven" read € 20.335 on € 335 of actual spending.
 *
 * The rows below are that measurement, kept as a test. They are deliberately
 * local rather than from `fixtures`: the case only exists when an own savings or
 * investment account was NEVER IMPORTED, so `ownAccounts` cannot know its IBAN
 * and "Eigen overboeking" can never fire on it. All the app ever sees is the
 * category. */
const AUG = { start: "2026-08-01", end: "2026-08-31" };
const JUL = { start: "2026-07-01", end: "2026-07-31" };

const parkTx = (id: string, date: string, amount: number, counterparty: string, description = ""): Tx => ({
  id, accountKey: "A1", date, amount, currency: "EUR", counterparty, description, category: "", manual: false,
});

/** A realistic month: income, two real expenses, a transfer to an account the
 *  app DOES know (A2's IBAN, so "Eigen overboeking"), and two deposits into
 *  accounts it does not. */
const parked: Tx[] = [
  parkTx("p1", "2026-08-01", 6_000, "Klant BV", "Managementfee"),
  parkTx("p2", "2026-08-03", -85.4, "Albert Heijn", "Boodschappen"),
  parkTx("p3", "2026-08-05", -250, "Vattenfall", "Energie augustus"),
  parkTx("p4", "2026-08-06", -15_000, "Trading 212", "Storting"),
  parkTx("p5", "2026-08-07", -5_000, "Spaarrekening", "Naar spaarrekening"),
  parkTx("p6", "2026-08-08", -1_000, "NL02RABO0001", "Naar Café BV"),
  // Money coming BACK out of the broker is not income either.
  parkTx("p7", "2026-08-09", 2_000, "Trading 212", "Opname"),
];

test("money parked in your own savings is not spending — it is the same euro elsewhere", () => {
  const share = categoryShare(parked, [], own, AUG);
  // The ring holds what was actually spent, and nothing else.
  expect(share.slices.map((s) => s.category)).toEqual(["Wonen & energie", "Boodschappen"]);
  expect(share.totalCents).toBe(25_000 + 8_540);
  // Both moved categories are gone from the ring, in both directions.
  expect(share.slices.map((s) => s.category)).not.toContain("Sparen & beleggen");
  expect(share.slices.map((s) => s.category)).not.toContain("Eigen overboeking");
});

test("what fell outside the diagram is reported, per category, with the reason", () => {
  const moved = movedTotals(parked, [], own, AUG);
  // Biggest first, so the € 20.000 line is the one he reads.
  expect(moved.map((m) => m.category)).toEqual(["Sparen & beleggen", "Eigen overboeking"]);
  expect(moved[0].outCents).toBe(2_000_000);
  expect(moved[0].inCents).toBe(200_000);
  expect(moved[0].why).toContain("spaar");
  expect(moved[1].outCents).toBe(100_000);
  expect(moved[1].inCents).toBe(0);
  // A window with nothing moved in it reports nothing — never a zero row.
  expect(movedTotals(parked, [], own, JUL)).toEqual([]);
});

test("the window's own totals leave the moved money out of BOTH sides", () => {
  const t = windowTotals(parked, [], own, AUG);
  expect(t.outTotal).toBeCloseTo(85.4 + 250, 6);
  expect(t.inTotal).toBeCloseTo(6_000, 6);
});

test("neither the bars nor the growth view counts a savings deposit as spending", () => {
  const per = categoryPerWindow(parked, [], own, AUG, 4);
  expect(per.categories).not.toContain("Sparen & beleggen");
  expect(per.categories).not.toContain("Eigen overboeking");

  const grown = categoryGrowth(parked, [], own, AUG);
  expect(grown.rows.map((r) => r.category)).not.toContain("Sparen & beleggen");
  expect(grown.rows.map((r) => r.category)).not.toContain("Eigen overboeking");
});

test("a weekday average is not made expensive by a savings deposit landing on it", () => {
  // 6 August 2026 is a Thursday; the € 15.000 to Trading 212 is on it.
  const w = weekdaySpend(parked, [], own, { start: "2026-08-01", end: "2026-08-28" });
  const thursday = w.rows[3];
  expect(thursday.total).toBe(0);
});
