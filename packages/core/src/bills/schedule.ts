import { DateTime } from "effect";
import type { Bill, BillOccurrencePair, BillRule } from "./model.js";
import { LAST_DAY, billRules } from "./model.js";

/**
 * The schedule engine: every date a series produces, from its recurrence rules.
 *
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 * Sure source: `app/models/recurring_transaction/schedule.rb`.
 *
 * Sure stores outflow positive; this module stores no amount at all (ADR 0011).
 * All maths is on ISO calendar dates through Effect `DateTime` in UTC, so no
 * DST shift can move an occurrence and no clock is read: `asOf` is always a
 * caller argument.
 */

/** Sure's `SEARCH_CAP_DAYS`: weekend "skip" can drop consecutive occurrences,
 *  so the search loops, but boundedly (ten years). */
export const SEARCH_CAP_DAYS = 366 * 10;

/** Sure's `WEEKEND_MARGIN`: an adjusted date moves at most two days, so a raw
 *  generation window is padded by three and adjusted dates cannot escape it. */
export const WEEKEND_MARGIN = 3;

const DAY_MS = 86_400_000;

type Utc = DateTime.Utc;

const parse = (iso: string): Utc => DateTime.makeUnsafe(iso.slice(0, 10)) as Utc;
const format = (d: DateTime.DateTime): string => DateTime.formatIso(d).slice(0, 10);

