import { DateTime } from "effect";
import type {
  Bill,
  BillOccurrence,
  BillOccurrencePair,
  BillOccurrenceStatus,
} from "./model.js";
import { billOccurrenceId, isBillActive, resolveBillAmountCents, sameScheduleShape } from "./model.js";
import {
  addDays,
  cycleStartOn,
  billDaysBetween,
  derivedOccurrenceState,
  firstOccurrenceAfter,
  isIsoDay,
  occurrencePairsBetween,
  occurrencesPerYear,
  type OccurrenceDerivedState,
} from "./schedule.js";

/**
 * Occurrence materialization: turn a bill series into the dated rows the vault
 * stores, idempotently.
 *
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 * Sure sources: `app/models/recurring_transaction/occurrence_generator.rb`,
 * `app/models/recurring_occurrence.rb`.
 *
 * Sure writes `recurring_occurrences` through an upsert keyed on
 * `(recurring_transaction_id, original_due_on)`. Here the same pair is the row's
 * deterministic `id`, so "run it twice" cannot duplicate and no database
 * constraint is needed. Only scheduled, unpaid, not-yet-due rows are ever
 * removed by an edit; closed rows are history.
 */

/** Sure's `HORIZON_DAYS`: far enough that a monthly bill's next instance is
 *  visible, and a yearly bill's next instance extends it. */
export const OCCURRENCE_HORIZON_DAYS = 90;

/** Six months of history, OPT-IN. A declared bill is Sure's "manual" series, and
 *  Sure starts it at the current cycle on purpose: backfilling rows the owner has
 *  already paid would present them as unpaid overdue debt until a payment
 *  matcher closes them. The detection half (WS2.6) passes this once matching can
 *  close past rows; the default path starts at the cycle. Bounded by the anchor,
 *  so generation never fabricates an obligation before the series' first due
 *  date. */
export const HISTORY_BACKFILL_MONTHS = 6;

export type GenerateOptions = {
  horizonDays?: number;
  historyMonths?: number;
};

/** What one generation pass changed. `occurrences` is the FULL merged set, so a
 *  caller saves it replace-all in one vault write. */
export type GenerateResult = {
  occurrences: BillOccurrence[];
  added: number;
};

function addMonths(iso: string, months: number): string {
  return DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(iso) as DateTime.Utc, { months })).slice(
    0,
    10,
  );
}

/** Just under half a cycle, the reach within which a kept row "stands in" for
 *  one occurrence of the current schedule (Sure's `half_cycle`). */
function halfCycleDays(bill: Bill): number {
  const perYear = occurrencesPerYear(bill);
  const cycleDays = Math.floor(365.25 / (perYear > 0 ? perYear : 12));
  return Math.max(1, Math.floor((cycleDays - 1) / 2));
}

/** The window one pass materializes: `historyMonths` of past cycles, from the
 *  start of the cycle containing `asOf`, through the 90-day horizon — extended
 *  to the next occurrence of a sparse cadence and, for a finite plan, to its
 *  whole length (an installment run should show all N payments and its end). */
function generationWindow(
  bill: Bill,
  asOf: string,
  options: GenerateOptions,
): { from: string; through: string } {
  const horizonDays = options.horizonDays ?? OCCURRENCE_HORIZON_DAYS;
  const historyMonths = options.historyMonths ?? 0;

  let through = addDays(asOf, horizonDays);
  const nextDue = firstOccurrenceAfter(bill, asOf);
  if (nextDue != null && nextDue > through) through = nextDue;

  if (bill.endMode === "after_count" && bill.endAfterCount != null) {
    const perYear = occurrencesPerYear(bill);
    const cycleDays = Math.ceil(365.25 / (perYear > 0 ? perYear : 12));
    const planEnd = addDays(bill.anchorDate, cycleDays * (bill.endAfterCount + 1));
    if (planEnd > through) through = planEnd;
  }

  const backfillStart = addMonths(asOf, -historyMonths);
  const cycleStart = cycleStartOn(bill, asOf) ?? backfillStart;
  let from = cycleStart < backfillStart ? cycleStart : backfillStart;
  if (from < bill.anchorDate) from = bill.anchorDate;
  // A plan that ended in the past has no future horizon to materialize.
  if (bill.endMode === "on_date" && bill.endOn != null && bill.endOn < from) {
    return { from, through: from };
  }
  return { from, through };
}

