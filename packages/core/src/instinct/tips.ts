import { isEurCurrency } from "../model.js";
import { accountTypeKind } from "../balance.js";
import {
  detectSubscriptions,
  subscriptionOverlaps,
  subscriptionPriceIncreases,
} from "../subscriptions.js";
import { addDays } from "./candidates.js";
import type { DailyInput, TipAnswers } from "./types.js";

export type Tip = {
  id: string;
  when: (a: TipAnswers, i: DailyInput) => boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  source: string;
};

export const TIP_COOLDOWN_DAYS = 3;
export const REPEAT_WINDOW_DAYS = 30;

/* The reviewed tip library. Only ids live here; the NL and EN words are in
 * ./copy.ts, keyed exhaustively by these ids. A tip is a general, factual
 * pointer to something the user can check in LaVega. None gives investment
 * product advice or urges credit. Each `when` reads DailyInput only.
 * Unreviewed tips (reviewedAt null) are never sent; the owner reviews them. */

const IDLE_BALANCE_CENTS = 500_000;
const FEE_WINDOW_DAYS = 90;
const FEE_MIN_CENTS = 2500;
const MANY_SUBSCRIPTIONS = 5;

const subsOf = (i: DailyInput) =>
  detectSubscriptions(
    i.txs.filter((t) => isEurCurrency(t.currency)),
    { asOf: i.today },
  );

export const TIPS = [
  {
    id: "subscription-overlap",
    when: (_a, i) => subscriptionOverlaps(subsOf(i)).length > 0,
    reviewedAt: null,
    reviewedBy: null,
    source: "Abonnementen tab: subscriptionOverlaps",
  },
  {
    id: "price-increase",
    when: (_a, i) => subscriptionPriceIncreases(subsOf(i)).length > 0,
    reviewedAt: null,
    reviewedBy: null,
    source: "Abonnementen tab: subscriptionPriceIncreases",
  },
  {
    id: "many-subscriptions",
    when: (_a, i) => subsOf(i).length >= MANY_SUBSCRIPTIONS,
    reviewedAt: null,
    reviewedBy: null,
    source: "Abonnementen tab: detectSubscriptions",
  },
  {
    id: "idle-balance",
    when: (_a, i) => {
      const cents = new Map(i.balances.map((b) => [b.accountKey, b.cents]));
      return i.accounts.some(
        (a) =>
          accountTypeKind(a) === "current" &&
          isEurCurrency(a.currency) &&
          (cents.get(a.key) ?? 0) >= IDLE_BALANCE_CENTS,
      );
    },
    reviewedAt: null,
    reviewedBy: null,
    source: "Optimalisatie tab: rentes via geld.nl",
  },
  {
    id: "fee-heavy-account",
    when: (_a, i) => {
      const from = addDays(i.today, -FEE_WINDOW_DAYS);
      let cents = 0;
      for (const t of i.txs) {
        if (t.amount >= 0 || t.date <= from || t.date > i.today || !isEurCurrency(t.currency))
          continue;
        if (t.category === "Bankkosten") cents += Math.round(-t.amount * 100);
      }
      return cents >= FEE_MIN_CENTS;
    },
    reviewedAt: null,
    reviewedBy: null,
    source: "Rekeningen tab: Bankkosten category",
  },
] as const satisfies readonly Tip[];

export type TipId = (typeof TIPS)[number]["id"];
