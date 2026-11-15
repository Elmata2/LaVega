/**
 * Paycheck planner (WS2.7, issue #288).
 *
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 * Sure source: `app/models/recurring_transaction/paycheck_planner.rb`. No Ruby is
 * copied.
 *
 * Sure slices time by the family's DECLARED income schedule and funds every open
 * obligation from the paycheck of the window it falls due in. Each window then
 * says what is due inside it, what it holds (reserves) for a later bill that
 * outgrows its own paycheck, and what is left once both are taken out.
 *
 * The rules that matter, all from Sure:
 *
 *  - Only declared income defines a payday. A recurring inflow that is not an
 *    `income` series is not one: sign alone proves nothing.
 *  - Today up to the first paycheck is its own LEADING window, with no income.
 *    When it has no income it is the BRIDGE: what it needs must come from cash
 *    already in hand, never from the paycheck that arrives after it.
 *  - A reserve must come out of a paycheck, so only windows that receive income
 *    can carry one. Overflow no earlier paycheck can absorb piles onto the
 *    earliest one, showing the gap now instead of the week the bill lands.
 *  - A bridge shortfall is measured against CASH ON HAND. An unknown balance is
 *    not evidence of a shortfall: the figure is null, never zero (ADR 0011 §8).
 *
 * LaVega differences, each deliberate: integer cents everywhere (ADR 0011), no
 * clock (`asOf` is an argument), and each obligation is read from the #286
 * occurrence row and the #287 allocation decisions instead of Active Record.
 * The caller passes cash on hand in; `cashOnHandCents` derives it from the
 * accounts it can honestly read.
 */
import type { Bill, BillDecisions, BillOccurrence } from "./model.js";
import { isBillActive, resolveBillAmountCents } from "./model.js";
import type { Account } from "../model.js";
import { addDays } from "./schedule.js";
import { OCCURRENCE_HORIZON_DAYS, occurrenceAmountCents } from "./occurrences.js";
import { accountTypeKind } from "../balance.js";

/** Sure's `plan(periods_limit: 3)`: one leading window plus up to three
 *  income windows. */
export const PAYCHECK_DEFAULT_PERIODS = 3;

/** How far back the "paid" figure reaches, matching the #286 screen. */
export const PAYCHECK_PAID_DAYS = 31;

/** Currency the planner counts in unless a caller says otherwise. LaVega bills
 *  are EUR today; a series in another currency is excluded and counted. */
export const PAYCHECK_CURRENCY = "EUR";

/** One obligation placed in one window. `shareCents` is the slice of the
 *  obligation this window carries; `remainingTotalCents` is the whole bill, so
 *  the view never has to reconstruct it. */
export type PaycheckItem = {
  occurrenceId: string;
  billId: string;
  billName: string;
  /** The date it actually falls due (snoozed date when the owner snoozed it). */
  dueOn: string;
  /** The whole open amount of this obligation, in cents. */
  remainingTotalCents: number;
  /** How much of it this window carries, in cents. */
  shareCents: number;
  /** True when the obligation falls due inside this window. */
  dueInPeriod: boolean;
};

export type PaycheckPeriod = {
  startsOn: string;
  /** Inclusive. */
  endsOn: string;
  incomeCents: number;
  /** Names of the declared income series that arrive on `startsOn`, deduped. */
  incomeSources: string[];
  items: PaycheckItem[];
  /** What must leave inside the window. */
  dueCents: number;
  /** What this window holds now for a bill due later. */
  reservedCents: number;
  obligationCents: number;
  /** income - obligation; negative when the window cannot fund its bills. */
  remainingCents: number;
  leading: boolean;
  final: boolean;
  /** The leading window carries no income: its bills are paid from cash. */
  bridge: boolean;
  short: boolean;
  /** What is missing. NULL means "cannot be judged" (a bridge with no known
   *  cash), never zero. A non-bridge window always carries a number. */
  shortfallCents: number | null;
  /** Cash on hand, leading window only; null when unknown. */
  cashOnHandCents: number | null;
  /** Cash left once the bridge's bills are paid; null unless it is a judged
   *  bridge. */
  cashAfterObligationsCents: number | null;
};

