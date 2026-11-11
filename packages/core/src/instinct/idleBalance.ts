import { accountTypeKind } from "../balance.js";
import { CREDIT_CARD_PAYMENT_CATEGORY } from "../categories.js";
import { isEurCurrency, type Tx } from "../model.js";
import { categorize, ownAccounts, type OwnAccounts } from "../views.js";
import { addDays, daysFromTo, spendOf } from "./candidates.js";
import type { DailyInput } from "./types.js";

/* Idle money: the part of the current-account balance the user never touched in
 * the look-back period, judged against the user's own monthly money. Pure: the
 * clock is `i.today`. All amounts are integer cents. */

/** Days of balance history that decide what was "never used". */
export const IDLE_LOOKBACK_DAYS = 60;
/** About half a month's income; margin because pay dates rarely fill the window evenly. */
export const IDLE_SHARE_OF_INCOME = 0.45;
/** Idle money below this many cents (EUR 250) is never worth a tip. */
export const IDLE_MIN_CENTS = 25_000;
/** Fewer days of transactions than this and the monthly average is not trusted. */
export const IDLE_MIN_HISTORY_DAYS = 30;
/** Mean days in a month, to turn a covered span into a month count. */
const DAYS_PER_MONTH = 30.44;

/** EUR inflow of one transaction in cents; null when it is money moved, not earned
 *  (same exclusions as `spendOf`: own transfers, card payoffs, "Overboekingen"). */
function incomeOf(t: Tx, i: DailyInput, own: OwnAccounts): number | null {
  if (t.amount <= 0 || !isEurCurrency(t.currency)) return null;
  const category = categorize(t, i.rules, own);
  if (
    category === "Eigen overboeking" ||
    category === CREDIT_CARD_PAYMENT_CATEGORY ||
    category === "Overboekingen"
  )
    return null;
  return Math.round(t.amount * 100);
}

/** Lowest end-of-day balance of one account over the look-back, walking back from
 *  today's balance: balance before a transaction = balance after minus its amount. */
function floorCents(todayCents: number, txs: readonly Tx[], today: string): number {
  const from = addDays(today, -(IDLE_LOOKBACK_DAYS - 1));
  const byDay = new Map<string, number>();
  for (const t of txs) {
    if (t.date > today) continue;
    byDay.set(t.date, (byDay.get(t.date) ?? 0) + Math.round(t.amount * 100));
  }
  let balance = todayCents;
  let floor = balance;
  for (let d = today; d >= from; d = addDays(d, -1)) {
    floor = Math.min(floor, balance);
    balance -= byDay.get(d) ?? 0;
  }
  return floor;
}

/** Sum of the per-account floors (each at least 0) over all EUR current accounts.
 *  Accounts, balances and transactions are tied by `accountKey`; an account with no
 *  balance entry is skipped. */
export function idleCents(i: DailyInput): number {
  const balance = new Map(i.balances.map((b) => [b.accountKey, b.cents]));
  let sum = 0;
  for (const a of i.accounts) {
    if (accountTypeKind(a) !== "current" || !isEurCurrency(a.currency)) continue;
    const cents = balance.get(a.key);
    if (cents === undefined) continue;
    const txs = i.txs.filter((t) => t.accountKey === a.key && isEurCurrency(t.currency));
    sum += Math.max(0, floorCents(cents, txs, i.today));
  }
  return sum;
}

/** Average monthly income in cents (spending when there is no income) over the
 *  span the input holds; null with under IDLE_MIN_HISTORY_DAYS of data. */
export function monthlyMoneyCents(i: DailyInput): number | null {
  const current = new Set(
    i.accounts
      .filter((a) => accountTypeKind(a) === "current" && isEurCurrency(a.currency))
      .map((a) => a.key),
  );
  const txs = i.txs.filter((t) => current.has(t.accountKey) && t.date <= i.today);
  if (txs.length === 0) return null;
  const oldest = txs.reduce((m, t) => (t.date < m ? t.date : m), txs[0]!.date);
  const days = daysFromTo(oldest, i.today);
  if (days < IDLE_MIN_HISTORY_DAYS) return null;
  const months = days / DAYS_PER_MONTH;
  const own = ownAccounts(i.accounts);
  let income = 0;
  let spend = 0;
  for (const t of txs) {
    income += incomeOf(t, i, own) ?? 0;
    spend += spendOf(t, i.rules, own)?.cents ?? 0;
  }
  return Math.round((income > 0 ? income : spend) / months);
}

/** True when the idle money is large next to the user's own monthly money. */
export function hasIdleMoney(i: DailyInput): boolean {
  if (i.noBankData) return false;
  const monthly = monthlyMoneyCents(i);
  if (monthly === null || monthly <= 0) return false;
  const idle = idleCents(i);
  return idle >= IDLE_MIN_CENTS && idle >= IDLE_SHARE_OF_INCOME * monthly;
}
