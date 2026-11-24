import { describe, expect, it } from "vitest";
import { cardOfferOf, MAX_YEARLY_GAIN_CENTS } from "./cardOffer.js";
import type { PlanResult } from "../plan/compute.js";
import type { CardAdvice, CardOption, Verdict } from "../plan/cardAdvice.js";

const best = (name: string): CardOption => ({ cardId: "c-best", name }) as unknown as CardOption;

const plan = (advice: Partial<CardAdvice>): PlanResult =>
  ({
    sections: {
      cards: {
        figures: {
          advice: {
            basis: "history",
            ignoresInterest: false,
            baseline: { kind: "best-held", cardId: "c-held", name: "Mijn kaart", netCents: 0 },
            ...advice,
          },
        },
      },
    },
  }) as unknown as PlanResult;

const switchTo = (name: string, gainCents: number): Verdict => ({
  kind: "switch",
  best: best(name),
  gainCents,
  parts: {} as never,
});

describe("cardOfferOf", () => {
  it("is null without a plan", () => {
    expect(cardOfferOf(null, "2026-11-10")).toBeNull();
  });

  it("a plan without the advice (computed before it existed) gives no offer and does not throw", () => {
    const old = { sections: { cards: { figures: { nets: [] } } } } as unknown as PlanResult;
    expect(cardOfferOf(old, "2026-11-10")).toBeNull();
    expect(cardOfferOf({ sections: {} } as unknown as PlanResult, "2026-11-10")).toBeNull();
  });

  it("a card with an empty name gives no offer; spaces round the name are trimmed", () => {
    expect(cardOfferOf(plan({ verdict: switchTo("   ", 8000) }), "2026-11-10")).toBeNull();
    expect(cardOfferOf(plan({ verdict: switchTo("  Kaart B ", 8000) }), "2026-11-10")?.name).toBe(
      "Kaart B",
    );
  });

  it("offer is the verdict's best card and gain", () => {
    expect(cardOfferOf(plan({ verdict: switchTo("Kaart B", 8000) }), "2026-11-10")).toEqual({
      name: "Kaart B",
      yearlyGainCents: 8000,
      computedAt: "2026-11-10",
    });
  });

  it("no offer when the verdict is keep, unknown-baseline, no-card-worth-it or no-options", () => {
    const verdicts: Verdict[] = [
      { kind: "keep", gainCents: 500 },
      { kind: "unknown-baseline" },
      { kind: "no-card-worth-it" },
      { kind: "no-options" },
    ];
    for (const verdict of verdicts) expect(cardOfferOf(plan({ verdict }), "2026-11-10")).toBeNull();
  });

  it("no offer while card debt is carried", () => {
    const p = plan({ verdict: switchTo("Kaart B", 8000), ignoresInterest: true });
    expect(cardOfferOf(p, "2026-11-10")).toBeNull();
  });

  it("no offer when the verdict rests on wizard answers alone", () => {
    const p = plan({ verdict: switchTo("Kaart B", 8000), basis: "stated" });
    expect(cardOfferOf(p, "2026-11-10")).toBeNull();
  });

  it("no offer for a first card: a no-card or unknown baseline has no current card to compare with", () => {
    const verdict = switchTo("Kaart B", 8000);
    const noCard = plan({ verdict, baseline: { kind: "no-card", netCents: 0 } });
    expect(cardOfferOf(noCard, "2026-11-10")).toBeNull();
    const unknown = plan({ verdict, baseline: { kind: "unknown", blockers: [] } });
    expect(cardOfferOf(unknown, "2026-11-10")).toBeNull();
  });

  it("the offer shape is unchanged", () => {
    const offer = cardOfferOf(plan({ verdict: switchTo("Kaart B", 8000) }), "2026-11-10");
    expect(Object.keys(offer ?? {}).sort()).toEqual(["computedAt", "name", "yearlyGainCents"]);
  });

  it("caps the figure and clips the name", () => {
    const offer = cardOfferOf(
      plan({ verdict: switchTo("x".repeat(300), MAX_YEARLY_GAIN_CENTS * 5) }),
      "2026-11-10",
    );
    expect(offer?.yearlyGainCents).toBe(MAX_YEARLY_GAIN_CENTS);
    expect(offer?.name).toHaveLength(200);
  });

  it("a gain that is not a positive integer gives null", () => {
    for (const g of [0, -5, 1.5, Number.NaN])
      expect(cardOfferOf(plan({ verdict: switchTo("B", g) }), "2026-11-10")).toBeNull();
  });

  it("does not read the legacy nets", () => {
    const p = {
      sections: {
        cards: {
          figures: {
            cardInUseKey: "k1",
            nets: [
              { cardKey: "k1", name: "A", netCents: 0 },
              { cardKey: "k2", name: "B", netCents: 9000 },
            ],
            advice: {
              basis: "history",
              ignoresInterest: false,
              baseline: { kind: "best-held", cardId: "k1", name: "A", netCents: 0 },
              verdict: { kind: "keep", gainCents: 0 },
            },
          },
        },
      },
    } as unknown as PlanResult;
    expect(cardOfferOf(p, "2026-11-10")).toBeNull();
  });
});
