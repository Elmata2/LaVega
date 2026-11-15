import { capacityForParts } from "../advisor/resolve.js";
import { capacityToleranceFlag } from "../advisor/capacity.js";
import { isIsoDate, monthsBetween } from "../advisor/months.js";
import { hash } from "../hash.js";
import { fig, liquidAccountBalances, roomMiddleCents } from "./internal.js";
import type { BufferFigures } from "./buffer.js";
import type { DebtFigures } from "./debts.js";
import type { MonthFigures } from "./month.js";
import type { StudyAssumptions } from "./preferences.js";
import { PENDING_PUBLIC_FACT_IDS, showableFacts } from "./publicFacts.js";
import { goalScenarioRows, lossIllustration, publicScenarioTable } from "./scenarios.js";
import { PLAN_THRESHOLDS } from "./thresholds.js";
import type {
  CalcStep,
  FigureValue,
  FigureUnit,
  Missing,
  PlanFact,
  PlanInput,
  SectionResult,
  StatusReason,
} from "./types.js";

/** The fall, in percentage points, the loss illustration uses. */
export const LOSS_ILLUSTRATION_FALL_PCT = 30;

/** Every key this section puts in `flat` (the change log labels each one). */
export const GOALS_FLAT_IDS = [
  "goals_count",
  "goals_within_12m",
  "unallocated_low",
  "unallocated_high",
  "capacity_score",
  "tolerance_score",
] as const;
export type GoalsFlatId = (typeof GOALS_FLAT_IDS)[number];

export const GOALS_CALC_IDS = [
  "goal-saved",
  "goal-required-monthly",
  "goal-schedule",
  "unallocated",
  "loss-illustration",
] as const;
export type GoalsCalcId = (typeof GOALS_CALC_IDS)[number];

export type GoalRow = {
  goalId: string;
  purpose: string;
  kind: "general" | "child";
  childId: string | null;
  yearsLeft: number | null;
  targetCents: number;
  savedCents: number;
  savedSource: "linked" | "stated";
  linkedAccountCount: number;
  brokerRefsNotCounted: number;
  /** Bank refs that added nothing: foreign, unknown balance or no such account. */
  linkedExcludedCount: number;
  /** Other goals linked to at least one of the same accounts. */
  sharedWithGoals: number;
  /** saved / target as a fraction (0.75 = 75%). */
  fundedRatio: number | null;
  /** The saved amount this goal is charged with: its own accounts, with an
   *  account linked to several goals split equally between them, so a shared
   *  balance is never counted twice across goals. Equals savedCents when
   *  nothing is shared. */
  allocatedSavedCents: number;
  requiredMonthly: { rate: number; cents: number | null }[];
  plannedMonthlyCents: number | null;
  /** target - saved; negative once the target is exceeded. */
  gapCents: number;
  scheduleCents: number | null;
  /** The date the schedule starts (the goal's anchor), when it has one. */
  scheduleFrom: string | null;
  /** What the unallocated line takes off for this goal each month, and whose
   *  number it is: the user's planned amount, or what the goal needs at a 0%
   *  return (LaVega's own estimate). Null when it cannot be worked out. */
  deduction: { cents: number | null; source: "planned" | "required" };
  behind: boolean | null;
  toTargetByDate: string | null;
};

export type UnallocatedLine =
  | {
      kind: "computed";
      lowCents: number;
      highCents: number;
      deductions: {
        bufferTopUpMonthlyCents: number;
        goalsMonthlyCents: number;
        /** Of goalsMonthlyCents: the user's own planned amounts. */
        goalsPlannedCents: number;
        /** Of goalsMonthlyCents: LaVega's 0%-return requirement, for goals
         *  where the user planned nothing. */
        goalsRequiredCents: number;
      };
      roomLowCents: number;
      roomHighCents: number;
    }
  | { kind: "stopped"; missing: ("room" | "room-stale" | "buffer-top-up" | "goal-monthly")[] };

