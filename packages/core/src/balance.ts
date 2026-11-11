/*
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 */

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
  /* WS3.1 asset/liability kinds. The first five strings are the stored values
   * of every vault written before this slice, so they are never renumbered or
   * removed; the additions only widen the set. A loan/property/vehicle value is
   * a dated ABSOLUTE valuation, never an amortization projection. */
  "Lening",
  "Woning",
  "Voertuig",
  "Overig bezit",
  "Overige schuld",
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
export type AccountTypeKind =
  | "current"
  | "savings"
  | "credit"
  | "investment"
  | "loan"
  | "property"
  | "vehicle"
  | "otherAsset"
  | "otherLiability"
  | "other";

const ACCOUNT_TYPE_KIND: Record<(typeof ACCOUNT_TYPES)[number], AccountTypeKind> = {
  Betaalrekening: "current",
  Spaarrekening: "savings",
  Creditcard: "credit",
  Beleggingsrekening: "investment",
  Lening: "loan",
  Woning: "property",
  Voertuig: "vehicle",
  "Overig bezit": "otherAsset",
  "Overige schuld": "otherLiability",
  Overig: "other",
};

/** Sure's `classification`: an account is an ASSET or a LIABILITY, and the
 *  balance series signs flows by it (Sure `BaseCalculator#flows_factor`).
 *  A credit card, a loan and "other liability" are liabilities. Everything
 *  else is an asset — including a bare "Overig", which stays an asset because
 *  a liability needs the owner to say so (Sure has separate OtherAsset and
 *  OtherLiability types; LaVega splits only where the owner picked a side). */
export type AccountClassification = "asset" | "liability";

export function accountClassificationOf(kind: AccountTypeKind): AccountClassification {
  return kind === "credit" || kind === "loan" || kind === "otherLiability" ? "liability" : "asset";
}

/** `accountClassificationOf(accountTypeKind(a))`. */
export function accountClassification(a: Account): AccountClassification {
  return accountClassificationOf(accountTypeKind(a));
}

/** Sure's `balance_type == :cash` accounts for this slice: the two depository
 *  kinds. Only these count as cash on hand; an investment account's cash part
 *  needs a holdings valuation that WS3.1 does not add. */
export function isDepositoryKind(kind: AccountTypeKind): boolean {
  return kind === "current" || kind === "savings";
}

export function isLiabilityKind(kind: AccountTypeKind): boolean {
  return accountClassificationOf(kind) === "liability";
}

/** A real liability account: a credit card, a loan or an explicit other
 *  liability. The screen shows the amount OWED as a positive and stores it as
 *  a negative, exactly as a credit card already did. */
export function accountIsLiability(a: Account): boolean {
  return isLiabilityKind(accountTypeKind(a));
}

/** Stored `type` spellings an older import or a hand-edited vault can carry,
 *  mapped to the canonical Dutch string. Only KNOWN aliases are rewritten; an
 *  unrecognised value is left exactly as it is (it already reads as "other"),
 *  so a migration can never rename data it does not understand. */
const ACCOUNT_TYPE_ALIASES: Record<string, (typeof ACCOUNT_TYPES)[number]> = {
  betaalrekening: "Betaalrekening",
  betaal: "Betaalrekening",
  checking: "Betaalrekening",
  current: "Betaalrekening",
  "current account": "Betaalrekening",
  spaarrekening: "Spaarrekening",
  savings: "Spaarrekening",
  "savings account": "Spaarrekening",
  creditcard: "Creditcard",
  "credit card": "Creditcard",
  credit: "Creditcard",
  beleggingsrekening: "Beleggingsrekening",
  investment: "Beleggingsrekening",
  investments: "Beleggingsrekening",
  brokerage: "Beleggingsrekening",
  lening: "Lening",
  loan: "Lening",
  hypotheek: "Lening",
  mortgage: "Lening",
  schuld: "Overige schuld",
  debt: "Overige schuld",
  "other liability": "Overige schuld",
  "overige schuld": "Overige schuld",
  woning: "Woning",
  property: "Woning",
  house: "Woning",
  home: "Woning",
  vastgoed: "Woning",
  voertuig: "Voertuig",
  vehicle: "Voertuig",
  car: "Voertuig",
  auto: "Voertuig",
  "overig bezit": "Overig bezit",
  "other asset": "Overig bezit",
  other: "Overig",
  overig: "Overig",
};

/** One pass over an old vault's account types (WS3.1). Returns the same object
 *  when every type is already canonical, which keeps the open-time migration to
 *  ONE vault save. Unknown values survive untouched. */