/** A newly materialized row. `expectedAmountCents: null` keeps the amount
 *  derived from the series (Sure resolves NULL through the amount strategy), so
 *  a price edit updates every open row with no sweep. */
export function makeBillOccurrence(bill: Bill, pair: BillOccurrencePair): BillOccurrence {
  return {
    id: billOccurrenceId(bill.id, pair.originalDueOn),
    billId: bill.id,
    originalDueOn: pair.originalDueOn,
    dueOn: pair.dueOn,
    currency: bill.currency,
    expectedAmountCents: null,
    status: "scheduled",
  };
}

/** Sure's `stood_in_for`: a row the current schedule no longer produces (a paid
 *  occurrence from before a due-day edit) already IS its cycle, so a new
 *  occurrence beside it would be a second row for the same cycle. Each kept row
 *  stands in for exactly ONE occurrence: the nearest within half a cycle. A row
 *  the current schedule does produce never counts, so two close days of one
 *  schedule both stay. */
function stoodInOriginals(
  bill: Bill,
  keptRows: BillOccurrence[],
  from: string,
  through: string,
): Set<string> {
  const reach = halfCycleDays(bill);
  const nearby = occurrencePairsBetween(bill, addDays(from, -reach), addDays(through, reach));
  const current = new Set(nearby.map((p) => p.originalDueOn));
  const suppressed = new Set<string>();

  for (const row of keptRows) {
    if (current.has(row.originalDueOn)) continue;
    let best: BillOccurrencePair | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const pair of nearby) {
      const distance = Math.abs(billDaysBetween(pair.dueOn, row.dueOn));
      if (distance > reach) continue;
      if (
        distance < bestDistance ||
        (distance === bestDistance && best != null && pair.dueOn < best.dueOn)
      ) {
        best = pair;
        bestDistance = distance;
      }
    }
    if (best != null) suppressed.add(best.originalDueOn);
  }
  return suppressed;
}

/** Materialize one bill into `existing` (all bills' rows). Never rewrites or
 *  deletes a row; it only appends the identities that are missing. */
function generateForBill(
  bill: Bill,
  existing: BillOccurrence[],
  asOf: string,
  options: GenerateOptions,
): { rows: BillOccurrence[]; added: number } {
  if (!isBillActive(bill)) return { rows: existing, added: 0 };
  const { from, through } = generationWindow(bill, asOf, options);
  const pairs = occurrencePairsBetween(bill, from, through);
  if (pairs.length === 0) return { rows: existing, added: 0 };

  const mine = existing.filter((o) => o.billId === bill.id);
  // Rows already stored for this bill in the reach generation is about to touch
  // are the candidates for standing in for a cycle.
  const reach = halfCycleDays(bill);
  const keptRows = mine.filter(
    (o) => o.dueOn >= addDays(from, -reach) && o.dueOn <= addDays(through, reach),
  );
  const known = new Set(mine.map((o) => o.originalDueOn));
  const fresh: BillOccurrence[] = [];
  const suppressed = stoodInOriginals(bill, keptRows, from, through);
  for (const pair of pairs) {
    if (known.has(pair.originalDueOn) || suppressed.has(pair.originalDueOn)) continue;
    fresh.push(makeBillOccurrence(bill, pair));
  }
  if (fresh.length === 0) return { rows: existing, added: 0 };
  return { rows: [...existing, ...fresh], added: fresh.length };
}

/** Materialize every active bill. Running it twice on the same input adds
 *  nothing the second time; the lazy unlock pass relies on that. */
