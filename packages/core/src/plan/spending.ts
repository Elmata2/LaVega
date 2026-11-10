import { isIsoDate, lastDayOfMonth, previousMonths } from "../advisor/months.js";
import { personalView } from "../advisor/scopePersonal.js";
import { scopedOwn } from "../advisor/room.js";
import { accountTypeKind } from "../balance.js";
import { hash } from "../hash.js";
import { isEurCurrency, type Account, type Rule, type Tx } from "../model.js";
import type { EntityProfile } from "../entities.js";
import { toEur, type ConversionMode } from "../fx.js";
import {
  categorySpendPercentiles,
  MAX_HISTORY_PERIODS,
  MIN_HISTORY_PERIODS,
  type PercentileReason,
  type SpendRow,
} from "../spendPercentile.js";
import { categorize, type OwnAccounts } from "../views.js";
import { fig } from "./internal.js";
import { PLAN_THRESHOLDS } from "./thresholds.js";
import type {
  CalcStep,
  FigureValue,
  Missing,
  PlanFact,
  PlanInput,
  SectionResult,
  StatusReason,
} from "./types.js";

/** Every key this section puts in `flat` (the change log labels each one). */
export const SPENDING_FLAT_IDS = [
  "spend_months",
  "spend_first_month",
  "spend_last_month",
  "spend_foreign_excluded",
  "spend_last_month_total",
  "spend_categories_over_limit",
] as const;
export type SpendingFlatId = (typeof SPENDING_FLAT_IDS)[number];

export const SPENDING_CALC_IDS = [
  "spend-months",
  "spend-median",
  "spend-percentile",
  "over-limit",
] as const;
export type SpendingCalcId = (typeof SPENDING_CALC_IDS)[number];

export type ExternalBenchmark = {
  source: string;
  year: number;
  householdType: string;
  licenceId: string;
  valuesByCategory: Record<string, number>;
};

export type SpendHistoryRow = {
  category: string;
  lastMonthCents: number;
  avg3Cents: number;
  /** Median over the full months present in the 12-month window (never padded);
   *  null when there is no full month. */
  median12Cents: number | null;
  /** Last six full months, oldest first, integer cents, no gaps. */
  trend6: number[];
  /** Mid-rank position in 0..1 within the user's own earlier months. */
  percentile: number | null;
  percentileReason: PercentileReason | null;
  limitCents: number | null;
  /** Consecutive most recent months above the limit. */
  overLimitMonths: number;
};

export type SpendingFigures = {
  /** Full calendar months of history that the spending figures rest on. */
  months: number;
  /** First and last full month the figures rest on (YYYY-MM); null without any. */
  firstMonth: string | null;
  lastMonth: string | null;
  /** Foreign-currency rows left out of every figure (no rate, or separate mode). */
  excludedForeignCount: number;
  rows: SpendHistoryRow[];
  externalBenchmark: ExternalBenchmark | null;
  budgetAdviceLink: "nibud-persoonlijk-budgetadvies";
};

export type SpendHistoryInput = {
  txs: readonly Tx[];
  accounts: readonly Account[];
  entityProfiles: readonly EntityProfile[];
  rules: Rule[];
  own: OwnAccounts;
  asOf: string;
  mode: ConversionMode;
  fxHistory: Record<string, Record<string, number>>;
  movedCategories: ReadonlySet<string>;
  /** Only these accounts (the cards section asks for the cards the user holds). */
  accountKeys?: ReadonlySet<string>;
  /** At most this many full months, newest ones kept. Default MAX_HISTORY_PERIODS. */
  windowMonths?: number;
  /** A row that is real outgoing money but does not belong in `byCategory`
   *  (the cards section drops what cannot be paid by card). Its cents are
   *  totalled in `skippedCents` instead. */
  skip?: (t: Tx, category: string) => boolean;
};

