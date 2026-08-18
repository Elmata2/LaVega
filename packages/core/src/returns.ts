import type { Account, Rule, Tx } from "./model.js";
import { categorize, type OwnAccounts } from "./views.js";
import { accountType } from "./balance.js";

/** Money moved between the owner's own accounts is not spending. Same category
 *  the forecast excludes, for the same reason: a €50k sweep to savings is not
 *  €50k of consumption, and treating it as such invents a number. */
const TRANSFER_CATEGORY = "Eigen overboeking";

/** Below this much history an annualised figure is a guess dressed as a
 *  measurement. Matches the forecast's own floor for the same judgement. */
export const MIN_SPEND_DAYS = 60;

/** How long an account may be silent before its history stops describing what
 *  it spends NOW. Measured from the last transaction to `asOf`, not from the
 *  window: six months of real spending that ended two years ago still divides
 *  out to a confident euro figure, and that figure would win a ranking against
 *  an account he actually uses. Three months covers an ordinary import lag
 *  (monthly or quarterly export) and catches dormancy. Past it the base is
 *  unknown - not zero, and not the old number carried forward. */
export const MAX_SPEND_GAP_DAYS = 90;

const DAY_MS = 86_400_000;

/**
 *  `exact`       a credit card: every outflow on it IS card spend
 *  `upper-bound` a payment account: the bank export does not reliably say
 *                whether an outflow was a card payment or a direct debit, so
 *                this is the most it could be
 *  `unknown`     too little history, nothing spent, or silent for longer than
 *                MAX_SPEND_GAP_DAYS
 */
export type SpendKind = "exact" | "upper-bound" | "unknown";

export type SpendBase = {
  /** Annualised card spending in cents, or null when it cannot be measured. */
  perYearCents: number | null;
  kind: SpendKind;
  /** Days between the first and last transaction we hold for this account. */
  observedDays: number;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** What this account spends in a year, as the base cashback multiplies. */
export function annualSpendCents(
  account: Account,
  txs: Tx[],
  rules: Rule[],
  own: OwnAccounts | undefined,
  asOf: string,
): SpendBase {
  const mine = txs.filter((t) => t.accountKey === account.key && t.date <= asOf);
  if (mine.length === 0) return { perYearCents: null, kind: "unknown", observedDays: 0 };

  const dates = mine.map((t) => t.date).sort();
  const lastDate = dates[dates.length - 1];
  const observedDays = daysBetween(dates[0], lastDate);

  // Silent too long: the history is real but it is no longer about today.
  if (daysBetween(lastDate, asOf) > MAX_SPEND_GAP_DAYS) {
    return { perYearCents: null, kind: "unknown", observedDays };
  }

  let outCents = 0;
  for (const t of mine) {
    if (t.amount >= 0) continue; // money in is not spending
    if (categorize(t, rules, own) === TRANSFER_CATEGORY) continue;
    outCents += Math.round(-t.amount * 100);
  }

  if (observedDays < MIN_SPEND_DAYS || outCents === 0) {
    return { perYearCents: null, kind: "unknown", observedDays };
  }
  return {
    perYearCents: Math.round((outCents * 365) / observedDays),
    kind: accountType(account) === "Creditcard" ? "exact" : "upper-bound",
    observedDays,
  };
}
