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
    expect(revolut.bank).toBe("Revolut");
    expect(revolut.checkedOn).toBe("2026-10-15");
    expect(revolut.planRates.map((p) => p.ratePct)).toEqual([1.25, 1.55, 2.0, 2.5]);
    expect(revolut.promo).toMatchObject({ ratePct: 5.25, durationMonths: 3, capAmount: 100_000 });
  });

  test("promo is active up to and including its sign-up deadline, hidden after", () => {
    expect(activePromo(revolut, "2026-10-15")?.ratePct).toBe(5.25);
    expect(activePromo(revolut, "2026-11-15")?.ratePct).toBe(5.25);
    expect(activePromo(revolut, "2026-11-16")).toBeNull();
  });

  test("promo is not active before its sign-up window opens", () => {
    expect(activePromo(revolut, "2026-09-14")).toBeNull();
  });

  test("an offer without a promo never has one active", () => {
    expect(activePromo({ ...revolut, promo: undefined }, "2026-10-15")).toBeNull();
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