export type PaycheckPlan = {
  asOf: string;
  currency: string;
  /** The first declared payday on or after `asOf`; null when none remains. */
  paydayOn: string | null;
  /** Cash the caller said is available, or null when unknown. */
  cashOnHandCents: number | null;
  periods: PaycheckPeriod[];
  /** Active series in another currency, counted rather than silently summed. */
  excludedCurrencyCount: number;
};

/** The one-screen answer. `periods` is absent here on purpose: the Bills screen
 *  reads the plan for the slice, and the block reads only this summary. */
export type PaycheckPreview = {
  asOf: string;
  hasIncome: boolean;
  paydayOn: string | null;
  cashCents: number | null;
  /** Leading window's due amount: what must leave before payday closes it.
   *  Without a declared payday it is what is due over the visible horizon. */
  dueBeforePaydayCents: number;
  /** Money the plan holds now out of later paychecks for later bills. */
  reservedCents: number;
  /** Closed outgoing rows due in the last 31 days. */
  paidRecentlyCents: number;
  /** Everything the plan cannot cover. NULL means unknown, never zero. */
  shortfallCents: number | null;
  /** True when a bridge exists but cash on hand is unknown, so the shortfall
   *  cannot be judged. */
  shortfallUnknown: boolean;
  /** End of what the preview covers: last period end, or the horizon. */
  coversUntil: string;
};

export type PaycheckOverview = {
  preview: PaycheckPreview;
  /** null when no declared income series has an open occurrence. */
  plan: PaycheckPlan | null;
};

export type PaycheckInput = {
  bills: readonly Bill[];
  occurrences: readonly BillOccurrence[];
  /** Stored #287 decisions; only the allocations matter here. */
  decisions?: BillDecisions;
  asOf: string;
  /** Cash on hand in cents, or null when no balance can be established. */
  cashCents: number | null;
  periodsLimit?: number;
  currency?: string;
  horizonDays?: number;
};

/** The series' own currency, defaulting to EUR as everywhere else. */
function billCurrency(bill: Pick<Bill, "currency">): string {
  return (
    String(bill.currency ?? "")
      .trim()
      .toUpperCase() || PAYCHECK_CURRENCY
  );
}

/** The date a payable obligation actually falls due: Sure's `effective_due_on`
 *  (a snooze moves it, the schedule does not). */
function effectiveDueOn(occurrence: Pick<BillOccurrence, "dueOn" | "snoozedUntil">): string {
  return occurrence.snoozedUntil ?? occurrence.dueOn;
}

/**
 * Cash a bill can actually be paid from: known balances of current and savings
 * accounts, in EUR. Credit cards are a liability and investments are not cash;
 * an "other" account is not claimed as cash either.
 *
 * NULL, never zero, when no such account exists or any of them has an unknown
 * balance. One unknown account must not shrink the sum silently: a partial
 * total reads as "short" when the missing balance might cover everything.
 * Callers pass accounts whose balance is already the position at `asOf`
 * (`withCurrentBalances` in the app).
 */
export function cashOnHandCents(accounts: readonly Account[]): number | null {
  let total = 0;
  let found = false;
  for (const account of accounts) {
    if (
      String(account.currency ?? "")
        .trim()
        .toUpperCase() !== PAYCHECK_CURRENCY
    )
      continue;
    const kind = accountTypeKind(account);
    if (kind !== "current" && kind !== "savings") continue;
    if (account.balance == null) return null;
    total += Math.round(account.balance * 100);
    found = true;
  }
  return found ? total : null;
}

/** Allocations already on an occurrence, in cents. The #287 decisions are the
 *  only payment truth; a partial payment shrinks what the plan must fund. */
function allocatedCents(decisions: BillDecisions | undefined, occurrenceId: string): number {
  if (decisions == null) return 0;
  return decisions.matches.reduce(
    (sum, match) => (match.occurrenceId === occurrenceId ? sum + Math.abs(match.amountCents) : sum),
    0,
  );
}

type PlannedObligation = {
  occurrence: BillOccurrence;
  bill: Bill;
  dueOn: string;
  remainingCents: number;
};

