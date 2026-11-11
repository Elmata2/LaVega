/**
 * Bills (recurring commitments): the series record and its occurrence rows.
 *
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 * Sure sources: `app/models/recurring_transaction.rb`,
 * `app/models/recurrence_rule.rb`, `app/models/recurring_occurrence.rb`.
 *
 * Sure stores money as BigDecimal(19,4) and its `Entry` is outflow-positive.
 * This module stores integer cents and carries direction explicitly (ADR 0011);
 * no stored transaction sign is read here.
 */

/** `dayOfMonth: LAST_DAY` means "the last calendar day of the month";
 *  `weekdayOrdinal: LAST_DAY` means "the last <weekday> of the month". Sure
 *  uses the same `-1` sentinel (`RecurrenceRule::LAST`). */
export const LAST_DAY = -1;

/** Sure's `bill_type` enum. `income` and `transfer` are commitments too, so
 *  they live in the same list rather than a second table. */
export type BillType = "bill" | "subscription" | "installment" | "income" | "transfer" | "other";

/** Sure's `amount_strategy`. `average`/`last` resolve through
 *  `resolveBillAmountCents`; the occurrence row stores NULL unless the owner
 *  overrode that one instance, so a price edit needs no sweep. */
export type BillAmountStrategy = "fixed" | "average" | "last";

/** Sure's `status`, unchanged: a detected-but-unconfirmed row is `suggested`;
 *  `ended` is terminal and keeps its paid history. */
export type BillStatus = "suggested" | "active" | "paused" | "inactive" | "ended";

export type BillFrequency = "weekly" | "monthly" | "yearly";

/** Sure's `weekend_adjust`: "skip" drops a weekend due date entirely, "before"
 *  moves it to Friday, "after" to Monday. */
export type BillWeekendAdjust = "none" | "skip" | "before" | "after";

/** Sure's `end_mode`: "after_count" counts from `anchorDate`. */
export type BillEndMode = "never" | "on_date" | "after_count";

/** One line of Sure's `recurrence_rules`. A series with no rule gets the
 *  implicit monthly rule (`billRules`), which is what every pre-rules Sure row
 *  meant. At most one of `dayOfMonth` and `weekday` may be set. */
export type BillRule = {
  frequency: BillFrequency;
  /** Every N periods; 1 = every period. */
  interval: number;
  /** 1..31, or `LAST_DAY`. Day 31 clamps into a short month (Feb 28/29). */
  dayOfMonth?: number;
  /** 0 = Sunday … 6 = Saturday (Sure/Ruby `wday`, JS `getUTCDay`). */
  weekday?: number;
  /** 1..5, or `LAST_DAY` for the last such weekday. Requires `weekday`. */
  weekdayOrdinal?: number;
  /** 1..12. Yearly rules only. */
  monthOfYear?: number;
};

export type Bill = {
  id: string;
  /** Display name. Not part of any hash, so renaming never re-keys history. */
  name: string;
  type: BillType;
  status: BillStatus;
  /** "out" = money you owe or expect to leave; "in" = expected income. ADR 0011
   *  wants this explicit instead of a Sure-signed amount. */
  direction: "in" | "out";
  /** Expected magnitude in integer cents (always >= 0). */
  amountCents: number;
  amountStrategy: BillAmountStrategy;
  /** What `average` resolves to when the owner knows the running average;
   *  absent falls back to `amountCents`. */
  averageAmountCents?: number;
  currency: string;
  /** Empty = the implicit monthly rule on `anchorDate`'s day of month. */
  rules: BillRule[];
  /** ISO YYYY-MM-DD that fixes WHICH week/month/year an every-N interval fires
   *  in, and where an `after_count` end counts from. Also the first obligation:
   *  generation never fabricates an occurrence before it. */
  anchorDate: string;
  accountKey?: string;
  category?: string;
  merchant?: string;
  weekendAdjust: BillWeekendAdjust;
  endMode: BillEndMode;
  /** Last due date an occurrence may fall on (`on_date` mode). */
  endOn?: string;
  /** Number of occurrences the plan lasts (`after_count` mode). */
  endAfterCount?: number;
  tags: string[];
  notes?: string;
  /** Optional bridge to the existing `ScheduledFlow` this series mirrors
   *  (WS2.1). Absent means the bill does not project into the flow list yet. */
  scheduledFlowId?: string;
};

/** Sure's minimal stored occurrence status. Derived states (upcoming/due/
 *  overdue/partially paid) are computed from dates and amounts on read, so they
 *  cannot go stale in the vault. */
export type BillOccurrenceStatus = "scheduled" | "paid" | "skipped" | "missed";

