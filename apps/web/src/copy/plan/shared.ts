import {
  LOSS_ILLUSTRATION_FALL_PCT,
  MIN_HISTORY_PERIODS,
  PLAN_THRESHOLDS,
  PRICE_INCREASE_MIN_CENTS,
  PRICE_INCREASE_MIN_PCT,
  factById,
  type MissingKind,
  type PendingPublicFactId,
  type PublicFact,
  type StatusReasonKey,
} from "@lavega/core";
import {
  formatDate,
  formatEuroIn,
  formatWholeEuroIn,
  localeTag,
  monthLabel,
} from "../../format.js";
import type { Locale } from "../../locale.js";

/**
 * Pieces every plan copy module shares. No Dutch or English sentence lives
 * here: only types, the formatter the templates receive, and the one place a
 * public fact is turned into a line.
 *
 * Templates take ALREADY-FORMATTED strings through `PlanFmt` (the optimise.ts
 * pattern). Money arrives in integer cents; `eur` divides by 100 because
 * `formatEuroIn` formats euros.
 */
export type PlanFmt = {
  /** Integer cents to whole euros ("€1,234", "-€300"): cents are noise in a sentence. */
  eur(cents: number): string;
  /** Integer cents with the cents shown, for prices and fees. */
  eurExact(cents: number): string;
  /** "€420 to €810", "-€300 to €100" (words, so a minus sign stays readable). */
  eurRange(lowCents: number, highCents: number): string;
  /** A plain number with up to two decimals, no unit ("1.5"). */
  plain(n: number): string;
  /** A bare number of months ("2.4"). */
  months(n: number): string;
  /** A count of months with its unit ("1 month", "2.4 months"). */
  monthsLabel(n: number): string;
  /** A count of years with its unit ("1 year", "2.4 years"). */
  yearsLabel(n: number): string;
  /** A whole count with a thousands separator. */
  count(n: number): string;
  /** A fraction (0.25 = 25%) as a percentage. */
  pct(ratio: number): string;
  /** Percentage points (2.5 = 2.5%) as a percentage. */
  points(pp: number): string;
  /** ISO day to a short date. */
  date(iso: string): string;
  /** YYYY-MM to a month name. */
  monthLabel(iso: string): string;
};

export function planFmt(locale: Locale): PlanFmt {
  const tag = localeTag(locale);
  const num = (n: number, max: number): string =>
    new Intl.NumberFormat(tag, { maximumFractionDigits: max }).format(n);
  const eur = (cents: number): string => {
    const euros = Math.round(Math.abs(cents) / 100);
    return (cents < 0 && euros > 0 ? "-" : "") + formatWholeEuroIn(locale, euros);
  };
  const eurExact = (cents: number): string =>
    (cents < 0 ? "-" : "") + formatEuroIn(locale, Math.abs(cents) / 100).replace(/\s+/g, "");
  const to = locale === "nl" ? "tot" : "to";
  const unit = (n: number): string =>
    locale === "nl" ? (n === 1 ? "maand" : "maanden") : n === 1 ? "month" : "months";
  const yearUnit = (n: number): string => (locale === "nl" ? "jaar" : n === 1 ? "year" : "years");
  return {
    eur,
    eurExact,
    eurRange: (low, high) => `${eur(low)} ${to} ${eur(high)}`,
    plain: (n) => num(n, 2),
    months: (n) => num(n, 1),
    monthsLabel: (n) => `${num(n, 1)} ${unit(n)}`,
    yearsLabel: (n) => `${num(n, 1)} ${yearUnit(n)}`,
    count: (n) => num(n, 0),
    pct: (ratio) => `${num(ratio * 100, 1)}%`,
    points: (pp) => `${num(pp, 2)}%`,
    date: (iso) => formatDate(locale, iso),
    monthLabel: (iso) => monthLabel(locale, iso),
  };
}

/** Every cut-off the copy mentions, read from core. No literal number of this
 *  kind may be written in a template: change it in core and the copy follows. */
export const PLAN_NUMBERS = {
  /** Earlier full months a percentile needs. */
  earlierMonths: MIN_HISTORY_PERIODS,
  /** Full months before spending can be compared with the user's own history
   *  (the earlier months plus the latest one). */
  spendingMonths: MIN_HISTORY_PERIODS + 1,
  historyDays: PLAN_THRESHOLDS.month.history.minDays,
  subsDays: PLAN_THRESHOLDS.subscriptions.minDays,
  roomShare: PLAN_THRESHOLDS.month.roomShareOnTrack,
  overLimitMonths: PLAN_THRESHOLDS.spending.overLimitMonths,
  betterCardMargin: PLAN_THRESHOLDS.cards.betterCardMargin,
  cardHorizonMonths: PLAN_THRESHOLDS.cards.horizonMonths,
  priceIncreasePct: PRICE_INCREASE_MIN_PCT,
  priceIncreaseCents: PRICE_INCREASE_MIN_CENTS,
  lossFallPct: LOSS_ILLUSTRATION_FALL_PCT,
  /** The return (a fraction) at which a goal's monthly requirement is worked out for the unallocated line. */
  requirementRate: PLAN_THRESHOLDS.scenarioRates[0],
} as const;

