const ISO_DAY_SUFFIX = "T00:00:00Z";

export function isBusinessDay(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

export function businessDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}${ISO_DAY_SUFFIX}`);
  const end = new Date(`${to}${ISO_DAY_SUFFIX}`);
  while (cursor <= end) {
    if (isBusinessDay(cursor)) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** Count Monday-to-Friday dates after `from`, through and including `to`. */
export function businessDaysAfter(from: string, to: string): number {
  if (to <= from) return 0;
  return businessDateRange(from, to).filter((date) => date > from).length;
}

/** Bars older than this many business days stop backing a value. */
export const MAX_MISSED_BUSINESS_DAYS = 5;

/** A bar still backs a value on `asOf` when at most five business days old. */
export function isPriceFresh(barDate: string, asOfDate: string): boolean {
  return businessDaysAfter(barDate, asOfDate) <= MAX_MISSED_BUSINESS_DAYS;
}