/** Sure's `plan`: null when no declared income is left to slice. */
export function paycheckPlan(input: PaycheckInput): PaycheckPlan | null {
  const { asOf, cashCents, decisions, periodsLimit = PAYCHECK_DEFAULT_PERIODS } = input;
  const currency = String(input.currency ?? PAYCHECK_CURRENCY)
    .trim()
    .toUpperCase();
  const byId = new Map(input.bills.map((bill) => [bill.id, bill]));

  const excludedCurrencyCount = input.bills.filter(
    (bill) => isBillActive(bill) && billCurrency(bill) !== currency,
  ).length;

  const activeSalary = input.bills.filter(
    (bill) =>
      isBillActive(bill) &&
      bill.type === "income" &&
      bill.direction === "in" &&
      billCurrency(bill) === currency,
  );
  const salaryIds = new Set(activeSalary.map((bill) => bill.id));

  // Declared paydays come from the open occurrence rows, never from a
  // next-expected-date field: a paycheck that did not arrive is not overdue, it
  // is simply not the next one (Sure's `upcoming_income_occurrences`).
  const incomes = input.occurrences
    .filter((occurrence) => occurrence.status === "scheduled" && salaryIds.has(occurrence.billId))
    .filter((occurrence) => occurrence.dueOn >= asOf)
    .sort((a, b) =>
      a.dueOn === b.dueOn ? a.id.localeCompare(b.id) : a.dueOn.localeCompare(b.dueOn),
    );
  const arrivals = new Map<string, BillOccurrence[]>();
  for (const occurrence of incomes) {
    const list = arrivals.get(occurrence.dueOn) ?? [];
    list.push(occurrence);
    arrivals.set(occurrence.dueOn, list);
  }
  const paydayOn = incomes[0]?.dueOn ?? null;
  if (paydayOn == null) return null;

  // Today up to the first paycheck is its own window, then one per paycheck.
  const dates = [...new Set(incomes.map((occurrence) => occurrence.dueOn))].slice(
    0,
    periodsLimit + 1,
  );
  const boundaries = [...new Set([asOf, ...dates])];
  if (boundaries.length < 2) {
    return {
      asOf,
      currency,
      paydayOn,
      cashOnHandCents: cashCents,
      periods: [],
      excludedCurrencyCount,
    };
  }

  // The open obligations: outgoing rows of active series, through the last
  // window. Income is a date to count on, not an obligation here.
  const through = boundaries[boundaries.length - 1] as string;
  const obligations: PlannedObligation[] = [];
  for (const occurrence of input.occurrences) {
    if (occurrence.status !== "scheduled") continue;
    const bill = byId.get(occurrence.billId);
    if (bill == null || !isBillActive(bill) || bill.direction !== "out") continue;
    if (billCurrency(bill) !== currency) continue;
    const dueOn = effectiveDueOn(occurrence);
    if (dueOn > through) continue;
    const remaining = Math.max(
      0,
      occurrenceAmountCents(bill, occurrence, input.occurrences) -
        allocatedCents(decisions, occurrence.id),
    );
    if (remaining <= 0) continue;
    obligations.push({ occurrence, bill, dueOn, remainingCents: remaining });
  }
  obligations.sort((a, b) =>
    a.dueOn === b.dueOn
      ? a.occurrence.id.localeCompare(b.occurrence.id)
      : a.dueOn.localeCompare(b.dueOn),
  );

  const starts = boundaries.slice(0, -1);
  const incomeOn = (day: string): number =>
    (arrivals.get(day) ?? []).reduce((sum, occurrence) => {
      const bill = byId.get(occurrence.billId);
      return bill == null ? sum : sum + occurrenceAmountCents(bill, occurrence, input.occurrences);
    }, 0);
  const available = starts.map(incomeOn);
  const periods: Array<{
    startsOn: string;
    endsOn: string;
    incomeCents: number;
    incomeSources: string[];
    items: PaycheckItem[];
    leading: boolean;
    final: boolean;
  }> = starts.map((startsOn, index) => {
    const endsOn = addDays(boundaries[index + 1] as string, -1);
    const dayArrivals = arrivals.get(startsOn) ?? [];
    return {
      startsOn,
      endsOn,
      incomeCents: available[index] as number,
      incomeSources: [
        ...new Set(
          dayArrivals
            .map((occurrence) => byId.get(occurrence.billId)?.name)
            .filter(Boolean) as string[],
        ),
      ],
      items: [],
      leading: index === 0,
      final: index === starts.length - 1,
    };
  });

  // Sure's `apportion_bills`: each obligation is funded by the paycheck of the
  // window it falls due in; only what that paycheck cannot cover cascades
  // backward as reserves, nearest paycheck first.
  for (const obligation of obligations) {
    // A past-due open row still needs paying, and every share of it is already
    // owed, so it lands whole in the leading window.
    const dueOn = obligation.dueOn < asOf ? asOf : obligation.dueOn;
    const home = periods.findIndex((period) => dueOn >= period.startsOn && dueOn <= period.endsOn);
    if (home < 0) continue;
    const itemBillId = obligation.bill.id;

    let funded = Math.min(obligation.remainingCents, Math.max(available[home] as number, 0));
    let uncovered = obligation.remainingCents - funded;

    const sources: number[] = [];
    for (let index = home - 1; index >= 0; index -= 1) {
      if ((periods[index]?.incomeCents ?? 0) > 0) sources.push(index);
    }
    for (const index of sources) {
      if (uncovered <= 0) break;
      const earliest = index === sources[sources.length - 1];
      const take = earliest
        ? uncovered
        : Math.min(uncovered, Math.max(available[index] as number, 0));
      if (take <= 0) continue;
      available[index] = (available[index] as number) - take;
      uncovered -= take;
      periods[index]?.items.push({
        occurrenceId: obligation.occurrence.id,
        billId: itemBillId,
        billName: obligation.bill.name,
        dueOn: obligation.dueOn,
        remainingTotalCents: obligation.remainingCents,
        shareCents: take,
        dueInPeriod: false,
      });
    }

    // With no earlier paycheck to lean on, the bill's own window carries all of
    // it, shortfall included.
    funded += uncovered;
    available[home] = (available[home] as number) - funded;
    periods[home]?.items.push({
      occurrenceId: obligation.occurrence.id,
      billId: itemBillId,
      billName: obligation.bill.name,
      dueOn: obligation.dueOn,
      remainingTotalCents: obligation.remainingCents,
      shareCents: funded,
      dueInPeriod: true,
    });
  }

  const built: PaycheckPeriod[] = periods.map((period) => {
    const dueCents = period.items.reduce(
      (sum, item) => sum + (item.dueInPeriod ? item.shareCents : 0),
      0,
    );
    const reservedCents = period.items.reduce(
      (sum, item) => sum + (item.dueInPeriod ? 0 : item.shareCents),
      0,
    );
    const obligationCents = dueCents + reservedCents;
    const remainingCents = period.incomeCents - obligationCents;
    const bridge = period.leading && period.incomeCents <= 0;
    const cash = period.leading ? cashCents : null;
    const short = bridge ? cash != null && obligationCents > cash : remainingCents < 0;
    const shortfallCents = bridge
      ? cash == null
        ? null
        : short
          ? obligationCents - cash
          : 0
      : short
        ? -remainingCents
        : 0;
    return {
      ...period,
      items: [...period.items].sort((a, b) => b.shareCents - a.shareCents),
      dueCents,
      reservedCents,
      obligationCents,
      remainingCents,
      bridge,
      short,
      shortfallCents,
      cashOnHandCents: cash,
      cashAfterObligationsCents: bridge && cash != null ? cash - obligationCents : null,
    };
  });

  return {
    asOf,
    currency,
    paydayOn,
    cashOnHandCents: cashCents,
    periods: built,
    excludedCurrencyCount,
  };
}

