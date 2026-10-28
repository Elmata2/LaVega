import { Schema } from "effect";
import { isoMonth } from "../advisor/months.js";
import {
  PLAN_SNAPSHOT_LIMIT,
  type PlanSection,
  type Stamped,
  type VaultEvent,
} from "../advisor/vaultSections.js";
import { SECTION_IDS, STATUS_REASON_KEYS, type SectionId } from "./types.js";

export class PlanDecodeError extends Schema.TaggedError<PlanDecodeError>()("PlanDecodeError", {
  message: Schema.String,
}) {}

/* Every *Cents field is an integer: a float would drift in sums and diffs. */
const Cents = Schema.Int;
const IsoDate = Schema.String;
const Stamp = Schema.Struct({ cents: Cents, at: IsoDate });

export const StudyAssumptions = Schema.Struct({
  monthlyCostCents: Cents,
  months: Schema.Finite,
  tuitionCents: Cents,
  inflationPct: Schema.Finite,
  at: IsoDate,
});
export type StudyAssumptions = Schema.Schema.Type<typeof StudyAssumptions>;

export const PlanPreferencesSchema = Schema.Struct({
  categoryLimits: Schema.Record(Schema.String, Stamp),
  redemptionExamples: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        programId: Schema.String,
        pointsSpent: Schema.Finite,
        cashPriceSavedCents: Cents,
        at: IsoDate,
      }),
    ),
  ),
  /** ISO date, as the user typed it. */
  pointsExpiry: Schema.Record(Schema.String, Schema.String),
  nibudBufferResult: Schema.NullOr(Stamp),
  studyCostAssumptions: Schema.NullOr(StudyAssumptions),
  /** Keyed by debt id. */
  extraDebtPayment: Schema.Record(Schema.String, Stamp),
  bufferTopUpMonths: Schema.NullOr(Schema.Struct({ months: Schema.Finite, at: IsoDate })),
  /** The person's own income-tax set-aside, in percent of client income. Optional
   *  key so preferences saved before it existed still decode. */
  incomeTaxSetAsidePct: Schema.optionalKey(Schema.NullOr(Schema.Struct({ pct: Schema.Finite, at: IsoDate }))),
});
export type PlanPreferences = Schema.Schema.Type<typeof PlanPreferencesSchema>;

export const emptyPlanPreferences = (): PlanPreferences => ({
  categoryLimits: {},
  redemptionExamples: [],
  pointsExpiry: {},
  nibudBufferResult: null,
  studyCostAssumptions: null,
  extraDebtPayment: {},
  bufferTopUpMonths: null,
});

export const REFRESH_TRIGGERS = [
  "open-stale",
  "new-month",
  "manual",
  "income-level",
  "income-stream",
  "price-increase",
  "goal-soon",
  "buffer-below-wish",
  "new-debt",
  "new-child",
  "new-card",
  "new-points",
  "profile-edit",
] as const;
export type RefreshTrigger = (typeof REFRESH_TRIGGERS)[number];

const FigureValueSchema = Schema.Struct({
  unit: Schema.Literals(["cents", "months", "ratio", "pct", "count", "date", "years"]),
  value: Schema.NullOr(Schema.Union([Schema.Finite, Schema.String])),
});
const FigureMapSchema = Schema.Record(Schema.String, FigureValueSchema);
const StatusReasonSchema = Schema.Struct({
  key: Schema.Literals(STATUS_REASON_KEYS),
  params: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Finite])),
  ),
});
const SectionSnapshot = Schema.Struct({
  status: Schema.Literals(["on-track", "attention", "not-enough-data"]),
  statusReason: StatusReasonSchema,
  flat: FigureMapSchema,
});

export const PlanMarkersSchema = Schema.Struct({
  incomeMedianCents: Schema.NullOr(Cents),
  incomeStreamIds: Schema.mutable(Schema.Array(Schema.String)),
  flaggedIncreaseKeys: Schema.mutable(Schema.Array(Schema.String)),
  goalsWithin12m: Schema.mutable(Schema.Array(Schema.String)),
  debtIds: Schema.mutable(Schema.Array(Schema.String)),
  childCount: Schema.Int,
  cardKeys: Schema.mutable(Schema.Array(Schema.String)),
  pointsProgramIds: Schema.mutable(Schema.Array(Schema.String)),
  bufferBelowWish: Schema.Boolean,
});
export type PlanMarkers = Schema.Schema.Type<typeof PlanMarkersSchema>;

export const PlanSnapshotSchema = Schema.Struct({
  asOf: IsoDate,
  thresholdsVersion: Schema.String,
  engineVersion: Schema.String,
  profileHash: Schema.String,
  trigger: Schema.Literals(REFRESH_TRIGGERS),
  sections: Schema.Struct(
    Object.fromEntries(SECTION_IDS.map((id) => [id, SectionSnapshot])) as Record<
      SectionId,
      typeof SectionSnapshot
    >,
  ),
  markers: PlanMarkersSchema,
});
export type PlanSnapshot = Schema.Schema.Type<typeof PlanSnapshotSchema>;

