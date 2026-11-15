/* Calendar maths the homescreen blocks share, as pure functions.
 *
 * All dates are ISO "YYYY-MM-DD" and are parsed through Date.UTC, never
 * `new Date(iso)` in a local timezone: a position graph that silently shifts a
 * day west of Greenwich would put a transaction in the wrong bucket, and the
 * weekday block's whole point ("which day costs me money") would be off by one
 * for half the world.
 *
 * Nothing here reads the clock — the caller passes `asOf`, the same rule
 * packages/core follows. */

const DAY_MS = 86_400_000;

function utc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** "2026-08-16" shifted by n days (negative goes back). */
export function shiftDate(iso: string, days: number): string {
  return new Date(utc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** 0 = maandag … 6 = zondag. Monday-first, because a Dutch week starts there
 *  and the "Friday is expensive" reading depends on the week reading left to
 *  right the way the owner thinks of it. */
export function weekdayIndex(iso: string): number {
  return (new Date(utc(iso)).getUTCDay() + 6) % 7;
}

/** Monday-first weekday names, short and long. */
export const WEEKDAYS_SHORT_NL = ["ma", "di", "wo", "do", "vr", "za", "zo"];
export const WEEKDAYS_NL = [
  "Maandag",
  "Dinsdag",
  "Woensdag",
  "Donderdag",
  "Vrijdag",
  "Zaterdag",
  "Zondag",
];

const MONTHS_SHORT_NL = [
  "jan",
  "feb",
  "mrt",
  "apr",
  "mei",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

/** "2026-08-11" -> "11 aug". The year is left off on purpose: these labels sit
 *  on an axis or in a list where the year is already established. */
export function dayLabelNL(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const month = MONTHS_SHORT_NL[m - 1];
  return month ? `${d} ${month}` : iso;
}

/** Step a "YYYY-MM" back by n months. */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** First and last calendar day of a "YYYY-MM". */
export function monthFirstDay(ym: string): string {
  return `${ym}-01`;
}
export function monthLastDay(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  // Day 0 of the NEXT month is the last day of this one — leap years included.
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The Monday of the week `iso` falls in. Monday-first, like weekdayIndex. */
export function mondayOf(iso: string): string {
  return shiftDate(iso, -weekdayIndex(iso));
}

/** "9 jun 2026" — the day label with its year, for the places where the year
 *  is NOT already established by something next to it. */
export function dayLabelYearNL(iso: string): string {
  return `${dayLabelNL(iso)} ${iso.slice(0, 4)}`;
}

/** "1 jun – 16 aug 2026", or "12 nov 2025 – 16 aug 2026" across a year
 *  boundary. Used wherever a block has to SAY which window a figure covers —
 *  a number without its window is a number that cannot be checked. */
export function rangeLabelNL(start: string, end: string): string {
  const ys = start.slice(0, 4);
  const ye = end.slice(0, 4);
  return ys === ye
    ? `${dayLabelNL(start)} – ${dayLabelNL(end)} ${ye}`
    : `${dayLabelNL(start)} ${ys} – ${dayLabelNL(end)} ${ye}`;
}