export function migrateAccountTypes(accounts: readonly Account[]): {
  accounts: Account[];
  changed: boolean;
} {
  let changed = false;
  const next = accounts.map((account) => {
    const raw = account.type;
    if (raw == null || raw.trim() === "") return account;
    const canonical = ACCOUNT_TYPE_ALIASES[raw.trim().toLowerCase()];
    if (canonical == null || canonical === raw) return account;
    changed = true;
    return { ...account, type: canonical };
  });
  return { accounts: changed ? next : [...accounts], changed };
}

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

/* ── Dated absolute valuations (WS3.1, issue #291) ───────────────────────────
 *
 * Sure keeps an opening anchor per account plus dated reconciliation rows that
 * hard-reset the balance to an API-reported value. LaVega mirrors that with one
 * additive vault field: `Valuation[]`, each row an absolute amount on a date.
 * A valuation is never an interpolation: the day it is dated on takes the amount
 * as-is, and only the ledger flows before/after move the series away from it.
 * Money is integer cents with the account's own sign convention (ADR 0011): a
 * liability account stores its debt as a negative amount, exactly as the credit
 * card balance already does. */

export type ValuationKind = "opening" | "reconciliation";

export type ValuationSource = "manual" | "import" | "linked";

export type Valuation = {
  /** Deterministic identity `accountKey|date`, so writing the same day twice
   *  updates instead of duplicating (the same trick bill occurrences use). */
  id: string;
  accountKey: string;
  /** ISO YYYY-MM-DD, the day the amount held (end of day). */
  date: string;
  /** Absolute balance in integer cents, signed like `Account.balance`. */
  amountCents: number;
  currency: string;
  /** `opening` is where the account STARTED; `reconciliation` is a later hard
   *  reset (a bank-reported value or the owner's revaluation). */
  kind: ValuationKind;
  source: ValuationSource;
  /** ISO date the owner/writer recorded this row; audit trail only. */
  createdAt: string;
};

