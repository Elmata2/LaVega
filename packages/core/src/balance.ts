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

/** The same distinction as `accountType`, as a locale-neutral kind rather than
 *  a Dutch word. Core stays out of the business of UI prose — a caller that
 *  needs to SHOW the type renders this kind through copy/money.ts, the way
 *  n8n.ts's AutoBookHold is rendered through an exhaustive switch instead of
 *  returning a sentence itself.
 *
 *  `accountType` itself keeps returning the Dutch string: accountCosts.ts,
 *  returns.ts, travel.ts, interest.ts and two views (Optimalisatie.tsx,
 *  Profiel.tsx) compare against it directly and are out of scope here, so
 *  this is additive rather than a replacement. */
export type AccountTypeKind = "current" | "savings" | "credit" | "investment" | "other";

const ACCOUNT_TYPE_KIND: Record<(typeof ACCOUNT_TYPES)[number], AccountTypeKind> = {
  Betaalrekening: "current",
  Spaarrekening: "savings",
  Creditcard: "credit",
  Beleggingsrekening: "investment",
  Overig: "other",
};

/** One of the five canonical `ACCOUNT_TYPES` strings, mapped to a kind. A value
 *  outside that set (data from before a type was renamed, or a hand-edited
 *  import) reads as "other" rather than throwing. Exported on its own so a
 *  `<select>` built from `ACCOUNT_TYPES` — the value stays the canonical Dutch
 *  string, only the option's displayed text is localised — can map each
 *  option without first having an Account to call `accountTypeKind` on. */
export function accountTypeKindOf(type: string): AccountTypeKind {
  return ACCOUNT_TYPE_KIND[type as (typeof ACCOUNT_TYPES)[number]] ?? "other";
}

/** `accountTypeKindOf(accountType(a))` — the kind for a real account. */
export function accountTypeKind(a: Account): AccountTypeKind {
  return accountTypeKindOf(accountType(a));
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