export type SpendHistory = {
  /** Full calendar months, oldest first. */
  months: string[];
  /** category -> month -> positive cents. A month without spending is absent. */
  byCategory: Map<string, Map<string, number>>;
  excludedForeignCount: number;
  /** Cents of the rows `skip` dropped, inside the window (0 without `skip`). */
  skippedCents: number;
  /** Keys of in-scope non-savings accounts whose data ends before the last day
   *  of the month before asOf. */
  staleAccounts: string[];
};

/** Per-category outgoing spend for each full calendar month before asOf's month.
 *  A month is full when every in-scope account that has transactions covers it
 *  (first tx by day 3, data to the last day); the months used are the newest
 *  unbroken run of such months. Personal scope, moved categories dropped,
 *  foreign rows without a rate (or all of them in separate mode) excluded and
 *  counted. */
export function spendHistory(i: SpendHistoryInput): SpendHistory {
  const view = personalView(i.accounts, i.txs, i.entityProfiles);
  const keep = i.accountKeys;
  const accounts = keep ? view.accounts.filter((a) => keep.has(a.key)) : view.accounts;
  const dated = view.txs.filter((t) => isIsoDate(t.date) && (keep ? keep.has(t.accountKey) : true));

  // Savings accounts do not count toward coverage: a rarely-used one would
  // otherwise cap the history of everything else.
  const savingsKeys = new Set(
    accounts.filter((a) => accountTypeKind(a) === "savings").map((a) => a.key),
  );
  const spans = new Map<string, { first: string; last: string }>();
  for (const t of dated) {
    if (savingsKeys.has(t.accountKey)) continue;
    const s = spans.get(t.accountKey);
    if (!s) spans.set(t.accountKey, { first: t.date, last: t.date });
    else {
      if (t.date < s.first) s.first = t.date;
      if (t.date > s.last) s.last = t.date;
    }
  }
  for (const a of accounts) {
    const s = spans.get(a.key);
    const bd = a.balanceDate?.slice(0, 10);
    if (s && bd && bd > s.last) s.last = bd;
  }
  const spanList = [...spans.values()];
  const prevMonth = previousMonths(i.asOf, 2)[1]!;
  const staleAccounts = [...spans]
    .filter(([, s]) => s.last < lastDayOfMonth(prevMonth))
    .map(([key]) => key)
    .sort();
  const covered = (m: string): boolean =>
    spanList.length > 0 &&
    spanList.every((s) => s.first <= `${m}-03` && s.last >= lastDayOfMonth(m));

  // Newest first; skip uncovered months until the first covered one, then
  // stop at the next gap.
  const limit = Math.max(0, Math.min(i.windowMonths ?? MAX_HISTORY_PERIODS, MAX_HISTORY_PERIODS));
  const picked: string[] = [];
  let started = false;
  for (const m of previousMonths(i.asOf, MAX_HISTORY_PERIODS + 12).slice(1)) {
    if (picked.length >= limit) break;
    if (covered(m)) {
      started = true;
      picked.push(m);
    } else if (started) break;
  }
  const months = picked.reverse();
  const inWindow = new Set(months);

  const own = scopedOwn(view.accounts, i.own);
  const byCategory = new Map<string, Map<string, number>>();
  let excludedForeignCount = 0;
  let skippedCents = 0;
  for (const t of dated) {
    const m = t.date.slice(0, 7);
    if (!inWindow.has(m) || t.amount >= 0) continue;
    let eur: number | null;
    if (isEurCurrency(t.currency)) eur = t.amount;
    else if (i.mode === "separate") eur = null;
    else eur = toEur(t.amount, t.currency, t.date, i.fxHistory);
    const cat = categorize(t, i.rules, own);
    if (i.movedCategories.has(cat)) continue;
    if (eur === null) {
      excludedForeignCount += 1;
      continue;
    }
    const cents = Math.round(Math.abs(eur) * 100);
    if (i.skip?.(t, cat)) {
      skippedCents += cents;
      continue;
    }
    const per = byCategory.get(cat) ?? new Map<string, number>();
    per.set(m, (per.get(m) ?? 0) + cents);
    byCategory.set(cat, per);
  }
  return { months, byCategory, excludedForeignCount, skippedCents, staleAccounts };
}

const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