/* ---------- events ---------- */

export type SubscriptionDecision = {
  id: string;
  kind: "subscription-decision";
  at: string;
  streamKey: string;
  decision: "keep" | "review" | "cancel" | "clear";
};
export type UsageLog = {
  id: string;
  kind: "usage-log";
  at: string;
  streamKey: string;
  /** YYYY-MM */
  month: string;
};
/** Where a goal's straight-line schedule starts: a date and the amount saved
 *  on that date, recorded together. Append-only: the latest one per goal is
 *  the anchor, so two devices union cleanly and no preference is rewritten. */
export type GoalAnchor = {
  id: string;
  kind: "goal-anchor";
  at: string;
  goalId: string;
  startCents: number;
};
export type PlanEvent = SubscriptionDecision | UsageLog | GoalAnchor;

/** Build a goal-anchor event. The first anchor for a goal has a fixed id (two
 *  devices that both see the goal first write the same event); later ones
 *  carry a nonce and sort after it. */
export function goalAnchorEventOf(a: {
  goalId: string;
  at: string;
  startCents: number;
  first: boolean;
  nonce?: string;
}): GoalAnchor {
  return {
    id: a.first ? `ga1:${a.goalId}` : `ga2:${a.goalId}:${a.at}:${a.nonce ?? ""}`,
    kind: "goal-anchor",
    at: a.at,
    goalId: a.goalId,
    startCents: a.startCents,
  };
}

/** The effective anchor per goal id: the latest by `at`, then id. */
export function goalAnchorsOf(
  events: readonly VaultEvent[],
): Record<string, { at: string; startCents: number }> {
  const best = new Map<string, GoalAnchor>();
  for (const e of events) {
    const p = planEventOf(e);
    if (p === null || p.kind !== "goal-anchor") continue;
    const seen = best.get(p.goalId);
    if (seen === undefined || p.at > seen.at || (p.at === seen.at && p.id > seen.id))
      best.set(p.goalId, p);
  }
  return Object.fromEntries(
    [...best].map(([id, a]) => [id, { at: a.at, startCents: a.startCents }]),
  );
}

const DECISIONS: ReadonlySet<unknown> = new Set(["keep", "review", "cancel", "clear"]);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Narrow a vault event to a plan event, or null for any kind (or shape) we do
 *  not know. Explanation and outcome events from the AI layer pass through
 *  untouched elsewhere; here they are simply not ours. */
export function planEventOf(e: VaultEvent): PlanEvent | null {
  if (!str(e.id) || !str(e.at)) return null;
  if (e.kind === "subscription-decision" && str(e["streamKey"]) && DECISIONS.has(e["decision"])) {
    return {
      id: e.id,
      kind: "subscription-decision",
      at: e.at,
      streamKey: e["streamKey"],
      decision: e["decision"] as SubscriptionDecision["decision"],
    };
  }
  if (
    e.kind === "usage-log" &&
    str(e["streamKey"]) &&
    typeof e["month"] === "string" &&
    /^\d{4}-\d{2}$/.test(e["month"])
  ) {
    return {
      id: e.id,
      kind: "usage-log",
      at: e.at,
      streamKey: e["streamKey"],
      month: e["month"],
    };
  }
  if (
    e.kind === "goal-anchor" &&
    str(e["goalId"]) &&
    typeof e["startCents"] === "number" &&
    Number.isInteger(e["startCents"])
  ) {
    return {
      id: e.id,
      kind: "goal-anchor",
      at: e.at,
      goalId: e["goalId"],
      startCents: e["startCents"],
    };
  }
  return null;
}

export type SubscriptionState = {
  decision: "keep" | "review" | "cancel" | null;
  usedMonths: string[];
};

/** Current subscription state, derived from the event log and never stored.
 *  Latest decision by `at` then `id` wins; `clear` resets to null; usage months
 *  are unique and sorted. A stream that no longer exists keeps its entry. */
export function subscriptionStateOf(events: readonly VaultEvent[]): Map<string, SubscriptionState> {
  const plan = events.flatMap((e) => {
    const p = planEventOf(e);
    return p === null || p.kind === "goal-anchor" ? [] : [p];
  });
  const ordered = [...plan].sort((a, b) =>
    a.at === b.at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.at < b.at ? -1 : 1,
  );
  const out = new Map<string, SubscriptionState>();
  const slot = (k: string): SubscriptionState => {
    let s = out.get(k);
    if (s === undefined) {
      s = { decision: null, usedMonths: [] };
      out.set(k, s);
    }
    return s;
  };
  for (const e of ordered) {
    const s = slot(e.streamKey);
    if (e.kind === "subscription-decision") {
      s.decision = e.decision === "clear" ? null : e.decision;
    } else if (!s.usedMonths.includes(e.month)) {
      s.usedMonths.push(e.month);
    }
  }
  for (const s of out.values()) s.usedMonths.sort();
  return out;
}

