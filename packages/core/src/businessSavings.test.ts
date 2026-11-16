import { describe, expect, test } from "vitest";
import {
  BUSINESS_SAVINGS_OFFERS,
  activePromo,
  businessSavingsOffersFor,
  planRateRange,
  type BusinessSavingsOffer,
} from "./businessSavings.js";

const revolut = BUSINESS_SAVINGS_OFFERS[0] as BusinessSavingsOffer;

describe("business savings offers", () => {
  test("Revolut Business Savings carries the verified figures", () => {
    // Re-read on 2026-11-16 from the savings page and the deposit information
    // sheet. The sheet's plan rates are unchanged. The 5,25% new-customer window
    // (2026-09-15..2026-11-15) closed on 2026-11-15 and is gone from the offer:
    // the page still shows the closed footnote, but nothing can be joined now.
    expect(revolut.bank).toBe("Revolut");
    expect(revolut.checkedOn).toBe("2026-11-16");
    expect(revolut.planRates.map((p) => p.ratePct)).toEqual([1.25, 1.55, 2.0, 2.5]);
    expect(revolut.promo).toBeUndefined();
    expect(revolut.sourceUrls).toEqual([
      "https://www.revolut.com/en-NL/business/savings/",
      "https://www.revolut.com/en-NL/legal/business-deposit-information-sheet/",
    ]);
  });

  const withPromo: BusinessSavingsOffer = {
    ...revolut,
    promo: {
      ratePct: 5.25,
      newCustomersOnly: true,
      signupFrom: "2026-09-15",
      signupUntil: "2026-11-15",
      durationMonths: 3,
      capAmount: 100_000,
    },
  };

  test("a promo is active from its first until its last sign-up day, hidden after", () => {
    expect(activePromo(withPromo, "2026-09-14")).toBeNull();
    expect(activePromo(withPromo, "2026-09-15")?.ratePct).toBe(5.25);
    expect(activePromo(withPromo, "2026-11-15")?.ratePct).toBe(5.25);
    expect(activePromo(withPromo, "2026-11-16")).toBeNull();
  });

  test("an offer without a promo never has one active", () => {
    expect(activePromo(revolut, "2026-10-15")).toBeNull();
  });

  test("plan rate range spans lowest to highest plan", () => {
    expect(planRateRange(revolut)).toEqual({ minPct: 1.25, maxPct: 2.5 });
  });

  test("business offers are absent in personal scope and present in business scope", () => {
    expect(businessSavingsOffersFor("personal")).toEqual([]);
    expect(businessSavingsOffersFor("business")).toEqual(BUSINESS_SAVINGS_OFFERS);
  });

  test("the type rejects a half promo", () => {
    const base = { ...revolut };
    // @ts-expect-error promo needs every field together
    const half: BusinessSavingsOffer = { ...base, promo: { ratePct: 5 } };
    expect(half).toBeDefined();
  });
});