const FACT_TOP_CATEGORIES = 8;
const TREND_VS = "previous-3-months";

const prevMonthOf = (asOf: string): string => previousMonths(asOf, 2)[1]!;

export function computeSpending(i: PlanInput): SectionResult<SpendingFigures> {
  const hist = spendHistory({
    txs: i.txs,
    accounts: i.accounts,
    entityProfiles: i.entityProfiles,
    rules: i.rules,
    own: i.own,
    asOf: i.asOf,
    mode: i.mode,
    fxHistory: i.fxHistory,
    movedCategories: i.movedCategories,
    windowMonths: MAX_HISTORY_PERIODS,
  });
  const months = hist.months;
  const n = months.length;
  const last = n > 0 ? months[n - 1]! : null;
  const win12 = months.slice(-12);
  const win3 = months.slice(-3);
  const win6 = months.slice(-6);
  const limits = i.preferences.categoryLimits;
  // Percentiles need MIN_HISTORY_PERIODS earlier months plus the month being ranked,
  // so status and percentile agree: no number, no on-track.
  const stale = hist.staleAccounts.length > 0 || (last !== null && last !== prevMonthOf(i.asOf));
  const enough = !stale && n >= MIN_HISTORY_PERIODS + 1;

  // Percentiles: the last full month is "now", the months before it the history.
  const pct = new Map<string, { value: number | null; reason: PercentileReason | null }>();
  if (enough && last !== null) {
    const rows: SpendRow[] = [];
    for (const [category, per] of hist.byCategory)
      for (const [m, cents] of per) rows.push({ date: `${m}-01`, category, cents });
    const res = categorySpendPercentiles(rows, {
      asOf: lastDayOfMonth(last),
      minHistory: MIN_HISTORY_PERIODS,
      coverage: { start: `${months[0]!}-01`, end: lastDayOfMonth(last) },
    });
    for (const r of res.rows) pct.set(r.category, { value: r.percentile, reason: r.reason });
  }

  const categories = new Set<string>([...hist.byCategory.keys(), ...Object.keys(limits)]);
  const rows: SpendHistoryRow[] = [];
  for (const category of categories) {
    const per = hist.byCategory.get(category) ?? new Map<string, number>();
    const at = (m: string): number => per.get(m) ?? 0;
    const limitCents = limits[category]?.cents ?? null;
    let over = 0;
    if (limitCents !== null)
      for (let k = n - 1; k >= 0 && at(months[k]!) > limitCents; k--) over += 1;
    const p = pct.get(category);
    rows.push({
      category,
      lastMonthCents: last === null ? 0 : at(last),
      avg3Cents:
        win3.length === 0 ? 0 : Math.round(win3.reduce((s, m) => s + at(m), 0) / win3.length),
      median12Cents: median(win12.map(at)),
      trend6: win6.map(at),
      percentile: enough ? (p?.value ?? null) : null,
      percentileReason: enough
        ? (p?.reason ?? (p === undefined ? "nieuwe-categorie" : null))
        : "te-weinig-geschiedenis",
      limitCents,
      overLimitMonths: over,
    });
  }
  rows.sort((a, b) => b.lastMonthCents - a.lastMonthCents || a.category.localeCompare(b.category));

  const calc: CalcStep[] = [];
  const missing: Missing[] = [];
  calc.push({
    id: "spend-months",
    inputs: {
      first_month_to_last: fig("count", n),
      foreign_excluded: fig("count", hist.excludedForeignCount),
      categories: fig("count", rows.length),
      categories_in_facts: fig(
        "count",
        rows.filter((r, idx) => idx < FACT_TOP_CATEGORIES || r.limitCents !== null).length,
      ),
    },
    output: fig("count", n),
  });
  if (n > 0)
    calc.push({
      id: "spend-median",
      inputs: { months_used: fig("count", win12.length) },
      output: fig("count", win12.length),
    });
  if (enough)
    calc.push({
      id: "spend-percentile",
      inputs: { min_history: fig("count", MIN_HISTORY_PERIODS), months: fig("count", n) },
      output: fig("count", pct.size),
    });
  const overRows = rows.filter(
    (r) => r.overLimitMonths >= PLAN_THRESHOLDS.spending.overLimitMonths,
  );
  if (Object.keys(limits).length > 0)
    calc.push({
      id: "over-limit",
      inputs: {
        limits: fig("count", Object.keys(limits).length),
        min_months: fig("count", PLAN_THRESHOLDS.spending.overLimitMonths),
      },
      output: fig("count", overRows.length),
    });

  let status: SectionResult<SpendingFigures>["status"];
  let statusReason: StatusReason;
  if (stale) {
    status = "not-enough-data";
    statusReason = { key: "data-stale" };
    for (const key of hist.staleAccounts)
      missing.push({ kind: "account-stale", action: "connect-bank", ref: key });
    if (hist.staleAccounts.length === 0)
      missing.push({ kind: "history-6m", action: "connect-bank" });
  } else if (!enough) {
    status = "not-enough-data";
    statusReason = { key: "history-short-6m" };
    missing.push({ kind: "history-6m", action: "connect-bank" });
  } else if (overRows.length > 0) {
    status = "attention";
    // The same figure the rows show: the longest run among the categories over.
    statusReason = {
      key: "over-limit",
      params: { months: Math.max(...overRows.map((r) => r.overLimitMonths)) },
    };
  } else {
    status = "on-track";
    statusReason = { key: Object.keys(limits).length > 0 ? "within-limits" : "no-limits" };
  }

  const totalLast = rows.reduce((s, r) => s + r.lastMonthCents, 0);
  const flat: Record<SpendingFlatId, FigureValue> = {
    spend_months: fig("count", n),
    spend_first_month: fig("date", n === 0 ? null : `${months[0]!}-01`),
    spend_last_month: fig("date", last === null ? null : lastDayOfMonth(last)),
    spend_foreign_excluded: fig("count", hist.excludedForeignCount),
    spend_last_month_total: fig("cents", last === null ? null : totalLast),
    spend_categories_over_limit: fig("count", overRows.length),
  };

  const facts: PlanFact[] = [];
  const keepFacts = stale
    ? []
    : rows.filter((r, idx) => idx < FACT_TOP_CATEGORIES || r.limitCents !== null);
  for (const r of keepFacts) {
    const h = hash(r.category);
    const base = { section: "spending" as const, polarity: "neutral" as const, mustMention: false };
    if (last !== null)
      facts.push({
        ...base,
        factId: `spend_last_month:${h}`,
        exact: r.lastMonthCents,
        unit: "cents",
      });
    if (r.median12Cents !== null)
      facts.push({ ...base, factId: `spend_median12:${h}`, exact: r.median12Cents, unit: "cents" });
    if (r.trend6.length === 6) {
      const prev = r.trend6.slice(0, 3).reduce((s, v) => s + v, 0) / 3;
      const recent = r.trend6.slice(3).reduce((s, v) => s + v, 0) / 3;
      const delta = Math.round(recent - prev);
      facts.push({
        ...base,
        factId: `spend_trend:${h}`,
        exact: delta,
        unit: "cents",
        trend: {
          direction:
            Math.abs(delta) < PLAN_THRESHOLDS.noise.cents ? "flat" : delta > 0 ? "up" : "down",
          vs: TREND_VS,
        },
      });
    }
    if (r.overLimitMonths >= 1)
      facts.push({
        ...base,
        factId: `spend_over_limit:${h}`,
        exact: r.overLimitMonths,
        unit: "count",
        polarity: "negative",
      });
  }

  return {
    section: "spending",
    figures: {
      months: n,
      firstMonth: n === 0 ? null : months[0]!,
      lastMonth: last,
      excludedForeignCount: hist.excludedForeignCount,
      rows,
      externalBenchmark: null,
      budgetAdviceLink: "nibud-persoonlijk-budgetadvies",
    },
    flat,
    headline: last === null || stale ? null : fig("cents", totalLast),
    status,
    statusReason,
    missing,
    calc,
    facts,
  };
}
