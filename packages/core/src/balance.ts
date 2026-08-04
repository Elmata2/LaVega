import type { Account, ScheduledFlow, Tx } from "./model.js";
import { reservedCents } from "./scheduledFlows.js";

/** A credit-card account: a manually-entered saldo is the amount OWED, so it
 *  counts as NEGATIVE (debt) in the net position while the UI shows the owed
 *  amount as a positive. Detected by bank name for now (Amex is always a card);
 *  extend as more card sources are added. */
export function isCardAccount(a: Account): boolean {
  return a.bank === "American Express";
}

export const ACCOUNT_TYPES = ["Betaalrekening", "Spaarrekening", "Creditcard", "Beleggingsrekening", "Overig"] as const;

/** The account's soort: the user-set `type` if present, else a smart default —
 *  a card => Creditcard; a name that reads as savings (ING "Oranje
 *  Spaarrekening", a Revolut "Spaarrekening"/"Savings" product, etc.) =>
 *  Spaarrekening; otherwise Betaalrekening. The name heuristic is only a
 *  default: mergeImportedAccounts preserves a user's explicit type on
 *  re-import, so an override always wins. */
export function accountType(a: Account): string {
  if (a.type && a.type.length > 0) return a.type;
  if (isCardAccount(a)) return "Creditcard";
  if (/spaar|savings/i.test(a.name)) return "Spaarrekening";
  return "Betaalrekening";
}

/** Current balance rolled forward to `asOf`: stored balance + the txs that fall
 *  strictly AFTER balanceDate and on/before asOf. A null balance stays null
 *  (unknown). No balanceDate => the balance is already current (returned as-is). */
export function currentBalance(account: Account, txs: Tx[], asOf: string): number | null {
  if (account.balance === null) return null;
  const d = account.balanceDate;
  if (!d) return account.balance;
  let sumCents = 0;
  for (const t of txs) {
    if (t.accountKey === account.key && t.date > d && t.date <= asOf) {
      sumCents += Math.round(t.amount * 100);
    }
  }
  return account.balance + sumCents / 100;
}

/** Map accounts to the same accounts with `balance` replaced by currentBalance,
 *  so consolidate/forecast/display all see the rolled-forward position. */
export function withCurrentBalances(accounts: Account[], txs: Tx[], asOf: string): Account[] {
  return accounts.map((a) => ({ ...a, balance: currentBalance(a, txs, asOf) }));
}

/** Spendable cash = total balance (euros) minus money earmarked for VAT
 *  (reservations), in integer cents. The forecast still places the actual VAT
 *  outflow on its due date; this is the "beschikbaar NU" view. */
export function availableBalanceCents(totalBalanceEuros: number, flows: ScheduledFlow[], asOf: string): number {
  return Math.round(totalBalanceEuros * 100) - reservedCents(flows, asOf);
}
