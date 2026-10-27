import { expect, test } from "vitest";
import { byName, brandOf, cardGroups, cardLabel, cardOptions, matchCards } from "./cardOptions";

test("cardOptions includes business and corporate cards again", () => {
  const opts = cardOptions("Another card");
  expect(opts.length).toBeGreaterThan(10);
  expect(opts.some((o) => /business/i.test(o.label))).toBe(true);
  expect(opts.some((o) => /corporate/i.test(o.label))).toBe(true);
  expect(opts.some((o) => o.id === "ing-creditcard")).toBe(true);
});

test("brandOf maps every catalogue card to a known brand, none to other-brand", () => {
  for (const c of matchCards("")) expect(brandOf(c.id), c.id).not.toBe("other-brand");
  expect(brandOf("flying-blue-american-express-gold-card")).toBe("amex");
  expect(brandOf("klm-american-express-corporate-card")).toBe("amex");
  expect(brandOf("rabobank-creditcard")).toBe("rabo");
  expect(brandOf("regiobank-creditcard")).toBe("sns-asn-regio");
  expect(brandOf("something-new")).toBe("other-brand");
});

test("cardGroups lists brands in the fixed order, cards sorted, no empty group", () => {
  const g = cardGroups("Overige");
  expect(g.map((x) => x.brand)).toEqual([
    "amex", "ics", "ing", "abn", "rabo", "anwb", "bunq", "knab", "sns-asn-regio", "nexo",
  ]);
  for (const x of g) {
    const names = x.cards.map((c) => c.label);
    expect(names).toEqual([...names].sort(byName));
  }
  const amex = g[0]!.cards.map((c) => c.label);
  expect(amex).toContain("American Express Business Gold Card");
  expect(amex).toContain("American Express Corporate Card");
  expect(g.flatMap((x) => x.cards).length).toBe(matchCards("").length);
});

test("cardOptions is sorted by product and ends with the other choice", () => {
  const opts = cardOptions("Another card");
  expect(opts.at(-1)).toEqual({ id: "other", label: "Another card" });
  const names = opts.slice(0, -1).map((o) => o.label);
  expect(names).toEqual([...names].sort(byName));
});

test("cardLabel names a catalogue id, the other choice, and keeps an unknown id", () => {
  expect(cardLabel("ing-creditcard", "x")).toBe("ING creditcard");
  expect(cardLabel("other", "Another card")).toBe("Another card");
  expect(cardLabel("gone-card", "x")).toBe("gone-card");
});

const ids = (q: string) => matchCards(q).map((o) => o.id);

test("search 'amex' finds every American Express card, including the Flying Blue ones", () => {
  const found = ids("amex");
  expect(found).toContain("american-express-gold-card");
  expect(found).toContain("flying-blue-american-express-gold-card");
  expect(found.every((id) => /american-express/.test(id))).toBe(true);
  expect(found).toContain("american-express-business-gold-card");
});

test("search is blind to case, accents, punctuation and spacing", () => {
  expect(ids("  AMEX ")).toEqual(ids("amex"));
  expect(ids("american-express")).toEqual(ids("amex"));
  expect(ids("Américan  Express")).toEqual(ids("amex"));
});

test("aliases: ics, klm and flying blue, visa, mastercard, anwb", () => {
  expect(ids("ics")).toContain("ics-visa-world-card");
  expect(ids("ics")).toContain("abn-amro-creditcard");
  expect(ids("ics")).not.toContain("american-express-gold-card");
  expect(ids("klm").every((id) => /^(flying-blue|klm)-/.test(id))).toBe(true);
  expect(ids("klm").length).toBe(5);
  expect(ids("flying blue").length).toBe(4);
  expect(ids("visa")).toContain("anwb-visa-gold-card");
  expect(ids("mastercard")).toContain("ics-mastercard-gold");
  expect(ids("anwb").length).toBe(3);
});

test("the raw issuer text is not searched: 'not ics' finds nothing", () => {
  expect(ids("not ics")).toEqual([]);
});

test("an empty query lists every card; nonsense lists none", () => {
  expect(matchCards("").length).toBe(cardOptions("x").length - 1);
  expect(matchCards("zzzzqq")).toEqual([]);
});
