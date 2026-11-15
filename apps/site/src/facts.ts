import { landingCopy, type LandingCopy } from "../../web/src/landingCopy.js";

export type Locale = "nl" | "en";
export type Faq = { q: string; a: string };

export type LocaleFacts = {
  summary: string;
  does: string[];
  privacy: Faq;
  movingMoney: Faq;
  price: Faq;
  investmentAdvice: Faq;
};

export type SiteFacts = { name: string; nl: LocaleFacts; en: LocaleFacts };

/** Positions of the answers llms.txt quotes inside `faq.items`; facts.test.ts pins each to its question. */
export const FAQ_SLOT = { privacy: 0, movingMoney: 1, price: 3, investmentAdvice: 4 } as const;

const faqAt = (copy: LandingCopy, slot: number): Faq => {
  const item = copy.faq.items[slot];
  if (!item) throw new Error(`landing faq has no item at ${slot}`);
  return { q: item.q, a: item.a };
};

export function deriveFacts(copy: LandingCopy): LocaleFacts {
  const { stand, move, watch } = copy.does;
  return {
    summary: copy.meta.description,
    does: [copy.view.lead, ...[stand, move, watch].map((s) => `${s.title} ${s.text}`)],
    privacy: faqAt(copy, FAQ_SLOT.privacy),
    movingMoney: faqAt(copy, FAQ_SLOT.movingMoney),
    price: faqAt(copy, FAQ_SLOT.price),
    investmentAdvice: faqAt(copy, FAQ_SLOT.investmentAdvice),
  };
}

export const SITE_FACTS: SiteFacts = {
  name: "LaVega",
  nl: deriveFacts(landingCopy("nl")),
  en: deriveFacts(landingCopy("en")),
};
