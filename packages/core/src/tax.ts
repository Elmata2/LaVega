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

/** The current period's end + its aangifte/betaling deadline (last day of the
 *  month AFTER the period end), relative to asOf. */
export function nextBtwDeadline(frequency: VatSettings["frequency"], asOf: string): { periodLabel: string; periodEnd: string; deadline: string } {
  const [y, m] = asOf.split("-").map(Number); // m: 1..12
  if (frequency === "yearly") {
    return { periodLabel: `${y}`, periodEnd: `${y}-12-31`, deadline: `${y + 1}-03-31` };
  }
  if (frequency === "monthly") {
    const periodEnd = lastDayOfMonth(y, m); // last day of this month
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    return { periodLabel: `${NL_MONTHS[m - 1]} ${y}`, periodEnd, deadline: lastDayOfMonth(nextY, nextM) };
  }
  // quarterly
  const q = Math.floor((m - 1) / 3); // 0..3
  const periodEndMonth = (q + 1) * 3; // 3,6,9,12
  const periodEnd = lastDayOfMonth(y, periodEndMonth);
  const deadlineMonth = periodEndMonth === 12 ? 1 : periodEndMonth + 1;
  const deadlineYear = periodEndMonth === 12 ? y + 1 : y;
  return { periodLabel: `${Q_LABEL[q]} ${y}`, periodEnd, deadline: lastDayOfMonth(deadlineYear, deadlineMonth) };
}

export {}; // (computeVatSetAside added in Task 5)