/** ISO date plus (or minus) whole days. */
export function addDays(iso: string, days: number): string {
  return format(DateTime.add(parse(iso), { days }));
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function billDaysBetween(from: string, to: string): number {
  return Math.round(
    (DateTime.toEpochMillis(parse(to)) - DateTime.toEpochMillis(parse(from))) / DAY_MS,
  );
}

/** 0 = Sunday … 6 = Saturday, the numbering Sure and its schemas use. */
export function dayOfWeek(iso: string): number {
  return DateTime.toParts(parse(iso)).weekDay;
}

export function dayOfMonth(iso: string): number {
  return DateTime.toParts(parse(iso)).day;
}

export function monthOfYear(iso: string): number {
  return DateTime.toParts(parse(iso)).month;
}

export function yearOf(iso: string): number {
  return DateTime.toParts(parse(iso)).year;
}

/** Last calendar day of the month that `iso` falls in. */
export function billLastDayOfMonth(iso: string): string {
  const { year, month } = DateTime.toParts(parse(iso));
  const nextMonth =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return addDays(nextMonth, -1);
}

/** Day `day` clamped into the month that `iso` falls in (Feb 31 -> Feb 28/29). */
function clampIntoMonth(iso: string, day: number): string {
  const last = Number(billLastDayOfMonth(iso).slice(8, 10));
  return `${iso.slice(0, 7)}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** True when `iso` is a real calendar date. */
export function isIsoDay(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return format(parse(iso)) === iso;
}

/** Average occurrences per year across every rule. Sure turns this into a
 *  monthly-equivalent amount; here it also sizes the search window. */
export function occurrencesPerYear(bill: Pick<Bill, "rules" | "anchorDate">): number {
  return billRules(bill).reduce((sum, rule) => {
    switch (rule.frequency) {
      case "weekly":
        return sum + 365.25 / (7 * rule.interval);
      case "monthly":
        return sum + 12 / rule.interval;
      case "yearly":
        return sum + 1 / rule.interval;
    }
  }, 0);
}

/** Longer than the longest possible gap between two occurrences, padded. */
function longestPeriodDays(bill: Pick<Bill, "rules" | "anchorDate">): number {
  const longest = billRules(bill).reduce((max, rule) => {
    const days =
      rule.frequency === "weekly"
        ? 7 * rule.interval
        : rule.frequency === "monthly"
          ? 31 * rule.interval
          : 366 * rule.interval;
    return Math.max(max, days);
  }, 0);
  return longest + 40;
}

/** The rule's day within a month: a day-of-month (clamped, `LAST_DAY` = end of
 *  month) or an nth weekday. Returns null when the month has no such nth
 *  weekday (a 5th Friday), which skips that month. */
function dateInMonth(rule: BillRule, year: number, month: number): string | null {
  const monthStart = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  if (rule.dayOfMonth != null) {
    if (rule.dayOfMonth === LAST_DAY) return billLastDayOfMonth(monthStart);
    return clampIntoMonth(monthStart, rule.dayOfMonth);
  }
  const weekday = rule.weekday;
  if (weekday == null) return null;
  const ordinal = rule.weekdayOrdinal ?? 1;
  if (ordinal === LAST_DAY) {
    const last = billLastDayOfMonth(monthStart);
    return addDays(last, -mod(dayOfWeek(last) - weekday, 7));
  }
  const first = addDays(monthStart, mod(weekday - dayOfWeek(monthStart), 7));
  const candidate = addDays(first, 7 * (ordinal - 1));
  return candidate.slice(0, 7) === monthStart.slice(0, 7) ? candidate : null;
}

function weeklyOccurrences(
  rule: BillRule,
  anchorDate: string,
  start: string,
  end: string,
): string[] {
  const weekday = rule.weekday ?? dayOfWeek(anchorDate);
  const step = 7 * rule.interval;
  const base = addDays(anchorDate, mod(weekday - dayOfWeek(anchorDate), 7));
  const firstStep = Math.ceil(billDaysBetween(base, start) / step);
  const out: string[] = [];
  for (
    let cursor = addDays(base, firstStep * step);
    cursor <= end;
    cursor = addDays(cursor, step)
  ) {
    out.push(cursor);
  }
  return out;
}

const monthIndex = (year: number, month: number): number => year * 12 + month;

function monthlyOccurrences(
  rule: BillRule,
  anchorDate: string,
  start: string,
  end: string,
): string[] {
  const reference = monthIndex(yearOf(anchorDate), monthOfYear(anchorDate));
  const out: string[] = [];
  let { year, month } = DateTime.toParts(parse(start));
  while (monthIndex(year, month) <= monthIndex(yearOf(end), monthOfYear(end))) {
    if (mod(monthIndex(year, month) - reference, rule.interval) === 0) {
      const date = dateInMonth(rule, year, month);
      if (date != null && date >= start && date <= end) out.push(date);
    }
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

function yearlyOccurrences(
  rule: BillRule,
  anchorDate: string,
  start: string,
  end: string,
): string[] {
  const referenceYear = yearOf(anchorDate);
  const month = rule.monthOfYear ?? monthOfYear(anchorDate);
  const out: string[] = [];
  for (let year = yearOf(start); year <= yearOf(end); year += 1) {
    if (mod(year - referenceYear, rule.interval) !== 0) continue;
    const date = dateInMonth(rule, year, month);
    if (date != null && date >= start && date <= end) out.push(date);
  }
  return out;
}

function rawOccurrences(rule: BillRule, anchorDate: string, start: string, end: string): string[] {
  switch (rule.frequency) {
    case "weekly":
      return weeklyOccurrences(rule, anchorDate, start, end);
    case "monthly":
      return monthlyOccurrences(rule, anchorDate, start, end);
    case "yearly":
      return yearlyOccurrences(rule, anchorDate, start, end);
  }
}

/** Sure's `adjust_for_weekend`: null means "skip this occurrence entirely". */
function adjustForWeekend(iso: string, adjust: Bill["weekendAdjust"]): string | null {
  const weekday = dayOfWeek(iso);
  if (weekday !== 0 && weekday !== 6) return iso;
  switch (adjust) {
    case "skip":
      return null;
    case "before":
      return addDays(iso, weekday === 6 ? -1 : -2);
    case "after":
      return addDays(iso, weekday === 6 ? 2 : 1);
    default:
      return iso;
  }
}

function pastEndOn(bill: Bill, dueOn: string): boolean {
  return bill.endMode === "on_date" && bill.endOn != null && dueOn > bill.endOn;
}

/** Every occurrence of the current rules with a due date in [start, end],
 *  weekend-adjusted, end-truncated, sorted and deduplicated. The raw scheduled
 *  date travels beside the due date: it is the occurrence's identity. */
export function occurrencePairsBetween(
  bill: Bill,
  start: string,
  end: string,
): BillOccurrencePair[] {
  if (start > end) return [];
  if (bill.endMode === "after_count") {
    return lifetimePairs(bill, end).filter((p) => p.dueOn >= start && p.dueOn <= end);
  }
  return adjustedPairs(bill, start, end);
}

/** The due dates only, the shape most callers want. */
export function occurrencesBetween(bill: Bill, start: string, end: string): string[] {
  return [...new Set(occurrencePairsBetween(bill, start, end).map((p) => p.dueOn))].sort();
}

function adjustedPairs(bill: Bill, start: string, end: string): BillOccurrencePair[] {
  const raw = billRules(bill).flatMap((rule) =>
    rawOccurrences(
      rule,
      bill.anchorDate,
      addDays(start, -WEEKEND_MARGIN),
      addDays(end, WEEKEND_MARGIN),
    ),
  );
  const out: BillOccurrencePair[] = [];
  for (const original of [...new Set(raw)].sort()) {
    const dueOn = adjustForWeekend(original, bill.weekendAdjust);
    if (dueOn == null) continue;
    if (dueOn < start || dueOn > end) continue;
    if (pastEndOn(bill, dueOn)) continue;
    out.push({ originalDueOn: original, dueOn });
  }
  return out;
}

/** The series' first `endAfterCount` occurrences, counted from the anchor, up
 *  to `through`. Membership keys on the raw scheduled date so an occurrence
 *  moved earlier by weekend "before" still counts as the first one. */
function lifetimePairs(bill: Bill, through: string): BillOccurrencePair[] {
  const anchor = bill.anchorDate;
  const pairs = adjustedPairs(
    bill,
    addDays(anchor, -WEEKEND_MARGIN),
    through > anchor ? through : anchor,
  );
  return pairs.filter((p) => p.originalDueOn >= anchor).slice(0, bill.endAfterCount ?? 0);
}

/** True once the series can produce no occurrence on or after `date`. */
function endedBefore(bill: Bill, date: string): boolean {
  if (bill.endMode === "on_date") return bill.endOn != null && bill.endOn < date;
  if (bill.endMode === "after_count") {
    return lifetimePairs(bill, date).length >= (bill.endAfterCount ?? 0);
  }
  return false;
}

/** First due date strictly after `date`, or null once the series has ended.
 *  The loop steps by the longest period so a yearly rule does not scan days. */
export function firstOccurrenceAfter(bill: Bill, date: string): string | null {
  const window = longestPeriodDays(bill);
  for (let cursor = addDays(date, 1); cursor <= addDays(date, SEARCH_CAP_DAYS);) {
    const found = occurrencesBetween(bill, cursor, addDays(cursor, window))[0];
    if (found != null) return found;
    if (endedBefore(bill, addDays(cursor, window))) return null;
    cursor = addDays(cursor, window + 1);
  }
  return null;
}

/** Start of the cycle containing `date`: the last occurrence on or before it,
 *  or (before the anchor) the first occurrence. Null for an ended plan whose
 *  last occurrence has already passed. Used by the generator's cycle lookback,
 *  so a bill that came due earlier this month still materializes unpaid. */
export function cycleStartOn(bill: Bill, date: string): string | null {
  const window = longestPeriodDays(bill);
  const lookback = occurrencesBetween(bill, addDays(date, -window * 2), date);
  const last = lookback.length > 0 ? lookback[lookback.length - 1] : null;
  return last ?? firstOccurrenceAfter(bill, addDays(date, -window * 2 - 1));
}

/** How far before an occurrence the view starts calling it "due". */
export const DEFAULT_NOTIFY_DAYS = 3;
/** How long after the due date it stays "due" before it is "overdue". */
export const DEFAULT_GRACE_DAYS = 3;

export type OccurrenceDerivedState = "upcoming" | "due" | "overdue";

/** Sure's `derived_state` for an OPEN occurrence. Closed rows keep their stored
 *  status; the caller decides which one to show. */
export function derivedOccurrenceState(
  dueOn: string,
  asOf: string,
  options: { notifyDays?: number; graceDays?: number } = {},
): OccurrenceDerivedState {
  const notifyDays = options.notifyDays ?? DEFAULT_NOTIFY_DAYS;
  const graceDays = options.graceDays ?? DEFAULT_GRACE_DAYS;
  if (asOf > addDays(dueOn, graceDays)) return "overdue";
  if (asOf >= addDays(dueOn, -notifyDays)) return "due";
  return "upcoming";
}
