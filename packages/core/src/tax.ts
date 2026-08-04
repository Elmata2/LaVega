import type { Tx, VatSettings } from "./model.js";
import { makeScheduledFlow } from "./scheduledFlows.js";
import type { ScheduledFlow } from "./model.js";

/** INDICATIVE snapshot — verify against the Belastingdienst. */
export const BTW_RULES_AS_OF = "2026-08-04";
export const NL_VAT_RATES = [21, 9, 0] as const;

/** ISO last day of month (y, m1..12). */
function lastDayOfMonth(y: number, m: number): string {
  const d = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of month m
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

const Q_LABEL = ["Q1", "Q2", "Q3", "Q4"];
const NL_MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

type BtwPeriod = { periodLabel: string; periodStart: string; periodEnd: string; deadline: string };

/** Descriptor for a single BTW period, given its frequency + coordinates. The
 *  deadline is the last day of the month AFTER the period end. */
function quarterPeriod(y: number, q: number): BtwPeriod {
  const startMonth = q * 3 + 1; // 1,4,7,10
  const endMonth = (q + 1) * 3; // 3,6,9,12
  const deadlineMonth = endMonth === 12 ? 1 : endMonth + 1;
  const deadlineYear = endMonth === 12 ? y + 1 : y;
  return {
    periodLabel: `${Q_LABEL[q]} ${y}`,
    periodStart: `${y}-${String(startMonth).padStart(2, "0")}-01`,
    periodEnd: lastDayOfMonth(y, endMonth),
    deadline: lastDayOfMonth(deadlineYear, deadlineMonth),
  };
}

function monthPeriod(y: number, m: number): BtwPeriod {
  const deadlineMonth = m === 12 ? 1 : m + 1;
  const deadlineYear = m === 12 ? y + 1 : y;
  return {
    periodLabel: `${NL_MONTHS[m - 1]} ${y}`,
    periodStart: `${y}-${String(m).padStart(2, "0")}-01`,
    periodEnd: lastDayOfMonth(y, m),
    deadline: lastDayOfMonth(deadlineYear, deadlineMonth),
  };
}

function yearPeriod(y: number): BtwPeriod {
  return { periodLabel: `${y}`, periodStart: `${y}-01-01`, periodEnd: `${y}-12-31`, deadline: `${y + 1}-03-31` };
}

/** The nearest BTW deadline that has NOT yet passed (the earliest deadline
 *  ≥ asOf), relative to asOf. On 15 Apr the owner still has to file the just-
 *  ended Q1 (due 30 Apr), so we return the PREVIOUS period whenever its deadline
 *  hasn't passed yet, otherwise the current (in-progress) period. */
export function nextBtwDeadline(frequency: VatSettings["frequency"], asOf: string): BtwPeriod {
  const [y, m] = asOf.split("-").map(Number); // m: 1..12
  let current: BtwPeriod;
  let previous: BtwPeriod;
  if (frequency === "yearly") {
    current = yearPeriod(y);
    previous = yearPeriod(y - 1);
  } else if (frequency === "monthly") {
    current = monthPeriod(y, m);
    previous = m === 1 ? monthPeriod(y - 1, 12) : monthPeriod(y, m - 1);
  } else {
    const q = Math.floor((m - 1) / 3); // 0..3
    current = quarterPeriod(y, q);
    previous = q === 0 ? quarterPeriod(y - 1, 3) : quarterPeriod(y, q - 1);
  }
  // ISO dates compare lexicographically. If last period's deadline is still
  // open, that's the nearest unfiled one; otherwise it's the current period's.
  return previous.deadline >= asOf ? previous : current;
}

/** Estimate the VAT to set aside for the current BTW period, as a confirmed
 *  outflow ScheduledFlow due on the deadline. See header for the estimate. */
export function computeVatSetAside(txs: Tx[], settings: VatSettings, asOf: string): ScheduledFlow | null {
  const { periodLabel, periodStart, periodEnd, deadline } = nextBtwDeadline(settings.frequency, asOf);

  let amountCents: number;
  if (typeof settings.manualCents === "number") {
    amountCents = Math.max(0, Math.round(settings.manualCents));
  } else if (settings.mixedRates) {
    return null; // can't safely auto-estimate mixed rates
  } else {
    let incomeCents = 0;
    let expenseCents = 0;
    for (const t of txs) {
      if (t.date < periodStart || t.date > periodEnd) continue; // exact period window
      const c = Math.round(t.amount * 100);
      if (c >= 0) incomeCents += c; else expenseCents += -c;
    }
    const marginCents = incomeCents - expenseCents;
    const r = settings.defaultRatePct;
    amountCents = marginCents > 0 ? Math.round((marginCents * r) / (100 + r)) : 0;
  }
  if (amountCents <= 0) return null;
  return makeScheduledFlow({
    entity: settings.entity,
    label: `BTW ${periodLabel}`,
    sign: -1,
    amountCents,
    dueDate: deadline,
    source: "vat",
    status: "confirmed",
  });
}
