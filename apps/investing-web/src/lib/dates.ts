/** A trade date, a price bar date and a chart point date are calendar dates with
 *  no time on them. Rendering one in the reader's own zone shows the day before
 *  to everyone west of Greenwich, so pin the formatter to UTC. */
const formatter = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });

const shortFormatter = formatter({ day: "numeric", month: "short", year: "numeric" });
const longFormatter = formatter({ day: "numeric", month: "long", year: "numeric" });

export function shortDate(value: string): string {
  return shortFormatter.format(new Date(`${value}T00:00:00Z`));
}

export function longDate(value: string): string {
  return longFormatter.format(new Date(`${value}T00:00:00Z`));
}

const dayMonthFormatter = formatter({ day: "numeric", month: "short" });
const monthYearFormatter = formatter({ month: "short", year: "numeric" });
const YEAR_MS = 300 * 24 * 60 * 60 * 1000;

/** Chart axis ticks: "19 Oct" inside a year, "Oct 2025" across a longer span.
 *  The full date stays on the tooltip. */
export function axisDateFormatter(first?: string, last?: string): (value: string) => string {
  const long = !!first && !!last && Date.parse(last) - Date.parse(first) > YEAR_MS;
  const format = long ? monthYearFormatter : dayMonthFormatter;
  return (value) => format.format(new Date(`${value}T00:00:00Z`));
}