export function generateBillOccurrences(
  bills: Bill[],
  existing: BillOccurrence[],
  asOf: string,
  options: GenerateOptions = {},
): GenerateResult {
  if (!isIsoDay(asOf)) throw new Error(`asOf must be an ISO date, got ${asOf}`);
  let occurrences = existing;
  let added = 0;
  for (const bill of bills) {
    const result = generateForBill(bill, occurrences, asOf, options);
    occurrences = result.rows;
    added += result.added;
  }
  return { occurrences, added };
}

/** After a schedule edit: drop the re-generatable future (scheduled, unpaid,
 *  not yet due) and rebuild it under the new rules. A row carrying a payment or
 *  a closed state is kept exactly as it was. */
export function regenerateBillOccurrences(
  bills: Bill[],
  existing: BillOccurrence[],
  billId: string,
  asOf: string,
  options: GenerateOptions = {},
): { occurrences: BillOccurrence[]; added: number; removed: number } {
  if (!isIsoDay(asOf)) throw new Error(`asOf must be an ISO date, got ${asOf}`);
  const kept = existing.filter(
    (o) => !(o.billId === billId && o.status === "scheduled" && o.dueOn >= asOf && o.paidAmountCents == null),
  );
  const bill = bills.find((b) => b.id === billId);
  if (bill == null) return { occurrences: kept, added: 0, removed: existing.length - kept.length };
  const result = generateForBill(bill, kept, asOf, options);
  return {
    occurrences: result.rows,
    added: result.added,
    removed: existing.length - kept.length,
  };
}

/** The amount one occurrence expects, in positive cents. `last` strategy reads
 *  what the previous PAID occurrence of the same series actually cost. */
export function occurrenceAmountCents(
  bill: Bill,
  occurrence: BillOccurrence,
  all: readonly BillOccurrence[] = [],
): number {
  let lastPaid: number | null = null;
  if (bill.amountStrategy === "last") {
    const previous = all
      .filter(
        (o) =>
          o.billId === bill.id &&
          o.status === "paid" &&
          o.paidAmountCents != null &&
          o.dueOn < occurrence.dueOn,
      )
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
    lastPaid = previous.length > 0 ? (previous[previous.length - 1].paidAmountCents ?? null) : null;
  }
  return resolveBillAmountCents(bill, occurrence, lastPaid);
}

export type BillOccurrenceView = OccurrenceDerivedState | BillOccurrenceStatus;

/** What the screen should call this row. A closed row keeps its stored status;
 *  an open row of an inactive series is shown as plain upcoming because nobody
 *  is paying a paused bill. */
export function occurrenceView(
  bill: Pick<Bill, "status">,
  occurrence: Pick<BillOccurrence, "status" | "dueOn">,
  asOf: string,
  options: { notifyDays?: number; graceDays?: number } = {},
): BillOccurrenceView {
  if (occurrence.status !== "scheduled") return occurrence.status;
  if (!isBillActive(bill)) return "upcoming";
  return derivedOccurrenceState(occurrence.dueOn, asOf, options);
}

