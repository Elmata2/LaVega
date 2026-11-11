/**
 * Budget envelopes with an explicit category-group map and signed carry
 * rollover (plan §3 WS2.9).
 *
 * Independent reimplementation of the envelope + carry contract in
 * we-promise/sure (AGPL-3.0), pinned at commit 562fe09 (2026-11-10):
 * `app/models/budget.rb`, `app/models/budget/rollover_calculator.rb` and
 * `app/models/budget_category.rb`. Sure stores outflow positive and keeps the
 * carry per budget category; this module uses integer cents and LaVega's flat
 * category strings, grouped only through the explicit `CategoryGroup` map.
 *
 * No clock: the caller passes the periods and the actuals. `asOf` is the
 * caller's date, never read here (plan §2.3).
 */

import { DateTime } from "effect";
import { addMonths, isoMonth } from "./advisor/months.js";

/* ---------- the stored shape ---------- */

/** One explicit parent row. LaVega categories are flat strings, so a parent is
 *  never invented: a category is in a group only when this map says so. The
 *  group name is a display name, not a spend category. */
export type CategoryGroup = {
  name: string;
  categories: readonly string[];
};

/** One category's allocation inside one period. */
export type BudgetLine = {
  category: string;
  /** Integer cents, never negative. */
  allocationCents: number;
  /** Surplus on this line rolls into the next period. Absent = the period's
   *  standing `rollover` flag decides. */
  rollover?: boolean;
};

/** One initialized month. An uninitialized month is simply absent from the
 *  list: a budget exists only where `budgetedSpendingCents` was written. */
export type BudgetPeriod = {
  /** The month the period starts in, `YYYY-MM`. */
  month: string;
  /** Optional custom month start day, 1..28 (Sure's `month_start_day`).
   *  Absent = 1, the calendar month. */
  monthStartDay?: number;
  /** ISO 4217 code. A change breaks the carry chain (Sure resets carry 0). */
  currency: string;
  /** The envelope for the period, integer cents. */
  budgetedSpendingCents: number;
  /** Standing rollover flag for this period; a line may override it. Off means
   *  no carry in and no carry out for the period. */
  rollover: boolean;
  lines: readonly BudgetLine[];
  /** Bills reserved: READ-ONLY slot for the bills model (issue #286). Null
   *  means "not known". This module never derives it and never spends it, so
   *  nothing here depends on the bills workstream landing. */
  billsReservedCents: number | null;
};

/* ---------- the computed shape ---------- */

export type BudgetLineState = {
  category: string;
  /** The group this line rolls up to; null for a top-level line. */
  group: string | null;
  allocationCents: number;
  carryInCents: number;
  /** allocation + carryIn. */
  availableCents: number;
  actualCents: number;
  /** available - actual; negative means the line is over. */
  remainingCents: number;
  /** max(0, remaining) when rollover applies, else 0. Only surplus carries. */
  carryOutCents: number;
};

export type BudgetGroupState = {
  name: string;
  lines: BudgetLineState[];
  allocationCents: number;
  carryInCents: number;
  actualCents: number;
  remainingCents: number;
  /** The children's carry, summed once. A ring-fenced child is never added to
   *  a parent total a second time: every line is in exactly one bucket. */
  carryOutCents: number;
};

export type BudgetPeriodState = {
  month: string;
  currency: string;
  budgetedSpendingCents: number;
  /** Sum of the line allocations: envelope money already given a category. */
  allocatedCents: number;
  /** budgeted - allocated: envelope money the owner has not allocated yet. */
  availableToAllocateCents: number;
  carryInCents: number;
  actualCents: number;
  remainingCents: number;
  carryOutCents: number;
  groups: BudgetGroupState[];
  /** Lines whose category is in no group. Each is a top-level line, never a
   *  child of an invented parent. */
  topLevel: BudgetLineState[];
  billsReservedCents: number | null;
};

export type BudgetChain = {
  /** Oldest first. Only initialized periods. */
  periods: BudgetPeriodState[];
  /** The newest period, or null when nothing is initialized. */
  last: BudgetPeriodState | null;
};

/** month -> category -> positive cents actually spent in that period. The
 *  caller nets refunds and converts to cents; this module never reads a Tx. */
export type BudgetActuals = Readonly<Record<string, Readonly<Record<string, number>>>>;

export type BudgetChainInput = {
  periods: readonly BudgetPeriod[];
  actuals?: BudgetActuals;
  groups?: readonly CategoryGroup[];
};

const clampCents = (n: number): number => Math.max(0, Math.round(n));

