import { describe, expect, test } from "vitest";
import { cardOfferOf } from "../instinct/cardOffer.js";
import { CARD_VERDICT_CASES, TODAY } from "./__fixtures__/cardVerdictCases.js";
import { computePlan } from "./compute.js";

/* One engine, one verdict. Each case runs `computePlan` once; the card verdict
 * and the Instinct offer are read from that single result. The expected figures
 * are pinned literals, checked by hand against the committed catalogue (e.g. ICS
 * Mastercard Classic -> American Express Blue Card: the Blue Card costs 0 and earns
 * 0,5 point per euro: 12.000 euro x 0,5 = 6.000 points x 0,3 cent = 1.800 cents;
 * the ICS card costs 3.895 cents a year; gain 1.800 + 3.895 = 5.695). */

describe("the card verdict and the Instinct offer come from one plan", () => {
  test.each(CARD_VERDICT_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const plan = computePlan(c.input);
    const advice = plan.sections.cards.figures.advice;
    const v = advice.verdict;

    expect(v.kind).toBe(c.expect.verdictKind);
    expect(v.kind === "switch" ? v.best.cardId : null).toBe(c.expect.bestCardId);
    expect("gainCents" in v ? v.gainCents : null).toBe(c.expect.gainCents);
    expect(advice.basis).toBe(c.expect.basis);
    expect(
      [...advice.options, ...advice.notComparable]
        .filter((o) => o.held)
        .map((o) => o.cardId)
        .sort(),
    ).toEqual(c.expect.heldIds);

    const offer = cardOfferOf(plan, TODAY);
    expect(
      offer === null ? null : { name: offer.name, yearlyGainCents: offer.yearlyGainCents },
    ).toEqual(c.expect.offer);
    if (offer !== null) {
      expect(offer.computedAt).toBe(TODAY);
      expect(v.kind === "switch" ? v.best.name : null).toBe(offer.name);
    }

    // An offer exists exactly when the verdict is a switch from a card the user holds
    // (a best-held baseline), on the user's own history, with no card debt.
    const mayOffer =
      v.kind === "switch" &&
      advice.baseline.kind === "best-held" &&
      advice.basis === "history" &&
      !advice.ignoresInterest;
    expect(offer !== null).toBe(mayOffer);
  });

  test("the cases cover each reason an offer is withheld", () => {
    const withheld = CARD_VERDICT_CASES.filter((c) => c.expect.offer === null);
    expect(withheld.some((c) => c.expect.verdictKind === "unknown-baseline")).toBe(true);
    expect(withheld.some((c) => c.expect.basis === "stated")).toBe(true);
    expect(withheld.some((c) => c.name.startsWith("card debt"))).toBe(true);
    expect(
      withheld.some((c) => c.expect.verdictKind === "switch" && c.expect.heldIds.length === 0),
    ).toBe(true);
    expect(CARD_VERDICT_CASES.some((c) => c.expect.offer !== null)).toBe(true);
  });
});