export type BillOccurrence = {
  /** Deterministic identity `billId|originalDueOn`, so re-running generation
   *  cannot create a duplicate (Sure's unique index keyed on the same pair). */
  id: string;
  billId: string;
  /** Raw scheduled date. This is the occurrence's permanent identity: weekend
   *  adjustment and non-identity schedule edits leave it untouched. */
  originalDueOn: string;
  /** The date the money is actually due (weekend-adjusted). */
  dueOn: string;
  currency: string;
  /** NULL = inherit the series amount via `resolveBillAmountCents`; a number is
   *  this instance's own override (Sure's `expected_amount`). */
  expectedAmountCents: number | null;
  status: BillOccurrenceStatus;
  /** Owner's "not this month" postponement; never rewrites the schedule. */
  snoozedUntil?: string;
  paidOn?: string;
  /** What actually left the account, when it is known. NULL = unknown, not 0. */
  paidAmountCents?: number | null;
  /** Set when the row closes (`paid`/`skipped`/`missed`). */
  closedAt?: string;
  closedSource?: "auto" | "user";
};

/** A planned occurrence the generator may materialize: the raw schedule date
 *  and its adjusted due date (Sure's `Schedule::Pair`). */
export type BillOccurrencePair = {
  originalDueOn: string;
  dueOn: string;
};

/** Codes, not sentences: the view owns the nl/en wording, the same split
 *  `rules/parse.ts` uses for its problems. */
export type BillProblem =
  | "name"
  | "amount"
  | "currency"
  | "anchor"
  | "rules"
  | "interval"
  | "weekday"
  | "weekdayOrdinal"
  | "monthOfYear"
  | "dayOfMonth"
  | "endOn"
  | "endAfterCount";

