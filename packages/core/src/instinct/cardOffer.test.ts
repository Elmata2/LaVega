import { describe, expect, it } from "vitest";
import { cardOfferOf, MAX_YEARLY_GAIN_CENTS } from "./cardOffer.js";
import type { PlanResult } from "../plan/compute.js";

const net = (cardKey: string, name: string, netCents: number | null) => ({
  cardKey,
  name,
  netCents,
});
const plan = (f: {
  cardInUseKey: string | null;
  months: number;
  cardableSpendCents: number;
  nets: ReturnType<typeof net>[];
}): PlanResult => ({ sections: { cards: { figures: f } } }) as unknown as PlanResult;

describe("cardOfferOf", () => {
  it("is null without a plan", () => {
    expect(cardOfferOf(null, "2026-11-10")).toBeNull();
  });

  it("is the best other card's yearly gain over the card in use", () => {
    const p = plan({
      cardInUseKey: "k1",
      months: 12,
      cardableSpendCents: 100000,
      nets: [net("k1", "Mijn kaart", 1000), net("k2", "Kaart B", 9000)],
    });
    expect(cardOfferOf(p, "2026-11-10")).toEqual({
      name: "Kaart B",
      yearlyGainCents: 8000,
      computedAt: "2026-11-10",
    });
  });

  it("caps the figure", () => {
    const p = plan({
      cardInUseKey: "k1",
      months: 12,
      cardableSpendCents: 1,
      nets: [net("k1", "A", 0), net("k2", "B", MAX_YEARLY_GAIN_CENTS * 5)],
    });
    expect(cardOfferOf(p, "2026-11-10")?.yearlyGainCents).toBe(MAX_YEARLY_GAIN_CENTS);
  });
});