/** Reason keys each section can emit. Typing a section's `reasons` Record over
 *  its own subset keeps a new key from compiling in the wrong section. */
export type MonthReasonKey = Extract<
  StatusReasonKey,
  "room-ok" | "room-low" | "month-negative" | "history-short" | "data-stale"
>;
export type BufferReasonKey = Extract<
  StatusReasonKey,
  "at-target" | "below-target" | "no-fixed-costs" | "no-savings" | "no-target"
>;
export type DebtsReasonKey = Extract<
  StatusReasonKey,
  | "no-debt"
  | "debt-no-payments"
  | "debt-payments"
  | "debt-payment-below-interest"
  | "debt-rate-missing"
  | "debts-not-asked"
>;
export type SpendingReasonKey = Extract<
  StatusReasonKey,
  "within-limits" | "no-limits" | "over-limit" | "history-short-6m" | "data-stale"
>;
export type SubsReasonKey = Extract<
  StatusReasonKey,
  "clean" | "price-increase" | "overlap" | "none-short-history"
>;
export type CardsReasonKey = Extract<
  StatusReasonKey,
  | "no-better-card"
  | "in-use-card-unknown"
  | "other-card-nets-more"
  | "no-card-data"
  | "no-cardable-spend"
>;
export type GoalsReasonKey = Extract<
  StatusReasonKey,
  "on-schedule" | "behind-schedule" | "no-goals" | "no-room" | "no-goal-dates"
>;

export type MonthMissingKind = Extract<
  MissingKind,
  "bank-data" | "history-60d" | "fixed-costs" | "stated-range" | "account-stale"
>;
export type BufferMissingKind = Extract<
  MissingKind,
  "savings-balance" | "fixed-costs" | "buffer-target"
>;
export type DebtsMissingKind = Extract<MissingKind, "debt-rate" | "debt-balance" | "debts">;
export type SpendingMissingKind = Extract<MissingKind, "account-stale" | "history-6m">;
export type SubsMissingKind = Extract<MissingKind, "history-90d">;
export type CardsMissingKind = Extract<MissingKind, "cards" | "cardable-spend">;
export type GoalsMissingKind = Extract<MissingKind, "goals" | "goal-date" | "room">;

/** General education, written from the AI spec's concept catalogue ids. The
 *  catalogue is not built yet: `conceptId` is a plain string, UNVERIFIED
 *  against it. Same text for every user. */
export type Education = { conceptId: string; title: string; body: string };

/** The common shape of a section's copy. `F` is the section's figures. */
export type SectionCopy<F, R extends StatusReasonKey, M extends MissingKind, C extends string> = {
  reasons: Record<R, string>;
  headline: (f: F, fmt: PlanFmt) => string;
  explain: {
    simple: (f: F, fmt: PlanFmt) => string[];
    detailed: (f: F, fmt: PlanFmt) => string[];
  };
  empty: Record<M, string>;
  howCalculated: Record<C, string>;
  education: Education[];
};

/** A slot filled only from a verified `PublicFact`. The template gets the
 *  fact's value and source name. */
export type FactSlot = (value: string, source: string) => string;

/** The line for a public fact, or null when the fact is not showable (not in
 *  PUBLIC_FACTS, or no verifiedOn). With PUBLIC_FACTS empty this is always
 *  null, so nothing outside LaVega renders. */
export function factLine(
  id: PendingPublicFactId,
  slot: FactSlot,
  facts?: readonly PublicFact[],
): string | null {
  const f = facts === undefined ? factById(id) : factById(id, facts);
  return f === null ? null : slot(String(f.value), f.source);
}

/** Shown wherever a figure is missing. A dash, never a zero. */
export const DASH = "–";

/* Build-time exhaustiveness: if a key is added to STATUS_REASON_KEYS or
 * MISSING_KINDS and no section subset above lists it, one of these stops
 * compiling (the type resolves to `never` and `true` is not assignable). */
type SectionReasonKeys =
  | MonthReasonKey
  | BufferReasonKey
  | DebtsReasonKey
  | SpendingReasonKey
  | SubsReasonKey
  | CardsReasonKey
  | GoalsReasonKey;
type SectionMissingKinds =
  | MonthMissingKind
  | BufferMissingKind
  | DebtsMissingKind
  | SpendingMissingKind
  | SubsMissingKind
  | CardsMissingKind
  | GoalsMissingKind;
export const REASON_KEYS_ARE_ALL_COVERED: [Exclude<StatusReasonKey, SectionReasonKeys>] extends [
  never,
]
  ? true
  : never = true;
export const MISSING_KINDS_ARE_ALL_COVERED: [Exclude<MissingKind, SectionMissingKinds>] extends [
  never,
]
  ? true
  : never = true;
