import type { CategorySelection, OwnAccounts, Rule, Tx } from "@lavega/core";
import { categorize, selectMajorCategories } from "@lavega/core";
import {
  dayLabelNL,
  daysBetween,
  mondayOf,
  monthFirstDay,
  monthLastDay,
  shiftDate,
  shiftMonth,
  weekdayIndex,
  WEEKDAYS_NL,
  WEEKDAYS_SHORT_NL,
} from "./dates.js";
import { monthLabelNL, monthShortNL } from "../../format.js";

/* The two questions the Statistieken block answers, as pure derivations, over
 * an explicit WINDOW.
 *
 *   1. categoryPerWindow — grouped bars, one group per bucket (day, week or
 *      month, chosen by how long the window is), one bar per major category.
 *      This is "verandering per categorie" generalised: instead of two windows
 *      side by side it shows the whole run.
 *   2. weekdaySpend — what a given weekday costs on average. The insight
 *      Alexander asked for is "Friday nights are expensive, and I want to know
 *      that BEFORE Friday", so the figure has to be an AVERAGE per occurrence
 *      of that weekday, not a total: a total makes whichever weekday happened
 *      most often in the window look like the expensive one.
 *
 * The window is a real date range — `{ start, end }` — because the period
 * filter now offers 1 week alongside the month presets and a hand-picked
 * range. A preset is resolved into the same shape (presetWindow), so nothing
 * downstream knows or cares which of the two it was: "aangepast" is a range,
 * not a preset wearing a costume.
 *
 * Three rules keep the charts from claiming things they did not measure:
 *
 *   - The window is CLAMPED to the span the transactions actually cover
 *     (`covered`). A bucket past the newest statement is not a bucket in which
 *     nothing was spent, it is a bucket we know nothing about.
 *   - A bucket the window only partly covers is marked `partial`, so a half
 *     month is never read as a whole one.
 *   - WHICH categories are big enough to draw is core's call
 *     (`selectMajorCategories`), against a floor that scales with the window.
 *     Nothing here invents a threshold: a fixed one hides €30-a-month against a
 *     year and keeps it against a month, which is the complaint that started
 *     this round.
 *
 * Both window on the transactions, never on the clock — an imported historical
 * statement then charts itself instead of showing an empty "this month".
 * Nothing here reads Date.now(); nothing here invents a figure it did not
 * measure. A weekday the window never contained has `average: null`, not 0. */

/** Transfers between the owner's own accounts are not spending. */
const TRANSFER_CATEGORY = "Eigen overboeking";

/** A weekday pattern needs at least this much history to mean anything: with
 *  one week of data every "average" is a single observation. */
export const MIN_WEEKDAY_DAYS = 14;

/** An inclusive date range, "YYYY-MM-DD" at both ends. */
export type StatWindow = { start: string; end: string };

/** The fixed choices in the period filter. "aangepast" is not here: it is a
 *  range the owner types, and it arrives as a StatWindow. */
export type StatPreset = "1w" | "1m" | "3m" | "6m" | "12m";

/** Newest transaction date in the data, or null when there is none. Every
 *  preset window ends here rather than "today": the data is the clock. */
export function newestTxDate(txs: Tx[]): string | null {
  let newest: string | null = null;
  for (const t of txs) {
    if (!t.date) continue;
    if (newest === null || t.date > newest) newest = t.date;
  }
  return newest;
}

/** Resolve a preset against the newest transaction date.
 *
 *  The two short presets are rolling day-windows — "1 week" is the last seven
 *  days and "1 maand" the last thirty, which is what those words mean when you
 *  ask them on the 11th of a month. They are drawn in day and week buckets, so
 *  no calendar month is ever cut in half by them.
 *
 *  The longer presets snap to whole calendar months — "3 maanden" means June,
 *  July and (so far) August, which is exactly how the axis labels them; a
 *  rolling 92-day window would put two half-Junes on one bar.
 *
 *  Either way the block prints the resolved range in words, so "1 maand" is
 *  never left to be guessed at. */
export function presetWindow(preset: StatPreset, end: string): StatWindow {
  if (preset === "1w") return { start: shiftDate(end, -6), end };
  if (preset === "1m") return { start: shiftDate(end, -29), end };
  const months = Number(preset.slice(0, -1));
  return { start: monthFirstDay(shiftMonth(end.slice(0, 7), months - 1)), end };
}

export type StatBucketUnit = "dag" | "week" | "maand";

/** Up to this many days the bars are per day; up to this many, per week. */
export const DAY_BUCKET_MAX = 14;
export const WEEK_BUCKET_MAX = 62;

/** How long a bucket is, given the window. One week of daily bars, one month
 *  of weekly bars, anything longer per month — so the chart always has enough
 *  groups to compare and few enough to read. */
