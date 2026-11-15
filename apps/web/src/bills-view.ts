import type { Bill, BillOccurrence, BillRule } from "@lavega/core";
import {
  billRules,
  LAST_DAY,
  occurrenceAmountCents,
  derivedOccurrenceState,
  firstOccurrenceAfter,
  occurrencesBetween,
} from "@lavega/core";
import type { Locale } from "./locale.js";
import { monthLabel, weekdayLabel } from "./format.js";
import type { BillsCopy } from "./copy/bills.js";
import { shiftDate, weekdayIndex } from "./components/blocks/dates.js";

/* The bills screen's derivations, pure and clock-free: cadence text, the
 * upcoming rows, the calendar grid and the series rows. `asOf` is always an
 * argument, so the view cannot read the clock and a test can pin a date. */

/** 0 = Sunday (the engine's numbering) -> 0 = Monday (the app's). */
const mondayIndex = (sundayIndex: number): number => (sundayIndex + 6) % 7;

export function weekdayName(locale: Locale, sundayIndex: number): string {
  const name = weekdayLabel(locale, mondayIndex(sundayIndex));
  // Dutch days are common nouns; only the start of a sentence capitalises them.
  return locale === "nl" ? name.toLowerCase() : name;
}

function ordinal(locale: Locale, n: number): string {
  if (locale === "nl") return `${n}e`;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** Human cadence for a series. Covers every shape the bill form can create;
 *  a rule it cannot describe (a hand-written semimonthly pair) falls back to the
 *  frequency names rather than inventing a phrase. */
export function cadenceText(bill: Bill, locale: Locale, c: BillsCopy): string {
  const rules = billRules(bill);
  if (rules.length !== 1) {
    return [...new Set(rules.map((r) => c.frequency[r.frequency]))].join(" · ");
  }
  return ruleText(rules[0], locale, c);
}

function ruleText(rule: BillRule, locale: Locale, c: BillsCopy): string {
  if (rule.frequency === "weekly") {
    const weekday = weekdayName(locale, rule.weekday ?? 1);
    return rule.interval === 1
      ? c.cadence.weekly(weekday)
      : c.cadence.everyWeeks(rule.interval, weekday);
  }
  if (rule.frequency === "yearly") {
    const month = monthLabel(
      locale,
      `2026-${String(rule.monthOfYear ?? 1).padStart(2, "0")}`,
    ).split(" ")[0];
    const day = rule.dayOfMonth === LAST_DAY ? c.cadence.lastDay : String(rule.dayOfMonth ?? 1);
    return c.cadence.yearly(day, month);
  }
  if (rule.weekday != null) {
    const weekday = weekdayName(locale, rule.weekday);
    return rule.weekdayOrdinal === LAST_DAY
      ? c.cadence.lastWeekday(weekday)
      : c.cadence.nthWeekday(ordinal(locale, rule.weekdayOrdinal ?? 1), weekday);
  }
  const day =
    rule.dayOfMonth === LAST_DAY ? c.cadence.lastDay : ordinal(locale, rule.dayOfMonth ?? 1);
  if (rule.interval === 3) return c.cadence.quarterly(day);
  if (rule.interval === 6) return c.cadence.twiceAYear(day);
  if (rule.interval === 1) return c.cadence.monthly(day);
  return c.cadence.everyMonths(rule.interval, day);
}

/** The next occurrence on or after `asOf`, or null when the plan has ended. */
export function nextDueOnOrAfter(bill: Bill, asOf: string): string | null {
  return occurrencesBetween(bill, asOf, asOf)[0] ?? firstOccurrenceAfter(bill, asOf);
}

export type UpcomingRow = {
  occurrence: BillOccurrence;
  bill: Bill;
  /** Magnitude in cents, resolved through the series' amount strategy. */
  amountCents: number;
  /** "out" rows are money to pay; "in" rows are expected income. */
  direction: "in" | "out";
  status: ReturnType<typeof derivedOccurrenceState>;
  past: boolean;
};

/** Open rows up to `horizonDays` ahead, overdue first, then by date. Rows of
 *  paused and ended series are not shown: nobody is paying a paused bill. */
export function upcomingRows(
  bills: readonly Bill[],
  occurrences: readonly BillOccurrence[],
  asOf: string,
  horizonDays = 90,
): UpcomingRow[] {
  const byId = new Map(bills.map((b) => [b.id, b]));
  const horizon = shiftDate(asOf, horizonDays);
  const rows: UpcomingRow[] = [];
  for (const occurrence of occurrences) {
    if (occurrence.status !== "scheduled") continue;
    const bill = byId.get(occurrence.billId);
    if (bill == null || bill.status !== "active") continue;
    if (occurrence.dueOn > horizon) continue;
    rows.push({
      occurrence,
      bill,
      amountCents: occurrenceAmountCents(bill, occurrence, occurrences),
      direction: bill.direction,
      status: derivedOccurrenceState(occurrence.dueOn, asOf),
      past: occurrence.dueOn < asOf,
    });
  }
  return rows.sort((a, b) =>
    a.occurrence.dueOn === b.occurrence.dueOn
      ? a.bill.name.localeCompare(b.bill.name)
      : a.occurrence.dueOn.localeCompare(b.occurrence.dueOn),
  );
}

export type CalendarCell = {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  rows: UpcomingRow[];
};

/** A Monday-first month grid: whole weeks covering `month` ("YYYY-MM"), with
 *  each open occurrence placed on its due date. */
export function calendarWeeks(
  bills: readonly Bill[],
  occurrences: readonly BillOccurrence[],
  month: string,
  asOf: string,
): CalendarCell[][] {
  const rows = upcomingRows(bills, occurrences, asOf, 400);
  const first = `${month}-01`;
  const start = shiftDate(first, -weekdayIndex(first));
  const weeks: CalendarCell[][] = [];
  for (let w = 0; w < 6; w += 1) {
    const week: CalendarCell[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = shiftDate(start, w * 7 + d);
      week.push({
        date,
        inMonth: date.slice(0, 7) === month,
        isToday: date === asOf,
        rows: rows.filter((r) => r.occurrence.dueOn === date),
      });
    }
    weeks.push(week);
  }
  return weeks;
}

export type SeriesRow = {
  bill: Bill;
  nextDueOn: string | null;
  openCount: number;
};

/** One row per series for the "Reeksen" list, active first, then paused, then
 *  ended, each by name. */
export function seriesRows(
  bills: readonly Bill[],
  occurrences: readonly BillOccurrence[],
  asOf: string,
): SeriesRow[] {
  const order = { active: 0, suggested: 1, paused: 2, inactive: 3, ended: 4 } as const;
  return bills
    .map((bill) => ({
      bill,
      nextDueOn: nextDueOnOrAfter(bill, asOf),
      openCount: occurrences.filter((o) => o.billId === bill.id && o.status === "scheduled").length,
    }))
    .sort(
      (a, b) =>
        order[a.bill.status] - order[b.bill.status] || a.bill.name.localeCompare(b.bill.name),
    );
}

/** Closed rows, newest first — what the owner has actually settled. */
export function historyRows(
  bills: readonly Bill[],
  occurrences: readonly BillOccurrence[],
): Array<{ occurrence: BillOccurrence; bill: Bill; amountCents: number }> {
  const byId = new Map(bills.map((b) => [b.id, b]));
  return occurrences
    .filter((o) => o.status !== "scheduled" && byId.has(o.billId))
    .map((occurrence) => {
      const bill = byId.get(occurrence.billId) as Bill;
      return {
        occurrence,
        bill,
        amountCents: occurrenceAmountCents(bill, occurrence, occurrences),
      };
    })
    .sort((a, b) => b.occurrence.dueOn.localeCompare(a.occurrence.dueOn));
}

/** The first day of the month shown in the calendar, moved by whole months. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}