/* ---------- the stored plan state ---------- */

export type PlanState = {
  preferences: PlanPreferences;
  snapshots: PlanSnapshot[];
};

const decodePrefs = Schema.decodeUnknownSync(PlanPreferencesSchema);
const decodeSnapshot = Schema.decodeUnknownSync(PlanSnapshotSchema);

const wrap = <T>(thunk: () => T): T => {
  try {
    return thunk();
  } catch (e) {
    throw new PlanDecodeError({
      message: e instanceof Error ? e.message : String(e),
    });
  }
};

/** Unwraps the vault's `plan` section. An absent section (or an absent
 *  preferences record) decodes to the empty state; bad data throws
 *  PlanDecodeError. Snapshots come back oldest month first. */
export function decodePlanState(section: PlanSection | undefined): PlanState {
  if (section === undefined) return { preferences: emptyPlanPreferences(), snapshots: [] };
  return wrap(() => ({
    preferences:
      section.preferences === null
        ? emptyPlanPreferences()
        : decodePrefs(section.preferences.value),
    // One bad stored snapshot must not block the plan: drop it, keep the rest.
    snapshots: Object.keys(section.snapshots)
      .sort()
      .flatMap((m) => {
        try {
          return [decodeSnapshot(section.snapshots[m]!.value)];
        } catch {
          return [];
        }
      }),
  }));
}

export type ChangeBaseline = {
  snapshot: PlanSnapshot;
  /** "earlier-month": the newest snapshot from an earlier month than `asOf`.
   *  "first-this-month": there is none, so this month's own first one. */
  kind: "earlier-month" | "first-this-month";
};

/** What the change log compares the live plan with: the newest snapshot from an
 *  earlier month, or, when there is none, the first snapshot of this month
 *  (a month keeps its first one, so a fresh vault still shows edits). Null
 *  when nothing is stored for this month or before. */
export function changeBaseline(
  snapshots: readonly PlanSnapshot[],
  asOf: string,
): ChangeBaseline | null {
  const month = isoMonth(asOf);
  let earlier: PlanSnapshot | null = null;
  let same: PlanSnapshot | null = null;
  for (const s of snapshots) {
    const m = isoMonth(s.asOf);
    if (m < month && (earlier === null || s.asOf > earlier.asOf)) earlier = s;
    if (m === month && (same === null || s.asOf < same.asOf)) same = s;
  }
  if (earlier !== null) return { snapshot: earlier, kind: "earlier-month" };
  return same === null ? null : { snapshot: same, kind: "first-this-month" };
}

/** Back into the vault shape. The preferences are stamped `at` (the write time,
 *  passed in: no clock in core); each snapshot is stamped with its own `asOf`
 *  and keyed by its month. */
export function encodePlanState(state: PlanState, at: string): PlanSection {
  const snapshots: Record<string, Stamped> = {};
  for (const s of state.snapshots) {
    snapshots[isoMonth(s.asOf)] = {
      at: s.asOf,
      value: Schema.encodeSync(PlanSnapshotSchema)(s),
    };
  }
  return {
    preferences: {
      at,
      value: Schema.encodeSync(PlanPreferencesSchema)(state.preferences),
    },
    snapshots,
  };
}

/** One snapshot per month: the first one stored in it, never replaced (the
 *  live plan is compared with it, so it must not move). The newest
 *  PLAN_SNAPSHOT_LIMIT months are kept, oldest first. A snapshot dated before
 *  the newest stored one (a lagging clock, a tab left open across a month end)
 *  is not stored: the list comes back unchanged. */
export function addSnapshot(
  snapshots: readonly PlanSnapshot[],
  next: PlanSnapshot,
): PlanSnapshot[] {
  const newest = snapshots.reduce<string | null>(
    (best, s) => (best === null || s.asOf > best ? s.asOf : best),
    null,
  );
  if (newest !== null && next.asOf < newest) return [...snapshots];
  const byMonth = new Map<string, PlanSnapshot>();
  for (const s of snapshots) byMonth.set(isoMonth(s.asOf), s);
  if (!byMonth.has(isoMonth(next.asOf))) byMonth.set(isoMonth(next.asOf), next);
  return [...byMonth.keys()]
    .sort()
    .slice(-PLAN_SNAPSHOT_LIMIT)
    .map((m) => byMonth.get(m)!);
}
