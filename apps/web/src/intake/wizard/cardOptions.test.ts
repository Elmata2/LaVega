import { expect, test } from "vitest";
import { byName, cardLabel, cardOptions, matchCards } from "./cardOptions";

test("cardOptions excludes business and corporate cards", () => {
  const opts = cardOptions("Another card");
  expect(opts.length).toBeGreaterThan(10);
  for (const o of opts) expect(o.label).not.toMatch(/business|corporate/i);
  expect(opts.some((o) => o.id === "ing-creditcard")).toBe(true);
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
  expect(ids("klm").every((id) => id.startsWith("flying-blue"))).toBe(true);
  expect(ids("klm").length).toBe(4);
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
