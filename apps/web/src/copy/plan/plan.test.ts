import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  BUFFER_CALC_IDS,
  CARDS_CALC_IDS,
  DEBTS_CALC_IDS,
  GOALS_CALC_IDS,
  MISSING_KINDS,
  MONTH_CALC_IDS,
  PENDING_PUBLIC_FACT_IDS,
  PUBLIC_FACTS,
  MIN_HISTORY_PERIODS,
  publicScenarioTable,
  SECTION_IDS,
  SPENDING_CALC_IDS,
  STATUS_REASON_KEYS,
  SUBS_CALC_IDS,
  findAdviceLanguage,
  type BufferFigures,
  type CardNet,
  type CardsFigures,
  type DebtFigures,
  type DebtRow,
  type GoalRow,
  type GoalsFigures,
  type MonthFigures,
  type PublicFact,
  type SpendHistoryRow,
  type SpendingFigures,
  type SubRow,
  type SubsFigures,
} from "@lavega/core";
import type { Locale } from "../../locale.js";
import { intakeCopy } from "../intake.js";
import {
  FACT_GATED_EXAMPLES,
  assumptionsCopy,
  PLAN_NUMBERS,
  WORDING_TABLES,
  MISSING_KINDS_ARE_ALL_COVERED,
  REASON_KEYS_ARE_ALL_COVERED,
  bufferCopy,
  cardsCopy,
  debtsCopy,
  factLine,
  goalsCopy,
  learnShortHorizonText,
  monthCopy,
  planFmt,
  planShellCopy,
  spendingCopy,
  subscriptionsCopy,
} from "./index.js";

const LOCALES: Locale[] = ["nl", "en"];

type Tree = Record<string, unknown>;
function paths(node: unknown, prefix = ""): string[] {
  if (typeof node === "function") return [`${prefix}()`];
  if (Array.isArray(node)) return node.flatMap((v, i) => paths(v, `${prefix}[${i}]`));
  if (node && typeof node === "object")
    return Object.entries(node as Tree).flatMap(([k, v]) =>
      paths(v, prefix ? `${prefix}.${k}` : k),
    );
  return [prefix];
}

/* ---- probe figures: zero, negative, 1, 1_000_000 euros, and nothing known ---- */

const SPREAD = [0, -5_000, 1, 100_000_000];

const monthProbes = (): MonthFigures[] => {
  const base = {
    nibudGuidanceFactId: "nibud-save-10pct" as const,
  };
  const out: MonthFigures[] = [
    {
      ...base,
      room: { kind: "none", reason: "no-data" },
      incomeMiddleCents: null,
      fixedCents: null,
      fixedShare: null,
      variableCents: null,
      variableShare: null,
      savingsRate: null,
      savingsMovedCents: null,
    },
    {
      ...base,
      room: {
        kind: "none",
        reason: "no-full-month",
        blockingAccounts: [{ id: "a", reason: "stale" }],
      },
      incomeMiddleCents: null,
      fixedCents: null,
      fixedShare: null,
      variableCents: null,
      variableShare: null,
      savingsRate: null,
      savingsMovedCents: null,
    },
    {
      ...base,
      room: { kind: "stated", lowCents: 100, highCents: 900, incomeMidCents: 5000 },
      incomeMiddleCents: 5000,
      fixedCents: null,
      fixedShare: null,
      variableCents: null,
      variableShare: null,
      savingsRate: null,
      savingsMovedCents: null,
    },
  ];
  for (const n of SPREAD)
    out.push({
      ...base,
      room: {
        kind: "computed",
        months: [{ month: "2026-07", incomingCents: 1000, outgoingCents: 900, netCents: n }],
        middleCents: n,
        middleIncomeCents: 1000,
        lowCents: n - 1,
        highCents: n + 1,
        partial: n === 1,
        excludedForeignCount: n === 0 ? 2 : 0,
        blockingAccounts: n === 1 ? [{ id: "x", reason: "short", since: "2026-06" }] : [],
      },
      incomeMiddleCents: 1000,
      fixedCents: n,
      fixedShare: n / 1000,
      variableCents: Math.max(0, n),
      variableShare: Math.max(0, n) / 1000,
      savingsRate: n / 1000,
      savingsMovedCents: n,
    });
  return out;
};

const bufferProbes = (): BufferFigures[] => {
  const empty: BufferFigures = {
    liquidSavingsCents: null,
    fixedCostsMonthlyCents: null,
    incomeBufferMonths: null,
    targetMonths: null,
    gapCents: null,
    gapMonths: null,
    closeMonths: null,
    closeRoom: null,
    statedOverlapGoalCount: 0,
    objectBufferCents: null,
    objectShareOfSavings: null,
    excludedForeignCount: 0,
    goalLinkedExcludedCents: 0,
  };
  const out: BufferFigures[] = [empty];
  for (const n of SPREAD)
    for (const close of [{ low: 1, high: 9 }, "not-reachable", null] as const)
      out.push({
        liquidSavingsCents: n,
        fixedCostsMonthlyCents: Math.abs(n) + 1,
        incomeBufferMonths: n / (Math.abs(n) + 1),
        targetMonths: 4,
        gapCents: n,
        gapMonths: n / (Math.abs(n) + 1),
        closeMonths: close,
        closeRoom:
          close === null || close === "not-reachable" ? null : { lowCents: 100, highCents: 300 },
        statedOverlapGoalCount: n === 1 ? 2 : 1,
        objectBufferCents: n,
        objectShareOfSavings: 0.25,
        excludedForeignCount: 1,
        goalLinkedExcludedCents: Math.abs(n),
      });
  return out;
};

const debtRow = (n: number, over: Partial<DebtRow> = {}): DebtRow => ({
  id: "d1",
  lender: "Lender X",
  balanceCents: n,
  ratePct: 9.5,
  rateSource: "stated",
  monthlyCents: Math.abs(n),
  interestPerYearCents: n,
  payoffMonths: 14,
  payoffDate: "2027-12-01",
  payoffReason: null,
  withExtra: { extraCents: 5000, payoffMonths: 10, monthsEarlier: 4, interestSavedCents: n },
  kind: "consumer",
  ...over,
});

const debtProbes = (): DebtFigures[] => {
  const base = { invisibleDebtNotice: true as const };
  const out: DebtFigures[] = [
    {
      ...base,
      rows: [],
      totalInterestPerYearCents: null,
      savingsRatePct: null,
    },
  ];
  for (const n of SPREAD)
    out.push({
      ...base,
      rows: [
        debtRow(n),
        debtRow(n, { id: "d2", ratePct: null, rateSource: null, interestPerYearCents: null }),
        debtRow(n, { id: "d3", balanceCents: null, interestPerYearCents: null }),
        debtRow(n, {
          id: "d4",
          payoffMonths: null,
          payoffDate: null,
          payoffReason: "payment-below-interest",
          kind: "duo",
        }),
        debtRow(n, {
          id: "d5",
          payoffMonths: null,
          payoffDate: null,
          payoffReason: "no-balance",
          rateSource: "detected",
          withExtra: null,
        }),
        debtRow(n, {
          id: "d6",
          payoffMonths: null,
          payoffDate: null,
          payoffReason: "no-rate",
          withExtra: {
            extraCents: 1,
            payoffMonths: null,
            monthsEarlier: null,
            interestSavedCents: null,
          },
        }),
      ],
      totalInterestPerYearCents: n,
      savingsRatePct: 2.1,
    });
  return out;
};

const spendRow = (n: number, over: Partial<SpendHistoryRow> = {}): SpendHistoryRow => ({
  category: "groceries",
  lastMonthCents: n,
  avg3Cents: n,
  median12Cents: n,
  trend6: [n, n, n, n, n, n],
  percentile: 0.7,
  percentileReason: null,
  limitCents: 1000,
  overLimitMonths: 2,
  ...over,
});

