import type { Account, ScheduledFlow, Tx } from "./model.js";
import { reservedCents } from "./scheduledFlows.js";

/** A credit-card account: a manually-entered saldo is the amount OWED, so it
 *  counts as NEGATIVE (debt) in the net position while the UI shows the owed
 *  amount as a positive.
 *
 *  This used to match American Express and nothing else, which meant a real ING
 *  or ABN AMRO credit card imported without an explicit type fell through to
 *  "Betaalrekening" — and the travel agent then asked for that bank's DEBIT card
 *  tariff and ranked the card at 1.4% instead of 2%. Same class of error as
 *  "rank PRODUCTS, not banks", one layer further down.
 *
 *  An explicit `a.type` set by the owner still wins over this; see accountType. */
/** Says "credit card" in so many words. Deliberately NOT `visa` or `mastercard`:
 *  both brands issue debit cards too, so matching them would recreate the exact
 *  mistake this is here to prevent — a Trading 212 "212 Card" is a Mastercard
 *  DEBIT card, and calling it a creditcard sends the travel agent looking up the
 *  wrong tariff. Nor plain "card"/"kaart", for the same reason. */
const READS_AS_CREDIT_CARD = /\b(creditcard|credit card|amex|american express)\b/i;

export function isCardAccount(a: Account): boolean {
  return READS_AS_CREDIT_CARD.test(`${a.bank ?? ""} ${a.name ?? ""}`);
}

export const ACCOUNT_TYPES = [
  "Betaalrekening",
  "Spaarrekening",
  "Creditcard",
  "Beleggingsrekening",
  "Overig",
] as const;

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
export function availableBalanceCents(
  totalBalanceEuros: number,
  flows: ScheduledFlow[],
  asOf: string,
): number {
  return Math.round(totalBalanceEuros * 100) - reservedCents(flows, asOf);
}