/** The obligations that fall due inside one window, by date. Sure's
 *  `items_due`. */
export function paycheckItemsDue(period: PaycheckPeriod): PaycheckItem[] {
  return period.items
    .filter((item) => item.dueInPeriod)
    .sort((a, b) =>
      a.dueOn === b.dueOn ? a.billName.localeCompare(b.billName) : a.dueOn.localeCompare(b.dueOn),
    );
}

/** The slices one window holds for bills due later, by date. Sure's
 *  `items_reserved`. */
export function paycheckItemsReserved(period: PaycheckPeriod): PaycheckItem[] {
  return period.items
    .filter((item) => !item.dueInPeriod)
    .sort((a, b) =>
      a.dueOn === b.dueOn ? a.billName.localeCompare(b.billName) : a.dueOn.localeCompare(b.dueOn),
    );
}

/** Open outgoing rows due in the last 31 days, at what was actually paid when
 *  the row knows it. */
function paidRecentlyCents(
  input: Pick<PaycheckInput, "bills" | "occurrences" | "asOf">,
  currency: string,
): number {
  const byId = new Map(input.bills.map((bill) => [bill.id, bill]));
  const from = addDays(input.asOf, -PAYCHECK_PAID_DAYS);
  return input.occurrences.reduce((sum, occurrence) => {
    if (occurrence.status !== "paid") return sum;
    if (occurrence.dueOn < from || occurrence.dueOn > input.asOf) return sum;
    const bill = byId.get(occurrence.billId);
    if (bill == null || bill.direction !== "out" || billCurrency(bill) !== currency) return sum;
    const amount =
      occurrence.paidAmountCents ?? occurrenceAmountCents(bill, occurrence, input.occurrences);
    return sum + amount;
  }, 0);
}