const spendingProbes = (): SpendingFigures[] => {
  const base = {
    externalBenchmark: null,
    budgetAdviceLink: "nibud-persoonlijk-budgetadvies" as const,
  };
  const out: SpendingFigures[] = [
    { ...base, months: 0, firstMonth: null, lastMonth: null, excludedForeignCount: 0, rows: [] },
  ];
  for (const n of SPREAD)
    out.push({
      ...base,
      months: 7,
      firstMonth: "2026-01",
      lastMonth: "2026-07",
      excludedForeignCount: 3,
      rows: [
        spendRow(n),
        spendRow(n, {
          category: "x",
          median12Cents: null,
          percentile: null,
          percentileReason: "geen-gegevens",
          limitCents: null,
          overLimitMonths: 0,
        }),
        spendRow(n, {
          category: "y",
          percentile: null,
          percentileReason: "te-weinig-geschiedenis",
        }),
        spendRow(n, { category: "z", percentile: null, percentileReason: "nieuwe-categorie" }),
        spendRow(n, { category: "w", percentile: null, percentileReason: "te-kort-bekend" }),
        spendRow(n, { category: "v", percentile: null, percentileReason: "geen-verschil" }),
      ],
    });
  return out;
};

const subRow = (n: number, over: Partial<SubRow> = {}): SubRow => ({
  key: "k",
  name: "Service",
  function: "video",
  monthlyCents: n,
  yearlyCents: n * 12,
  monthsActive: 5,
  priceChange: { changeDate: "2026-03-01", fromCents: 999, toCents: 1179, changePct: 0.18 },
  overlapGroup: "video",
  overlapCombinedMonthlyCents: n * 2,
  skippedCycles: 1,
  usage: { loggedMonths: 2, lastLoggedMonth: "2026-09", costPerUseCents: n },
  decision: null,
  facts: ["price-up", "overlap", "no-use-logged", "missed-payment"],
  ...over,
});

const subsProbes = (): SubsFigures[] => {
  const out: SubsFigures[] = [
    {
      rows: [],
      totalMonthlyCents: 0,
      totalYearlyCents: 0,
      whatIfCancelMonthlyCents: 0,
      whatIfCancelYearlyCents: 0,
      coverageDays: 30,
      excludedForeignCount: 0,
      excludedFixedCosts: [],
    },
  ];
  for (const n of SPREAD)
    out.push({
      rows: [
        subRow(n),
        subRow(n, {
          priceChange: null,
          overlapGroup: null,
          overlapCombinedMonthlyCents: null,
          usage: "unknown",
          skippedCycles: 2,
        }),
      ],
      totalMonthlyCents: n,
      totalYearlyCents: n * 12,
      whatIfCancelMonthlyCents: n,
      whatIfCancelYearlyCents: Math.abs(n) + 1,
      coverageDays: 120,
      excludedForeignCount: 2,
      excludedFixedCosts: [{ name: "Energie" }],
    });
  return out;
};

const cardNet = (n: number, over: Partial<CardNet> = {}): CardNet => ({
  cardKey: "c1",
  name: "Card A",
  programId: "p",
  spendCents: Math.abs(n),
  earnedCents: n,
  feeShareCents: 100,
  cashbackTier: "measured",
  net: null,
  netCents: n,
  pointsEarned: 310,
  pointsValueRange: { lowCents: n, medianCents: n, highCents: n },
  ...over,
});

const NO_ADVICE: CardsFigures["advice"] = {
  state: "short-history",
  spend: {
    windowCents: 0,
    months: 0,
    foreignCents: 0,
    excludedForeignCount: 0,
    annualCents: 0,
    annualForeignCents: 0,
  },
  baseline: { kind: "no-card", netCents: 0 },
  verdict: { kind: "no-options" },
  options: [],
  notComparable: [],
  interest: [],
  ignoresInterest: false,
  points: [],
};

const cardsProbes = (): CardsFigures[] => {
  const base = { criteria: [], sharedCases: true as const, advice: NO_ADVICE };
  const out: CardsFigures[] = [
    {
      ...base,
      nets: [],
      cardInUseKey: null,
      cardableSpendCents: 0,
      notCardableSpendCents: 0,
      months: 0,
      breakEven: [],
      balances: [],
      excludedForeignCount: 0,
    },
  ];
  for (const n of SPREAD)
    for (const months of [3, 12])
      out.push({
        ...base,
        nets: [
          cardNet(n),
          cardNet(n, { cardKey: "c2", name: "Card B", cashbackTier: "assumed" }),
          cardNet(n, {
            cardKey: "c3",
            name: "Card C",
            cashbackTier: "unknown",
            earnedCents: null,
            netCents: null,
            feeShareCents: null,
            pointsEarned: null,
            pointsValueRange: null,
          }),
          cardNet(n, {
            cardKey: "c4",
            name: "Card D",
            feeShareCents: null,
            pointsValueRange: null,
          }),
        ],
        cardInUseKey: "c1",
        cardableSpendCents: n,
        notCardableSpendCents: 0,
        months,
        breakEven: [
          { cardKey: "c1", annualSpendCents: n },
          { cardKey: "zz", annualSpendCents: null },
        ],
        balances: [
          { programId: "p", points: 1, stale: true, expiresOn: "2027-03-31", valueRange: null },
          { programId: "q", points: n, stale: false, expiresOn: null, valueRange: null },
        ],
        excludedForeignCount: 4,
      });
  return out;
};

const goalRow = (n: number, over: Partial<GoalRow> = {}): GoalRow => ({
  goalId: "g1",
  purpose: "Holiday",
  kind: "general",
  childId: null,
  yearsLeft: 3,
  targetCents: Math.abs(n) + 1,
  savedCents: n,
  savedSource: "linked",
  linkedAccountCount: 2,
  brokerRefsNotCounted: 1,
  linkedExcludedCount: 1,
  sharedWithGoals: 1,
  fundedRatio: 0.5,
  allocatedSavedCents: n,
  scheduleFrom: null,
  deduction: { cents: n, source: "planned" },
  requiredMonthly: [
    { rate: 0, cents: n },
    { rate: 0.02, cents: null },
  ],
  plannedMonthlyCents: null,
  gapCents: n,
  scheduleCents: 100,
  behind: true,
  toTargetByDate: "2036-01-01",
  ...over,
});

const goalsProbes = (): GoalsFigures[] => {
  const base = {
    capacity: {
      score: 3 as const,
      parts: { buffer: 1 as const, room: 1 as const, debt: 1 as const, horizon: 1 as const },
      missing: [],
    },
    scenarioTable: undefined as never,
    pendingFacts: [],
  };
  const out: GoalsFigures[] = [
    {
      ...base,
      rows: [],
      totalGapCents: 0,
      unallocated: { kind: "stopped", missing: ["room", "buffer-top-up", "goal-monthly"] },
      toleranceScore: null,
      disagreement: "unknown",
      loss: null,
      study: null,
      capacity: {
        score: null,
        parts: { buffer: null, room: null, debt: null, horizon: null },
        missing: [],
      },
    },
  ];
  for (const n of SPREAD)
    for (const disagreement of ["agree", "disagree", "unknown"] as const)
      out.push({
        ...base,
        totalGapCents: Math.abs(n),
        rows: [
          goalRow(n),
          goalRow(n, {
            goalId: "g2",
            behind: false,
            scheduleCents: null,
            savedSource: "stated",
            gapCents: -5,
            toTargetByDate: null,
            sharedWithGoals: 0,
            linkedExcludedCount: 0,
            brokerRefsNotCounted: 0,
            fundedRatio: null,
          }),
        ],
        unallocated: {
          kind: "computed",
          lowCents: n,
          highCents: n + 100,
          deductions: {
            bufferTopUpMonthlyCents: 5,
            goalsMonthlyCents: 6,
            goalsPlannedCents: 6,
            goalsRequiredCents: 0,
          },
          roomLowCents: n + 11,
          roomHighCents: n + 111,
        },
        toleranceScore: 4,
        disagreement,
        loss: { lossCents: Math.abs(n), monthsOfRoom: n === 1 ? null : 4.7 },
        study: {
          totalCents: Math.abs(n),
          monthlyCostCents: 90000,
          months: 48,
          tuitionCents: 250000,
          inflationPct: 2,
        },
      });
  return out;
};

type Rendered = { where: string; text: string };

