/* Where this period's spending on a category sits in the distribution of the
 * SAME category over his own earlier periods.
 *
 * The question was asked as "average category spending percentile", and the
 * first instinct was to compare against a Dutch average. That was measured and
 * rejected (docs/research/2026-08-20-categorie-gemiddelden.md): the CBS classes
 * by PRODUCT where LaVega classes by COUNTERPARTY — one Albert Heijn debit
 * splits over five CBS posts and no mapping puts it back together — its biggest
 * post ("toegerekende huur eigen woning", 16% of the total) has no bank
 * transaction behind it at all, the newest per-category figure is 2020, and the
 * CBS publishes means with a confidence interval, never a distribution, so
 * there is no percentile in it to begin with. His own history is not the
 * fallback here; it is the only baseline that can carry the claim.
 *
 * Pure by rule: no clock, no I/O. `asOf` arrives as a parameter, and every
 * period is derived from it.
 *
 * ─── the three ways this function can lie, and what stops each one
 *
 * 1. TOO FEW PERIODS. A percentile out of three points is noise wearing the
 *    costume of a measurement. Under `minHistory` it returns null WITH the
 *    reason, never a 50th percentile. See MIN_HISTORY_PERIODS.
 *
 * 2. AN UNFINISHED CURRENT PERIOD. On 21 August the month-to-date is almost
 *    always "low", so a raw comparison against whole earlier months measures
 *    the calendar and calls it behaviour. The fix is not to pro-rate — rent and
 *    subscriptions land on the 1st, so scaling by elapsed days invents a
 *    spending pattern nobody has. Instead each earlier period is cut to the
 *    SAME NUMBER OF ELAPSED DAYS: the first 21 days of this month against the
 *    first 21 days of each earlier month. `comparedDays` says which case the
 *    caller is in, so the UI can never compare silently.
 *
 * 3. A CATEGORY THAT DID NOT EXIST YET. A subscription started in June has no
 *    distribution — the €0 of January is not "a month he spent nothing on it",
 *    it is a month in which the thing did not exist. Periods that end before
 *    the category's first transaction are dropped, and if too few remain the
 *    answer is unknown, not the 100th percentile.
 *
 * And the fourth, which is a coverage rule rather than a statistics one: an
 * earlier period is only compared when the imported data covers ALL of it. A
 * month with no statement imported is not a month without spending — the same
 * rule the Statistieken block already applies to its empty bars.
 */

/** An inclusive date range, "YYYY-MM-DD" at both ends. */
export type PeriodRange = { start: string; end: string };

/** One outflow, already categorised and already stripped of money that only
 *  moved place (see MOVED_CATEGORIES in the web layer — what counts as an
 *  expense is decided there, and this module does not want a second opinion).
 *  `cents` is a POSITIVE magnitude. */
export type SpendRow = { date: string; category: string; cents: number };

/** How many earlier periods it takes before a position in them means anything.
 *
 *  Six, and the number is a floor rather than a preference. Under the null that
 *  this period is exchangeable with the earlier ones, the chance of landing
 *  above all of them by luck alone is 1/(n+1): at n = 3 that is 25%, so one
 *  category in four would set a "record" every single period and the block
 *  would cry wolf continuously. At n = 6 it is 14% and each step of the count
 *  is worth at most 17 points, which is coarse but honest. Six months is also
 *  the shortest span that survives one holiday and one quiet month without
 *  either of them defining the whole range.
 *
 *  It is deliberately NOT set high enough to cover seasonality (that would take
 *  a dozen-plus months). The block says "hoger dan 8 van je laatste 10
 *  maanden", which is a statement about those ten months and claims nothing
 *  about the year — that is the whole reason the count is printed instead of a
 *  percentile. */
export const MIN_HISTORY_PERIODS = 6;

/** How far back to look at most. Two years of months: beyond that the earlier
 *  periods describe a different life (job, house, city) and a percentile
 *  against them answers a question nobody asked. */
export const MAX_HISTORY_PERIODS = 24;

