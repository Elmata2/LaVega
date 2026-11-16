import { accountTypeKind } from "../balance.js";
import { CREDIT_CARD_PAYMENT_CATEGORY } from "../categories.js";
import { bestRate, detectInterestRate, keptRate } from "../interest.js";
import { isEurCurrency, type Rule, type Tx } from "../model.js";
import { detectSubscriptions } from "../subscriptions.js";
import { categorize, ownAccounts, type OwnAccounts } from "../views.js";
import {
  CARD_OFFER_MAX_AGE_DAYS,
  DEADLINE_DAYS,
  OFFER_MIN_YEARLY_CENTS,
  SPEND_MIN_DIFF_CENTS,
  SPEND_MIN_DIFF_RATIO,
  type Candidate,
  type DailyInput,
} from "./types.js";

/* Pure candidate generators for the daily message. No clock, no I/O: the
 * caller passes `today` (the user's local day). Every figure is integer cents or
 * a whole-day count. Errors name no merchant and no amount. */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtcMs(day: string): number {
  const m = ISO_DAY.exec(day);
  if (!m) throw new Error("invalid date");
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(ms).toISOString().slice(0, 10);
  if (back !== day) throw new Error("invalid date");
  return ms;
}

export function addDays(day: string, n: number): string {
  return new Date(toUtcMs(day) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysFromTo(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86_400_000);
}

/** The calendar day in Europe/Amsterdam for an instant. Day boundaries follow
 *  local time (CET/CEST), not UTC. Pure: the instant is an argument. */
export function amsterdamDay(instant: Date | string): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) throw new Error("invalid date");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function weekdayOf(day: string): number {
  return new Date(toUtcMs(day)).getUTCDay();
}

/* --- spending --- */

/** What one transaction counts as spend, in cents, with its category; null when
 *  it is not spend. Money moved, not spent: own transfers, card payoffs (the
 *  card's own spend is already counted) and "Overboekingen" (Tikkie, top-ups)
 *  are skipped. Counting them would raise a false "you spent a lot" alarm. */
export function spendOf(
  t: Tx,
  rules: Rule[],
  own: OwnAccounts,
): { cents: number; category: string } | null {
  if (t.amount >= 0 || !isEurCurrency(t.currency)) return null;
  const category = categorize(t, rules, own);
  if (
    category === "Eigen overboeking" ||
    category === CREDIT_CARD_PAYMENT_CATEGORY ||
    category === "Overboekingen"
  )
    return null;
  return { cents: Math.round(-t.amount * 100), category };
}

/** Total EUR spend on one day, in cents. */
export function spendOnDay(i: DailyInput, day: string): number {
  const own = ownAccounts(i.accounts);
  let cents = 0;
  for (const t of i.txs) {
    if (t.date !== day) continue;
    const s = spendOf(t, i.rules, own);
    if (s) cents += s.cents;
  }
  return cents;
}

export function spendingCandidate(i: DailyInput): Candidate | null {
  if (i.noBankData) return null;
  const yesterday = addDays(i.today, -1);
  const lastWeek = addDays(yesterday, -7);
  const spendOn = (day: string): number => spendOnDay(i, day);

  const yesterdayCents = spendOn(yesterday);
  const lastWeekdayCents = spendOn(lastWeek);
  const diffCents = yesterdayCents - lastWeekdayCents;
  if (Math.abs(diffCents) < SPEND_MIN_DIFF_CENTS) return null;
  if (lastWeekdayCents === 0) {
    if (yesterdayCents < 2 * SPEND_MIN_DIFF_CENTS) return null;
  } else if (Math.abs(diffCents) / lastWeekdayCents < SPEND_MIN_DIFF_RATIO) {
    return null;
  }
  return {
    kind: "spending",
    key: `spending:${yesterday}`,
    figures: { yesterdayCents, lastWeekdayCents, diffCents, weekday: weekdayOf(yesterday) },
  };
}

/* --- deadlines --- */

function daysAwayOf(c: Candidate): number {
  return c.kind === "deadline" ? c.figures.daysAway : Number.MAX_SAFE_INTEGER;
}