export type StudyPlan = {
  totalCents: number;
  monthlyCostCents: number;
  months: number;
  tuitionCents: number;
  inflationPct: number;
};

export type GoalsFigures = {
  rows: GoalRow[];
  unallocated: UnallocatedLine;
  /** Sum of max(0, target - allocated saved) over the goals: each distinct
   *  account counted once. */
  totalGapCents: number;
  capacity: ReturnType<typeof capacityForParts>;
  toleranceScore: 1 | 2 | 3 | 4 | 5 | null;
  disagreement: "disagree" | "agree" | "unknown";
  loss: { lossCents: number; monthsOfRoom: number | null } | null;
  scenarioTable: ReturnType<typeof publicScenarioTable>;
  study: StudyPlan | null;
  pendingFacts: string[];
};

/** Cost of the study plan after `yearsAhead` years of inflation, integer cents. */
export function studyCost(a: StudyAssumptions, yearsAhead: number): number {
  const base = a.tuitionCents + a.monthlyCostCents * a.months;
  return Math.round(base * (1 + a.inflationPct / 100) ** yearsAhead);
}

/** Today's prices: null unless every figure was entered and is usable. */
function studyPlanOf(a: StudyAssumptions | null): StudyPlan | null {
  if (a === null) return null;
  const ok =
    [a.monthlyCostCents, a.months, a.tuitionCents, a.inflationPct].every(Number.isFinite) &&
    a.monthlyCostCents >= 0 &&
    a.months >= 0 &&
    a.tuitionCents >= 0 &&
    a.inflationPct > -100;
  if (!ok) return null;
  return {
    totalCents: studyCost(a, 0),
    monthlyCostCents: a.monthlyCostCents,
    months: a.months,
    tuitionCents: a.tuitionCents,
    inflationPct: a.inflationPct,
  };
}

/** Raw ids that already fit the fact-id charset are kept; others are hashed. */
const idKey = (id: string): string => (/^[a-z0-9_-]+$/.test(id) ? id : hash(id));

/** Four decimals: 0.7512 is 75.12%. */
const roundRatio = (x: number): number => Math.round(x * 10_000) / 10_000;

/** One goal's share of the unallocated deduction. The user's planned amount
 *  wins; with none, the 0%-return requirement is LaVega's own estimate. A
 *  dated goal that is past needs nothing more. */
function deductionOf(
  planned: number | undefined,
  target: string | null,
  months: number | null,
  required: number | null,
): GoalRow["deduction"] {
  if (planned !== undefined) return { cents: planned, source: "planned" };
  if (target !== null && months === null) return { cents: 0, source: "required" };
  return { cents: required, source: "required" };
}

