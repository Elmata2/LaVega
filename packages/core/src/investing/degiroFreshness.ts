import { DateTime, Option, Schema } from "effect";

/* A DeGiro import is a snapshot, not a live feed: the prices are ours and
 * update daily, but the quantities are the ones the user exported. The read
 * model carries the dates that say how old the quantities are, and one rule
 * turns those dates into the warning the dashboard shows (D13, #325). */

const NullableString = Schema.NullOr(Schema.String);

/** What the dashboard knows about the stored DeGiro import. Nullable fields
 *  mean "not reported", never "today". */
export const DeGiroDataStateSchema = Schema.Struct({
  importedAt: NullableString,
  coversFrom: NullableString,
  coversTo: NullableString,
  positionsAsOf: NullableString,
});

export type DeGiroDataState = Schema.Schema.Type<typeof DeGiroDataStateSchema>;

/** An import older than this many days is stale. The acceptance boundary is a
 *  31-day-old import warning and a 29-day-old one staying quiet; a 30-day-old
 *  one is not "older than 30 days". */
export const DEGIRO_STALE_AFTER_DAYS = 30;

const DAY_MS = 86_400_000;

function utcDayMillis(day: string): number | null {
  const value = day.trim().slice(0, 10);
  if (value.length !== 10) return null;
  const parsed = DateTime.make(`${value}T00:00:00Z`);
  return Option.isSome(parsed) ? DateTime.toEpochMillis(parsed.value) : null;
}

/** Whole UTC calendar days from `day` to `today`. A date after today is zero
 *  days old, not a negative age. Null when either side is not a day. */
export function deGiroDaysSince(day: string | null | undefined, today: string): number | null {
  if (day === null || day === undefined) return null;
  const from = utcDayMillis(day);
  const to = utcDayMillis(today);
  if (from === null || to === null) return null;
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

/** The age the stale rule reports: the older of the two dates that prove how
 *  current the holdings and cash are. `importedAt` alone never triggers it,
 *  because an old import can still carry fresh rows and vice versa. Returns
 *  null when neither date exists or neither is older than the threshold. */
export function deGiroStaleDays(data: DeGiroDataState, today: string): number | null {
  const ages = [data.positionsAsOf, data.coversTo]
    .map((day) => deGiroDaysSince(day, today))
    .filter((age): age is number => age !== null);
  if (ages.length === 0) return null;
  const age = Math.max(...ages);
  return age > DEGIRO_STALE_AFTER_DAYS ? age : null;
}

export function deGiroStaleProblems(data: DeGiroDataState, today: string): string[] {
  const days = deGiroStaleDays(data, today);
  if (days === null) return [];
  return [`DeGiro-gegevens zijn ${days} dagen oud. Importeer een nieuw rekeningoverzicht.`];
}
