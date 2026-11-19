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

const axisFormatter = formatter({ day: "numeric", month: "short" });

/** A chart axis tick: "19 Oct". The year is on the tooltip and the range picker. */
export function axisDate(value: string): string {
  return axisFormatter.format(new Date(`${value}T00:00:00Z`));
}