export function computeGoals(
  i: PlanInput,
  month: SectionResult<MonthFigures>,
  buffer: SectionResult<BufferFigures>,
  _debts: SectionResult<DebtFigures>,
): SectionResult<GoalsFigures> {
  const { eur } = liquidAccountBalances(i);
  const eurByKey = new Map(eur.map((a) => [a.key, a.cents]));
  const calc: CalcStep[] = [];
  const rows: GoalRow[] = [];
  let within12m = 0;
  const countedByGoal: Set<string>[] = [];

  // How many goals link each counted account, so a shared balance is split.
  const goalsPerAccount = new Map<string, number>();
  for (const { goal: g } of i.profile.goals) {
    const ids = new Set(g.accountRefs.filter((r) => r.kind === "bank").map((r) => r.id));
    for (const id of ids) {
      const c = eurByKey.get(id);
      if (c !== undefined && c !== null)
        goalsPerAccount.set(id, (goalsPerAccount.get(id) ?? 0) + 1);
    }
  }

  for (const { goal: g, since, startCents } of i.profile.goals) {
    const birth = i.profile.children.find((c) => c.id === g.childId)?.birthYear;
    const target = isIsoDate(g.targetDate)
      ? g.targetDate.slice(0, 10)
      : g.kind === "child" && birth !== undefined
        ? `${birth + 18}-12-31`
        : null;
    const past = target !== null && target < i.asOf.slice(0, 10);
    const months = target === null || past ? null : Math.max(1, monthsBetween(i.asOf, target));
    if (months !== null && monthsBetween(i.asOf, target!) <= PLAN_THRESHOLDS.goals.within12Months)
      within12m += 1;

    const bankIds = [...new Set(g.accountRefs.filter((r) => r.kind === "bank").map((r) => r.id))];
    const counted = bankIds.filter((id) => {
      const c = eurByKey.get(id);
      return c !== undefined && c !== null;
    });
    const linkedSum = counted.reduce((s, id) => s + eurByKey.get(id)!, 0);
    const linked = counted;
    countedByGoal.push(new Set(counted));
    const savedSource: GoalRow["savedSource"] = linked.length > 0 ? "linked" : "stated";
    const saved = linked.length > 0 ? linkedSum : (g.startingBalanceCents ?? 0);
    const brokerCount = g.accountRefs.filter((r) => r.kind === "broker").length;
    const allocated =
      linked.length > 0
        ? Math.round(
            linked.reduce((s, id) => s + eurByKey.get(id)! / (goalsPerAccount.get(id) ?? 1), 0),
          )
        : saved;

    const scen =
      months === null
        ? PLAN_THRESHOLDS.scenarioRates.map((rate) => ({ rate, cents: null }))
        : goalScenarioRows({ targetCents: g.targetCents, savedCents: allocated, months }).map(
            (r) => ({
              rate: r.annualRate,
              cents: r.requiredMonthlyCents,
            }),
          );

    // Straight line from the anchor (`since`, `startCents`: a date and the
    // amount saved on it, recorded together) to the target date.
    const start = startCents ?? g.startingBalanceCents ?? 0;
    let schedule: number | null = null;
    if (target !== null) {
      if (past || i.asOf.slice(0, 10) >= target) schedule = g.targetCents;
      else {
        const total = monthsBetween(since, target);
        if (total > 0) {
          const elapsed = Math.max(0, Math.min(total, monthsBetween(since, i.asOf)));
          schedule = Math.round(start + ((g.targetCents - start) * elapsed) / total);
        }
      }
    }

    const row: GoalRow = {
      goalId: g.id,
      purpose: g.purpose,
      kind: g.kind,
      childId: g.childId ?? null,
      yearsLeft: months === null ? null : months / 12,
      targetCents: g.targetCents,
      savedCents: saved,
      savedSource,
      linkedAccountCount: linked.length,
      brokerRefsNotCounted: brokerCount,
      linkedExcludedCount: bankIds.length - counted.length,
      sharedWithGoals: 0,
      fundedRatio: g.targetCents > 0 ? roundRatio(allocated / g.targetCents) : null,
      allocatedSavedCents: allocated,
      requiredMonthly: scen,
      plannedMonthlyCents: g.plannedMonthlyCents ?? null,
      gapCents: g.targetCents - allocated,
      scheduleCents: schedule,
      scheduleFrom: schedule === null ? null : since.slice(0, 10),
      deduction: deductionOf(g.plannedMonthlyCents, target, months, scen[0]?.cents ?? null),
      behind: schedule === null ? null : allocated < schedule,
      toTargetByDate: target,
    };
    rows.push(row);

    calc.push({
      id: "goal-saved",
      inputs: {
        linked_accounts: fig("count", linked.length),
        broker_not_counted: fig("count", brokerCount),
      },
      output: fig("cents", saved),
    });
    if (months !== null && scen[0]!.cents !== null) {
      calc.push({
        id: "goal-required-monthly",
        inputs: {
          target: fig("cents", g.targetCents),
          saved: fig("cents", allocated),
          months: fig("months", months),
        },
        output: fig("cents", scen[0]!.cents),
      });
    }
    if (schedule !== null) {
      calc.push({
        id: "goal-schedule",
        inputs: {
          start: fig("cents", start),
          target: fig("cents", g.targetCents),
        },
        output: fig("cents", schedule),
      });
    }
  }

  rows.forEach((r, n) => {
    r.sharedWithGoals = countedByGoal.filter(
      (o, m) => m !== n && [...o].some((id) => countedByGoal[n]!.has(id)),
    ).length;
  });

  // Unallocated: the room range minus the same deductions at both ends.
  const room = month.figures.room;
  const middle = roomMiddleCents(room);
  const stoppedMissing: ("room" | "room-stale" | "buffer-top-up" | "goal-monthly")[] = [];
  if (room.kind === "none") stoppedMissing.push("room");
  // The room rests on months that are not the latest: it is not a figure to
  // subtract from.
  else if (month.statusReason.key === "data-stale") stoppedMissing.push("room-stale");

  const gap = buffer.figures.gapCents;
  let topUp = 0;
  if (gap !== null && gap > 0) {
    const m = i.preferences.bufferTopUpMonths?.months;
    if (m === undefined || !(m > 0)) stoppedMissing.push("buffer-top-up");
    else topUp = Math.ceil(gap / m - 1e-9);
  } else if (gap === null && buffer.figures.targetMonths !== null) {
    // A wished-for buffer whose gap cannot be worked out (no savings figure or
    // no fixed costs) is not a full buffer: the line stops instead of assuming one.
    stoppedMissing.push("buffer-top-up");
  }
  let goalsMonthly = 0;
  let goalsPlanned = 0;
  let goalsRequired = 0;
  let goalMonthlyMissing = false;
  for (const r of rows) {
    const need = r.deduction.cents;
    if (need === null) goalMonthlyMissing = true;
    else {
      goalsMonthly += need;
      if (r.deduction.source === "planned") goalsPlanned += need;
      else goalsRequired += need;
    }
  }
  if (goalMonthlyMissing) stoppedMissing.push("goal-monthly");

  const unallocated: UnallocatedLine =
    stoppedMissing.length > 0 || room.kind === "none"
      ? { kind: "stopped", missing: stoppedMissing }
      : {
          kind: "computed",
          lowCents: room.lowCents - topUp - goalsMonthly,
          highCents: room.highCents - topUp - goalsMonthly,
          deductions: {
            bufferTopUpMonthlyCents: topUp,
            goalsMonthlyCents: goalsMonthly,
            goalsPlannedCents: goalsPlanned,
            goalsRequiredCents: goalsRequired,
          },
          roomLowCents: room.lowCents,
          roomHighCents: room.highCents,
        };
  if (unallocated.kind === "computed") {
    calc.push({
      id: "unallocated",
      inputs: {
        room_low: fig("cents", unallocated.roomLowCents),
        room_high: fig("cents", unallocated.roomHighCents),
        buffer_top_up: fig("cents", topUp),
        goals_monthly: fig("cents", goalsMonthly),
      },
      output: fig("cents", unallocated.lowCents),
    });
  }

  // Capacity: the same function About-you uses, fed the same profile figures.
  const capacity = capacityForParts(
    {
      savingsCents: i.profile.savingsStatedCents,
      fixedCostsMonthlyCents: i.profile.fixedCostsMonthlyCents ?? 0,
      debtMonthlyCents: i.profile.debts.map((d) => d.monthlyCents),
      goals: i.profile.goals.map((g) => g.goal),
    },
    room,
    i.asOf,
  );
  const tolerance = i.profile.tolerance;

  // The loss illustration needs the amount held in investments. The plan input
  // carries no invested or broker amounts (broker links are not counted), so
  // there is no such amount and the illustration is not shown: a fall in value
  // is never applied to bank savings.
  const investedCents: number | null = null;
  const loss =
    investedCents === null
      ? null
      : lossIllustration({
          amountCents: investedCents,
          fallPct: LOSS_ILLUSTRATION_FALL_PCT,
          roomMiddleCents: middle,
        });
  if (loss !== null && investedCents !== null) {
    calc.push({
      id: "loss-illustration",
      inputs: { amount: fig("cents", investedCents), fall: fig("pct", LOSS_ILLUSTRATION_FALL_PCT) },
      output: fig("cents", loss.lossCents),
    });
  }

  let status: SectionResult<GoalsFigures>["status"];
  let statusReason: StatusReason;
  const missing: Missing[] = [];
  if (rows.length === 0) {
    status = "not-enough-data";
    statusReason = { key: "no-goals" };
    missing.push({ kind: "goals", action: "intake-question" });
  } else if (room.kind === "none") {
    status = "not-enough-data";
    statusReason = { key: "no-room" };
    missing.push({ kind: "room", action: "connect-bank" });
  } else if (rows.some((r) => r.behind === true)) {
    status = "attention";
    statusReason = { key: "behind-schedule" };
  } else if (rows.every((r) => r.behind === null)) {
    status = "not-enough-data";
    statusReason = { key: "no-goal-dates" };
    for (const r of rows)
      missing.push({ kind: "goal-date", action: "enter-figure", ref: r.goalId });
  } else {
    status = "on-track";
    statusReason = { key: "on-schedule" };
  }

  const flat: Record<GoalsFlatId, FigureValue> = {
    goals_count: fig("count", rows.length),
    goals_within_12m: fig("count", within12m),
    unallocated_low: fig("cents", unallocated.kind === "computed" ? unallocated.lowCents : null),
    unallocated_high: fig("cents", unallocated.kind === "computed" ? unallocated.highCents : null),
    capacity_score: fig("count", capacity.score),
    tolerance_score: fig("count", tolerance),
  };

  const facts: PlanFact[] = [];
  const add = (
    factId: string,
    exact: number | null,
    unit: FigureUnit,
    extra: Partial<PlanFact> = {},
  ): void => {
    if (exact === null || !Number.isFinite(exact)) return;
    facts.push({
      factId,
      section: "goals",
      exact,
      unit,
      polarity: "neutral",
      mustMention: false,
      ...extra,
    });
  };
  for (const r of rows) {
    const k = idKey(r.goalId);
    if (r.scheduleCents !== null) {
      const diff = r.allocatedSavedCents - r.scheduleCents;
      add(`goal_gap:${k}`, diff, "cents", {
        polarity: diff < 0 ? "negative" : "neutral",
        mustMention: r.behind === true,
      });
    }
    add(`goal_funded_ratio:${k}`, r.fundedRatio, "ratio");
    add(`goal_required_monthly:${k}`, r.requiredMonthly[0]?.cents ?? null, "cents");
  }
  if (unallocated.kind === "computed") {
    add("unallocated_low", unallocated.lowCents, "cents", {
      polarity: unallocated.lowCents < 0 ? "negative" : "neutral",
    });
    add("unallocated_high", unallocated.highCents, "cents", {
      polarity: unallocated.highCents < 0 ? "negative" : "neutral",
    });
  }
  add("capacity_score", capacity.score, "count");
  add("tolerance_score", tolerance, "count");

  const shown = new Set(showableFacts().map((f) => f.id));
  return {
    section: "goals",
    figures: {
      rows,
      unallocated,
      totalGapCents: rows.reduce(
        (n, r) => n + Math.max(0, r.targetCents - r.allocatedSavedCents),
        0,
      ),
      capacity,
      toleranceScore: tolerance,
      disagreement: capacityToleranceFlag(capacity.score, tolerance),
      loss,
      scenarioTable: publicScenarioTable(),
      study: studyPlanOf(i.preferences.studyCostAssumptions),
      pendingFacts: PENDING_PUBLIC_FACT_IDS.filter((id) => !shown.has(id)),
    },
    flat,
    headline: fig("count", rows.length),
    status,
    statusReason,
    missing,
    calc,
    facts,
  };
}
