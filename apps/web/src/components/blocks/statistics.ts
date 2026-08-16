import type { OwnAccounts, Rule, Tx } from "@lavega/core";
import { categorize } from "@lavega/core";
import { daysBetween, shiftMonth, weekdayIndex, WEEKDAYS_NL, WEEKDAYS_SHORT_NL } from "./dates.js";

/* The two questions the Statistieken block answers, as pure derivations.
 *
 *   1. categoryPerMonth — grouped bars, one group per month, one bar per major
 *      category. This is "verandering per categorie" generalised: instead of
 *      two windows side by side it shows the whole run, which is the same
 *      question ("is this category going up?") answered better.
 *   2. weekdaySpend — what a given weekday costs on average. The insight
 *      Alexander asked for is "Friday nights are expensive, and I want to know
 *      that BEFORE Friday", so the figure has to be an AVERAGE per occurrence
 *      of that weekday, not a total: a total makes whichever weekday happened
 *      most often in the window look like the expensive one.
 *
 * Both window on the newest transaction in the data, never on the clock — an
 * imported historical statement then charts itself instead of showing an empty
 * "this month". Same rule category-trend.ts and core's categoryComparison use.
 *
 * Nothing here reads Date.now(); nothing here invents a figure it did not
 * measure. A weekday the window never contained has `average: null`, not 0. */

/** Transfers between the owner's own accounts are not spending. */
const TRANSFER_CATEGORY = "Eigen overboeking";

/** A weekday pattern needs at least this much history to mean anything: with
 *  one week of data every "average" is a single observation. */
export const MIN_WEEKDAY_DAYS = 14;

const monthOf = (date: string): string => date.slice(0, 7);

/** Spend transactions only, own-transfers removed, already categorised. */
function spendRows(txs: Tx[], rules: Rule[], own: OwnAccounts | undefined) {
  const rows: { date: string; category: string; spend: number }[] = [];
  for (const t of txs) {
    if (t.amount >= 0) continue;
    if (!t.date) continue;
    const category = categorize(t, rules, own);
    if (category === TRANSFER_CATEGORY) continue;
    rows.push({ date: t.date, category, spend: -t.amount });
  }
  return rows;
}

export type CategoryPerMonth = {
  /** "YYYY-MM", oldest first. */
  months: string[];
  /** The major categories, biggest total spend in the window first. */
  categories: string[];
  /** values[monthIndex][categoryIndex], positive euros. */
  values: number[][];
  /** Categories that were dropped because the chart only shows the majors. */
  otherCount: number;
};

/** Spend per category per month over the last `monthCount` months (or all of
 *  them), keeping the `topN` biggest categories. */
export function categoryPerMonth(
  txs: Tx[],
  rules: Rule[],
  own: OwnAccounts | undefined,
  monthCount: number | "alle",
  topN: number,
): CategoryPerMonth {
  const empty: CategoryPerMonth = { months: [], categories: [], values: [], otherCount: 0 };
  const rows = spendRows(txs, rules, own);
  if (rows.length === 0) return empty;

  const end = rows.reduce((a, r) => (r.date > a ? r.date : a), rows[0].date).slice(0, 7);
  const first = rows.reduce((a, r) => (r.date < a ? r.date : a), rows[0].date).slice(0, 7);
  // The window never reaches back past the data. A "12 maanden" period on three
  // months of history would otherwise draw nine empty groups, and an empty
  // group is a bar of zero — i.e. a claim that nothing was spent in a month we
  // simply have no statement for. Clamp instead.
  const available = monthsBetween(first, end) + 1;
  const span = monthCount === "alle" ? available : Math.min(monthCount, available);
  const months = Array.from({ length: span }, (_, i) => shiftMonth(end, span - 1 - i));
  const inWindow = new Set(months);

  const totals = new Map<string, number>();
  const grid = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = monthOf(r.date);
    if (!inWindow.has(m)) continue;
    totals.set(r.category, (totals.get(r.category) ?? 0) + r.spend);
    const row = grid.get(m) ?? new Map<string, number>();
    row.set(r.category, (row.get(r.category) ?? 0) + r.spend);
    grid.set(m, row);
  }
  if (totals.size === 0) return empty;

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const categories = ranked.slice(0, topN);
  return {
    months,
    categories,
    values: months.map((m) => categories.map((c) => grid.get(m)?.get(c) ?? 0)),
    otherCount: Math.max(0, ranked.length - categories.length),
  };
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export type WeekdayRow = {
  /** "Maandag" … "Zondag". */
  label: string;
  short: string;
  /** Total spend on that weekday inside the window, positive euros. */
  total: number;
  /** How many times that weekday occurred in the window — including the ones
   *  with no transaction at all, which is what keeps the average honest. */
  occurrences: number;
  /** total / occurrences, or null when the window never contained this
   *  weekday. Never 0: "we never saw a Sunday" is not "Sundays are free". */
  average: number | null;
};