const groupOf = (groups: readonly CategoryGroup[], category: string): string | null => {
  for (const g of groups) if (g.categories.includes(category)) return g.name;
  return null;
};

const sortPeriods = (periods: readonly BudgetPeriod[]): BudgetPeriod[] => {
  // A duplicate month keeps the last writer, matching the vault's "newest
  // write wins" habit. Sorting is stable, so the input order breaks ties.
  const byMonth = new Map<string, BudgetPeriod>();
  for (const p of periods) byMonth.set(p.month, p);
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
};

const previousMonth = (month: string): string => addMonths(`${month}-01`, -1).slice(0, 7);

/** The envelope chain, oldest period first. Rules, each pinned by a test:
 *  - only initialized periods chain at all (`budgetPeriods` rows are initialized);
 *  - a month gap or a currency change breaks the chain (carry in 0);
 *  - a period with `rollover: false` carries neither in nor out;
 *  - only surplus carries: `carryOut = max(0, remaining)`, so a negative month
 *    stops at zero instead of moving a debt forward;
 *  - every line is in exactly one bucket (`groups` children or `topLevel`), so
 *    a ring-fenced child is counted once.
 */
export function computeBudgetChain(input: BudgetChainInput): BudgetChain {
  const actuals = input.actuals ?? {};
  const groups = input.groups ?? [];
  const periods = sortPeriods(input.periods);
  const states: BudgetPeriodState[] = [];
  let prev: BudgetPeriodState | null = null;
  let prevMonth: string | null = null;

  for (const p of periods) {
    const sameCurrency = prev !== null && prev.currency === p.currency;
    const adjacent = prevMonth !== null && previousMonth(p.month) === prevMonth;
    const chainOpen = sameCurrency && adjacent;
    const carryIn = p.rollover && chainOpen ? prev!.carryOutCents : 0;

    const spentFor = actuals[p.month] ?? {};
    const prevLines = new Map(
      [...(prev?.groups.flatMap((g) => g.lines) ?? []), ...(prev?.topLevel ?? [])].map((l) => [
        l.category,
        l,
      ]),
    );

    const lines: BudgetLineState[] = p.lines.map((line) => {
      const rollover = line.rollover ?? p.rollover;
      const allocationCents = clampCents(line.allocationCents);
      const lineCarryIn =
        rollover && chainOpen ? (prevLines.get(line.category)?.carryOutCents ?? 0) : 0;
      const availableCents = allocationCents + lineCarryIn;
      const actualCents = clampCents(spentFor[line.category] ?? 0);
      const remainingCents = availableCents - actualCents;
      return {
        category: line.category,
        group: groupOf(groups, line.category),
        allocationCents,
        carryInCents: lineCarryIn,
        availableCents,
        actualCents,
        remainingCents,
        carryOutCents: rollover && remainingCents > 0 ? remainingCents : 0,
      };
    });
    // Lines not named in a group are top-level. A category repeated in the map
    // is rendered once, in the first group that names it.
    const topLevel = lines.filter((l) => l.group === null);
    const groupStates: BudgetGroupState[] = [];
    for (const g of groups) {
      const children = lines.filter((l) => l.group === g.name);
      if (children.length === 0) continue;
      groupStates.push({
        name: g.name,
        lines: children,
        allocationCents: children.reduce((s, l) => s + l.allocationCents, 0),
        carryInCents: children.reduce((s, l) => s + l.carryInCents, 0),
        actualCents: children.reduce((s, l) => s + l.actualCents, 0),
        remainingCents: children.reduce((s, l) => s + l.remainingCents, 0),
        carryOutCents: children.reduce((s, l) => s + l.carryOutCents, 0),
      });
    }

    const allocatedCents = lines.reduce((s, l) => s + l.allocationCents, 0);
    const actualCents = lines.reduce((s, l) => s + l.actualCents, 0);
    const budgetedSpendingCents = clampCents(p.budgetedSpendingCents);
    const remainingCents = budgetedSpendingCents + carryIn - actualCents;
    const state: BudgetPeriodState = {
      month: p.month,
      currency: p.currency,
      budgetedSpendingCents,
      allocatedCents,
      availableToAllocateCents: budgetedSpendingCents - allocatedCents,
      carryInCents: carryIn,
      actualCents,
      remainingCents,
      carryOutCents: p.rollover && remainingCents > 0 ? remainingCents : 0,
      groups: groupStates,
      topLevel,
      billsReservedCents: p.billsReservedCents === null ? null : clampCents(p.billsReservedCents),
    };
    states.push(state);
    prev = state;
    prevMonth = p.month;
  }
  return { periods: states, last: states.length === 0 ? null : states[states.length - 1]! };
}