const BILL_TYPES: readonly BillType[] = [
  "bill",
  "subscription",
  "installment",
  "income",
  "transfer",
  "other",
];
const AMOUNT_STRATEGIES: readonly BillAmountStrategy[] = ["fixed", "average", "last"];
const STATUSES: readonly BillStatus[] = ["suggested", "active", "paused", "inactive", "ended"];
const FREQUENCIES: readonly BillFrequency[] = ["weekly", "monthly", "yearly"];
const WEEKEND_ADJUSTS: readonly BillWeekendAdjust[] = ["none", "skip", "before", "after"];
const END_MODES: readonly BillEndMode[] = ["never", "on_date", "after_count"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

/** Empty rules = Sure's implicit monthly rule on the anchor's day of month. */
export function billRules(bill: Pick<Bill, "rules" | "anchorDate">): BillRule[] {
  if (bill.rules.length > 0) return bill.rules;
  const day = Number(bill.anchorDate.slice(8, 10));
  return [{ frequency: "monthly", interval: 1, dayOfMonth: day }];
}

/** A bill only creates rows while it is `active`. `suggested` waits for the
 *  owner to confirm it; paused/inactive/ended keep their rows but add none. */
export function isBillActive(bill: Pick<Bill, "status">): boolean {
  return bill.status === "active";
}

/** Sure's `resolved_expected_amount`: an explicit occurrence amount wins, then
 *  the series' strategy, then the plain series amount. Magnitude in cents,
 *  never a signed value. */
export function resolveBillAmountCents(
  bill: Pick<Bill, "amountCents" | "amountStrategy" | "averageAmountCents">,
  occurrence?: Pick<BillOccurrence, "expectedAmountCents"> | null,
  lastPaidCents?: number | null,
): number {
  if (occurrence != null && occurrence.expectedAmountCents != null) {
    return Math.abs(occurrence.expectedAmountCents);
  }
  if (bill.amountStrategy === "average") {
    return Math.abs(bill.averageAmountCents ?? bill.amountCents);
  }
  if (bill.amountStrategy === "last") {
    return Math.abs(lastPaidCents ?? bill.amountCents);
  }
  return Math.abs(bill.amountCents);
}

/** The identity the whole bills stack keys on. String form keeps the pair
 *  readable in a vault dump and impossible to re-order by accident. */
export function billOccurrenceId(billId: string, originalDueOn: string): string {
  return `${billId}|${originalDueOn}`;
}

/** Sure's `AmountStrategy`/`bill_type`/`status` guards, as a list of codes.
 *  The vault is trusted for shape (like every other section); this is the form
 *  gate, so an invalid series cannot be saved and then generate nonsense. */
export function billProblems(bill: Bill): BillProblem[] {
  const problems: BillProblem[] = [];
  if (bill.name.trim() === "") problems.push("name");
  if (!isInt(bill.amountCents) || bill.amountCents < 0) problems.push("amount");
  if (
    bill.averageAmountCents != null &&
    (!isInt(bill.averageAmountCents) || bill.averageAmountCents < 0)
  ) {
    problems.push("amount");
  }
  if (bill.currency.trim() === "") problems.push("currency");
  if (!ISO_DATE.test(bill.anchorDate)) problems.push("anchor");
  if (!BILL_TYPES.includes(bill.type)) problems.push("rules");
  if (!STATUSES.includes(bill.status)) problems.push("rules");
  if (!AMOUNT_STRATEGIES.includes(bill.amountStrategy)) problems.push("rules");
  if (bill.direction !== "in" && bill.direction !== "out") problems.push("rules");
  if (!WEEKEND_ADJUSTS.includes(bill.weekendAdjust)) problems.push("rules");
  if (!END_MODES.includes(bill.endMode)) problems.push("rules");

  for (const rule of bill.rules) {
    if (!FREQUENCIES.includes(rule.frequency)) problems.push("rules");
    if (!isInt(rule.interval) || rule.interval < 1) problems.push("interval");
    if (rule.dayOfMonth != null && rule.weekday != null) problems.push("dayOfMonth");
    if (rule.dayOfMonth != null) {
      const ok =
        rule.dayOfMonth === LAST_DAY ||
        (isInt(rule.dayOfMonth) && rule.dayOfMonth >= 1 && rule.dayOfMonth <= 31);
      if (!ok) problems.push("dayOfMonth");
    }
    if (rule.weekday != null && (!isInt(rule.weekday) || rule.weekday < 0 || rule.weekday > 6)) {
      problems.push("weekday");
    }
    if (rule.weekdayOrdinal != null) {
      if (rule.weekday == null) problems.push("weekdayOrdinal");
      const ok =
        rule.weekdayOrdinal === LAST_DAY ||
        (isInt(rule.weekdayOrdinal) && rule.weekdayOrdinal >= 1 && rule.weekdayOrdinal <= 5);
      if (!ok) problems.push("weekdayOrdinal");
    }
    if (rule.frequency === "yearly") {
      if (
        rule.monthOfYear == null ||
        !isInt(rule.monthOfYear) ||
        rule.monthOfYear < 1 ||
        rule.monthOfYear > 12
      ) {
        problems.push("monthOfYear");
      }
    } else if (rule.monthOfYear != null) {
      problems.push("rules");
    }
    if (rule.frequency === "weekly" && (rule.dayOfMonth != null || rule.weekdayOrdinal != null)) {
      problems.push("rules");
    }
  }

  if (bill.endMode === "on_date") {
    if (bill.endOn == null || !ISO_DATE.test(bill.endOn)) problems.push("endOn");
  } else if (bill.endOn != null) {
    problems.push("endOn");
  }
  if (bill.endMode === "after_count") {
    if (!isInt(bill.endAfterCount) || (bill.endAfterCount ?? 0) < 1) problems.push("endAfterCount");
  } else if (bill.endAfterCount != null) {
    problems.push("endAfterCount");
  }
  return problems;
}

/** Fill the defaults a caller may omit, so every row in the vault has the same
 *  complete shape. Identity fields are never invented: a bill without an id or
 *  anchor is a programming error, not a default. */
export function normalizeBill(
  bill: Omit<
    Bill,
    | "status"
    | "type"
    | "amountStrategy"
    | "rules"
    | "weekendAdjust"
    | "endMode"
    | "tags"
    | "direction"
  > &
    Partial<
      Pick<
        Bill,
        | "status"
        | "type"
        | "amountStrategy"
        | "rules"
        | "weekendAdjust"
        | "endMode"
        | "tags"
        | "direction"
      >
    >,
): Bill {
  return {
    ...bill,
    type: bill.type ?? "bill",
    status: bill.status ?? "active",
    direction: bill.direction ?? "out",
    amountStrategy: bill.amountStrategy ?? "fixed",
    rules: bill.rules ?? [],
    weekendAdjust: bill.weekendAdjust ?? "none",
    endMode: bill.endMode ?? "never",
    tags: bill.tags ?? [],
  };
}

/** True when two series would produce the same schedule shape. Used to answer
 *  "did the owner actually change the schedule?" so an unrelated edit (rename,
 *  amount) is not allowed to delete and rebuild future rows. */
export function sameScheduleShape(
  a: Pick<Bill, "rules" | "anchorDate" | "weekendAdjust" | "endMode" | "endOn" | "endAfterCount">,
  b: Pick<Bill, "rules" | "anchorDate" | "weekendAdjust" | "endMode" | "endOn" | "endAfterCount">,
): boolean {
  const shape = (x: typeof a) =>
    JSON.stringify([
      x.anchorDate,
      x.weekendAdjust,
      x.endMode,
      x.endOn ?? null,
      x.endAfterCount ?? null,
      billRules({ rules: x.rules, anchorDate: x.anchorDate }).map((r) => [
        r.frequency,
        r.interval,
        r.dayOfMonth ?? null,
        r.weekday ?? null,
        r.weekdayOrdinal ?? null,
        r.monthOfYear ?? null,
      ]),
    ]);
  return shape(a) === shape(b);
}