/** Why there is no percentile. Each one of these is a different sentence for
 *  the UI to print — never a dash, and never a 50 standing in for a shrug.
 *
 *  - `geen-gegevens`          the current period has not been measured at all
 *                             (the data stops before it starts).
 *  - `te-weinig-geschiedenis` fewer than `minHistory` fully-covered earlier
 *                             periods exist in the imported data.
 *  - `nieuwe-categorie`       earlier periods exist, but none of them predates
 *                             this category's first transaction.
 *  - `te-kort-bekend`         the category has been around for some periods,
 *                             but fewer than `minHistory` of them.
 *  - `geen-verschil`          enough periods, and every one of them holds
 *                             exactly this amount. A rank inside a distribution
 *                             with no spread is arithmetic without meaning —
 *                             the mid-rank would come out at exactly 50%, which
 *                             is the one number this module must never invent.
 *                             The counts are still filled in, so the caller can
 *                             say "even hoog als al je laatste 10 maanden". */
export type PercentileReason =
  | "geen-gegevens"
  | "te-weinig-geschiedenis"
  | "nieuwe-categorie"
  | "te-kort-bekend"
  | "geen-verschil";

export type CategoryPercentile = {
  category: string;
  /** Spend in the measured part of the current period, positive cents. Zero is
   *  a real answer here and not a missing one: the period is measured, so "he
   *  spent nothing on this" is a fact. What is unknown carries a `reason`. */
  currentCents: number;
  /** The comparable sums of the earlier periods this category could be judged
   *  against, oldest first. The evidence behind the counts — a caller that
   *  wants to show the distribution has it without recomputing. */
  historyCents: number[];
  /** Earlier periods holding strictly less than the current one. */
  higher: number;
  /** Earlier periods holding exactly the same. Kept apart from `higher` and
   *  `lower` because with monthly zeros ties are common, and folding them into
   *  either side is how the same data gets reported as 0% and as 100%. */
  same: number;
  /** Earlier periods holding strictly more. */
  lower: number;
  /** Mid-rank position, (higher + same/2) / n, in 0..1 — null whenever
   *  `reason` is set. Mid-rank because of those ties: the two one-sided
   *  definitions disagree by the full width of the tie group. */
  percentile: number | null;
  reason: PercentileReason | null;
  /** First date this category was seen anywhere in `rows` — the line between
   *  "spent nothing" and "did not exist yet". */
  firstSeen: string;
};

export type SpendPercentiles = {
  /** The current period as a whole, complete or not. */
  current: PeriodRange;
  /** The last day of it the data actually reaches, or null when the data does
   *  not reach into it at all. */
  measuredThrough: string | null;
  /** Whether the current period has run out. */
  complete: boolean;
  /** When the current period is still running: how many of its days are
   *  measured, and therefore how many days of each earlier period were compared
   *  against it. Null when whole periods were compared. A caller that prints a
   *  position without printing this is comparing silently. */
  comparedDays: number | null;
  /** The slices of the earlier periods that were compared, oldest first. Per
   *  category the count can be lower — a category that did not exist yet drops
   *  the periods before it. */
  compared: PeriodRange[];
  /** Earlier periods dropped for being shorter than the elapsed part of the
   *  current one: on the 30th of a 31-day month, February cannot supply a
   *  comparable first-30-days. Reported rather than silently skipped, because
   *  it changes the n the counts are out of. */
  shortPeriods: number;
  /** The floor that was applied, so the caller can name it. */
  minHistory: number;
  /** One row per category seen in `rows`, biggest current spend first. */
  rows: CategoryPercentile[];
};

