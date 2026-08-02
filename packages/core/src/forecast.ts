import type { Account, Tx } from "./model.js";
import { norm } from "./hash.js";

/* Recurring-stream detection — the first stage of the deterministic cashflow
 * forecast. Pure + deterministic: no Date.now()/Math.random(), integer cents
 * internally, ISO-date day math via Date.UTC (never `new Date(str)`, which is
 * a locale/TZ hazard). */

export type RecurringStream = {
  key: string;             // norm(counterparty) + "|" + (sign > 0 ? "in" : "out")
  counterparty: string;    // raw counterparty of the first occurrence in the group
  sign: 1 | -1;             // 1 = inflow, -1 = outflow
  cadenceDays: number;      // snapped: 7 | 14 | 30 | 91 | 365
  amountCents: number;      // representative magnitude = round(median(|amount| in cents)), POSITIVE integer
  occurrences: number;
  lastDate: string;         // ISO date of the most recent occurrence
  intervalCv: number;       // std/mean of day-gaps (0 when < 2 gaps)
};

export type DetectOptions = { minOccurrences?: number; maxIntervalCv?: number; amountTolerance?: number };

/** Minimum days of transaction history before the incidental (non-recurring)
 *  daily baseline is extrapolated into the forecast. Below this, one lumpy
 *  one-off would dominate a short window — so we project recurring streams only.
 *  Tunable on real multi-BV data. */
const MIN_HISTORY_DAYS = 60;

/** Cadence "snap" bands: a group's median day-gap must fall in exactly one of
 *  these to be considered recurring (weekly/biweekly/monthly/quarterly/yearly). */
const CADENCE_BANDS: ReadonlyArray<{ cadenceDays: number; min: number; max: number }> = [
  { cadenceDays: 7, min: 6, max: 8 },
  { cadenceDays: 14, min: 12, max: 16 },
  { cadenceDays: 30, min: 26, max: 36 },
  { cadenceDays: 91, min: 84, max: 98 },
  { cadenceDays: 365, min: 350, max: 380 },
];

