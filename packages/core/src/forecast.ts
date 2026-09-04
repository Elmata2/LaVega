import type { Account, ScheduledFlow, Tx } from "./model.js";
import { norm } from "./hash.js";
import { scheduledFlowsForScope } from "./scheduledFlows.js";
import { categorize, ownAccounts } from "./views.js";

/* Recurring-stream detection — the first stage of the deterministic cashflow
 * forecast. Pure + deterministic: no Date.now()/Math.random(), integer cents
 * internally, ISO-date day math via Date.UTC (never `new Date(str)`, which is
 * a locale/TZ hazard). */

export type RecurringStream = {
  key: string; // norm(counterparty) + "|" + (sign > 0 ? "in" : "out")
  counterparty: string; // raw counterparty of the first occurrence in the group
  sign: 1 | -1; // 1 = inflow, -1 = outflow
  cadenceDays: number; // snapped: 7 | 14 | 30 | 91 | 365
  amountCents: number; // representative magnitude = round(median(|amount| in cents)), POSITIVE integer
  occurrences: number;
  lastDate: string; // ISO date of the most recent occurrence
  intervalCv: number; // std/mean of day-gaps (0 when < 2 gaps)
};

export type DetectOptions = {
  minOccurrences?: number;
  maxIntervalCv?: number;
  amountTolerance?: number;
};

/** Minimum days of transaction history before the incidental (non-recurring)
 *  daily baseline is extrapolated into the forecast. Below this, one lumpy
 *  one-off would dominate a short window — so we project recurring streams only.
 *  Tunable on real multi-BV data. */
const MIN_HISTORY_DAYS = 60;

/** History beyond which the basis stops calling itself thin. Six months covers
 *  a quarterly cycle twice, which is the shortest window in which a Dutch BV's
 *  own rhythm (BTW quarter, holiday month) is visible more than once. */
const SOLID_HISTORY_DAYS = 180;

/** Whole observed weeks required before the incidental spread is estimated from
 *  the weekly series. Fewer than this and a single unusual week sets the band
 *  width, which is a confident-looking number with nothing behind it. */
const MIN_BAND_WEEKS = 8;

/** Cadence "snap" bands: a group's median day-gap must fall in exactly one of
 *  these to be considered recurring (weekly/biweekly/monthly/quarterly/yearly). */
const CADENCE_BANDS: ReadonlyArray<{ cadenceDays: number; min: number; max: number }> = [
  { cadenceDays: 7, min: 6, max: 8 },
  { cadenceDays: 14, min: 12, max: 16 },
  { cadenceDays: 30, min: 26, max: 36 },
  { cadenceDays: 91, min: 84, max: 98 },
  { cadenceDays: 365, min: 350, max: 380 },
];

/** The category `categorize` gives a move between two of the owner's own
 *  accounts. Spelled here rather than imported because views.ts keeps it
 *  private; the string is the contract between the two modules. */
const TRANSFER_CATEGORY = "Eigen overboeking";

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

/** Add `n` calendar months to an ISO date, keeping the day of the month and
 *  clamping it to the target month's length (2026-01-31 + 1 month =
 *  2026-02-28, and the following step returns to the 28th, not the 31st —
 *  which is what a bank standing order does too). Same TZ-safe construction as
 *  `addDays`. */
function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  // Day 0 of the month AFTER the target is the target's last day.
  const lastDayOfTarget = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const t = new Date(Date.UTC(y, m - 1 + n, Math.min(d, lastDayOfTarget)));
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** The `k`-th occurrence after `anchor` for a given cadence.
 *
 *  7 and 14 days ARE their own calendar — a weekly direct debit lands on the
 *  same weekday. But rent, salary, insurance and SaaS on the "monthly" band land
 *  on a DAY OF THE MONTH, and stepping them by a flat 30 days drifts: salary
 *  last paid on the 25th would be projected on the 24th, then the 23rd, then the
 *  22nd. Over a 13-week horizon that moves the reported shortfall date by
 *  several days — exactly the number the owner would check against his own bank
 *  statement. So the monthly/quarterly/yearly bands count calendar months.
 *
 *  Always measured from the ANCHOR, never from the previous result: a payment
 *  anchored on the 31st goes 31 Jan → 28 Feb → 31 Mar, which is what a standing
 *  order does. Stepping from the clamped 28th would have stayed on the 28th
 *  forever, losing three days a year. */