export type SpendPercentileOptions = {
  /** Peildatum. Which period is "now" is read from this and nothing else. */
  asOf: string;
  /** Length of a period in whole calendar months. 1 = per month.
   *
   *  Calendar months, not 30-day blocks: rent, salary, insurance and every
   *  subscription land on a day of the month, so a 30-day block slides one of
   *  them in and out and manufactures a swing of a full rent. The price is that
   *  February is three days shorter than January, which is accepted — a month
   *  is what he budgets in. */
  monthsPerPeriod?: number;
  /** Override the floor. Only for tests and for a caller that can defend it. */
  minHistory?: number;
  maxHistory?: number;
  /** The span the imported data covers, inclusive. Pass the span of ALL
   *  transactions, not just the spending ones: a month that only holds salary
   *  is a measured month with zero spending, and deriving the span from
   *  `rows` alone would throw it away. Defaults to the span of `rows`. */
  coverage?: PeriodRange | null;
};

/* ── date arithmetic ──────────────────────────────────────────────────────
 *
 * All of it on the parsed y/m/d parts through `Date.UTC`, never `new Date(str)`
 * — that parse is locale- and timezone-dependent, and one hour of drift moves a
 * transaction into the previous month. Same construction as forecast.ts. */

const monthOf = (iso: string): string => iso.slice(0, 7);

function isoOf(t: Date): string {
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const d = String(t.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Step a "YYYY-MM" by n months. */
function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const index = ((total % 12) + 12) % 12;
  return `${year}-${String(index + 1).padStart(2, "0")}`;
}

const monthFirstDay = (month: string): string => `${month}-01`;

/** Day 0 of the next month is this month's last day — 28, 29, 30 or 31 without
 *  a table and without a leap-year rule of our own. */
function monthLastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return isoOf(new Date(Date.UTC(y, m, 0)));
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoOf(new Date(Date.UTC(y, m - 1, d + n)));
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

const min = (a: string, b: string): string => (a < b ? a : b);

/** The span a set of rows covers, or null when there is nothing dated. */
function spanOf(rows: readonly SpendRow[]): PeriodRange | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const r of rows) {
    if (start === null || r.date < start) start = r.date;
    if (end === null || r.date > end) end = r.date;
  }
  return start === null || end === null ? null : { start, end };
}

/* ── the calculation ───────────────────────────────────────────────────── */

/** Position of every category's current-period spend within its own earlier
 *  periods. Returns a row per category, refusals included and explained. */