export function bucketUnit(window: StatWindow): StatBucketUnit {
  const days = daysBetween(window.start, window.end) + 1;
  if (days <= DAY_BUCKET_MAX) return "dag";
  if (days <= WEEK_BUCKET_MAX) return "week";
  return "maand";
}

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

/** The part of `window` the transactions actually cover, or null when they
 *  cover none of it. Clamping to the observed span is what stops the chart
 *  drawing bars of zero for months no statement was ever imported for. */
function coveredWindow(dates: string[], window: StatWindow): StatWindow | null {
  if (dates.length === 0) return null;
  let first = dates[0];
  let last = dates[0];
  for (const d of dates) {
    if (d < first) first = d;
    if (d > last) last = d;
  }
  const start = window.start > first ? window.start : first;
  const end = window.end < last ? window.end : last;
  return start > end ? null : { start, end };
}

export type StatBucket = {
  /** Unique per bucket — CategoryBars keys its groups by the label, so the
   *  label has to be unique too; this is what it is derived from. */
  key: string;
  /** Short axis label. */
  label: string;
  /** The full name for the tooltip, including "only part of this month". */
  title: string;
  start: string;
  end: string;
  /** The window cuts this bucket short: a clipped month is not a month. */
  partial: boolean;
  /** Whether any spending was recorded in it at all. */
  hasData: boolean;
};

export type CategoryWindow = {
  /** The window as asked for. */
  window: StatWindow;
  /** The part of it the data covers, or null when nothing does. */
  covered: StatWindow | null;
  unit: StatBucketUnit;
  buckets: StatBucket[];
  /** The major categories, biggest total spend in the window first. */
  categories: string[];
  /** values[bucketIndex][categoryIndex], positive euros. */
  values: number[][];
  /** Core's split of this window's categories into shown and folded-away, with
   *  the floor it applied. The floor is a RATE (per 30 days) scaled to the
   *  window, which is what makes the cut-off per-timeframe: €30 a month is 6%
   *  of a month and half a percent of a year, and a fixed floor would hide it
   *  in one and keep it in the other. `null` when the window holds no spend. */
  selection: CategorySelection | null;
  /** Days the ranking was made over — the window core scaled its floor to. */
  windowDays: number;
};

/** "aug" inside a year, "aug '25" once the window is longer than twelve months
 *  — both so the label stays short and so it stays UNIQUE. */
export function monthAxisLabel(month: string, windowLength: number): string {
  return windowLength > 12 ? `${monthShortNL(month)} '${month.slice(2, 4)}` : monthShortNL(month);
}

/** The buckets covering `covered`, clipped at both ends. */
function buildBuckets(covered: StatWindow, unit: StatBucketUnit): Omit<StatBucket, "hasData">[] {
  const clip = (start: string, end: string) => ({
    start: start < covered.start ? covered.start : start,
    end: end > covered.end ? covered.end : end,
  });

  if (unit === "dag") {
    const out: Omit<StatBucket, "hasData">[] = [];
    for (let d = covered.start; d <= covered.end; d = shiftDate(d, 1)) {
      out.push({
        key: d,
        label: dayLabelNL(d),
        title: `${WEEKDAYS_NL[weekdayIndex(d)]} ${dayLabelNL(d)}`,
        start: d,
        end: d,
        // A single day is never "part of" itself.
        partial: false,
      });
    }
    return out;
  }

  if (unit === "week") {
    const out: Omit<StatBucket, "hasData">[] = [];
    for (let w = mondayOf(covered.start); w <= covered.end; w = shiftDate(w, 7)) {
      const full = { start: w, end: shiftDate(w, 6) };
      const { start, end } = clip(full.start, full.end);
      const partial = start !== full.start || end !== full.end;
      out.push({
        key: w,
        label: dayLabelNL(start),
        title: partial
          ? `Week van ${dayLabelNL(full.start)} — alleen ${dayLabelNL(start)} t/m ${dayLabelNL(end)}`
          : `Week van ${dayLabelNL(full.start)}`,
        start,
        end,
        partial,
      });
    }
    return out;
  }

  const months: string[] = [];
  for (let m = monthOf(covered.start); m <= monthOf(covered.end); m = shiftMonth(m, -1)) months.push(m);
  return months.map((m) => {
    const full = { start: monthFirstDay(m), end: monthLastDay(m) };
    const { start, end } = clip(full.start, full.end);
    const partial = start !== full.start || end !== full.end;
    return {
      key: m,
      label: monthAxisLabel(m, months.length),
      title: partial
        ? `${monthLabelNL(m)} — alleen ${dayLabelNL(start)} t/m ${dayLabelNL(end)}`
        : monthLabelNL(m),
      start,
      end,
      partial,
    };
  });
}

/** Which bucket a date falls in. The buckets are contiguous and ordered, so
 *  this is arithmetic rather than a search. */