/**
 * The one-screen answer to "what is due, what is paid, what is short before
 * payday", with the period slice available beside it.
 *
 * A missing declared income means no payday: the due figure still covers the
 * visible horizon, but no shortfall is claimed. A bridge with no known cash
 * reports `shortfallCents: null` and `shortfallUnknown: true`; it never reports
 * zero, because an unknown balance is not evidence of a gap.
 */
export function paycheckOverview(input: PaycheckInput): PaycheckOverview {
  const horizonDays = input.horizonDays ?? OCCURRENCE_HORIZON_DAYS;
  const currency = String(input.currency ?? PAYCHECK_CURRENCY)
    .trim()
    .toUpperCase();
  const plan = paycheckPlan(input);
  const coversUntil =
    plan != null && plan.periods.length > 0
      ? (plan.periods[plan.periods.length - 1]?.endsOn as string)
      : addDays(input.asOf, horizonDays);

  let dueBeforePaydayCents = 0;
  if (plan != null) {
    dueBeforePaydayCents = plan.periods[0]?.dueCents ?? 0;
  } else {
    // No payday: report what is due over the visible horizon so the screen
    // still answers the first question.
    const byId = new Map(input.bills.map((bill) => [bill.id, bill]));
    for (const occurrence of input.occurrences) {
      if (occurrence.status !== "scheduled") continue;
      const bill = byId.get(occurrence.billId);
      if (bill == null || !isBillActive(bill) || bill.direction !== "out") continue;
      if (billCurrency(bill) !== currency) continue;
      // Overdue rows are still owed, so they belong in the figure; only rows
      // beyond the visible horizon are left out.
      if (effectiveDueOn(occurrence) > coversUntil) continue;
      const remaining = Math.max(
        0,
        occurrenceAmountCents(bill, occurrence, input.occurrences) -
          allocatedCents(input.decisions, occurrence.id),
      );
      dueBeforePaydayCents += remaining;
    }
  }

  const unknownBridge =
    plan != null && plan.periods.some((p) => p.bridge && p.cashOnHandCents == null);
  const shortfallCents =
    plan == null
      ? null
      : unknownBridge
        ? null
        : plan.periods.reduce((sum, period) => sum + (period.shortfallCents ?? 0), 0);

  return {
    plan,
    preview: {
      asOf: input.asOf,
      hasIncome: plan != null,
      paydayOn: plan?.paydayOn ?? null,
      cashCents: input.cashCents,
      dueBeforePaydayCents,
      reservedCents: (plan?.periods ?? []).reduce((sum, period) => sum + period.reservedCents, 0),
      paidRecentlyCents: paidRecentlyCents(input, currency),
      shortfallCents,
      shortfallUnknown: unknownBridge,
      coversUntil,
    },
  };
}

/** Re-exported so a caller that only needs the income amount shape does not
 *  import the schedule engine directly. */
export { resolveBillAmountCents };