/** Every string a section's templates can produce, for one locale. */
function renderSection(
  name: string,
  copy: {
    reasons: Record<string, string>;
    empty: Record<string, string>;
    howCalculated: Record<string, string>;
    education: { conceptId: string; title: string; body: string }[];
  },
  render: (f: never) => string[],
  probes: unknown[],
): Rendered[] {
  const out: Rendered[] = [];
  for (const [k, v] of Object.entries(copy.reasons))
    out.push({ where: `${name}.reasons.${k}`, text: v });
  for (const [k, v] of Object.entries(copy.empty))
    out.push({ where: `${name}.empty.${k}`, text: v });
  for (const [k, v] of Object.entries(copy.howCalculated))
    out.push({ where: `${name}.howCalculated.${k}`, text: v });
  for (const e of copy.education) {
    out.push({ where: `${name}.education.${e.conceptId}.title`, text: e.title });
    out.push({ where: `${name}.education.${e.conceptId}.body`, text: e.body });
  }
  probes.forEach((p, i) => {
    for (const t of render(p as never)) out.push({ where: `${name}.probe#${i}`, text: t });
  });
  return out;
}

/** Every static string in a copy tree (labels, notes, tier names), not only
 *  the ones the render harness happens to call. */
function leaves(node: unknown, prefix = ""): Rendered[] {
  if (typeof node === "string") return [{ where: prefix, text: node }];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${prefix}[${i}]`));
  if (node && typeof node === "object")
    return Object.entries(node as Tree).flatMap(([k, v]) =>
      leaves(v, prefix ? `${prefix}.${k}` : k),
    );
  return [];
}

function renderAll(locale: Locale): Rendered[] {
  const fmt = planFmt(locale);
  const m = monthCopy[locale];
  const b = bufferCopy[locale];
  const d = debtsCopy[locale];
  const s = spendingCopy[locale];
  const u = subscriptionsCopy[locale];
  const c = cardsCopy[locale];
  const g = goalsCopy[locale];
  const shell = planShellCopy[locale];
  const out: Rendered[] = [];

  out.push(
    ...renderSection(
      "month",
      m,
      (f: MonthFigures) => [
        m.headline(f, fmt),
        ...m.explain.simple(f, fmt),
        ...m.explain.detailed(f, fmt),
      ],
      monthProbes(),
    ),
    ...renderSection(
      "buffer",
      b,
      (f: BufferFigures) => [
        b.headline(f, fmt),
        ...b.explain.simple(f, fmt),
        ...b.explain.detailed(f, fmt),
      ],
      bufferProbes(),
    ),
    ...renderSection(
      "debts",
      d,
      (f: DebtFigures) => [
        d.headline(f, fmt),
        ...d.explain.simple(f, fmt),
        ...d.explain.detailed(f, fmt),
      ],
      debtProbes(),
    ),
    ...renderSection(
      "spending",
      s,
      (f: SpendingFigures) => [
        s.headline(f, fmt),
        ...s.explain.simple(f, fmt),
        ...s.explain.detailed(f, fmt),
      ],
      spendingProbes(),
    ),
    ...renderSection(
      "subscriptions",
      u,
      (f: SubsFigures) => [
        u.headline(f, fmt),
        ...u.explain.simple(f, fmt),
        ...u.explain.detailed(f, fmt),
      ],
      subsProbes(),
    ),
    ...renderSection(
      "cards",
      c,
      (f: CardsFigures) => [
        c.headline(f, fmt),
        ...c.explain.simple(f, fmt),
        ...c.explain.detailed(f, fmt),
      ],
      cardsProbes(),
    ),
    ...renderSection(
      "goals",
      g,
      (f: GoalsFigures) => [
        g.headline(f, fmt),
        ...g.explain.simple(f, fmt),
        ...g.explain.detailed(f, fmt),
      ],
      goalsProbes(),
    ),
  );

  // Row-level templates the page calls directly.
  for (const n of SPREAD) {
    const sub = subRow(n);
    out.push({ where: "subs.priceUp", text: u.priceUp(sub, fmt) ?? "" });
    out.push({ where: "subs.overlap", text: u.overlap(2, "video", fmt.eur(n)) });
    out.push({ where: "subs.noUse", text: u.noUseLogged(fmt.eur(n)) });
    out.push({ where: "subs.whatIf", text: u.whatIf(fmt.eur(n), fmt.eur(n)) });
    out.push({ where: "cards.points", text: c.pointsLine("Card A", cardNet(n), fmt) ?? "" });
    const st = c.stated;
    for (const [k, v] of Object.entries(st))
      if (typeof v === "string") out.push({ where: `cards.stated.${k}`, text: v });
    out.push({ where: "cards.stated.checkedOn", text: st.checkedOn(fmt.date("2026-08-20")) });
    out.push({ where: "cards.stated.billed", text: st.billed(fmt.eurExact(n), "maand") });
    out.push({ where: "cards.stated.total", text: st.total(fmt.eurExact(n)) });
    out.push({ where: "cards.stated.left", text: st.left(n) });
    out.push({ where: "spending.limit", text: s.limitLine("groceries", fmt.eur(n), 2) });
    out.push({ where: "goals.scenario", text: g.scenario.cell("2%", "0,2%", fmt.eur(n)) });
    out.push({
      where: "goals.scenarioAssumptions",
      text: g.scenario.assumptions(publicScenarioTable(), fmt),
    });
    out.push({ where: "buffer.target", text: b.targetInEuros("4", fmt.eur(n)) });
  }
  // Part B strings: every shape of the unallocated line, the goal "as of" lines,
  // the buffer worked example and notes, and the reference-budget slot.
  const fmtB = fmt;
  for (const [low, high] of [
    [10_000, 30_000],
    [-30_000, -10_000],
    [-30_000, 10_000],
    [10_000, 10_000],
  ] as const)
    for (const [planned, required] of [
      [20_000, 0],
      [0, 15_000],
      [20_000, 15_000],
      [0, 0],
    ] as const) {
      const line = {
        kind: "computed" as const,
        lowCents: low,
        highCents: high,
        deductions: {
          bufferTopUpMonthlyCents: 5_000,
          goalsMonthlyCents: planned + required,
          goalsPlannedCents: planned,
          goalsRequiredCents: required,
        },
        roomLowCents: 40_000,
        roomHighCents: 60_000,
      };
      out.push({ where: "goals.unallocatedLine.b", text: g.unallocatedLine(line, fmtB) });
      out.push({ where: "goals.unallocatedHeadline.b", text: g.unallocatedHeadline(line, fmtB) });
    }
  const stated = goalRow(5_000, {
    savedSource: "stated",
    scheduleFrom: "2026-03-01",
    toTargetByDate: "2027-03-01",
  });
  out.push({ where: "goals.statedAsOf", text: g.goal.statedAsOf("2026-03-01", fmtB) });
  out.push({ where: "goals.scheduleSpan", text: g.goal.scheduleSpan(stated, fmtB) ?? "" });
  out.push({
    where: "goals.savedLine.negative",
    text: g.goal.savedLine(goalRow(-30_000, { targetCents: 100_000, fundedRatio: -0.3 }), fmtB),
  });
  out.push({
    where: "goals.studyLine.b",
    text: g.studyLine(
      {
        totalCents: 4_800_000,
        monthlyCostCents: 90_000,
        months: 48,
        tuitionCents: 250_000,
        inflationPct: 2,
      },
      fmtB,
    ),
  });
  out.push({
    where: "buffer.closeExample",
    text:
      b.closeExample(
        {
          ...bufferProbes()[1]!,
          closeMonths: { low: 2, high: 4 },
          closeRoom: { lowCents: 10_000, highCents: 30_000 },
        },
        fmtB,
      ) ?? "",
  });
  out.push({ where: "buffer.statedOverlap", text: b.statedOverlapNote(2) ?? "" });
  out.push({ where: "goals.capacityLine", text: g.capacityLine(3, 4) });
  out.push({ where: "debts.kind", text: d.kindLabel.duo });
  out.push({ where: "debts.invisible", text: d.invisibleDebt });
  out.push({
    where: "spending.benchmark",
    text: s.facts.referenceBudget("€400", "Source"),
  });
  for (const key of ["room", "room-stale", "buffer-top-up", "goal-monthly"] as const)
    out.push({ where: "goals.stopped", text: g.unallocatedStopped([key]) });

  // The frame.
  out.push({ where: "shell.backbone", text: shell.backbone.neutral });
  for (const [k, step] of Object.entries(shell.backbone.steps)) {
    out.push({ where: `shell.backbone.${k}.fact`, text: step.fact(fmt.eur(1)) });
    out.push({ where: `shell.backbone.${k}.empty`, text: step.empty });
  }
  out.push({ where: "shell.header.plan", text: shell.header.planDate("1 Oct 2026") });
  out.push({ where: "shell.header.fresh1", text: shell.header.freshness("20 Oct", "14 Oct") });
  out.push({ where: "shell.header.fresh2", text: shell.header.freshness(null, null) });
  out.push({ where: "shell.changes.none", text: shell.changes.none });
  out.push({ where: "shell.changes.first", text: shell.changes.firstPlan });
  out.push({
    where: "shell.changes.sinceMonth",
    text: shell.changes.headingSinceMonth("September"),
  });
  out.push({ where: "shell.changes.sinceFirst", text: shell.changes.headingSinceFirst });
  out.push({ where: "shell.changes.status", text: shell.changes.statusChange("A", "B") });
  for (const [k, fn] of Object.entries(shell.changes.reasons))
    out.push({ where: `shell.changes.reasons.${k}`, text: fn({}) });
  out.push({ where: "shell.footer", text: shell.footer.notice });
  out.push({ where: "shell.invitation", text: shell.invitation.sentence });
  for (const [k, v] of Object.entries(shell.missing))
    out.push({ where: `shell.missing.${k}`, text: v });
  for (const [k, v] of Object.entries(shell.actions))
    out.push({ where: `shell.actions.${k}`, text: v });
  const trees = {
    shell: planShellCopy,
    month: monthCopy,
    buffer: bufferCopy,
    debts: debtsCopy,
    spending: spendingCopy,
    subscriptions: subscriptionsCopy,
    cards: cardsCopy,
    goals: goalsCopy,
    assumptions: assumptionsCopy,
  };
  for (const [name, t] of Object.entries(trees)) out.push(...leaves(t[locale], `static.${name}`));
  return out;
}

describe("plan copy: structure", () => {
  const trees = (): Array<[string, { nl: unknown; en: unknown }]> => [
    ["shell", planShellCopy],
    ["month", monthCopy],
    ["buffer", bufferCopy],
    ["debts", debtsCopy],
    ["spending", spendingCopy],
    ["subscriptions", subscriptionsCopy],
    ["cards", cardsCopy],
    ["goals", goalsCopy],
    ["assumptions", assumptionsCopy],
  ];

  test.each(trees())("%s has the same key paths in nl and en", (_n, copy) => {
    const nl = paths(copy.nl).sort();
    const en = paths(copy.en).sort();
    expect(en.filter((p) => !nl.includes(p))).toEqual([]);
    expect(nl.filter((p) => !en.includes(p))).toEqual([]);
  });

  test.each(LOCALES)(
    "%s: every status reason key has text in one section (data-stale: month and spending)",
    (l) => {
      const all = [
        monthCopy[l].reasons,
        bufferCopy[l].reasons,
        debtsCopy[l].reasons,
        spendingCopy[l].reasons,
        subscriptionsCopy[l].reasons,
        cardsCopy[l].reasons,
        goalsCopy[l].reasons,
      ].flatMap((r) => Object.keys(r));
      // data-stale is the one key two sections share: the same rule, mirrored.
      expect([...new Set(all)].sort()).toEqual([...STATUS_REASON_KEYS].sort());
      expect(all.filter((k, i) => all.indexOf(k) !== i)).toEqual(["data-stale"]);
      for (const r of [
        monthCopy,
        bufferCopy,
        debtsCopy,
        spendingCopy,
        subscriptionsCopy,
        cardsCopy,
        goalsCopy,
      ])
        for (const v of Object.values(r[l].reasons)) expect(v.trim()).not.toBe("");
    },
  );

  test.each(LOCALES)(
    "%s: every missing kind is named and has an empty state in some section",
    (l) => {
      const covered = [
        monthCopy[l].empty,
        bufferCopy[l].empty,
        debtsCopy[l].empty,
        spendingCopy[l].empty,
        subscriptionsCopy[l].empty,
        cardsCopy[l].empty,
        goalsCopy[l].empty,
      ].flatMap((r) => Object.keys(r));
      expect(new Set(covered)).toEqual(new Set(MISSING_KINDS));
      expect(Object.keys(planShellCopy[l].missing).sort()).toEqual([...MISSING_KINDS].sort());
      expect(Object.keys(planShellCopy[l].actions).sort()).toEqual([
        "connect-bank",
        "enter-figure",
        "import",
        "intake-question",
      ]);
      expect(Object.keys(planShellCopy[l].sectionTitles).sort()).toEqual([...SECTION_IDS].sort());
    },
  );

  test.each(LOCALES)("%s: howCalculated covers every calc id its section emits", (l) => {
    expect(Object.keys(monthCopy[l].howCalculated).sort()).toEqual([...MONTH_CALC_IDS].sort());
    expect(Object.keys(bufferCopy[l].howCalculated).sort()).toEqual([...BUFFER_CALC_IDS].sort());
    expect(Object.keys(debtsCopy[l].howCalculated).sort()).toEqual([...DEBTS_CALC_IDS].sort());
    expect(Object.keys(spendingCopy[l].howCalculated).sort()).toEqual(
      [...SPENDING_CALC_IDS].sort(),
    );
    expect(Object.keys(subscriptionsCopy[l].howCalculated).sort()).toEqual(
      [...SUBS_CALC_IDS].sort(),
    );
    expect(Object.keys(cardsCopy[l].howCalculated).sort()).toEqual([...CARDS_CALC_IDS].sort());
    expect(Object.keys(goalsCopy[l].howCalculated).sort()).toEqual([...GOALS_CALC_IDS].sort());
  });

  test.each(LOCALES)("%s: status word and symbol are non-empty and the symbols differ", (l) => {
    const st = planShellCopy[l].status;
    const symbols = Object.values(st).map((s) => s.symbol);
    for (const s of Object.values(st)) {
      expect(s.word.trim()).not.toBe("");
      expect(s.symbol.trim()).not.toBe("");
    }
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(Object.keys(st).sort()).toEqual(["attention", "not-enough-data", "on-track"]);
  });
});

describe("plan copy: wording", () => {
  test.each(LOCALES)(
    "%s: every rendered template, reason, empty state and note is free of advice language",
    (l) => {
      const hits = renderAll(l)
        // The footer states that LaVega now makes recommendations (owner, 27 Oct 2026).
        .filter((r) => !/shell\.footer/.test(r.where))
        .map((r) => ({ ...r, found: findAdviceLanguage(r.text, l) }))
        .filter((r) => r.found.length > 0)
        .map((r) => `${r.where}: [${r.found.join(", ")}] ${r.text}`);
      expect(hits).toEqual([]);
    },
  );

  test.each(LOCALES)("%s: rendering never leaks NaN, undefined, Infinity or null", (l) => {
    const bad = renderAll(l)
      .filter((r) => /NaN|undefined|Infinity|\bnull\b/.test(r.text))
      .map((r) => `${r.where}: ${r.text}`);
    expect(bad).toEqual([]);
  });

  test("the rendering harness produces a real volume of text (guards an empty pass)", () => {
    expect(renderAll("en").length).toBeGreaterThan(500);
    expect(renderAll("nl").length).toBeGreaterThan(500);
  });

  test("the checker itself catches a banned word in each locale", () => {
    expect(findAdviceLanguage("This is the best card for you.", "en")).not.toEqual([]);
    expect(findAdviceLanguage("Dit is de beste kaart voor jou.", "nl")).not.toEqual([]);
    expect(findAdviceLanguage("NL0000235190 is a fund", "en")).not.toEqual([]);
  });

  test.each(LOCALES)(
    "%s: no rendered text tells the user to invest, and no 'you can invest' form appears (the fixed backbone sentence is general education and is exempt)",
    (l) => {
      const bad = renderAll(l)
        .filter(
          (r) =>
            /\b(invest|investeer|beleg|belegt|beleggen|invest in)\b/i.test(r.text) &&
            r.where !== "shell.backbone" &&
            !r.where.startsWith("static."),
        )
        .map((r) => `${r.where}: ${r.text}`);
      expect(bad).toEqual([]);
    },
  );

  test.each(LOCALES)(
    "%s: a goal at 75% saved reads 75%, not 7,500% (funded share is a fraction)",
    (l) => {
      const line = goalsCopy[l].goal.savedLine(
        goalRow(750_000, { targetCents: 1_000_000, fundedRatio: 0.75 }),
        planFmt(l),
      );
      expect(line).toMatch(/\(75\s?%\)/);
      expect(line).not.toMatch(/7[.,]?500\s?%/);
    },
  );

  test.each(LOCALES)("%s: the not-allocated line says 'not allocated' and nothing more", (l) => {
    const g = goalsCopy[l];
    const fmt = planFmt(l);
    const line = g.unallocatedLine(
      {
        kind: "computed",
        lowCents: 41000,
        highCents: 74000,
        deductions: {
          bufferTopUpMonthlyCents: 5000,
          goalsMonthlyCents: 10000,
          goalsPlannedCents: 10000,
          goalsRequiredCents: 0,
        },
        roomLowCents: 56000,
        roomHighCents: 89000,
      },
      fmt,
    );
    expect(line).toMatch(l === "en" ? /is not allocated/ : /niet toegewezen/);
    expect(line).toContain(fmt.eur(41000));
    expect(line).toContain(fmt.eur(74000));
  });

  test.each(LOCALES)(
    "%s: no sentence in any module (frame, month, buffer, debts, spending, subscriptions, cards, goals) opens with an imperative",
    (l) => {
      const IMPERATIVE =
        /^(pay|move|build|use|cancel|reduce|invest|put|save|switch|repay|choose|pick|set|keep|betaal|los|bouw|gebruik|zeg|beperk|beleg|zet|spaar|kies|verplaats|schakel|houd)\b/i;
      // Data-entry labels (actions, the start button) and the user's own
      // decision buttons are controls, not sentences about money.
      const CONTROLS =
        /static\.assumptions\.(errors|save|clear|remove|add)\b|\.actions\.|invitation\.start|\.decisions\.|explainControls|recompute/;
      const bad = renderAll(l)
        .filter((r) => !CONTROLS.test(r.where))
        .filter((r) => IMPERATIVE.test(r.text.trim()))
        .map((r) => `${r.where}: ${r.text}`);
      expect(bad).toEqual([]);
    },
  );

  test("the cards copy never ranks: no 'best', no highlighted row, sorted by name", () => {
    for (const l of LOCALES) {
      expect(cardsCopy[l].sortNote.length).toBeGreaterThan(10);
      const all = leaves(cardsCopy[l])
        .map((r) => r.text)
        .join(" ");
      expect(all).not.toMatch(/\bbest\b|\bbeste\b/i);
    }
  });

  test.each(LOCALES)(
    "%s: a fee share over fewer than twelve months says it covers only those months",
    (l) => {
      const note = cardsCopy[l].feeShareNote(5);
      expect(note).toContain("5");
      expect(note).toMatch(l === "en" ? /only the 5 months of data/ : /alleen de 5 maanden/);
      expect(cardsCopy[l].feeShareNote(12)).not.toContain("only");
    },
  );

  test.each(LOCALES)(
    "%s: a shared-account row shows the counted amount, with the shared balance in the note",
    (l) => {
      const fmt = planFmt(l);
      const row = goalRow(800_000, {
        allocatedSavedCents: 400_000,
        targetCents: 1_000_000,
        fundedRatio: 0.4,
        sharedWithGoals: 1,
      });
      const saved = goalsCopy[l].goal.savedLine(row, fmt);
      expect(saved).toContain(fmt.eur(400_000));
      expect(saved).not.toContain(fmt.eur(800_000));
      const t = goalsCopy[l].goal.sharedLine(1, 800_000, fmt);
      expect(t).not.toBeNull();
      expect(t).toContain(fmt.eur(800_000));
      expect(t).toMatch(
        l === "en" ? /split equally across the 2 goals/ : /gelijk wordt verdeeld over de 2 doelen/,
      );
      expect(goalsCopy[l].goal.sharedLine(0, 800_000, fmt)).toBeNull();
      expect(findAdviceLanguage(t!, l)).toEqual([]);
    },
  );
});

describe("plan copy: wording tables", () => {
  test.each(LOCALES)("%s: allowed examples hold no advice language", (l) => {
    const hits = SECTION_IDS.flatMap((id) =>
      WORDING_TABLES[id].allowed[l]
        .map((t) => ({ id, t, found: findAdviceLanguage(t, l) }))
        .filter((r) => r.found.length > 0)
        .map((r) => `${r.id}: [${r.found.join(", ")}] ${r.t}`),
    );
    expect(hits).toEqual([]);
  });

  test.each(SECTION_IDS)(
    "%s: at least three forbidden examples, same count in both locales",
    (id) => {
      const t = WORDING_TABLES[id];
      expect(t.forbidden.en.length).toBeGreaterThanOrEqual(3);
      expect(t.forbidden.nl.length).toBe(t.forbidden.en.length);
      expect(t.allowed.nl.length).toBe(t.allowed.en.length);
      expect(t.allowed.en.length).toBeGreaterThan(0);
    },
  );
});

describe("plan copy: empty states", () => {
  test.each(LOCALES)(
    "%s: every empty state is specific, says nothing was estimated, and every action has a label",
    (l) => {
      const end = l === "en" ? /Nothing has been estimated\.$/ : /Er is niets geschat\.$/;
      const sections = [
        monthCopy,
        bufferCopy,
        debtsCopy,
        spendingCopy,
        subscriptionsCopy,
        cardsCopy,
        goalsCopy,
      ];
      for (const sec of sections)
        for (const [kind, text] of Object.entries(sec[l].empty)) {
          expect(text, kind).toMatch(end);
          expect(text.length, kind).toBeGreaterThan(60);
        }
      for (const a of Object.values(planShellCopy[l].actions)) expect(a.trim()).not.toBe("");
      for (const k of MISSING_KINDS) expect(planShellCopy[l].missing[k].trim()).not.toBe("");
    },
  );
});

describe("plan copy: public facts and the backbone", () => {
  test.each(LOCALES)(
    "%s: the unverified backbone is neutral: four parts, no order, no judgement",
    (l) => {
      const bb = planShellCopy[l].backbone;
      expect(bb.sourceFactId).toBe("afm-backbone");
      const text = [bb.heading, bb.neutral].join(" ");
      expect(text).not.toMatch(
        /first|eerst|then|daarna|expensive|dure|common|gangbare|gebruikelijk|order|volgorde|\bafm\b/i,
      );
      expect(findAdviceLanguage(text, l)).toEqual([]);
    },
  );

  const verified = (id: string): PublicFact => ({
    id,
    textKey: id,
    value: "A sourced sentence.",
    source: "AFM",
    sourceUrl: "https://example.org/x",
    verifiedOn: "2026-10-01",
    verifiedBy: "owner",
  });

  test("PUBLIC_FACTS ships empty, so every fact slot renders nothing", () => {
    expect(PUBLIC_FACTS.length).toBe(0);
    for (const id of PENDING_PUBLIC_FACT_IDS)
      expect(factLine(id, (v, s) => `${v} ${s}`)).toBeNull();
    for (const l of LOCALES) {
      expect(factLine("afm-backbone", planShellCopy[l].backbone.fromFact)).toBeNull();
      expect(learnShortHorizonText(l)).toBeNull();
    }
  });

  test("the backbone order sentence appears only from a verified afm-backbone fact", () => {
    const slot = planShellCopy.en.backbone.fromFact;
    expect(factLine("afm-backbone", slot, [])).toBeNull();
    const unverified: PublicFact = { ...verified("afm-backbone") };
    delete (unverified as { verifiedOn?: string }).verifiedOn;
    expect(factLine("afm-backbone", slot, [unverified])).toBeNull();
    expect(factLine("afm-backbone", slot, [verified("afm-backbone")])).toBe(
      "A sourced sentence. (AFM)",
    );
  });

  test("the short-horizon card renders only from a verified afm-long-term fact, and is clean", () => {
    for (const l of LOCALES) {
      const t = learnShortHorizonText(l, [verified("afm-long-term")]);
      expect(t).not.toBeNull();
      expect(findAdviceLanguage(t ?? "", l)).toEqual([]);
      expect(learnShortHorizonText(l, [verified("afm-costs")])).toBeNull();
    }
  });

  test("goal templates do not mention where money needed soon belongs", () => {
    for (const l of LOCALES) {
      const fmt = planFmt(l);
      const text = goalsProbes()
        .flatMap((f) => [
          ...goalsCopy[l].explain.simple(f, fmt),
          ...goalsCopy[l].explain.detailed(f, fmt),
        ])
        .join(" ");
      expect(text).not.toMatch(/soon|binnenkort|snel nodig|savings account|spaarrekening/i);
    }
  });
});

describe("plan formatter", () => {
  test("eur divides cents by 100 and shows whole euros; eurExact keeps the cents", () => {
    expect(planFmt("en").eur(123456)).toBe("€1,235");
    expect(planFmt("en").eurExact(123456)).toBe("€1,234.56");
    expect(planFmt("nl").eurExact(99)).toBe("€0,99");
    expect(planFmt("en").eur(-30000)).toBe("-€300");
    expect(planFmt("nl").eur(-30000)).toBe("-€300");
  });
  test("ranges are worded with 'to'/'tot' so a minus sign stays readable", () => {
    expect(planFmt("en").eurRange(-30000, 10000)).toBe("-€300 to €100");
    expect(planFmt("nl").eurRange(-30000, 10000)).toBe("-€300 tot €100");
  });
  test("a month count takes the singular", () => {
    expect(planFmt("en").monthsLabel(1)).toBe("1 month");
    expect(planFmt("nl").monthsLabel(1)).toBe("1 maand");
    expect(planFmt("nl").monthsLabel(2.4)).toBe("2,4 maanden");
  });
  test("pct reads a fraction, points reads percentage points", () => {
    expect(planFmt("en").pct(0.25)).toBe("25%");
    expect(planFmt("en").points(2.5)).toBe("2.5%");
  });
});

describe("plan copy: review fixes", () => {
  test("exhaustiveness is also checked at build time", () => {
    expect(REASON_KEYS_ARE_ALL_COVERED).toBe(true);
    expect(MISSING_KINDS_ARE_ALL_COVERED).toBe(true);
  });

  test.each(LOCALES)("%s: spending says the number core needs, not a literal six", (l) => {
    expect(PLAN_NUMBERS.spendingMonths).toBe(MIN_HISTORY_PERIODS + 1);
    const c = spendingCopy[l];
    const texts = [
      c.reasons["history-short-6m"],
      c.needsSixMonths,
      c.percentileReason["te-weinig-geschiedenis"],
      c.empty["history-6m"],
      planShellCopy[l].missing["history-6m"],
    ];
    for (const t of texts) expect(t).toContain(String(MIN_HISTORY_PERIODS + 1));
    expect(c.howCalculated["spend-percentile"]).toContain(String(MIN_HISTORY_PERIODS));
  });

  test("no template carries a threshold as a literal (they come from core through PLAN_NUMBERS)", () => {
    const dir = join(__dirname);
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "wording.ts",
    );
    const LITERAL =
      /\b(10|30|60|90|50)\s?(%|days|dagen|cent)|\b(six|zes)\b|\b(2|4|6)%|\b0[.,]2%|\b1[.,]5%/i;
    const hits = files.flatMap((f) =>
      readFileSync(join(dir, f), "utf8")
        .split("\n")
        .map((line, i) => ({ f, i: i + 1, line }))
        .filter(
          ({ line }) =>
            !line.trim().startsWith("//") && !line.trim().startsWith("*") && LITERAL.test(line),
        )
        .map(({ f, i, line }) => `${f}:${i}: ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  test("thresholds appear in the text from PLAN_NUMBERS", () => {
    const en = planFmt("en");
    expect(monthCopy.en.reasons["room-low"]).toContain(en.pct(PLAN_NUMBERS.roomShare));
    expect(monthCopy.en.reasons["room-low"]).toMatch(/marker LaVega uses itself, not a rule/);
    expect(monthCopy.nl.reasons["room-low"]).toMatch(/markering van LaVega zelf, geen regel/);
    // No card reason compares cards: both read the same neutral line.
    expect(cardsCopy.en.reasons["other-card-nets-more"]).toBe(
      "Net value per card for the same spending:",
    );
    expect(cardsCopy.en.reasons["no-better-card"]).toBe(
      cardsCopy.en.reasons["other-card-nets-more"],
    );
    expect(cardsCopy.nl.reasons["no-better-card"]).toBe(
      cardsCopy.nl.reasons["other-card-nets-more"],
    );
    expect(subscriptionsCopy.en.howCalculated["price-change"]).toContain(
      en.pct(PLAN_NUMBERS.priceIncreasePct),
    );
    expect(goalsCopy.en.howCalculated["loss-illustration"]).toContain(
      en.points(PLAN_NUMBERS.lossFallPct),
    );
    const t = publicScenarioTable();
    const assumptions = goalsCopy.en.scenario.assumptions(t, en);
    for (const r of t.grossRates) expect(assumptions).toContain(en.pct(r));
    for (const r of t.costs) expect(assumptions).toContain(en.pct(r));
  });

  test.each(LOCALES)(
    "%s: education holds definitions only: no market claim, no 'usually', no other households",
    (l) => {
      const secs = [
        monthCopy,
        bufferCopy,
        debtsCopy,
        spendingCopy,
        subscriptionsCopy,
        cardsCopy,
        goalsCopy,
      ];
      const text = secs.flatMap((c) => c[l].education.map((e) => `${e.title} ${e.body}`)).join(" ");
      expect(text).not.toMatch(
        /usually|typically|generally|meestal|doorgaans|gewoonlijk|other households|andere huishoudens|\bDUO\b|\bNibud\b|\bAFM\b/i,
      );
    },
  );

  test.each(LOCALES)(
    "%s: DUO rules and the Nibud benchmark render only from a verified source",
    (l) => {
      const f = debtProbes()[1]!;
      const fmt = planFmt(l);
      const text = debtsCopy[l].explain.detailed(f, fmt).join(" ");
      expect(text).not.toMatch(/DUO-regels|DUO rules/);
      expect("benchmarkLink" in spendingCopy[l]).toBe(false);
    },
  );

  test.each(LOCALES)("%s: negative room reads in neutral words and ranges stay readable", (l) => {
    const fmt = planFmt(l);
    const neg = monthProbes().find(
      (p) => p.room.kind === "computed" && p.room.middleCents === -5000,
    )!;
    const simple = monthCopy[l].explain.simple(neg, fmt).join(" ");
    const out = [
      monthCopy[l].headline(neg, fmt),
      ...monthCopy[l].explain.simple(neg, fmt),
      ...monthCopy[l].explain.detailed(neg, fmt),
    ].join(" ");
    expect(simple).toMatch(
      l === "en" ? /€50 more went out than came in/ : /€50 meer uit dan er binnenkwam/,
    );
    expect(out).not.toMatch(/-€\d+\s?[–-]\s?€/);
    expect(out).not.toMatch(/ left each month; the middle month was -|bleef er per maand tussen -/);
  });

  test.each(LOCALES)("%s: a negative savings balance is not shown as negative months", (l) => {
    const fmt = planFmt(l);
    const out = bufferProbes()
      .filter((p) => (p.incomeBufferMonths ?? 0) < 0)
      .flatMap((p) => [bufferCopy[l].headline(p, fmt), ...bufferCopy[l].explain.simple(p, fmt)])
      .join(" ");
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toMatch(/-\d+([.,]\d+)? (months|maanden)/);
  });

  test("NL and EN buffer calc text agree that the entered amount is marked, not added", () => {
    expect(bufferCopy.nl.howCalculated["liquid-savings"]).toMatch(/markeren we dat als ingevuld/);
    expect(bufferCopy.nl.howCalculated["liquid-savings"]).not.toMatch(/erbij/);
    expect(bufferCopy.en.howCalculated["liquid-savings"]).toMatch(/mark it as entered/);
  });

  test.each(LOCALES)(
    "%s: an empty state names the gap and carries no action; the action comes from the missing entry",
    (l) => {
      const ACTION_WORDS =
        /\b(connect|connecting|import|importing|enter|entering|add|adding|answer|answering|sync|koppel|koppelen|importeer|importeren|vul|invullen|voeg|toevoegen|beantwoord|synchroniseer)\b/i;
      const sections = [
        monthCopy,
        bufferCopy,
        debtsCopy,
        spendingCopy,
        subscriptionsCopy,
        cardsCopy,
        goalsCopy,
      ];
      const bad = sections.flatMap((sec) =>
        Object.entries(sec[l].empty)
          .filter(([, t]) => ACTION_WORDS.test(t))
          .map(([k, t]) => `${k}: ${t}`),
      );
      expect(bad).toEqual([]);
      // each action label is a single instruction (one sentence, no "or"/"of")
      for (const a of Object.values(planShellCopy[l].actions)) {
        expect(a).not.toMatch(/\b(or|of)\b|[.;]/);
      }
    },
  );

  test.each(LOCALES)("%s: the frame's neighbours use the same page name", (l) => {
    const s = planShellCopy[l];
    expect(s.header.knowsLink).toBe(l === "en" ? "What LaVega knows" : "Wat LaVega weet");
  });

  test("facts that quote a public source are not in WORDING_TABLES.allowed and are gated", () => {
    const allowed = SECTION_IDS.flatMap((id) => [
      ...WORDING_TABLES[id].allowed.en,
      ...WORDING_TABLES[id].allowed.nl,
    ]);
    for (const e of FACT_GATED_EXAMPLES) {
      expect(allowed).not.toContain(e.en);
      expect(allowed).not.toContain(e.nl);
      expect(factLine(e.factId, (v) => v)).toBeNull();
      expect(findAdviceLanguage(e.en, "en")).toEqual([]);
      expect(findAdviceLanguage(e.nl, "nl")).toEqual([]);
    }
  });

  test("WORDING_TABLES (with its forbidden examples) is imported by no view or component", () => {
    const root = join(__dirname, "..", "..");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const offenders = walk(root)
      .filter((p) => /\.(ts|tsx)$/.test(p) && !p.includes(join("copy", "plan")))
      .filter((p) => /WORDING_TABLES|FACT_GATED_EXAMPLES/.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("plan copy: final fix wave, part B", () => {
  const fmtOf = planFmt;
  const unalloc = (
    low: number,
    high: number,
    d: Partial<{ planned: number; required: number }> = {},
  ) => ({
    kind: "computed" as const,
    lowCents: low,
    highCents: high,
    deductions: {
      bufferTopUpMonthlyCents: 5_000,
      goalsMonthlyCents: (d.planned ?? 0) + (d.required ?? 0),
      goalsPlannedCents: d.planned ?? 0,
      goalsRequiredCents: d.required ?? 0,
    },
    roomLowCents: 10_000,
    roomHighCents: 20_000,
  });
  const NOT_INVEST = /invest|beleg/i;

  test.each(LOCALES)(
    "B1 %s: no visible title, backbone label or backbone sentence says investing",
    (l) => {
      const sh = planShellCopy[l];
      expect(sh.sectionTitles.goals).toBe(l === "en" ? "Goals" : "Doelen");
      expect(sh.backbone.steps.investing.label).toBe(l === "en" ? "Left over" : "Niet toegewezen");
      for (const t of [
        sh.sectionTitles.goals,
        sh.backbone.neutral,
        sh.backbone.heading,
        sh.backbone.steps.investing.label,
        sh.backbone.steps.investing.fact("€1"),
        sh.backbone.steps.investing.empty,
      ])
        expect(t).not.toMatch(NOT_INVEST);
    },
  );

  test.each(LOCALES)(
    "B2 %s: a negative unallocated line says more went out than came in, not 'not allocated'",
    (l) => {
      const g = goalsCopy[l];
      const fmt = fmtOf(l);
      const both = g.unallocatedLine(unalloc(-30_000, -10_000, { planned: 1_000 }), fmt);
      expect(both).toContain(fmt.eurRange(10_000, 30_000));
      expect(both).toMatch(
        l === "en" ? /more goes out than comes in/ : /meer uit dan er binnenkomt/,
      );
      expect(both).not.toMatch(l === "en" ? /not allocated/ : /niet toegewezen/);
      expect(both).not.toMatch(/-€/);
      const mixed = g.unallocatedLine(unalloc(-30_000, 10_000, { planned: 1_000 }), fmt);
      expect(mixed).toContain("€300");
      expect(mixed).toContain("€100");
      expect(mixed).not.toMatch(/-€/);
      const head = g.unallocatedHeadline(unalloc(-30_000, -10_000), fmt);
      expect(head).not.toMatch(/-€|not allocated|niet toegewezen/);
      expect(head).toContain("€100");
      expect(g.unallocatedHeadline(unalloc(10_000, 10_000), fmt)).not.toMatch(/ (to|tot) /);
    },
  );

  test.each(LOCALES)("B2/A14 %s: the line says whose number each goal deduction is", (l) => {
    const g = goalsCopy[l];
    const fmt = fmtOf(l);
    const zero = fmt.pct(PLAN_NUMBERS.requirementRate);
    const planned = g.unallocatedLine(unalloc(1, 2, { planned: 20_000 }), fmt);
    expect(planned).toContain("€200");
    expect(planned).not.toContain("LaVega");
    const required = g.unallocatedLine(unalloc(1, 2, { required: 15_000 }), fmt);
    expect(required).toContain("€150");
    expect(required).toContain(zero);
    expect(required).toContain("LaVega");
    const both = g.unallocatedLine(unalloc(1, 2, { planned: 20_000, required: 15_000 }), fmt);
    expect(both).toContain("€200");
    expect(both).toContain("€150");
    expect(both).toContain("LaVega");
    expect(g.howCalculated.unallocated).toContain("LaVega");
    expect(g.howCalculated.unallocated).toContain(zero);
  });

  test.each(LOCALES)(
    "B3 %s: an overdrawn linked account is not 'saved' and shows no percentage",
    (l) => {
      const line = goalsCopy[l].goal.savedLine(
        goalRow(-30_000, { targetCents: 100_000, fundedRatio: -0.3 }),
        fmtOf(l),
      );
      expect(line).toContain("-€300");
      expect(line).not.toMatch(/%/);
      expect(line).not.toMatch(l === "en" ? /-€300 of €1,000 saved/ : /-€300 van €1\.000 gespaard/);
      expect(line).toMatch(l === "en" ? /Nothing is saved/ : /niets gespaard/);
    },
  );

  test.each(LOCALES)("B4 %s: the debts detail holds only the user's own savings rate", (l) => {
    const fmt = fmtOf(l);
    const f = debtProbes()[1]!;
    const text = debtsCopy[l].explain.detailed(f, fmt).join(" ");
    expect(text).toContain(fmt.points(2.1));
    expect(text).not.toMatch(/highest|hoogste|vrij opneembaar|withdraw freely/i);
    expect("freeRateLine" in debtsCopy[l]).toBe(false);
    expect("rateProvenance" in debtsCopy[l]).toBe(false);
  });

  test.each(LOCALES)(
    "B5 %s: the spending reference line exists only as a public-fact slot",
    (l) => {
      expect("benchmarkLine" in spendingCopy[l]).toBe(false);
      expect(
        factLine("spending-reference-budget", spendingCopy[l].facts.referenceBudget),
      ).toBeNull();
      const line = factLine("spending-reference-budget", spendingCopy[l].facts.referenceBudget, [
        {
          id: "spending-reference-budget",
          textKey: "x",
          value: "€400",
          source: "Bron",
          sourceUrl: "https://example.org",
          verifiedOn: "2026-10-01",
          verifiedBy: "owner",
        },
      ]);
      expect(line).toContain("€400");
      expect(findAdviceLanguage(line ?? "", l)).toEqual([]);
    },
  );

  test.each(LOCALES)("B6 %s: subscriptions say 'same category', not 'do the same thing'", (l) => {
    const c = subscriptionsCopy[l];
    for (const t of [c.reasons.overlap, c.reasons.clean])
      expect(t).not.toMatch(/same thing|same function|hetzelfde|dezelfde functie|doen hetzelfde/i);
    expect(c.howCalculated.overlap).toMatch(l === "en" ? /same category/ : /dezelfde categorie/);
    expect(c.reasons.overlap).toMatch(l === "en" ? /same category/ : /dezelfde categorie/);
  });

  test.each(LOCALES)(
    "B7 %s: closing the gap is a conditional worked example; equal ends collapse",
    (l) => {
      const fmt = fmtOf(l);
      const f = bufferProbes().find(
        (p) => typeof p.closeMonths === "object" && p.closeMonths !== null,
      )!;
      const range = {
        ...f,
        closeMonths: { low: 2, high: 4 },
        closeRoom: { lowCents: 10_000, highCents: 30_000 },
      };
      const ex = bufferCopy[l].closeExample(range, fmt)!;
      expect(ex).toMatch(
        l === "en"
          ? /^Worked example: if .* each month went to your buffer/
          : /^Rekenvoorbeeld: als er elke maand .* naar je buffer ging/,
      );
      expect(ex).toContain(fmt.eurRange(10_000, 30_000));
      expect(ex).toContain(`${fmt.months(2)} ${l === "en" ? "to" : "tot"} ${fmt.monthsLabel(4)}`);
      const same = bufferCopy[l].closeExample(
        {
          ...range,
          closeMonths: { low: 4, high: 4 },
          closeRoom: { lowCents: 20_000, highCents: 20_000 },
        },
        fmt,
      )!;
      expect(same).toContain(fmt.monthsLabel(4));
      expect(same).not.toContain(`${fmt.months(4)} ${l === "en" ? "to" : "tot"} `);
      expect(same).not.toContain(fmt.eurRange(20_000, 20_000));
      expect(
        bufferCopy[l].closeExample({ ...range, closeMonths: "not-reachable" }, fmt),
      ).toBeNull();
      expect(bufferCopy[l].closeExample({ ...range, closeRoom: null }, fmt)).toBeNull();
      const text = [
        ...bufferCopy[l].explain.simple(range, fmt),
        ...bufferCopy[l].explain.detailed(range, fmt),
      ].join(" ");
      expect(text).not.toMatch(/takes|duurt het|gedeeld door de ruimte/);
    },
  );

  test.each(LOCALES)(
    "B8 %s: habits are education definitions, not a list on the month card",
    (l) => {
      expect("habits" in monthCopy[l]).toBe(false);
      expect("habits" in monthCopy[l].labels).toBe(false);
      const ids = monthCopy[l].education.map((e) => e.conceptId);
      expect(ids).toEqual(
        expect.arrayContaining(["paying-yourself-first", "automatic-transfer", "annual-review"]),
      );
      for (const e of monthCopy[l].education.filter(
        (x) =>
          x.conceptId.includes("-yourself-") ||
          x.conceptId === "automatic-transfer" ||
          x.conceptId === "annual-review",
      ))
        expect(e.title).toMatch(/\?$/);
    },
  );

  test.each(LOCALES)(
    "B9 %s: 'on schedule' is only over goals with an end date; the study line does not claim a rise",
    (l) => {
      expect(goalsCopy[l].reasons["on-schedule"]).toMatch(l === "en" ? /end date/ : /einddatum/);
      const line = goalsCopy[l].studyLine(
        {
          totalCents: 4_800_000,
          monthlyCostCents: 90_000,
          months: 48,
          tuitionCents: 250_000,
          inflationPct: 2,
        },
        fmtOf(l),
      );
      expect(line).toMatch(l === "en" ? /today's prices/ : /prijzen van nu/);
      expect(line).toMatch(l === "en" ? /not in this amount/ : /zit niet in dit bedrag/);
      expect(line).not.toMatch(/with the|met \d/);
    },
  );

  test.each(LOCALES)(
    "B10 %s: capacity is described, not granted: no 'what your numbers allow', in the plan or the intake",
    (l) => {
      const fmt = fmtOf(l);
      const plan = goalsCopy[l].capacityLine(3, 4);
      const intake = intakeCopy[l].block3.result.capacity(3);
      for (const t of [plan, intake, planShellCopy[l].figureLabels.capacity_score])
        expect(t).not.toMatch(/toelaten|allow|mag\b|permit/i);
      expect(plan).toMatch(l === "en" ? /scale 1 to 5/ : /schaal 1 tot 5/);
      expect(intake).toMatch(l === "en" ? /scale 1 to 5/ : /schaal 1 tot 5/);
      expect(plan).toContain("3");
      expect(findAdviceLanguage(`${plan} ${intake}`, l)).toEqual([]);
      expect(fmt.plain(1)).toBe("1");
    },
  );

  test("B12: points per euro formats without a percent sign", () => {
    for (const l of LOCALES) {
      expect(fmtOf(l).plain(1.5)).not.toContain("%");
      expect(fmtOf(l).plain(1.5)).toBe(l === "en" ? "1.5" : "1,5");
      expect(fmtOf(l).points(1.5)).toContain("%");
    }
  });

  test.each(LOCALES)(
    "B13 %s: the stated-savings overlap note appears only when there is an overlap",
    (l) => {
      const b = bufferCopy[l];
      expect(b.statedOverlapNote(0)).toBeNull();
      expect(b.statedOverlapNote(1)).toMatch(l === "en" ? /same money/ : /hetzelfde geld/);
      expect(b.statedOverlapNote(2)).not.toBeNull();
      const f = { ...bufferProbes()[1]!, statedOverlapGoalCount: 1 };
      expect(b.explain.detailed(f, fmtOf(l)).join(" ")).toMatch(
        l === "en" ? /same money/ : /hetzelfde geld/,
      );
      expect(
        b.explain.detailed({ ...f, statedOverlapGoalCount: 0 }, fmtOf(l)).join(" "),
      ).not.toMatch(l === "en" ? /same money/ : /hetzelfde geld/);
    },
  );

  test.each(LOCALES)(
    "B14 %s: cards reason is a plain fact; month has a data-stale reason; stated goals are 'as of' a date",
    (l) => {
      const t = cardsCopy[l].reasons["other-card-nets-more"];
      expect(t).not.toMatch(/switch|overstap|beter|better|should|zou je/i);
      expect(findAdviceLanguage(t, l)).toEqual([]);
      expect(monthCopy[l].reasons["data-stale"].length).toBeGreaterThan(20);
      expect(monthCopy[l].empty["account-stale"]).toMatch(
        l === "en" ? /Nothing has been estimated\.$/ : /Er is niets geschat\.$/,
      );
      const fmt = fmtOf(l);
      const row = goalRow(5_000, {
        savedSource: "stated",
        scheduleFrom: "2026-03-01",
        toTargetByDate: "2027-03-01",
      });
      expect(goalsCopy[l].goal.statedAsOf("2026-03-01", fmt)).toContain(fmt.date("2026-03-01"));
      expect(goalsCopy[l].goal.scheduleSpan(row, fmt)).toContain(fmt.date("2027-03-01"));
      expect(goalsCopy[l].goal.scheduleSpan({ ...row, scheduleFrom: null }, fmt)).toBeNull();
      const detailed = goalsCopy[l].explain.detailed({ ...goalsProbes()[1]!, rows: [row] }, fmt);
      expect(detailed.join(" ")).toContain(fmt.date("2026-03-01"));
    },
  );
});

describe("plan copy: Part A wording that Part B had to follow", () => {
  test.each(LOCALES)(
    "%s: savings rate is not 'moved plus left over'; cards name the spend left out",
    (l) => {
      const fmt = planFmt(l);
      const m = monthProbes().find((p) => p.savingsRate !== null)!;
      const text = [
        ...monthCopy[l].explain.detailed(m, fmt),
        monthCopy[l].howCalculated["savings-rate"],
      ].join(" ");
      expect(text).not.toMatch(/plus wat overbleef|plus what was left/);
      expect(text).toMatch(
        l === "en" ? /already in it|not added again/ : /zit daar al in|niet nog eens/,
      );
      const c = { ...cardsProbes()[1]!, notCardableSpendCents: 12_300 };
      expect(cardsCopy[l].explain.detailed(c, fmt).join(" ")).toContain("€123");
      expect(cardsCopy[l].howCalculated["cardable-spend"]).toMatch(l === "en" ? /rent/ : /huur/);
    },
  );
});
