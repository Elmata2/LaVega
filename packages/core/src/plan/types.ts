import type { HeldCashback } from "../assumedCashback.js";
import type { ProductFee } from "../accountCosts.js";
import type { CatalogueEntryLike } from "../catalogRates.js";
import type { EntityProfile } from "../entities.js";
import type { ConversionMode } from "../fx.js";
import type { RateBenchmark } from "../interest.js";
import type { Account, Rule, Tx } from "../model.js";
import type { RewardsBalance } from "../rewards.js";
import type { OwnAccounts } from "../views.js";
import type { PlanEvent, PlanPreferences } from "./preferences.js";
import type { PlanProfile } from "./profileView.js";

export const SECTION_IDS = [
  "month",
  "buffer",
  "debts",
  "spending",
  "subscriptions",
  "cards",
  "goals",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export type PlanStatus = "on-track" | "attention" | "not-enough-data";

/** `ratio` is a fraction (0.25 = 25%); `pct` is percentage points (2.5 = 2.5%). */
export type FigureUnit =
  | "cents"
  | "months"
  | "ratio"
  | "pct"
  | "count"
  | "date"
  | "years";
export type FigureValue = { unit: FigureUnit; value: number | string | null };
export type FigureMap = Record<string, FigureValue>;

export const STATUS_REASON_KEYS = [
  // month
  "room-ok",
  "room-low",
  "month-negative",
  "history-short",
  // buffer
  "at-target",
  "below-target",
  "no-fixed-costs",
  "no-savings",
  "no-target",
  // debts
  "no-debt",
  "debt-no-payments",
  "debt-payments",
  "debt-payment-below-interest",
  "debt-rate-missing",
  "debts-not-asked",
  // spending
  "within-limits",
  "no-limits",
  "over-limit",
  "history-short-6m",
  "data-stale",
  // subscriptions
  "clean",
  "price-increase",
  "overlap",
  "none-short-history",
  // cards
  "no-better-card",
  "in-use-card-unknown",
  "other-card-nets-more",
  "no-card-data",
  "no-cardable-spend",
  // goals
  "on-schedule",
  "behind-schedule",
  "no-goals",
  "no-room",
  "no-goal-dates",
] as const;
export type StatusReasonKey = (typeof STATUS_REASON_KEYS)[number];

export type StatusReason = {
  key: StatusReasonKey;
  params?: Record<string, string | number>;
};

export const MISSING_KINDS = [
  "bank-data",
  "history-60d",
  "history-90d",
  "history-6m",
  "savings-balance",
  "fixed-costs",
  "buffer-target",
  "debt-rate",
  "debt-balance",
  "debts",
  "account-stale",
  "cards",
  "cardable-spend",
  "goals",
  "goal-date",
  "room",
  "stated-range",
] as const;
export type MissingKind = (typeof MISSING_KINDS)[number];

export type MissingAction =
  | "connect-bank"
  | "import"
  | "intake-question"
  | "enter-figure";
export type Missing = {
  kind: MissingKind;
  action: MissingAction;
  ref?: string;
};

/** One step of "how we calculated this". */
export type CalcStep = { id: string; inputs: FigureMap; output: FigureValue };

export type Polarity = "positive" | "negative" | "neutral";

export type PlanFact = {
  factId: string;
  section: SectionId;
  exact: number | string;
  unit: FigureUnit;
  polarity: Polarity;
  mustMention: boolean;
  trend?: { direction: "up" | "down" | "flat"; vs: string };
  range?: {
    low: number;
    expected: number;
    high: number;
    horizon?: string;
    assumption?: string;
  };
  derivedFrom?: string[];
};

export type SectionResult<F> = {
  section: SectionId;
  figures: F;
  flat: FigureMap;
  headline: FigureValue | null;
  status: PlanStatus;
  statusReason: StatusReason;
  missing: Missing[];
  calc: CalcStep[];
  facts: PlanFact[];
};

/** A card the user holds, as the cards section needs it. Declared here only. */
export type HeldCardInput = {
  accountKey: string;
  label: string;
  cashback: HeldCashback;
  fee: ProductFee | null;
  fxFeePct: number | null;
  pointsPerEuro: number | null;
  programId: string | null;
  /** Source and date of the fx and points figures (the web layer fills this
   *  from the catalogue entry). Absent: the figure is not shown. */
  provenance?: {
    fxFeePct?: { asOf: string; sourceUrl: string | null };
    pointsPerEuro?: { asOf: string; sourceUrl: string | null };
  };
};

export type PlanInput = {
  profile: PlanProfile;
  txs: Tx[];
  accounts: Account[];
  entityProfiles: EntityProfile[];
  rules: Rule[];
  own: OwnAccounts;
  rewards: RewardsBalance[];
  catalogue: readonly CatalogueEntryLike[];
  rates: readonly RateBenchmark[];
  heldCards: HeldCardInput[];
  preferences: PlanPreferences;
  events: PlanEvent[];
  mode: ConversionMode;
  fxHistory: Record<string, Record<string, number>>;
  movedCategories: ReadonlySet<string>;
  asOf: string;
};

/* CALC_IDS convention (ruling P11): each section module exports
 *   export const CALC_IDS = ["...", ...] as const;
 *   export type CalcId = (typeof CALC_IDS)[number];
 * and every CalcStep.id it emits is one of them, so the web layer's
 * `howCalculated` can be an exhaustive Record<CalcId, ...>. This file only
 * fixes the convention; the sections fill it in. */
export type CalcIdsOf<T extends readonly string[]> = T[number];