export type WeekdaySpend = {
  rows: WeekdayRow[];
  /** Days from the first to the last day of the window, inclusive. */
  spanDays: number;
  /** Mean of the known weekday averages — "what a normal day costs". */
  dayAverage: number | null;
  /** The most expensive weekday, and how far above a normal day it sits. */
  peak: { label: string; index: number; average: number; pctVsAverage: number | null } | null;
};

/** What each weekday costs on average over the last `monthCount` months. */
export function weekdaySpend(
  txs: Tx[],
  rules: Rule[],
  own: OwnAccounts | undefined,
  monthCount: number | "alle",
): WeekdaySpend {
  const blank: WeekdaySpend = {
    rows: WEEKDAYS_NL.map((label, i) => ({
      label,
      short: WEEKDAYS_SHORT_NL[i],
      total: 0,
      occurrences: 0,
      average: null,
    })),
    spanDays: 0,
    dayAverage: null,
    peak: null,
  };

  const rows = spendRows(txs, rules, own);
  if (rows.length === 0) return blank;

  const last = rows.reduce((a, r) => (r.date > a ? r.date : a), rows[0].date);
  const firstSeen = rows.reduce((a, r) => (r.date < a ? r.date : a), rows[0].date);
  const endMonth = last.slice(0, 7);
  const startMonth =
    monthCount === "alle" ? firstSeen.slice(0, 7) : shiftMonth(endMonth, monthCount - 1);
  // The window runs from the first day of its first month to the newest
  // transaction — the period we can actually claim to have observed.
  const start = startMonth <= firstSeen.slice(0, 7) ? firstSeen : `${startMonth}-01`;
  const spanDays = daysBetween(start, last) + 1;

  const totals = new Array(7).fill(0);
  for (const r of rows) {
    if (r.date < start || r.date > last) continue;
    totals[weekdayIndex(r.date)] += r.spend;
  }

  // Count every calendar occurrence in the window, transaction or not.
  const occurrences = new Array(7).fill(0);
  const startWd = weekdayIndex(start);
  for (let i = 0; i < spanDays; i++) occurrences[(startWd + i) % 7]++;

  const out: WeekdayRow[] = WEEKDAYS_NL.map((label, i) => ({
    label,
    short: WEEKDAYS_SHORT_NL[i],
    total: totals[i],
    occurrences: occurrences[i],
    average: occurrences[i] === 0 ? null : totals[i] / occurrences[i],
  }));

  const known = out.filter((r) => r.average !== null) as (WeekdayRow & { average: number })[];
  if (known.length === 0) return { ...blank, rows: out, spanDays };

  const dayAverage = known.reduce((s, r) => s + r.average, 0) / known.length;
  const top = known.reduce((best, r) => (r.average > best.average ? r : best), known[0]);
  const peak =
    top.average === 0
      ? null
      : {
          label: top.label,
          index: out.indexOf(top),
          average: top.average,
          pctVsAverage: dayAverage === 0 ? null : ((top.average - dayAverage) / dayAverage) * 100,
        };

  return { rows: out, spanDays, dayAverage, peak };
}
