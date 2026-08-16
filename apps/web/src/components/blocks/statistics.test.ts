import { expect, test } from "vitest";
import { categorize } from "@lavega/core";
import { categoryPerMonth, MIN_WEEKDAY_DAYS, weekdaySpend } from "./statistics";
import { freshTxs, own, rules, txs } from "./fixtures";

const DEFAULT_CATEGORY = categorize(txs[1], rules, own); // Albert Heijn, via the Dutch defaults

test("categoryPerMonth returns one column per month and one bar per major category", () => {
  const s = categoryPerMonth(txs, rules, own, 12, 4);
  expect(s.months).toEqual(["2026-06", "2026-07", "2026-08"]);
  // Ranked by total spend in the window: Inkoop 2.980, boodschappen 420,50, Energie 250.
  expect(s.categories).toEqual(["Inkoop", DEFAULT_CATEGORY, "Energie"]);
  expect(s.values).toEqual([
    [0, 420.5, 0],
    [1_880, 0, 0],
    [1_100, 0, 250],
  ]);
  expect(s.otherCount).toBe(0);
});

test("categoryPerMonth clamps a long period to the months there is data for", () => {
  // Twelve months requested, three months held: nine extra groups would each be
  // a bar of zero, which claims a month of no spending that was never observed.
  expect(categoryPerMonth(txs, rules, own, 12, 4).months).toHaveLength(3);
  expect(categoryPerMonth(txs, rules, own, "alle", 4).months).toHaveLength(3);
  expect(categoryPerMonth(txs, rules, own, 2, 4).months).toEqual(["2026-07", "2026-08"]);
});

test("categoryPerMonth counts how many categories it left out", () => {
  const s = categoryPerMonth(txs, rules, own, 12, 1);
  expect(s.categories).toEqual(["Inkoop"]);
  expect(s.otherCount).toBe(2);
});

test("categoryPerMonth is empty rather than zeroed with nothing to chart", () => {
  const s = categoryPerMonth([], rules, own, 12, 4);
  expect(s).toEqual({ months: [], categories: [], values: [], otherCount: 0 });
});

test("weekdaySpend averages per OCCURRENCE of the weekday, not per transaction", () => {
  const w = weekdaySpend(txs, rules, own, 12);
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
  const w = weekdaySpend(freshTxs, rules, own, 12);
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
  const w = weekdaySpend([], rules, own, 12);
  expect(w.spanDays).toBe(0);
  expect(w.peak).toBeNull();
  expect(w.dayAverage).toBeNull();
  expect(w.rows.every((r) => r.average === null)).toBe(true);
});