/** Whole days between two ISO `YYYY-MM-DD` dates, via `Date.UTC` on the parsed
 *  y/m/d parts — never `new Date(str)`, whose parsing is locale/TZ-dependent. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ua = Date.UTC(ay, am - 1, ad);
  const ub = Date.UTC(by, bm - 1, bd);
  return Math.round((ub - ua) / 86_400_000);
}

/** Add `n` days to an ISO `YYYY-MM-DD` date, returning a new ISO date. Parses
 *  the y/m/d parts and lets `Date.UTC` do the calendar carry (month/year
 *  rollover), then reads the result back via the UTC getters — deterministic
 *  and, unlike `daysBetween`'s `new Date(str)` hazard, this only ever
 *  constructs a `Date` from a numeric timestamp, which is TZ-safe. */
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Bucket an ISO date into a Monday-anchored week index, relative to a fixed
 *  reference Monday (2000-01-03). Used only to group incidental (non-recurring)
 *  cashflow into weeks so the forecast band can estimate week-to-week spread;
 *  not a full ISO-8601 week-numbering (which has year-boundary edge cases we
 *  don't need here) — just a stable, deterministic 7-day bucketing. */
function weekBucket(iso: string): number {
  return Math.floor(daysBetween("2000-01-03", iso) / 7);
}

/** Median of a numeric array (sorts a copy; never mutates the input). */
function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/** Sample standard deviation (Bessel's correction: n-1 denominator). The
 *  standard convention for a CV estimated from a sample, and stricter at the
 *  minimum n=3-occurrence case (2 gaps) — the right bias for asserting a stream
 *  is "recurring". Returns 0 for fewer than 2 values. */
function std(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const variance = nums.reduce((s, n) => s + (n - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

/** Snap a median day-gap to the cadence whose band contains it, or null if no
 *  band matches (i.e. the group isn't recurring on a recognized cadence). */
function snapCadence(medianGapDays: number): number | null {
  for (const band of CADENCE_BANDS) {
    if (medianGapDays >= band.min && medianGapDays <= band.max) return band.cadenceDays;
  }
  return null;
}

/** Detect recurring payment streams (salary, rent, SaaS, loan, recurring
 *  inflows, ...) from transaction history.
 *
 *  Groups txs by normalized counterparty + direction (sign), then per group:
 *  requires >= minOccurrences, a median day-gap that snaps to a known cadence
 *  band, a day-gap coefficient of variation <= maxIntervalCv, and a stable
 *  amount (every occurrence within tolerance of the median magnitude). Groups
 *  failing any check are dropped entirely — this never returns a partial or
 *  "maybe" stream. */
export function detectRecurringStreams(txs: Tx[], opts: DetectOptions = {}): RecurringStream[] {
  const minOccurrences = opts.minOccurrences ?? 3;
  const maxIntervalCv = opts.maxIntervalCv ?? 0.35;
  const amountTolerance = opts.amountTolerance ?? 0.25;

  // Group by key, preserving first-appearance order (Map insertion order) for
  // deterministic output ordering — no randomness anywhere in this function.
  const groups = new Map<string, Tx[]>();
  for (const t of txs) {
    if (t.amount === 0) continue;
    const key = norm(t.counterparty) + "|" + (t.amount >= 0 ? "in" : "out");
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }

  const streams: RecurringStream[] = [];
  for (const [key, group] of groups) {
    if (group.length < minOccurrences) continue;

    // Stable sort by ISO date (lexicographic == chronological); Array#sort is
    // spec-guaranteed stable, so same-date ties keep their original order.
    const sorted = [...group].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date));

    const cadenceDays = snapCadence(median(gaps));
    if (cadenceDays === null) continue;

    const intervalCv = gaps.length < 2 ? 0 : std(gaps) / mean(gaps);
    if (intervalCv > maxIntervalCv) continue;

    const amountsCents = sorted.map((t) => Math.round(Math.abs(t.amount) * 100));
    // Round the median: for an even occurrence count it averages two middles and
    // could yield a half-cent, which would break the "integer cents" contract.
    const amountCents = Math.round(median(amountsCents));
    const tolerance = Math.max(amountTolerance * amountCents, 100);
    const hasOutlier = amountsCents.some((c) => Math.abs(c - amountCents) > tolerance);
    if (hasOutlier) continue;

    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const sign: 1 | -1 = first.amount >= 0 ? 1 : -1;

    streams.push({
      key,
      counterparty: first.counterparty,
      sign,
      cadenceDays,
      amountCents,
      occurrences: sorted.length,
      lastDate: last.date,
      intervalCv,
    });
  }

  return streams;
}

/* forecastCashflow — the orchestrator. Rolls detected streams forward
 * day-by-day from `asOf` into a 13-week (default) balance projection per
 * entity + consolidated, adds an incidental (non-recurring) baseline, widens
 * a simple week-scaled band, and flags the first weekly close below a
 * buffer. Pure + deterministic: `asOf` is caller-supplied (no Date.now()),
 * no Math.random(), integer cents throughout. */

export type ForecastPoint = {
  date: string; // ISO, weekly closing date (asOf + 7,14,...)
  projectedClosingCents: number | null; // null when opening is unknown (flow-only)
  lowerCents: number | null;
  upperCents: number | null;
};
export type Shortfall = { date: string; balanceCents: number };
export type Driver = { label: string; sign: 1 | -1; perWeekCents: number };
export type EntityForecast = {
  scope: string; // entity name, or "geconsolideerd"
  asOf: string;
  horizonDays: number;
  openingCents: number | null;
  points: ForecastPoint[]; // weekly closings, length = floor(horizonDays/7)
  shortfall: Shortfall | null;
  streams: RecurringStream[];
  drivers: Driver[]; // top streams by |perWeekCents| desc (cap 8)
};
export type ForecastOptions = { asOf: string; horizonDays?: number; bufferCents?: number };

/** Per-week "recurring flow" contribution of a stream, used both for the
 *  driver ranking and (via its average) as the band's fallback spread when
 *  there isn't enough incidental history to estimate one directly. */
function perWeekCents(s: RecurringStream): number {
  return Math.round(s.sign * s.amountCents * 7 / s.cadenceDays);
}

/** Build one scope's forecast (an entity, or the "geconsolideerd" total)
 *  from its transactions and accounts. See module doc comment above for the
 *  overall algorithm; this implements FinnTell spec §6.3/§6.5/§6.6. */
function buildForecast(
  scopeTxs: Tx[],
  scopeAccounts: Account[],
  scope: string,
  asOf: string,
  horizonDays: number,
  bufferCents: number,
): EntityForecast {
  // No accounts (e.g. the "onbekend" scope of orphan txs) => opening is UNKNOWN,
  // not a confident €0 — otherwise it could surface a spurious shortfall.
  const openingCents = scopeAccounts.length === 0 || scopeAccounts.some((a) => a.balance === null)
    ? null
    : Math.round(scopeAccounts.reduce((s, a) => s + (a.balance as number), 0) * 100);

  const streams = detectRecurringStreams(scopeTxs);
  const streamKeys = new Set(streams.map((s) => s.key));
  const nonRecurring = scopeTxs.filter(
    (t) => !streamKeys.has(norm(t.counterparty) + "|" + (t.amount >= 0 ? "in" : "out")),
  );

  // Incidental (non-recurring) daily baseline, estimated from the scope's own
  // transaction history. Requires >= MIN_HISTORY_DAYS of history: with a short
  // window a single lumpy one-off (a big transfer / equipment buy, <3 occ so
  // not "recurring") extrapolates into a huge daily drift that would dominate —
  // and could fabricate or erase a shortfall. Below the threshold we project
  // recurring streams only (honest "not enough history for a spend baseline").
  let incidentalPerDayCents = 0;
  if (scopeTxs.length > 0) {
    const dates = scopeTxs.map((t) => t.date);
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    const historyDays = Math.max(1, daysBetween(minDate, maxDate));
    if (historyDays >= MIN_HISTORY_DAYS) {
      const nonRecurringSumCents = nonRecurring.reduce((s, t) => s + Math.round(t.amount * 100), 0);
      incidentalPerDayCents = Math.round(nonRecurringSumCents / historyDays);
    }
  }

  // Day-by-day roll-forward: apply the incidental baseline and any streams
  // due "today", capturing a weekly closing point every 7th day.
  const points: ForecastPoint[] = [];
  let bal = openingCents ?? 0;
  for (let d = 1; d <= horizonDays; d++) {
    const day = addDays(asOf, d);
    bal += incidentalPerDayCents;
    for (const s of streams) {
      const gap = daysBetween(s.lastDate, day);
      if (gap > 0 && gap % s.cadenceDays === 0) bal += s.sign * s.amountCents;
    }
    if (d % 7 === 0) {
      points.push({
        date: day,
        projectedClosingCents: openingCents === null ? null : bal,
        lowerCents: null,
        upperCents: null,
      });
    }
  }

  // Band + shortfall are only meaningful when we know the opening balance
  // (otherwise the roll-forward above is a flow-only internal computation,
  // not a projected position).
  let shortfall: Shortfall | null = null;
  if (openingCents !== null) {
    const weeklyNetsByWeek = new Map<number, number>();
    for (const t of nonRecurring) {
      const wk = weekBucket(t.date);
      weeklyNetsByWeek.set(wk, (weeklyNetsByWeek.get(wk) ?? 0) + Math.round(t.amount * 100));
    }
    const weeklyNets = [...weeklyNetsByWeek.values()];
    const streamPerWeek = streams.map(perWeekCents);
    const avgWeeklyRecurringFlow = streamPerWeek.length > 0 ? mean(streamPerWeek) : 0;
    const weeklyIncidentalStd =
      weeklyNets.length >= 2 ? std(weeklyNets) : Math.max(0, 0.15 * Math.abs(avgWeeklyRecurringFlow));

    for (let i = 0; i < points.length; i++) {
      const weekIndex = i + 1;
      const spread = Math.round(weeklyIncidentalStd * Math.sqrt(weekIndex));
      const closing = points[i].projectedClosingCents as number;
      points[i].lowerCents = closing - spread;
      points[i].upperCents = closing + spread;
      if (shortfall === null && closing < bufferCents) {
        shortfall = { date: points[i].date, balanceCents: closing };
      }
    }
  }

  const drivers: Driver[] = streams
    .map((s) => ({ label: s.counterparty, sign: s.sign, perWeekCents: perWeekCents(s) }))
    .sort((a, b) => Math.abs(b.perWeekCents) - Math.abs(a.perWeekCents))
    .slice(0, 8);

  return { scope, asOf, horizonDays, openingCents, points, shortfall, streams, drivers };
}

/** Deterministic 13-week (default) cashflow forecast: one `EntityForecast`
 *  per entity found in `accounts`/`txs`, plus a "geconsolideerd" total over
 *  everything. `opts.asOf` must be supplied by the caller (no Date.now()). */
export function forecastCashflow(
  txs: Tx[],
  accounts: Account[],
  opts: ForecastOptions,
): { byEntity: Record<string, EntityForecast>; consolidated: EntityForecast } {
  const asOf = opts.asOf;
  const horizonDays = opts.horizonDays ?? 91;
  const bufferCents = opts.bufferCents ?? 0;

  const entityOf = new Map(accounts.map((a) => [a.key, a.entity]));

  // Partition accounts and txs by entity, preserving each input array's own
  // order (Map insertion order) for deterministic output.
  const scopeAccountsByEntity = new Map<string, Account[]>();
  for (const a of accounts) {
    const arr = scopeAccountsByEntity.get(a.entity);
    if (arr) arr.push(a);
    else scopeAccountsByEntity.set(a.entity, [a]);
  }
  const scopeTxsByEntity = new Map<string, Tx[]>();
  for (const t of txs) {
    const e = entityOf.get(t.accountKey) ?? "onbekend";
    const arr = scopeTxsByEntity.get(e);
    if (arr) arr.push(t);
    else scopeTxsByEntity.set(e, [t]);
  }

  const seenEntities = new Set<string>();
  const entities: string[] = [];
  for (const e of scopeAccountsByEntity.keys()) {
    if (!seenEntities.has(e)) {
      seenEntities.add(e);
      entities.push(e);
    }
  }
  for (const e of scopeTxsByEntity.keys()) {
    if (!seenEntities.has(e)) {
      seenEntities.add(e);
      entities.push(e);
    }
  }

  const byEntity: Record<string, EntityForecast> = {};
  for (const e of entities) {
    byEntity[e] = buildForecast(
      scopeTxsByEntity.get(e) ?? [],
      scopeAccountsByEntity.get(e) ?? [],
      e,
      asOf,
      horizonDays,
      bufferCents,
    );
  }

  const consolidated = buildForecast(txs, accounts, "geconsolideerd", asOf, horizonDays, bufferCents);

  return { byEntity, consolidated };
}
