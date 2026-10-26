import { isIsoDate, monthsBetween } from "../advisor/months.js";
import { personalView } from "../advisor/scopePersonal.js";
import { computeBuffer, type BufferFigures } from "./buffer.js";
import { computeCards, type CardsFigures } from "./cards.js";
import { computeDebts, type DebtFigures } from "./debts.js";
import {
  PLAN_ENGINE_VERSION,
  buildFactSheet,
  type FactSheet,
} from "./factsheet.js";
import { computeGoals, type GoalsFigures } from "./goals.js";
import { computeMonth, type MonthFigures } from "./month.js";
import type {
  PlanMarkers,
  PlanSnapshot,
  RefreshTrigger,
} from "./preferences.js";
import { computeSpending, type SpendingFigures } from "./spending.js";
import { computeSubscriptions, type SubsFigures } from "./subs.js";
import { PLAN_THRESHOLDS } from "./thresholds.js";
import {
  SECTION_IDS,
  type FigureValue,
  type PlanFact,
  type PlanInput,
  type SectionResult,
} from "./types.js";

export type PlanSections = {
  month: SectionResult<MonthFigures>;
  buffer: SectionResult<BufferFigures>;
  debts: SectionResult<DebtFigures>;
  spending: SectionResult<SpendingFigures>;
  subscriptions: SectionResult<SubsFigures>;
  cards: SectionResult<CardsFigures>;
  goals: SectionResult<GoalsFigures>;
};

/** Only facts from the user's own sections; nothing here orders or ranks steps. */
export type PlanBackbone = {
  buffer: FigureValue | null;
  debtInterestPerYear: FigureValue | null;
  goalsGap: FigureValue | null;
  investingUnallocated: { low: FigureValue; high: FigureValue } | null;
};

/** `markers` hold raw subscription and card keys: for the encrypted snapshot
 *  only, never handed to the AI layer (use `factSheet`). */
export type PlanResult = {
  asOf: string;
  thresholdsVersion: string;
  sections: PlanSections;
  facts: PlanFact[];
  /** A function so the locale-dependent hash is computed lazily. */
  factSheet: (
    locale: "nl" | "en",
    taskType?: "plan" | "digest" | "note",
  ) => FactSheet;
  markers: PlanMarkers;
  backbone: PlanBackbone;
  freshness: {
    bankDataTo: string | null;
    profileConfirmedAt: string | null;
  };
};

const sorted = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();
const cents = (value: number): FigureValue => ({ unit: "cents", value });

function markersOf(i: PlanInput, s: PlanSections): PlanMarkers {
  const day = i.asOf.slice(0, 10);
  const within12m = s.goals.figures.rows.flatMap((r) => {
    const t = r.toTargetByDate;
    return t !== null &&
      t >= day &&
      monthsBetween(i.asOf, t) <= PLAN_THRESHOLDS.goals.within12Months
      ? [r.goalId]
      : [];
  });
  return {
    incomeMedianCents: s.month.figures.incomeMiddleCents,
    incomeStreamIds: sorted(i.profile.incomeStreams.map((x) => x.id)),
    flaggedIncreaseKeys: sorted(
      s.subscriptions.figures.rows
        .filter((r) => r.facts.includes("price-up"))
        .map((r) => r.key),
    ),
    goalsWithin12m: sorted(within12m),
    debtIds: sorted(i.profile.debts.map((d) => d.id)),
    childCount: i.profile.children.length,
    cardKeys: sorted(s.cards.figures.nets.map((n) => n.cardKey)),
    pointsProgramIds: sorted(
      s.cards.figures.balances.map((b) => b.programId),
    ),
    bufferBelowWish: s.buffer.statusReason.key === "below-target",
  };
}

function backboneOf(s: PlanSections): PlanBackbone {
  const { debts, goals, buffer } = s;
  const interest = debts.figures.totalInterestPerYearCents;
  const rows = goals.figures.rows;
  const un = goals.figures.unallocated;
  return {
    buffer: buffer.headline?.value == null ? null : buffer.headline,
    debtInterestPerYear:
      debts.figures.rows.length === 0 || interest === null
        ? null
        : cents(interest),
    goalsGap:
      rows.length === 0
        ? null
        : cents(goals.figures.totalGapCents),
    investingUnallocated:
      un.kind === "computed"
        ? { low: cents(un.lowCents), high: cents(un.highCents) }
        : null,
  };
}

/** Newest personal-scope transaction date, none after asOf. */
function newestTxDate(i: PlanInput): string | null {
  const day = i.asOf.slice(0, 10);
  let best: string | null = null;
  for (const t of personalView(i.accounts, i.txs, i.entityProfiles).txs) {
    if (!isIsoDate(t.date)) continue;
    const d = t.date.slice(0, 10);
    if (d > day) continue;
    if (best === null || d > best) best = d;
  }
  return best;
}

/** Sections build ids from hash(key), a 32-bit hash, so two keys can collide.
 *  A repeated id gets -2, -3 ... in input (section) order; the rest are kept. */
export function uniqueFactIds(facts: readonly PlanFact[]): PlanFact[] {
  const used = new Set(facts.map((f) => f.factId));
  const seen = new Set<string>();
  return facts.map((f) => {
    if (!seen.has(f.factId)) {
      seen.add(f.factId);
      return f;
    }
    let n = 2;
    while (used.has(`${f.factId}-${n}`) || seen.has(`${f.factId}-${n}`)) n += 1;
    const factId = `${f.factId}-${n}`;
    used.add(factId);
    seen.add(factId);
    return { ...f, factId };
  });
}

/** Pure: the same input gives the same output. No clock, no network, no AI. */
export function computePlan(i: PlanInput): PlanResult {
  const month = computeMonth(i);
  const buffer = computeBuffer(i, month);
  const debts = computeDebts(i);
  const spending = computeSpending(i);
  const subscriptions = computeSubscriptions(i);
  const cards = computeCards(i);
  const goals = computeGoals(i, month, buffer, debts);
  const sections: PlanSections = {
    month,
    buffer,
    debts,
    spending,
    subscriptions,
    cards,
    goals,
  };
  const facts = uniqueFactIds(SECTION_IDS.flatMap((id) => sections[id].facts));
  return {
    asOf: i.asOf,
    thresholdsVersion: PLAN_THRESHOLDS.version,
    sections,
    facts,
    factSheet: (locale, taskType) =>
      buildFactSheet(facts, {
        locale,
        asOf: i.asOf,
        ...(taskType === undefined ? {} : { taskType }),
      }),
    markers: markersOf(i, sections),
    backbone: backboneOf(sections),
    freshness: { bankDataTo: newestTxDate(i), profileConfirmedAt: i.profile.profileUpdatedAt },
  };
}

export function snapshotOf(
  r: PlanResult,
  trigger: RefreshTrigger,
  profileHash: string,
): PlanSnapshot {
  const sections = Object.fromEntries(
    SECTION_IDS.map((id) => [
      id,
      {
        status: r.sections[id].status,
        statusReason: r.sections[id].statusReason,
        flat: r.sections[id].flat,
      },
    ]),
  ) as PlanSnapshot["sections"];
  return {
    asOf: r.asOf,
    thresholdsVersion: r.thresholdsVersion,
    engineVersion: PLAN_ENGINE_VERSION,
    profileHash,
    trigger,
    sections,
    markers: r.markers,
  };
}
