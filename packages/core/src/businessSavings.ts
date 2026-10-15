/* CURATED BUSINESS SAVINGS OFFERS.
 *
 * The catalogue (catalog.ts / catalogRates.ts) was the first place to look and
 * does not fit: one entry carries one scalar `interestPct`, so it cannot hold
 * per-plan rates or a promo with a sign-up window, and everything it holds is
 * merged into the CONSUMER comparison by `savingsBenchmarks`. A business offer
 * there would surface in Particulier. So this is a small typed list with the
 * same provenance fields the catalogue uses (source URL, date checked).
 *
 * Pure: no clock. Callers pass `today` (an ISO date). */
import type { EntityScope } from "./entities.js";

/** Which guarantee scheme covers the deposits; the UI words it per locale. */
export type BusinessDepositScheme = "lt-revolut-bank-uab-nl-branch";

export type BusinessSavingsPlanRate = { plan: string; ratePct: number };

/** Every promo field travels together: an offer either has a complete promo or
 *  none, so a "5,25%" with no deadline or cap cannot be expressed. */
export type BusinessSavingsPromo = {
  ratePct: number;
  newCustomersOnly: boolean;
  /** ISO dates, inclusive. */
  signupFrom: string;
  signupUntil: string;
  durationMonths: number;
  /** In whole units of `currency`; the promo rate applies up to this balance. */
  capAmount: number;
};

export type BusinessSavingsOffer = {
  id: string;
  bank: string;
  product: string;
  currency: string;
  /** Rate per plan, standing (no promo). At least one. */
  planRates: readonly [BusinessSavingsPlanRate, ...BusinessSavingsPlanRate[]];
  promo?: BusinessSavingsPromo;
  depositScheme: BusinessDepositScheme;
  /** Where each figure was read; at least one. */
  sourceUrls: readonly [string, ...string[]];
  /** ISO date a human last read the sources. */
  checkedOn: string;
};

export const BUSINESS_SAVINGS_OFFERS: readonly BusinessSavingsOffer[] = [
  {
    id: "revolut-business-savings",
    bank: "Revolut",
    product: "Business Savings",
    currency: "EUR",
    planRates: [
      { plan: "Basic", ratePct: 1.25 },
      { plan: "Grow", ratePct: 1.55 },
      { plan: "Scale", ratePct: 2.0 },
      { plan: "Enterprise", ratePct: 2.5 },
    ],
    promo: {
      ratePct: 5.25,
      newCustomersOnly: true,
      signupFrom: "2026-09-15",
      signupUntil: "2026-11-15",
      durationMonths: 3,
      capAmount: 100_000,
    },
    depositScheme: "lt-revolut-bank-uab-nl-branch",
    sourceUrls: [
      "https://www.revolut.com/en-NL/business/savings/",
      "https://www.revolut.com/en-NL/legal/business-deposit-information-sheet/",
    ],
    checkedOn: "2026-10-15",
  },
];

/** The promo while it can still be signed up for (inclusive of both ends), else
 *  null: after `signupUntil` the entry silently falls back to its plan rates. */
export function activePromo(
  offer: BusinessSavingsOffer,
  today: string,
): BusinessSavingsPromo | null {
  const p = offer.promo;
  if (!p) return null;
  return today >= p.signupFrom && today <= p.signupUntil ? p : null;
}

export function planRateRange(offer: BusinessSavingsOffer): { minPct: number; maxPct: number } {
  const rates = offer.planRates.map((r) => r.ratePct);
  return { minPct: Math.min(...rates), maxPct: Math.max(...rates) };
}

/** Business offers appear in the business half only. */
export function businessSavingsOffersFor(
  scope: EntityScope,
  offers: readonly BusinessSavingsOffer[] = BUSINESS_SAVINGS_OFFERS,
): readonly BusinessSavingsOffer[] {
  return scope === "business" ? offers : [];
}