/* ---------- period dates (custom month start) ---------- */

export type PeriodBounds = { start: string; end: string };

const DAYS_IN_MONTH_START = 1;

/** The ISO day range of a period: `[start, end]`, both inclusive. Day 1 is the
 *  calendar month; a custom start day (1..28, Sure's range) shifts both ends. */
export function budgetPeriodBounds(month: string, monthStartDay = 1): PeriodBounds {
  const day = Math.min(28, Math.max(DAYS_IN_MONTH_START, Math.trunc(monthStartDay)));
  const start = `${month}-${String(day).padStart(2, "0")}`;
  const next = addMonths(start, 1);
  const end = DateTime.formatIso(DateTime.subtract(DateTime.makeUnsafe(next), { days: 1 })).slice(
    0,
    10,
  );
  return { start, end };
}

/* ---------- legacy migration ---------- */

/** A stored category limit, the shape `PlanPreferences.categoryLimits` holds. */
export type LegacyCategoryLimit = { cents: number; at: string };

/** The first initialized period built from the vault's legacy
 *  `categoryLimits`: one line per limit, the envelope their sum, no rollover.
 *  The period is the month the newest limit was stamped in. Null when there is
 *  no limit to migrate. The legacy record is never rewritten, so an older
 *  build still reads it. */
export function budgetPeriodFromLimits(
  limits: Readonly<Record<string, LegacyCategoryLimit>>,
  currency = "EUR",
): BudgetPeriod | null {
  const entries = Object.entries(limits).filter(([, v]) => Number.isFinite(v?.cents));
  if (entries.length === 0) return null;
  let newest = "";
  for (const [, v] of entries) if (v.at > newest) newest = v.at;
  const month = newest.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const lines = entries
    .map(([category, v]) => ({ category, allocationCents: clampCents(v.cents) }))
    .sort((a, b) => a.category.localeCompare(b.category));
  return {
    month,
    currency,
    budgetedSpendingCents: lines.reduce((s, l) => s + l.allocationCents, 0),
    rollover: false,
    lines,
    billsReservedCents: null,
  };
}

/** What the plan reads: the stored periods, or, on a vault that has not stored
 *  any yet, the legacy limits migrated to a first period. Read-only: nothing is
 *  written, so an unmigrated vault keeps rendering its limits. */
export function budgetPeriodsOf(
  periods: readonly BudgetPeriod[] | undefined,
  limits: Readonly<Record<string, LegacyCategoryLimit>>,
): readonly BudgetPeriod[] {
  if (periods !== undefined && periods.length > 0) return periods;
  const migrated = budgetPeriodFromLimits(limits);
  return migrated === null ? [] : [migrated];
}

/** Set (or clear, with `null`) one category's allocation in `at`'s month, for
 *  the plan's limit input. Creates the month's period when it is not there yet.
 *  The envelope of an edited period becomes the sum of its lines: the input
 *  edits allocations, and money not yet allocated is a later slice. Returns the
 *  same array when there is nothing to change. */
export function setBudgetLineAllocation(
  periods: readonly BudgetPeriod[],
  at: string,
  category: string,
  allocationCents: number | null,
  currency = "EUR",
): readonly BudgetPeriod[] {
  const month = isoMonth(at);
  const index = periods.findIndex((p) => p.month === month);
  const cents = allocationCents === null ? null : clampCents(allocationCents);
  if (index === -1) {
    if (cents === null) return periods;
    return [
      ...periods,
      {
        month,
        currency,
        budgetedSpendingCents: cents,
        rollover: false,
        lines: [{ category, allocationCents: cents }],
        billsReservedCents: null,
      },
    ].sort((a, b) => (a.month < b.month ? -1 : 1));
  }
  const period = periods[index]!;
  const lines = period.lines.filter((l) => l.category !== category);
  if (cents !== null) lines.push({ category, allocationCents: cents });
  lines.sort((a, b) => a.category.localeCompare(b.category));
  const next: BudgetPeriod = {
    ...period,
    lines,
    budgetedSpendingCents: lines.reduce((sum, l) => sum + l.allocationCents, 0),
  };
  const out = [...periods];
  out[index] = next;
  return out;
}

/** The state the plan shows for one month, or null when that month has no
 *  initialized period. */
export function budgetPeriodAt(chain: BudgetChain, month: string): BudgetPeriodState | null {
  return chain.periods.find((p) => p.month === month) ?? null;
}