export function categorySpendPercentiles(
  rows: readonly SpendRow[],
  options: SpendPercentileOptions,
): SpendPercentiles {
  const monthsPerPeriod = Math.max(1, Math.round(options.monthsPerPeriod ?? 1));
  const minHistory = Math.max(1, Math.round(options.minHistory ?? MIN_HISTORY_PERIODS));
  const maxHistory = Math.max(minHistory, Math.round(options.maxHistory ?? MAX_HISTORY_PERIODS));

  // A row of exactly € 0,00 is kept: it carries no amount but it does prove the
  // category existed on that date, and that is the line between "spent nothing"
  // and "did not exist yet".
  const dated = rows.filter((r) => r.date !== "" && r.category !== "" && Number.isFinite(r.cents));
  const coverage = options.coverage ?? spanOf(dated);

  const endMonth = monthOf(options.asOf);
  const startMonth = shiftMonth(endMonth, -(monthsPerPeriod - 1));
  const current: PeriodRange = { start: monthFirstDay(startMonth), end: monthLastDay(endMonth) };

  // How far into the current period the data reaches. Both ends matter: `asOf`
  // is how far the question reaches, `coverage.end` how far the answer can. A
  // vault whose newest statement is from June cannot say anything about August,
  // and must not report it as a quiet month.
  const measuredThrough =
    coverage === null || coverage.end < current.start
      ? null
      : min(min(options.asOf, coverage.end), current.end);

  const complete = measuredThrough !== null && measuredThrough >= current.end;
  const comparedDays =
    measuredThrough === null || complete ? null : daysBetween(current.start, measuredThrough) + 1;

  // Earlier periods, newest first while walking back, kept only while the data
  // covers the whole of them.
  const compared: PeriodRange[] = [];
  let shortPeriods = 0;
  if (coverage !== null && measuredThrough !== null) {
    for (let k = 1; k <= maxHistory; k++) {
      const periodStart = monthFirstDay(shiftMonth(startMonth, -k * monthsPerPeriod));
      const periodEnd = monthLastDay(shiftMonth(monthOf(periodStart), monthsPerPeriod - 1));
      if (periodStart < coverage.start) break; // no statement for part of it
      const sliceEnd = comparedDays === null ? periodEnd : addDays(periodStart, comparedDays - 1);
      // A February cannot supply a comparable "first 30 days". Dropping it
      // changes the n, which is why the count comes back to the caller.
      if (sliceEnd > periodEnd) {
        shortPeriods++;
        continue;
      }
      compared.push({ start: periodStart, end: sliceEnd });
    }
  }
  compared.reverse(); // oldest first, so historyCents reads as a timeline

  const currentSlice: PeriodRange | null =
    measuredThrough === null ? null : { start: current.start, end: measuredThrough };

  // One pass over the rows: first appearance, current sum, and the sum per
  // compared slice. Slices are few (24 at most) and disjoint, so the inner scan
  // costs less than building an index would.
  const firstSeen = new Map<string, string>();
  const currentCents = new Map<string, number>();
  const history = new Map<string, number[]>();
  const blank = (): number[] => Array.from({ length: compared.length }, () => 0);
  for (const r of dated) {
    const seen = firstSeen.get(r.category);
    if (seen === undefined || r.date < seen) firstSeen.set(r.category, r.date);
    if (currentSlice !== null && r.date >= currentSlice.start && r.date <= currentSlice.end) {
      currentCents.set(r.category, (currentCents.get(r.category) ?? 0) + r.cents);
      continue;
    }
    for (let i = 0; i < compared.length; i++) {
      if (r.date < compared[i].start || r.date > compared[i].end) continue;
      const sums = history.get(r.category) ?? blank();
      sums[i] += r.cents;
      history.set(r.category, sums);
      break;
    }
  }

  const out: CategoryPercentile[] = [];
  for (const [category, seenAt] of firstSeen) {
    const nowCents = currentCents.get(category) ?? 0;
    const sums = history.get(category) ?? blank();

    // Periods that ended before this category's first transaction are not
    // observations of it. Dropping them is what keeps a two-month-old
    // subscription from reading as the most expensive it has ever been.
    const eligible = sums.filter((_, i) => compared[i].end >= seenAt);

    const row: CategoryPercentile = {
      category,
      currentCents: nowCents,
      historyCents: eligible,
      higher: 0,
      same: 0,
      lower: 0,
      percentile: null,
      reason: null,
      firstSeen: seenAt,
    };

    if (measuredThrough === null) {
      out.push({ ...row, historyCents: [], reason: "geen-gegevens" });
      continue;
    }
    if (compared.length < minHistory) {
      out.push({ ...row, reason: "te-weinig-geschiedenis" });
      continue;
    }
    if (eligible.length === 0) {
      out.push({ ...row, reason: "nieuwe-categorie" });
      continue;
    }
    if (eligible.length < minHistory) {
      out.push({ ...row, reason: "te-kort-bekend" });
      continue;
    }

    let higher = 0;
    let same = 0;
    let lower = 0;
    for (const cents of eligible) {
      if (cents < nowCents) higher++;
      else if (cents > nowCents) lower++;
      else same++;
    }
    out.push({
      ...row,
      higher,
      same,
      lower,
      // A distribution with no spread has no inside. The counts still say
      // something true ("even hoog als al je laatste 10 maanden"), so they are
      // filled in; the percentile is not, because it would be exactly 50.
      percentile: same === eligible.length ? null : (higher + same / 2) / eligible.length,
      reason: same === eligible.length ? "geen-verschil" : null,
    });
  }

  out.sort((a, b) => b.currentCents - a.currentCents || a.category.localeCompare(b.category, "nl"));

  return {
    current,
    measuredThrough,
    complete,
    comparedDays,
    compared,
    shortPeriods,
    minHistory,
    rows: out,
  };
}