export type UpcomingRenewal = {
  key: string;
  name: string;
  dueDate: string;
  daysAway: number;
  amountCents: number;
};

/** Detected subscriptions whose next charge falls within `withinDays` days of
 *  `i.today` (0 = today). Next charge = last charge + cadence. EUR only: an
 *  amount in cents is a euro amount. */
export function upcomingRenewals(i: DailyInput, withinDays: number): UpcomingRenewal[] {
  const out: UpcomingRenewal[] = [];
  if (i.noBankData) return out;
  const eurTxs: Tx[] = i.txs.filter((t) => isEurCurrency(t.currency));
  for (const s of detectSubscriptions(eurTxs, { asOf: i.today })) {
    const dueDate = addDays(s.lastDate, s.cadenceDays);
    const daysAway = daysFromTo(i.today, dueDate);
    if (daysAway < 0 || daysAway > withinDays) continue;
    out.push({ key: s.key, name: s.name, dueDate, daysAway, amountCents: s.lastAmountCents });
  }
  return out;
}

export function deadlineCandidates(i: DailyInput): Candidate[] {
  const out: Candidate[] = [];
  for (const r of upcomingRenewals(i, DEADLINE_DAYS)) {
    out.push({
      kind: "deadline",
      key: `deadline:renewal:${r.key}:${r.dueDate}`,
      figures: {
        what: "renewal",
        name: r.name,
        dueDate: r.dueDate,
        daysAway: r.daysAway,
        amountCents: r.amountCents,
      },
    });
  }
  for (const d of i.mirror.dueDates) {
    const daysAway = daysFromTo(i.today, d.date);
    if (daysAway < 0 || daysAway > DEADLINE_DAYS) continue;
    out.push({
      kind: "deadline",
      key: `deadline:${d.kind}:${d.label}:${d.date}`,
      figures: { what: d.kind, name: d.label, dueDate: d.date, daysAway, amountCents: null },
    });
  }
  return out.sort((a, b) => daysAwayOf(a) - daysAwayOf(b) || a.key.localeCompare(b.key));
}

/* --- offers --- */

export function offerCandidates(i: DailyInput): Candidate[] {
  const out: Candidate[] = [];

  // Rate: the largest EUR savings account, moved to the best free-withdrawal rate.
  const centsOf = new Map(i.balances.map((b) => [b.accountKey, b.cents]));
  let top: { account: (typeof i.accounts)[number]; cents: number } | null = null;
  for (const a of i.accounts) {
    if (accountTypeKind(a) !== "savings" || !isEurCurrency(a.currency)) continue;
    const cents = centsOf.get(a.key);
    if (cents === undefined || cents <= 0) continue;
    if (top === null || cents > top.cents) top = { account: a, cents };
  }
  const best = bestRate(i.rates);
  if (top && best && !i.noBankData) {
    const bestKept = keptRate(best);
    const current =
      top.account.interestRate ??
      detectInterestRate({ ...top.account, balance: top.cents / 100 }, i.txs, i.today);
    if (bestKept !== null && current !== null && bestKept > current) {
      // cents * percentage-points / 100, rounded once at the end
      const yearlyGainCents = Math.round((top.cents * (bestKept - current)) / 100);
      if (yearlyGainCents >= OFFER_MIN_YEARLY_CENTS) {
        out.push({
          kind: "better-offer",
          key: `offer:rate:${best.bank}`,
          figures: { what: "rate", name: best.bank, yearlyGainCents },
        });
      }
    }
  }

  // Card: mirrored by the browser; trusted only while fresh.
  const card = i.mirror.cardOffer;
  if (card && card.yearlyGainCents >= OFFER_MIN_YEARLY_CENTS) {
    const age = daysFromTo(card.computedAt, i.today);
    if (age >= 0 && age <= CARD_OFFER_MAX_AGE_DAYS) {
      out.push({
        kind: "better-offer",
        key: `offer:card:${card.name}`,
        figures: { what: "card", name: card.name, yearlyGainCents: card.yearlyGainCents },
      });
    }
  }
  return out;
}
