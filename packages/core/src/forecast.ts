import type { Tx } from "./model.js";
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