/** Open occurrence rows of active bills, oldest due date first. */
export function openOccurrences(
  bills: readonly Bill[],
  occurrences: readonly BillOccurrence[],
): BillOccurrence[] {
  const active = new Set(bills.filter((b) => isBillActive(b)).map((b) => b.id));
  return occurrences
    .filter((o) => o.status === "scheduled" && active.has(o.billId))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

/** The one-screen answer: what is due, what is paid, what is short before the
 *  next payday.
 *
 *  `cashCents` is the owner's available cash, or null when no account balance is
 *  known. Payday is the next occurrence of an active `income` bill; when there
 *  is none the period is the 90-day horizon and the shortfall is null rather
 *  than a number built on an invented payday (ADR 0011 §8). */
export type BillsOutlook = {
  asOf: string;
  /** End of the visible period: payday, else the horizon. */
  periodEndsOn: string;
  nextIncomeOn: string | null;
  nextIncomeCents: number | null;
  /** Open rows already past their due date. */
  overdueCents: number;
  /** Open rows due from `asOf` through `periodEndsOn` (payday exclusive). */
  dueCents: number;
  /** Open overdue + due: what the cash on hand must cover before payday. */
  toCoverCents: number;
  /** Closed `paid` rows whose due date is within the last 31 days. */
  paidLastMonthCents: number;
  /** Cash minus `toCoverCents`, or null when cash or payday is unknown. */
  shortfallCents: number | null;
  cashCents: number | null;
};

export function billsOutlook(
  bills: readonly Bill[],
  occurrences: readonly BillOccurrence[],
  asOf: string,
  cashCents: number | null,
  horizonDays: number = OCCURRENCE_HORIZON_DAYS,
): BillsOutlook {
  const active = bills.filter((b) => isBillActive(b));
  const byId = new Map(bills.map((b) => [b.id, b]));
  const open = openOccurrences(bills, occurrences);

  const openAmount = (o: BillOccurrence): number => {
    const bill = byId.get(o.billId);
    return bill == null ? 0 : occurrenceAmountCents(bill, o, occurrences);
  };

  const income = active
    .filter((b) => b.type === "income" && b.direction === "in")
    .map((b) => ({ bill: b, on: firstOccurrenceAfter(b, asOf) }))
    .filter((x): x is { bill: Bill; on: string } => x.on != null)
    .sort((a, b) => a.on.localeCompare(b.on));
  const nextIncome = income[0] ?? null;
  const periodEndsOn = nextIncome?.on ?? addDays(asOf, horizonDays);

  let overdueCents = 0;
  let dueCents = 0;
  for (const o of open) {
    // Expected income is a date to count on, not cash on hand; only money that
    // must LEAVE before payday is part of what can be short (ADR 0011).
    if (byId.get(o.billId)?.direction === "in") continue;
    if (o.dueOn < asOf) overdueCents += openAmount(o);
    else if (o.dueOn < periodEndsOn) dueCents += openAmount(o);
  }
  const paidFrom = addDays(asOf, -31);
  const paidLastMonthCents = occurrences
    .filter((o) => o.status === "paid" && o.dueOn >= paidFrom && o.dueOn <= asOf)
    .reduce((sum, o) => {
      const bill = byId.get(o.billId);
      return sum + (bill == null ? 0 : occurrenceAmountCents(bill, o, occurrences));
    }, 0);

  const toCoverCents = overdueCents + dueCents;
  const shortfallCents =
    cashCents != null && nextIncome != null
      ? Math.max(0, toCoverCents - cashCents)
      : null;
  return {
    asOf,
    periodEndsOn,
    nextIncomeOn: nextIncome?.on ?? null,
    nextIncomeCents: nextIncome == null ? null : resolveBillAmountCents(nextIncome.bill),
    overdueCents,
    dueCents,
    toCoverCents,
    paidLastMonthCents,
    shortfallCents,
    cashCents,
  };
}

/** Rows the view shows between `asOf` and the horizon: open upcoming ones plus
 *  the closed ones, newest first for history. Kept here so the grouping rule is
 *  testable without a DOM. */
export function upcomingOccurrences(
  bills: readonly Bill[],
  occurrences: readonly BillOccurrence[],
  asOf: string,
  horizonDays: number = OCCURRENCE_HORIZON_DAYS,
): BillOccurrence[] {
  const active = new Set(bills.filter((b) => isBillActive(b)).map((b) => b.id));
  const horizon = addDays(asOf, horizonDays);
  return occurrences
    .filter((o) => o.status === "scheduled" && active.has(o.billId) && o.dueOn <= horizon)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

/** True when saving `next` over `previous` moved the schedule itself, so the
 *  future rows must be rebuilt. A rename or amount edit does not. */
export function scheduleChanged(previous: Bill, next: Bill): boolean {
  return !sameScheduleShape(previous, next);
}
