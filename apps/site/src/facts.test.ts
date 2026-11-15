import { describe, expect, it } from "vitest";
import { landingCopy } from "../../web/src/landingCopy.js";
import { FAQ_SLOT, SITE_FACTS, deriveFacts } from "./facts.js";

const QUESTION = {
  nl: {
    privacy: /veilig/,
    movingMoney: /geld verplaatsen/,
    price: /kost/,
    investmentAdvice: /beleggingsadvies/,
  },
  en: {
    privacy: /safe/,
    movingMoney: /move money/,
    price: /cost/,
    investmentAdvice: /investment advice/,
  },
} as const;

describe("deriveFacts", () => {
  for (const locale of ["nl", "en"] as const) {
    const copy = landingCopy(locale);
    const facts = SITE_FACTS[locale];

    it(`${locale}: each slot still points at its question`, () => {
      for (const key of Object.keys(FAQ_SLOT) as Array<keyof typeof FAQ_SLOT>)
        expect(facts[key].q).toMatch(QUESTION[locale][key]);
    });
    it(`${locale}: stance answers are the landing faq answers verbatim`, () => {
      for (const key of Object.keys(FAQ_SLOT) as Array<keyof typeof FAQ_SLOT>)
        expect(facts[key]).toEqual(copy.faq.items[FAQ_SLOT[key]]);
    });
    it(`${locale}: summary is the meta description`, () => {
      expect(facts.summary).toBe(copy.meta.description);
    });
    it(`${locale}: does lists the view lead and the three does sections`, () => {
      expect(facts.does).toEqual([
        copy.view.lead,
        `${copy.does.stand.title} ${copy.does.stand.text}`,
        `${copy.does.move.title} ${copy.does.move.text}`,
        `${copy.does.watch.title} ${copy.does.watch.text}`,
      ]);
    });
  }

  it("follows the copy it is given", () => {
    const nl = landingCopy("nl");
    const edited = { ...nl, meta: { ...nl.meta, description: "Nieuwe omschrijving." } };
    expect(deriveFacts(edited).summary).toBe("Nieuwe omschrijving.");
  });
  it("throws when the faq loses a quoted slot", () => {
    const nl = landingCopy("nl");
    expect(() => deriveFacts({ ...nl, faq: { ...nl.faq, items: [] } })).toThrow(/faq has no item/);
  });
  it("states nothing the landing copy does not", () => {
    const blob = JSON.stringify(SITE_FACTS);
    expect(blob).not.toMatch(/AFM|Interactive Brokers|Trading 212|\bbeta\b/i);
  });
});
