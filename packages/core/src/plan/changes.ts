import { daysBetween, isIsoDate, isoMonth } from "../advisor/months.js";
import { type PlanSnapshot, type RefreshTrigger } from "./preferences.js";
import { PLAN_THRESHOLDS } from "./thresholds.js";
import { SECTION_IDS, type FigureUnit, type PlanStatus, type SectionId } from "./types.js";

export type PlanChangeReasonKey =
  | "income-stream-changed"
  | "price-increase-flagged"
  | "goal-date-near"
  | "buffer-below-wish"
  | "debt-added"
  | "child-added"
  | "card-added"
  | "points-added"
  | "profile-edited"
  | "figure-changed";

export type PlanChange = {
  section: SectionId;
  figureId: string;
  unit: FigureUnit;
  before: number | string | null;
  after: number | string | null;
  reason: {
    key: PlanChangeReasonKey;
    params?: Record<string, string | number>;
  };
};

export type StatusChange = {
  section: SectionId;
  before: PlanStatus;
  after: PlanStatus;
};

export type PlanDiff = {
  changes: PlanChange[];
  statusChanges: StatusChange[];
  material: boolean;
  /** True when there is nothing comparable (no previous snapshot, or the
   *  thresholds or engine changed): an upgrade is not reported as a spike. */
  baseline: boolean;
};

const EPS = 1e-9;

const noiseOf = (unit: FigureUnit): number | null =>
  unit === "cents" || unit === "months" || unit === "ratio" || unit === "pct"
    ? PLAN_THRESHOLDS.noise[unit]
    : null;

const added = (prev: readonly string[], next: readonly string[]): boolean =>
  next.some((x) => !prev.includes(x));

/** Coverage and bookkeeping figures move with the calendar or the sync, not
 *  with the user's behaviour; dates never count either. */
const NOT_A_CHANGE: ReadonlySet<string> = new Set([
  "spend_months",
  "spend_first_month",
  "spend_last_month",
  "spend_foreign_excluded",
  "sub_coverage_days",
  "sub_foreign_excluded",
  "cards_months",
  "cards_foreign_excluded",
]);

/** income-level trigger rule: the median moved by 20% or more (integers). */
const medianMoved = (was: number | null, now: number | null): boolean =>
  was !== null &&
  now !== null &&
  (was === 0 ? now !== 0 : Math.abs(now - was) * 100 >= Math.abs(was) * 20);

const INCOME_FIGURES: ReadonlySet<string> = new Set([
  "income_middle",
  "room_low",
  "room_middle",
  "room_high",
]);
/** Figures that come from the profile alone, so a profile edit explains them. */
const PROFILE_SECTIONS: ReadonlySet<SectionId> = new Set(["debts", "goals"]);

/** The reason one figure moved. Each reason names only the figures it can explain; else figure-changed. */
function reasonFor(
  section: SectionId,
  figureId: string,
  prev: PlanSnapshot,
  next: PlanSnapshot,
): PlanChange["reason"] {
  const a = prev.markers;
  const b = next.markers;
  const rows: [boolean, PlanChangeReasonKey][] = [
    [
      section === "month" &&
        INCOME_FIGURES.has(figureId) &&
        (medianMoved(a.incomeMedianCents, b.incomeMedianCents) ||
          added(a.incomeStreamIds, b.incomeStreamIds)),
      "income-stream-changed",
    ],
    [
      section === "subscriptions" && added(a.flaggedIncreaseKeys, b.flaggedIncreaseKeys),
      "price-increase-flagged",
    ],
    [
      section === "goals" &&
        figureId === "goals_within_12m" &&
        added(a.goalsWithin12m, b.goalsWithin12m),
      "goal-date-near",
    ],
    [section === "buffer" && !a.bufferBelowWish && b.bufferBelowWish, "buffer-below-wish"],
    [section === "debts" && added(a.debtIds, b.debtIds), "debt-added"],
    [
      section === "goals" && figureId === "goals_count" && b.childCount > a.childCount,
      "child-added",
    ],
    [section === "cards" && added(a.cardKeys, b.cardKeys), "card-added"],
    [section === "cards" && added(a.pointsProgramIds, b.pointsProgramIds), "points-added"],
    [PROFILE_SECTIONS.has(section) && prev.profileHash !== next.profileHash, "profile-edited"],
  ];
  return { key: rows.find(([hit]) => hit)?.[1] ?? "figure-changed" };
}

export function diffSnapshots(prev: PlanSnapshot | null, next: PlanSnapshot): PlanDiff {
  if (
    prev === null ||
    prev.thresholdsVersion !== next.thresholdsVersion ||
    prev.engineVersion !== next.engineVersion
  ) {
    return { changes: [], statusChanges: [], material: false, baseline: true };
  }
  const changes: PlanChange[] = [];
  const statusChanges: StatusChange[] = [];
  for (const section of SECTION_IDS) {
    const p = prev.sections[section];
    const n = next.sections[section];
    if (p.status !== n.status) {
      statusChanges.push({ section, before: p.status, after: n.status });
    }
    const ids = [...new Set([...Object.keys(p.flat), ...Object.keys(n.flat)])].sort();
    for (const figureId of ids) {
      const before = p.flat[figureId];
      const after = n.flat[figureId];
      const b = before?.value ?? null;
      const a = after?.value ?? null;
      if (a === b || NOT_A_CHANGE.has(figureId)) continue;
      const unit = (after ?? before)!.unit;
      if (unit === "date") continue;
      const noise = noiseOf(unit);
      if (
        noise !== null &&
        typeof a === "number" &&
        typeof b === "number" &&
        Math.abs(a - b) < noise - EPS
      ) {
        continue;
      }
      changes.push({
        section,
        figureId,
        unit,
        before: b,
        after: a,
        reason: reasonFor(section, figureId, prev, next),
      });
    }
  }
  return {
    changes,
    statusChanges,
    material: changes.length > 0 || statusChanges.length > 0,
    baseline: false,
  };
}

/** The reason to store a snapshot now, or null. A month keeps its first
 *  snapshot, so only a new month (or a plan left unopened for over 30 days)
 *  asks for one; changes inside a month are shown live, not stored. No
 *  snapshot yet counts as a new month. */
export function refreshDecision(prev: PlanSnapshot | null, asOf: string): RefreshTrigger | null {
  if (prev === null || !isIsoDate(prev.asOf)) return "new-month";
  // A clock behind the newest snapshot stores nothing.
  if (asOf < prev.asOf) return null;
  if (isoMonth(asOf) === isoMonth(prev.asOf)) return null;
  return daysBetween(prev.asOf, asOf) > 30 ? "open-stale" : "new-month";
}

const relativeMove = (c: PlanChange): number => {
  if (typeof c.before !== "number" || typeof c.after !== "number") return Infinity;
  const base = Math.abs(c.before);
  return base === 0 ? Infinity : Math.abs(c.after - c.before) / base;
};

/** The n biggest figure changes, largest relative move first; ties keep
 *  section order (the sort is stable over the diff's own order). */
export function topChanges(d: Pick<PlanDiff, "changes">, n = 3): PlanChange[] {
  return d.changes
    .map((c, idx) => ({ c, idx, rel: relativeMove(c) }))
    .sort((x, y) => (x.rel === y.rel ? x.idx - y.idx : x.rel > y.rel ? -1 : 1))
    .slice(0, n)
    .map((x) => x.c);
}
