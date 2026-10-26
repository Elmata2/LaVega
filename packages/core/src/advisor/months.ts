import { DateTime } from "effect";

/* The only place the advisor code adds or subtracts calendar months or
 * compares to "12 months". All through Effect DateTime (UTC); no Date math. */

const parse = (iso: string): DateTime.Utc => DateTime.makeUnsafe(iso) as DateTime.Utc;

const monthKey = (d: DateTime.DateTime): string => {
  const { year, month } = DateTime.toParts(d);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
};

/** `2026-10-22` (or an ISO date-time) -> `2026-10`. */
export function isoMonth(date: string): string {
  return monthKey(parse(date));
}

/** The `n` calendar months ending WITH asOf's own month, newest first.
 *  `previousMonths("2026-10-22", 3)` -> `["2026-10", "2026-09", "2026-08"]`.
 *  A caller that wants only full months drops the first entry itself. */
export function previousMonths(asOf: string, n: number): string[] {
  const start = DateTime.startOf(parse(asOf), "month");
  return Array.from({ length: Math.max(0, n) }, (_, i) =>
    monthKey(DateTime.subtract(start, { months: i })),
  );
}

/** Whole calendar months from `from` to `to`, floored: 2025-10-23 -> 2026-10-23
 *  is 12, -> 2026-10-22 is 11. Day-of-month clamps (Jan 31 + 1 month = Feb 28).
 *  Negative when `to` is before `from`. */
export function monthsBetween(from: string, to: string): number {
  const a = parse(from);
  const b = parse(to);
  if (DateTime.toEpochMillis(b) < DateTime.toEpochMillis(a)) return -monthsBetween(to, from);
  const pa = DateTime.toParts(a);
  const pb = DateTime.toParts(b);
  let k = (pb.year - pa.year) * 12 + (pb.month - pa.month);
  if (DateTime.toEpochMillis(DateTime.add(a, { months: k })) > DateTime.toEpochMillis(b)) k -= 1;
  return Math.max(0, k);
}

/** True for a real calendar date written YYYY-MM-DD (optionally followed by a
 *  time). "garbage", "05-09-2026" and "2026-02-30" are not: the date must
 *  survive a round trip through DateTime unchanged. */
export function isIsoDate(date: string): boolean {
  const parsed = DateTime.make(date);
  if (parsed._tag === "None") return false;
  return DateTime.formatIso(parsed.value).slice(0, 10) === date.slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). Both must be
 *  valid ISO dates. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (DateTime.toEpochMillis(parse(to)) - DateTime.toEpochMillis(parse(from))) / 86_400_000,
  );
}