function bucketIndexOf(date: string, buckets: Omit<StatBucket, "hasData">[], unit: StatBucketUnit): number {
  if (buckets.length === 0) return -1;
  if (unit === "dag") return daysBetween(buckets[0].start, date);
  if (unit === "week") return Math.floor(daysBetween(buckets[0].key, date) / 7);
  const [fy, fm] = buckets[0].key.split("-").map(Number);
  const [y, m] = monthOf(date).split("-").map(Number);
  return (y - fy) * 12 + (m - fm);
}

/** Spend per category per bucket over `window`. Which categories are major
 *  enough to draw is core's call (`selectMajorCategories`), against a floor
 *  scaled to THIS window — `maxShown` is only the chart's cap. */
export function categoryPerWindow(
  txs: Tx[],
  rules: Rule[],
  own: OwnAccounts | undefined,
  window: StatWindow,
  maxShown: number,
): CategoryWindow {
  const unit = bucketUnit(window);
  const empty: CategoryWindow = {
    window,
    covered: null,
    unit,
    buckets: [],
    categories: [],
    values: [],
    selection: null,
    windowDays: 0,
  };

  const all = spendRows(txs, rules, own);
  const covered = coveredWindow(
    all.map((r) => r.date),
    window,
  );
  if (covered === null) return empty;

  const rows = all.filter((r) => r.date >= covered.start && r.date <= covered.end);
  if (rows.length === 0) return { ...empty, covered };

  const skeleton = buildBuckets(covered, unit);
  const totals = new Map<string, number>();
  const grid = skeleton.map(() => new Map<string, number>());
  const touched = skeleton.map(() => false);
  for (const r of rows) {
    const i = bucketIndexOf(r.date, skeleton, unit);
    if (i < 0 || i >= skeleton.length) continue;
    totals.set(r.category, (totals.get(r.category) ?? 0) + r.spend);
    grid[i].set(r.category, (grid[i].get(r.category) ?? 0) + r.spend);
    touched[i] = true;
  }

  const windowDays = daysBetween(covered.start, covered.end) + 1;
  const selection = selectMajorCategories(totals, { windowDays, maxShown });
  const categories = selection.shown.map((s) => s.category);
  return {
    window,
    covered,
    unit,
    buckets: skeleton.map((b, i) => ({ ...b, hasData: touched[i] })),
    categories,
    values: grid.map((row) => categories.map((c) => row.get(c) ?? 0)),
    selection,
    windowDays,
  };
}

export type WindowTotals = {
  /** Money in and money out over the window, positive euros. Own transfers are
   *  left out of both: moving money between your own accounts is neither. */
  inTotal: number;
  outTotal: number;
  /** The part of the window the data covers — null when nothing does. */
  covered: StatWindow | null;
};

/** What came in and what went out inside `window`. Totals, not per-month
 *  averages: with a window as short as a week, a "per maand" figure would be
 *  an extrapolation, and an extrapolation is not a measurement. */
export function windowTotals(
  txs: Tx[],
  rules: Rule[],
  own: OwnAccounts | undefined,
  window: StatWindow,
): WindowTotals {
  const dated = txs.filter((t) => t.date);
  const covered = coveredWindow(
    dated.map((t) => t.date),
    window,
  );
  let inTotal = 0;
  let outTotal = 0;
  for (const t of dated) {
    if (t.date < window.start || t.date > window.end) continue;
    if (categorize(t, rules, own) === TRANSFER_CATEGORY) continue;
    if (t.amount >= 0) inTotal += t.amount;
    else outTotal += -t.amount;
  }
  return { inTotal, outTotal, covered };
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
  /** Days from the first to the last day of the covered window, inclusive. */
  spanDays: number;
  /** Mean of the known weekday averages — "what a normal day costs". */
  dayAverage: number | null;
  /** The most expensive weekday, and how far above a normal day it sits. */
  peak: { label: string; index: number; average: number; pctVsAverage: number | null } | null;
};

/** What each weekday costs on average inside `window`. */
export function weekdaySpend(
  txs: Tx[],
  rules: Rule[],
  own: OwnAccounts | undefined,
  window: StatWindow,
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

  const all = spendRows(txs, rules, own);
  const covered = coveredWindow(
    all.map((r) => r.date),
    window,
  );
  if (covered === null) return blank;

  const spanDays = daysBetween(covered.start, covered.end) + 1;

  const totals = new Array(7).fill(0);
  for (const r of all) {
    if (r.date < covered.start || r.date > covered.end) continue;
    totals[weekdayIndex(r.date)] += r.spend;
  }

  // Count every calendar occurrence in the window, transaction or not.
  const occurrences = new Array(7).fill(0);
  const startWd = weekdayIndex(covered.start);
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