function occurrenceAt(anchor: string, cadenceDays: number, k: number): string {
  if (cadenceDays === 30) return addMonths(anchor, k);
  if (cadenceDays === 91) return addMonths(anchor, 3 * k);
  if (cadenceDays === 365) return addMonths(anchor, 12 * k);
  return addDays(anchor, cadenceDays * k);
}

/** Day index relative to a fixed reference Monday (2000-01-03). `weekday(idx)`
 *  is 0 on a Monday and 6 on a Sunday — which is how the weekly series below
 *  tells a whole observed week from a partial one. */
function dayIndex(iso: string): number {
  return daysBetween("2000-01-03", iso);
}

/** Weekday of a day index, 0 = Monday. Written the long way because JS `%`
 *  keeps the sign of the dividend, so a date before the reference Monday would
 *  otherwise give a negative "weekday" and silently mis-bucket the week. */
function weekday(idx: number): number {
  return ((idx % 7) + 7) % 7;
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

/** The grouping key detection uses: normalized counterparty + direction. */
function streamKeyOf(t: Tx): string {
  return norm(t.counterparty) + "|" + (t.amount >= 0 ? "in" : "out");
}

/** Detect recurring payment streams (salary, rent, SaaS, loan, recurring
 *  inflows, ...) from transaction history.
 *
 *  Groups txs by normalized counterparty + direction (sign), then per group:
 *  requires >= minOccurrences, a median day-gap that snaps to a known cadence
 *  band, a day-gap coefficient of variation <= maxIntervalCv, and a stable
 *  amount (every occurrence within tolerance of the median magnitude). Groups
 *  failing any check are dropped entirely — this never returns a partial or
 *  "maybe" stream.
 *
 *  Detection says nothing about whether a stream is still RUNNING; that needs an
 *  `asOf`, which this function does not take. `streamHasEnded` below is where
 *  the forecast makes that call. */
export function detectRecurringStreams(txs: Tx[], opts: DetectOptions = {}): RecurringStream[] {
  const minOccurrences = opts.minOccurrences ?? 3;
  const maxIntervalCv = opts.maxIntervalCv ?? 0.35;
  const amountTolerance = opts.amountTolerance ?? 0.25;

  // Group by key, preserving first-appearance order (Map insertion order) for
  // deterministic output ordering — no randomness anywhere in this function.
  const groups = new Map<string, Tx[]>();
  for (const t of txs) {
    if (t.amount === 0) continue;
    const key = streamKeyOf(t);
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
    for (let i = 1; i < sorted.length; i++)
      gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date));

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

/** A detected stream has ENDED when it missed more than two consecutive
 *  expected payments — i.e. its last occurrence is more than three cadences
 *  before `asOf`.
 *
 *  This is deliberately the same assumption `computeAlerts` makes when it STOPS
 *  warning about a missed payment ("older ⇒ assume the stream simply ended"), so
 *  the two surfaces never contradict each other: while the alert center says a
 *  payment is late, the forecast still expects it; once the alert center gives
 *  up on it, the forecast stops projecting it. Without this, a subscription
 *  cancelled in March is still being paid in the projection in August. */
export function streamHasEnded(s: RecurringStream, asOf: string): boolean {
  return daysBetween(s.lastDate, asOf) > s.cadenceDays * 3;
}

/** The dates on which `s` is expected to pay, within `(asOf, horizonEnd]`,
 *  ascending. Empty for a stream that has ended.
 *
 *  Beyond plain calendar stepping there is one rule: an occurrence that was due
 *  in the recent past and never arrived is rolled forward to the first projected
 *  day rather than dropped. Dropping it is what the old modulo walk did, and it
 *  quietly removed money that is still owed — the rent you are four days late
 *  with is still leaving your account. "Recent" is the same grace window
 *  `computeAlerts` uses before it calls a payment late, and at most one cycle:
 *  past that we are guessing, and only ONE catch-up is ever added. */
export function streamOccurrences(s: RecurringStream, asOf: string, horizonEnd: string): string[] {
  if (streamHasEnded(s, asOf)) return [];

  const dates: string[] = [];
  let missed: string | null = null;
  for (let k = 1; ; k++) {
    const at = occurrenceAt(s.lastDate, s.cadenceDays, k);
    if (at > horizonEnd) break;
    if (at > asOf) dates.push(at);
    else missed = at; // keep the most recent overdue one
  }

  if (missed !== null) {
    const overdueDays = daysBetween(missed, asOf);
    const grace = Math.max(3, Math.round(s.cadenceDays * 0.2));
    const catchUp = addDays(asOf, 1);
    if (
      overdueDays > grace &&
      overdueDays <= s.cadenceDays &&
      catchUp <= horizonEnd &&
      dates[0] !== catchUp
    ) {
      dates.unshift(catchUp);
    }
  }
  return dates;
}

/* forecastCashflow — the orchestrator. Rolls detected streams forward
 * day-by-day from `asOf` into a 13-week (default) balance projection per
 * entity + consolidated, adds an incidental (non-recurring) baseline, widens
 * a band from MEASURED variability, flags the first weekly close below a
 * buffer, and reports what the whole thing is actually built on. Pure +
 * deterministic: `asOf` is caller-supplied (no Date.now()), no Math.random(),
 * integer cents throughout. */

export type ForecastPoint = {
  date: string; // ISO, weekly closing date (asOf + 7,14,...)
  projectedClosingCents: number | null; // null when opening is unknown (flow-only)
  /** Band edges, or null when there is nothing measured to build a band from.
   *  Null is NOT "no uncertainty" — it is "we cannot say", and the view must
   *  render it as an absent band, never as a tight one. */
  lowerCents: number | null;
  upperCents: number | null;
};
export type Shortfall = { date: string; balanceCents: number };
export type Driver = { label: string; sign: 1 | -1; perWeekCents: number };

/** Where the band's width comes from. "streams" = the measured spread of the
 *  recurring amounts themselves; "incidental" = the week-to-week spread of
 *  everything that is not a recognised stream; "none" = neither could be
 *  measured, so there is no band. */
export type BandBasis = "none" | "streams" | "incidental" | "both";

/** How much this forecast is worth. Deliberately coarse and rule-based (see
 *  `buildBasis`) — a number here would imply a precision we cannot defend. */
export type ForecastConfidence = "none" | "low" | "medium" | "high";

/** What the projection is actually built on. The forecast is the product's
 *  reason to exist and its competitor is a spreadsheet the owner trusts because
 *  he built it; the only way to beat that is to be checkable. So every number
 *  needed to say "this is 3 weeks of one account" travels with the forecast.
 *
 *  Everything here is observed, never assumed: an absent figure is null or 0
 *  with a flag beside it, never a default standing in for knowledge. */
export type ForecastBasis = {
  /** Days spanned by this scope's transaction history (0 for none or one tx). */
  historyDays: number;
  firstTxDate: string; // "" when the scope has no transactions
  lastTxDate: string; // ""; also the answer to "how stale is this?"
  /** Whole calendar weeks fully inside the observed window. */
  fullWeeks: number;
  accountsTotal: number; // accounts in this scope
  accountsWithHistory: number; // ...of which contributed at least one transaction
  /** The SHORTEST history among the accounts that contributed any — "three
   *  weeks of one account" is literally this number. null when none did. */
  shortestAccountDays: number | null;
  /** Whether the incidental (non-recurring) baseline made it into the line.
   *  False means only recognised streams and scheduled flows are projected. */
  incidentalIncluded: boolean;
  incidentalPerWeekCents: number; // 0 when not included
  liveStreamCount: number;
  /** Detected streams the projection deliberately left out because they stopped
   *  occurring. Named, so the owner can confirm or correct the call. */
  endedStreams: RecurringStream[];
  bandBasis: BandBasis;
  /** Unpaid scheduled flows whose due date already passed. They are NOT in the
   *  line — we cannot tell from here whether they were paid outside LaVega —
   *  and they are not silently dropped either. Signed net cents. */
  overdueFlowsCents: number;
  overdueFlowCount: number;
  /** Scheduled flows that ARE in the line (due inside the horizon). */
  projectedFlowCount: number;
  confidence: ForecastConfidence;
};

export type EntityForecast = {
  scope: string; // entity name, or "geconsolideerd"
  asOf: string;
  horizonDays: number;
  openingCents: number | null;
  points: ForecastPoint[]; // weekly closings, length = floor(horizonDays/7)
  shortfall: Shortfall | null;
  streams: RecurringStream[];
  drivers: Driver[]; // top LIVE streams by |perWeekCents| desc (cap 8)
  /** The first week whose LOWER band edge dips below the buffer while the
   *  expected line still clears it — a risk, not a prediction. Only ever set
   *  when `shortfall` is null; a real shortfall says it louder already.
   *  Optional so forecasts written by hand in tests/fixtures stay valid. */
  atRisk?: Shortfall | null;
  /** Optional for the same reason. `forecastCashflow` always produces it. */
  basis?: ForecastBasis;
};
export type ForecastOptions = {
  asOf: string;
  horizonDays?: number;
  bufferCents?: number;
  scheduledFlows?: ScheduledFlow[];
};

/** Per-week "recurring flow" contribution of a stream, used for the driver
 *  ranking. Note this is an AVERAGE rate, not a schedule — the projection
 *  itself uses the real calendar dates from `streamOccurrences`. */
function perWeekCents(s: RecurringStream): number {
  return Math.round((s.sign * s.amountCents * 7) / s.cadenceDays);
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
  scheduledFlows: ScheduledFlow[] = [],
): EntityForecast {
  const horizonEnd = addDays(asOf, horizonDays);

  // No accounts (e.g. the "onbekend" scope of orphan txs) => opening is UNKNOWN,
  // not a confident €0 — otherwise it could surface a spurious shortfall.
  const openingCents =
    scopeAccounts.length === 0 || scopeAccounts.some((a) => a.balance === null)
      ? null
      : Math.round(scopeAccounts.reduce((s, a) => s + (a.balance as number), 0) * 100);

  const streams = detectRecurringStreams(scopeTxs);
  const liveStreams = streams.filter((s) => !streamHasEnded(s, asOf));
  const endedStreams = streams.filter((s) => streamHasEnded(s, asOf));
  const streamKeys = new Set(streams.map((s) => s.key));

  // How much each stream's own amount actually varies, measured from its own
  // occurrences. This replaces the band's old "15% of the average recurring
  // flow" fallback — a magic number wearing the clothes of a measurement, and
  // one computed from a mean over mixed signs, so it did not even describe the
  // thing it was 15% of.
  const amountsByKey = new Map<string, number[]>();
  for (const t of scopeTxs) {
    const k = streamKeyOf(t);
    if (!streamKeys.has(k)) continue;
    const arr = amountsByKey.get(k);
    if (arr) arr.push(Math.round(Math.abs(t.amount) * 100));
    else amountsByKey.set(k, [Math.round(Math.abs(t.amount) * 100)]);
  }
  const amountStdByKey = new Map<string, number>();
  for (const [k, amounts] of amountsByKey) amountStdByKey.set(k, std(amounts));

  // Everything that is not a recognised stream. Own transfers are taken out
  // first: a one-off €50k sweep to the owner's own savings account is not spend,
  // but as an "incidental" it extrapolates into hundreds of euros of drift per
  // day and can fabricate a shortfall out of his own money. `ownAccounts` is
  // built from THIS SCOPE's accounts on purpose (its own docs say to pass the
  // full list): consolidated nets a BV1->BV2 move to zero and should ignore both
  // legs, while for BV1 alone that same move is a real outflow and must count.
  const own = ownAccounts(scopeAccounts);
  const incidental = scopeTxs.filter(
    (t) => !streamKeys.has(streamKeyOf(t)) && categorize(t, [], own) !== TRANSFER_CATEGORY,
  );

  // Observed window + per-account coverage. Both feed the basis; the window also
  // sets the incidental baseline's denominator.
  const dated = scopeTxs.filter((t) => t.date);
  const spanByAccount = new Map<string, { first: string; last: string }>();
  for (const t of dated) {
    const s = spanByAccount.get(t.accountKey);
    if (!s) spanByAccount.set(t.accountKey, { first: t.date, last: t.date });
    else {
      if (t.date < s.first) s.first = t.date;
      if (t.date > s.last) s.last = t.date;
    }
  }
  const firstTxDate =
    dated.length > 0 ? dated.reduce((a, b) => (a.date < b.date ? a : b)).date : "";
  const lastTxDate = dated.length > 0 ? dated.reduce((a, b) => (a.date > b.date ? a : b)).date : "";
  const historyDays = dated.length > 0 ? daysBetween(firstTxDate, lastTxDate) : 0;
  const accountDays = [...spanByAccount.values()].map((s) => daysBetween(s.first, s.last));
  const shortestAccountDays = accountDays.length > 0 ? Math.min(...accountDays) : null;

  // Incidental (non-recurring) daily baseline, estimated from the scope's own
  // transaction history. Requires >= MIN_HISTORY_DAYS of history: with a short
  // window a single lumpy one-off (a big transfer / equipment buy, <3 occ so
  // not "recurring") extrapolates into a huge daily drift that would dominate —
  // and could fabricate or erase a shortfall. Below the threshold we project
  // recurring streams only (honest "not enough history for a spend baseline").
  const incidentalIncluded = historyDays >= MIN_HISTORY_DAYS;
  const incidentalSumCents = incidental.reduce((s, t) => s + Math.round(t.amount * 100), 0);
  const incidentalPerDayCents = incidentalIncluded
    ? Math.round(incidentalSumCents / Math.max(1, historyDays))
    : 0;

  // Week-to-week spread of the incidental flow, over EVERY whole week in the
  // observed window — quiet weeks included as real zeros. The old version built
  // its series only from weeks that happened to contain a transaction, so a
  // scope that spends in bursts looked steadier than it is: the zero weeks that
  // are half the story were simply missing from the sample.
  const firstIdx = firstTxDate ? dayIndex(firstTxDate) : 0;
  const lastIdx = lastTxDate ? dayIndex(lastTxDate) : -1;
  const firstFullWeek = Math.floor(firstIdx / 7) + (weekday(firstIdx) === 0 ? 0 : 1);
  const lastFullWeek = Math.floor(lastIdx / 7) - (weekday(lastIdx) === 6 ? 0 : 1);
  const fullWeeks = dated.length > 0 ? Math.max(0, lastFullWeek - firstFullWeek + 1) : 0;

  let incidentalWeeklyStd = 0;
  const bandHasIncidental = fullWeeks >= MIN_BAND_WEEKS;
  if (bandHasIncidental) {
    const netByWeek = Array.from({ length: fullWeeks }, () => 0);
    for (const t of incidental) {
      const w = Math.floor(dayIndex(t.date) / 7) - firstFullWeek;
      if (w >= 0 && w < fullWeeks) netByWeek[w] += Math.round(t.amount * 100);
    }
    incidentalWeeklyStd = std(netByWeek);
  }
  const bandHasStreams = liveStreams.length > 0;
  const bandBasis: BandBasis =
    bandHasStreams && bandHasIncidental
      ? "both"
      : bandHasStreams
        ? "streams"
        : bandHasIncidental
          ? "incidental"
          : "none";

  // The projected calendar: what lands on which day, and how uncertain each
  // landing is. Streams carry their own measured amount spread; a scheduled flow
  // is a known amount on a known date and contributes none.
  const deltaByDate = new Map<string, number>();
  const varianceByDate = new Map<string, number>();
  for (const s of liveStreams) {
    const sd = amountStdByKey.get(s.key) ?? 0;
    for (const d of streamOccurrences(s, asOf, horizonEnd)) {
      deltaByDate.set(d, (deltaByDate.get(d) ?? 0) + s.sign * s.amountCents);
      varianceByDate.set(d, (varianceByDate.get(d) ?? 0) + sd * sd);
    }
  }
  let projectedFlowCount = 0;
  let overdueFlowsCents = 0;
  let overdueFlowCount = 0;
  for (const f of scheduledFlows) {
    if (f.status === "cancelled" || f.status === "paid") continue;
    if (f.dueDate <= asOf) {
      // Already due and still open. Not added to the line — from here we cannot
      // tell whether it was paid outside LaVega — but counted so the view can
      // say it, instead of the money simply disappearing from the projection.
      overdueFlowsCents += f.sign * f.amountCents;
      overdueFlowCount += 1;
      continue;
    }
    if (f.dueDate > horizonEnd) continue;
    deltaByDate.set(f.dueDate, (deltaByDate.get(f.dueDate) ?? 0) + f.sign * f.amountCents);
    projectedFlowCount += 1;
  }

  // Day-by-day roll-forward, capturing a weekly closing point every 7th day.
  // The band's half-width at week k is sqrt(measured variance accumulated so
  // far): the recurring amounts' own variance for every occurrence already
  // passed, plus k weeks of incidental weekly variance. Independent variances
  // add — that is the whole model, and it is arithmetic anyone can redo by hand.
  // It is one standard deviation of MEASURED variation, not a confidence
  // interval: we have no basis for claiming a percentage.
  const points: ForecastPoint[] = [];
  let bal = openingCents ?? 0;
  let streamVariance = 0;
  for (let d = 1; d <= horizonDays; d++) {
    const day = addDays(asOf, d);
    bal += incidentalPerDayCents;
    bal += deltaByDate.get(day) ?? 0;
    streamVariance += varianceByDate.get(day) ?? 0;
    if (d % 7 === 0) {
      const week = d / 7;
      const variance = streamVariance + incidentalWeeklyStd * incidentalWeeklyStd * week;
      const spread = bandBasis === "none" ? null : Math.round(Math.sqrt(variance));
      points.push({
        date: day,
        projectedClosingCents: openingCents === null ? null : bal,
        lowerCents: openingCents === null || spread === null ? null : bal - spread,
        upperCents: openingCents === null || spread === null ? null : bal + spread,
      });
    }
  }

  // Shortfall and risk are only meaningful when we know the opening balance
  // (otherwise the roll-forward above is a flow-only internal computation,
  // not a projected position).
  let shortfall: Shortfall | null = null;
  let atRisk: Shortfall | null = null;
  if (openingCents !== null) {
    for (const p of points) {
      const closing = p.projectedClosingCents as number;
      if (shortfall === null && closing < bufferCents)
        shortfall = { date: p.date, balanceCents: closing };
      if (atRisk === null && p.lowerCents !== null && p.lowerCents < bufferCents) {
        atRisk = { date: p.date, balanceCents: p.lowerCents };
      }
    }
    if (shortfall !== null) atRisk = null; // the louder statement wins
  }

  const drivers: Driver[] = liveStreams
    .map((s) => ({ label: s.counterparty, sign: s.sign, perWeekCents: perWeekCents(s) }))
    .sort((a, b) => Math.abs(b.perWeekCents) - Math.abs(a.perWeekCents))
    .slice(0, 8);

  const basis: ForecastBasis = {
    historyDays,
    firstTxDate,
    lastTxDate,
    fullWeeks,
    accountsTotal: scopeAccounts.length,
    accountsWithHistory: spanByAccount.size,
    shortestAccountDays,
    incidentalIncluded,
    incidentalPerWeekCents: incidentalPerDayCents * 7,
    liveStreamCount: liveStreams.length,
    endedStreams,
    bandBasis,
    overdueFlowsCents,
    overdueFlowCount,
    projectedFlowCount,
    confidence: gradeConfidence({
      hasEvidence: liveStreams.length > 0 || incidentalIncluded || projectedFlowCount > 0,
      historyDays,
      accountsTotal: scopeAccounts.length,
      accountsWithHistory: spanByAccount.size,
      shortestAccountDays,
    }),
  };

  return {
    scope,
    asOf,
    horizonDays,
    openingCents,
    points,
    shortfall,
    atRisk,
    streams,
    drivers,
    basis,
  };
}

/** The confidence ladder, as a rule anyone can check against the basis:
 *
 *  - "none"   nothing to project from — no live stream, no spend baseline, no
 *             scheduled flow. A flat line at today's balance is not a forecast,
 *             and the view must not dress it up as one.
 *  - "low"    thinner than {@link MIN_HISTORY_DAYS} of history, OR an account
 *             whose balance is in the opening but whose transactions are not
 *             (its future flows are invisible), OR several accounts of which one
 *             is far shorter than the rest — the "three weeks of one account"
 *             case, which is invisible in the totals.
 *  - "medium" enough history to project, less than {@link SOLID_HISTORY_DAYS}.
 *  - "high"   at least SOLID_HISTORY_DAYS, on accounts that all reach back.
 */
function gradeConfidence(o: {
  hasEvidence: boolean;
  historyDays: number;
  accountsTotal: number;
  accountsWithHistory: number;
  shortestAccountDays: number | null;
}): ForecastConfidence {
  if (!o.hasEvidence) return "none";
  if (o.historyDays < MIN_HISTORY_DAYS) return "low";
  if (o.accountsWithHistory < o.accountsTotal) return "low";
  if (o.accountsWithHistory > 1 && (o.shortestAccountDays ?? 0) < MIN_HISTORY_DAYS) return "low";
  if (o.historyDays < SOLID_HISTORY_DAYS) return "medium";
  return "high";
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
  const allFlows = opts.scheduledFlows ?? [];

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
      scheduledFlowsForScope(allFlows, e),
    );
  }

  const consolidated = buildForecast(
    txs,
    accounts,
    "geconsolideerd",
    asOf,
    horizonDays,
    bufferCents,
    allFlows,
  );

  return { byEntity, consolidated };
}
