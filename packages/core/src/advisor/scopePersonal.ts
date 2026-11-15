import type { Account, Rule, Tx } from "../model.js";
import { accountsInScope, type EntityProfile } from "../entities.js";
import { CREDIT_CARD_PAYMENT_CATEGORY } from "../categories.js";
import { accountType } from "../balance.js";
import { categorize, type OwnAccounts } from "../views.js";
import { daysBetween, isIsoDate } from "./months.js";

/** Nothing is proposed from less history than this (Global Constraints). */
export const MIN_HISTORY_DAYS = 60;

export type HistoryCoverage = { days: number; sufficient: boolean };

/** Days between the first and the last dated transaction. */
export function historyCoverage(txs: readonly Tx[]): HistoryCoverage {
  let min = "";
  let max = "";
  for (const t of txs) {
    if (!isIsoDate(t.date)) continue;
    if (min === "" || t.date < min) min = t.date;
    if (max === "" || t.date > max) max = t.date;
  }
  if (min === "") return { days: 0, sufficient: false };
  const days = daysBetween(min, max);
  return { days, sufficient: days >= MIN_HISTORY_DAYS };
}

/** Personal scope (spec 10.1): business-entity accounts and their txs are out.
 *  No profiles means every account is personal (the default). */
export function personalView(
  accounts: readonly Account[],
  txs: readonly Tx[],
  profiles: readonly EntityProfile[],
): { accounts: Account[]; txs: Tx[] } {
  const inScope = accountsInScope(accounts, "personal", profiles);
  const keys = new Set(inScope.map((a) => a.key));
  return { accounts: inScope, txs: txs.filter((t) => keys.has(t.accountKey)) };
}

/** A card payment's two legs sit this many days apart at most. */
const SETTLEMENT_PAIR_DAYS = 7;

/** FIRST step of every proposer. `detectScheduleStreams` takes no rules and no
 *  own-accounts and only hints own money by name, so own transfers are removed
 *  here, by the full `categorize` rule. A card settlement is dropped only when
 *  the card account is in the same set (its spending is counted there); with
 *  the card out of scope the settlement is the real outflow and stays.
 *
 *  With the card in scope, the settlement drops as a PAIR: the checking-side
 *  settlement AND the card account's incoming "payment received" leg (same
 *  amount within a cent, within 7 days). Dropping only one side would turn the
 *  other into income or spending that cancels the card's purchases. A
 *  settlement with no matching card leg is dropped alone.
 *  UNVERIFIED against a real ICS/Amex statement: the pair rule is built from
 *  the shape of a card payment, not from an exported file. */
export function cleanTxs(
  txs: readonly Tx[],
  accounts: readonly Account[],
  rules: Rule[],
  own: OwnAccounts,
): Tx[] {
  const cardKeys = new Set(
    accounts.filter((a) => accountType(a) === "Creditcard").map((a) => a.key),
  );
  const kept = txs
    .map((t) => ({ t, c: categorize(t, rules, own) }))
    .filter(({ c }) => c !== "Eigen overboeking");
  if (cardKeys.size === 0) return kept.map(({ t }) => t);

  const legs = kept.filter(({ t }) => t.amount > 0 && cardKeys.has(t.accountKey));
  const dropped = new Set<Tx>();
  for (const { t: s, c } of kept) {
    if (c !== CREDIT_CARD_PAYMENT_CATEGORY) continue;
    dropped.add(s);
    const leg = legs.find(
      ({ t: l }) =>
        !dropped.has(l) &&
        Math.abs(Math.abs(l.amount) - Math.abs(s.amount)) <= 0.0100001 &&
        isIsoDate(l.date) &&
        isIsoDate(s.date) &&
        Math.abs(daysBetween(s.date, l.date)) <= SETTLEMENT_PAIR_DAYS,
    );
    if (leg) dropped.add(leg.t);
  }
  return kept.filter(({ t }) => !dropped.has(t)).map(({ t }) => t);
}