export function valuationId(accountKey: string, date: string): string {
  return `${accountKey}|${date}`;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isValuationDay(date: string): boolean {
  return ISO_DAY.test(date);
}

/** Fill the shape a stored row may predate. Identity fields are never invented:
 *  an account key and an ISO date are required, not defaulted. */
export function normalizeValuation(v: Valuation): Valuation {
  return {
    ...v,
    id: valuationId(v.accountKey, v.date),
    amountCents: Math.round(v.amountCents),
    currency: (v.currency ?? "").trim().toUpperCase() || "EUR",
    kind: v.kind ?? "reconciliation",
    source: v.source ?? "manual",
  };
}

/** Every stored valuation of one account, oldest date first. */
export function valuationsForAccount(
  valuations: readonly Valuation[] | null | undefined,
  accountKey: string,
): Valuation[] {
  return (valuations ?? [])
    .filter((v) => v.accountKey === accountKey)
    .map(normalizeValuation)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** An absolute anchor the balance series can hard-reset on. The account's own
 *  `balance`/`balanceDate` counts as a derived `current` anchor: it is what the
 *  bank or statement last said, not a stored valuation row. */
export type AccountAnchor = {
  date: string;
  amountCents: number;
  kind: "opening" | "current" | "reconciliation";
  source?: ValuationSource;
};

/** The account's opening anchor, when the owner supplied both halves. A date
 *  without an amount (or the reverse) is not an anchor: unknown, not zero. */
export function openingAnchor(account: Account): AccountAnchor | null {
  if (account.openingBalanceCents == null || account.openingDate == null) return null;
  if (!isValuationDay(account.openingDate)) return null;
  return {
    date: account.openingDate,
    amountCents: Math.round(account.openingBalanceCents),
    kind: "opening",
  };
}

/** The derived current anchor: the stored balance, dated by `balanceDate` when
 *  the statement named one. A balance with no date is treated as the position
 *  at `asOf` — the same convention `currentBalance` already uses, not an
 *  invented vault date. A null balance is no anchor at all. */
export function currentAnchor(account: Account, asOf: string): AccountAnchor | null {
  if (account.balance == null) return null;
  const date =
    account.balanceDate != null && isValuationDay(account.balanceDate) ? account.balanceDate : asOf;
  return { date, amountCents: Math.round(account.balance * 100), kind: "current" };
}

/** Every anchor for one account, oldest first, one per date. On a shared date
 *  an explicit reconciliation beats the opening beat the derived current
 *  anchor: the owner's/newest absolute statement wins. */
export function accountAnchors(
  account: Account,
  valuations: readonly Valuation[] | null | undefined,
  asOf: string,
): AccountAnchor[] {
  const byDate = new Map<string, AccountAnchor>();
  const put = (anchor: AccountAnchor | null) => {
    if (anchor == null) return;
    const previous = byDate.get(anchor.date);
    if (previous == null || anchorRank(anchor) > anchorRank(previous)) {
      byDate.set(anchor.date, anchor);
    }
  };
  put(openingAnchor(account));
  put(currentAnchor(account, asOf));
  for (const v of valuationsForAccount(valuations, account.key)) {
    put({
      date: v.date,
      amountCents: v.amountCents,
      kind: v.kind === "opening" ? "opening" : "reconciliation",
      source: v.source,
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function anchorRank(anchor: AccountAnchor): number {
  return anchor.kind === "reconciliation" ? 3 : anchor.kind === "current" ? 2 : 1;
}

/** How old the newest absolute anchor is, and whether that makes the series a
 *  carried value rather than a current one. Sure labels stale balances; so does
 *  this, from data instead of prose. */
export type ValuationStatus = {
  kind: "unknown" | "fresh" | "stale";
  lastAnchorDate: string | null;
  ageDays: number | null;
};

/** A carried balance older than this reads as stale on the screen. Six weeks
 *  is long enough that a monthly statement covers it and short enough that a
 *  quarterly revaluation is visibly labelled. */
export const VALUATION_STALE_DAYS = 45;

export function valuationStatus(
  account: Account,
  valuations: readonly Valuation[] | null | undefined,
  asOf: string,
): ValuationStatus {
  const anchors = accountAnchors(account, valuations, asOf);
  const latest = anchors[anchors.length - 1];
  if (latest == null) return { kind: "unknown", lastAnchorDate: null, ageDays: null };
  const ageDays = daysBetweenIso(latest.date, asOf);
  return {
    kind: ageDays > VALUATION_STALE_DAYS ? "stale" : "fresh",
    lastAnchorDate: latest.date,
    ageDays,
  };
}

function daysBetweenIso(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Merge consistency for a duplicate account pair (WS3.1 acceptance).
 *
 * The duplicate's valuations move to the survivor, re-keyed. When the survivor
 * already has a row on the same date, the survivor's row is kept and the
 * duplicate's is DROPPED (counted, never silently): two absolute amounts for
 * one day cannot both be true. A dropped row is what the caller reports, the
 * same way #282 reports dropped transfer links. The result never points at the
 * duplicate account key, so a merge cannot leave orphans.
 */
export function mergeValuations(
  valuations: readonly Valuation[],
  survivorKey: string,
  duplicateKey: string,
): { valuations: Valuation[]; remapped: number; dropped: number } {
  if (survivorKey === duplicateKey) {
    return { valuations: [...valuations], remapped: 0, dropped: 0 };
  }
  const survivorDates = new Set(
    valuations.filter((v) => v.accountKey === survivorKey).map((v) => v.date),
  );
  let remapped = 0;
  let dropped = 0;
  const out: Valuation[] = [];
  for (const v of valuations) {
    if (v.accountKey === survivorKey) {
      out.push(v);
    } else if (v.accountKey === duplicateKey) {
      if (survivorDates.has(v.date)) {
        dropped += 1;
      } else {
        remapped += 1;
        survivorDates.add(v.date);
        out.push({ ...v, accountKey: survivorKey, id: valuationId(survivorKey, v.date) });
      }
    } else {
      out.push(v);
    }
  }
  return { valuations: out, remapped, dropped };
}

/** Nothing may point at a vanished account: deleting one drops its valuations
 *  explicitly (the count is returned so the screen can say so). */
export function dropAccountValuations(
  valuations: readonly Valuation[],
  accountKey: string,
): { valuations: Valuation[]; dropped: number } {
  const kept = valuations.filter((v) => v.accountKey !== accountKey);
  return { valuations: kept, dropped: valuations.length - kept.length };
}

/** True when every stored valuation points at an account that still exists.
 *  The invariant `mergeValuations`/`dropAccountValuations` keep; exposed so a
 *  caller (and a test) can assert it instead of trusting the comment. */
export function valuationsHaveNoOrphans(
  valuations: readonly Valuation[],
  accountKeys: readonly string[],
): boolean {
  const known = new Set(accountKeys);
  return valuations.every((v) => known.has(v.accountKey));
}
