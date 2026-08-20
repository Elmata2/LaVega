import { describe, expect, test } from "vitest";
import type { Account } from "./model.js";
import { TRAVEL_AGENT, productOf } from "./travel.js";
import { makeFact } from "./facts.js";
import type { CatalogueEntryLike } from "./catalogRates.js";
import { fxBankKey, fxBrandOf, fxExtraCost, fxRouteDefault, rankFxRoutes } from "./fxRoutes.js";

/** A covered catalogue card with an fx surcharge. */
function card(
  id: string,
  product: string,
  issuer: string,
  pct: number,
  extra: { conditions?: string | null; conditionsKnown?: boolean; checkedAt?: string; route?: string } = {},
): CatalogueEntryLike {
  return {
    id,
    product,
    issuer,
    kind: "betaalpas",
    fields: {
      fxFeePct: {
        value: pct,
        route: (extra.route ?? "agent") as never,
        sourceUrl: `https://example.test/${id}`,
        checkedAt: extra.checkedAt ?? "2026-06-15",
        conditions: extra.conditions ?? "koersopslag bij betalen in vreemde valuta",
        conditionsKnown: extra.conditionsKnown ?? true,
      },
    },
  };
}

const acc = (key: string, name: string, bank: string, type?: string): Account => ({
  key,
  iban: key,
  name,
  bank,
  entity: "Prive",
  currency: "EUR",
  balance: 1000,
  ...(type ? { type } : {}),
} as Account);

describe("fxBrandOf — the bank a card belongs to, as the owner would name it", () => {
  test("strips the card type and its tier, so one bank is one name", () => {
    expect(fxBrandOf("ING betaalpas", "ING Bank N.V.")).toBe("ING");
    expect(fxBrandOf("ING creditcard", "International Card Services (ICS)")).toBe("ING");
    expect(fxBrandOf("ING Platinumcard", "International Card Services (ICS)")).toBe("ING");
    expect(fxBrandOf("ICS Visa World Card Gold", "International Card Services B.V. (ICS)")).toBe("ICS");
    expect(fxBrandOf("bunq Core Business betaalpas", "bunq B.V.; Mastercard")).toBe("bunq");
    expect(fxBrandOf("Crypto.com Prepaid Card — Private (Obsidian)", "Crypto.com (EEA entity)")).toBe("Crypto.com");
    expect(fxBrandOf("Openbank betaalpas (R42 Betaalpas)", "Open Bank S.A. (Spain)")).toBe("Openbank");
  });

  test("keeps a name that only LOOKS like a tier word", () => {
    // "Blue" here is half the brand, not the tier of an Amex card.
    expect(fxBrandOf("Flying Blue - American Express Gold Card", "American Express")).toBe("Flying Blue");
    expect(fxBrandOf("American Express Blue Card", "American Express")).toBe("American Express");
  });

  test("falls back to the issuer when the product name carries no brand", () => {
    expect(fxBrandOf("Creditcard", "Knab (Aegon Bank N.V.)")).toBe("Knab");
  });

  test("a brand the product name hides is named the way he says it", () => {
    // He calls this Trading 212 (review item 8); "212" alone is not a bank.
    expect(fxBrandOf("212 Card", "Paynetics (card issuer); NL customers under Trading 212")).toBe("Trading 212");
  });

  test("fxBankKey folds the spellings of one bank onto one key", () => {
    expect(fxBankKey("Rabobank")).toBe(fxBankKey("Rabo"));
    expect(fxBankKey("ASN Bank")).toBe(fxBankKey("ASN"));
    expect(fxBankKey("ING")).not.toBe(fxBankKey("ICS"));
  });
});

describe("rankFxRoutes — one row per bank, cheapest first, over the whole catalogue", () => {
  const CATALOGUE = [
    card("ing-betaalpas", "ING betaalpas", "ING Bank N.V.", 1.4),
    card("ing-creditcard", "ING creditcard", "International Card Services (ICS)", 2),
    card("ing-platinum", "ING Platinumcard", "International Card Services (ICS)", 0),
    card("rabo-betaalpas", "Rabobank betaalpas", "Coöperatieve Rabobank U.A.", 1.4),
    card("rabo-gold", "Rabo GoldCard", "International Card Services (ICS)", 2),
    card("t212", "212 Card", "Paynetics; Trading 212", 0),
    card("revolut-plus", "Revolut Plus betaalpas", "Revolut Bank UAB", 0.5),
  ];

  test("ING appears ONCE, even though the catalogue holds three ING cards", () => {
    const rows = rankFxRoutes({ accounts: [], facts: [], entries: CATALOGUE });
    const ing = rows.filter((r) => r.bank === "ING");
    expect(ing).toHaveLength(1);
    expect(ing[0].collapsed).toBe(3);
  });

  test("two spellings of one bank collapse, and the fuller name is the one shown", () => {
    const rows = rankFxRoutes({ accounts: [], facts: [], entries: CATALOGUE });
    expect(rows.filter((r) => fxBankKey(r.bank) === fxBankKey("Rabobank"))).toHaveLength(1);
    expect(rows.some((r) => r.bank === "Rabobank")).toBe(true);
    expect(rows.some((r) => r.bank === "Rabo")).toBe(false);
  });

  test("the collapsed row keeps the best figure at that bank and names the product that gets it", () => {
    const rows = rankFxRoutes({ accounts: [], facts: [], entries: CATALOGUE });
    const ing = rows.find((r) => r.bank === "ING")!;
    expect(ing.pct).toBe(0);
    expect(ing.product).toBe("ING Platinumcard");
    expect(ing.sourceUrl).toBe("https://example.test/ing-platinum");
  });

  test("cheapest first, and a bank he holds wins a tie against one he does not", () => {
    const accounts = [acc("NL01RABO", "Betaalrekening", "Rabobank")];
    const rows = rankFxRoutes({
      accounts,
      facts: [],
      entries: [card("a", "Rabobank betaalpas", "Rabobank U.A.", 0.5), card("b", "Zeal Card", "Monavate", 0.5), card("c", "Plutus Card", "Plutus", 2.5)],
    });
    expect(rows.map((r) => r.bank)).toEqual(["Rabobank", "Zeal", "Plutus"]);
    expect(rows[0].held).toBe(true);
    expect(rows[1].held).toBe(false);
  });

  test("a bank he holds is never dropped, even with no figure anywhere — and it is not 0%", () => {
    const rows = rankFxRoutes({
      accounts: [acc("A1", "Amex", "American Express", "Creditcard")],
      facts: [],
      entries: CATALOGUE,
    });
    const amex = rows.find((r) => r.bank === "American Express");
    expect(amex).toBeDefined();
    expect(amex!.pct).toBeNull();
    expect(amex!.held).toBe(true);
    // Unknown sorts last, never above a known figure.
    expect(rows.indexOf(amex!)).toBe(rows.length - 1);
  });

  test("an uncovered figure is refused: the bank shows up only if he holds it, and then as unknown", () => {
    const entries = [card("x", "Bybit Card", "Bybit EU", 0.5, { conditionsKnown: false })];
    expect(rankFxRoutes({ accounts: [], facts: [], entries })).toHaveLength(0);
    const rows = rankFxRoutes({ accounts: [acc("BY", "Bybit", "Bybit")], facts: [], entries });
    expect(rows).toHaveLength(1);
    expect(rows[0].pct).toBeNull();
  });

  test("for a bank he holds the row prices HIS product, and names the cheaper one beside it", () => {
    const rows = rankFxRoutes({
      accounts: [acc("NL01ING", "Betaalrekening", "ING")],
      facts: [],
      entries: CATALOGUE,
    });
    const ing = rows.find((r) => r.bank === "ING")!;
    expect(ing.pct).toBe(1.4);
    expect(ing.product).toBe("ING betaalpas");
    expect(ing.cheaperAtSameBank).toEqual({ product: "ING Platinumcard", pct: 0 });
  });

  test("what he entered himself outranks the catalogue for his own product", () => {
    const accounts = [acc("NL01ING", "Betaalrekening", "ING")];
    const facts = [
      makeFact({ agent: TRAVEL_AGENT, subject: productOf(accounts[0]), key: "fxFeePct", value: "1,1", source: "user", updatedAt: "2026-08-19" }),
    ];
    const ing = rankFxRoutes({ accounts, facts, entries: CATALOGUE }).find((r) => r.bank === "ING")!;
    expect(ing.pct).toBe(1.1);
    expect(ing.origin).toBe("user");
  });

  test("a bank only the vault knows about is ranked too", () => {
    const accounts = [acc("W1", "Wise", "Wise")];
    const facts = [
      makeFact({ agent: TRAVEL_AGENT, subject: productOf(accounts[0]), key: "fxFeePct", value: "0,4", source: "agent", updatedAt: "2026-08-19" }),
    ];
    const rows = rankFxRoutes({ accounts, facts, entries: CATALOGUE });
    const wise = rows.find((r) => r.bank === "Wise")!;
    expect(wise.pct).toBe(0.4);
    expect(wise.origin).toBe("agent");
    expect(wise.held).toBe(true);
  });

  test("savings and investment accounts do not make a bank a conversion route on their own", () => {
    const rows = rankFxRoutes({
      accounts: [acc("S1", "Spaarrekening", "Nexent")],
      facts: [],
      entries: CATALOGUE,
    });
    expect(rows.some((r) => r.bank === "Nexent")).toBe(false);
  });
});

describe("a bank whose products all agree needs no 'which one is yours' caveat", () => {
  const AMEX = [
    card("amex-green", "American Express Green Card", "American Express", 2.5, { checkedAt: "2022-03-01" }),
    card("amex-gold", "American Express Gold Card", "American Express", 2.5, { checkedAt: "2026-08-19" }),
  ];
  const BUNQ = [
    card("bunq-free", "bunq Free betaalpas", "bunq B.V.", 3),
    card("bunq-core", "bunq Core betaalpas", "bunq B.V.", 0.5),
  ];

  test("all products the same: the row says so instead of naming one of them", () => {
    const rows = rankFxRoutes({ accounts: [acc("A1", "Amex", "American Express", "Creditcard")], facts: [], entries: AMEX });
    expect(rows[0].uniformAcrossBank).toBe(true);
    expect(rows[0].why).toContain("hetzelfde bij alle 2 American Express-producten");
    expect(rows[0].why).not.toContain("weet LaVega niet");
  });

  test("products that disagree: the row names the product and admits the doubt", () => {
    const rows = rankFxRoutes({ accounts: [acc("B1", "bunq", "bunq")], facts: [], entries: BUNQ });
    expect(rows[0].uniformAcrossBank).toBe(false);
    expect(rows[0].why).toContain("bunq Core betaalpas");
    expect(rows[0].why).toContain("of jouw pakket bij deze bank hetzelfde rekent, weet LaVega niet");
  });

  test("the transfer is never priced on a package he may not be on", () => {
    const accounts = [acc("B1", "bunq", "bunq"), acc("NL01ING", "Betaalrekening", "ING")];
    const rows = rankFxRoutes({
      accounts,
      facts: [],
      entries: [...BUNQ, card("ing", "ING betaalpas", "ING Bank N.V.", 1.4)],
    });
    // bunq is the cheapest bank he holds, but 0,5% is bunq Core's and bunq Free
    // charges 3% — so the default is the bank whose figure is provably his.
    expect(rows[0].bank).toBe("bunq");
    const chosen = fxRouteDefault(rows)!;
    expect(chosen.bank).toBe("ING");
    expect(chosen.mine).toBe(true);
  });

  test("when no figure is provably his, a bank that charges one rate for everything comes first", () => {
    const accounts = [acc("B1", "bunq", "bunq"), acc("A1", "Amex", "American Express", "Creditcard")];
    const chosen = fxRouteDefault(rankFxRoutes({ accounts, facts: [], entries: [...BUNQ, ...AMEX] }))!;
    expect(chosen.bank).toBe("American Express");
    expect(chosen.uniformAcrossBank).toBe(true);
  });
});

test("the row admits what kind of product the figure belongs to", () => {
  const rows = rankFxRoutes({
    accounts: [],
    facts: [],
    entries: [
      { ...card("cdc", "Crypto.com Prepaid Card — Private (Obsidian)", "Crypto.com", 0), kind: "prepaid" },
      { ...card("ing", "ING betaalpas", "ING Bank N.V.", 1.4), kind: "betaalpas" },
    ],
  });
  // The cheapest thing the catalogue can prove is not a bank account, and the
  // row says so rather than letting the ranking imply it is one.
  expect(rows[0].bank).toBe("Crypto.com");
  expect(rows[0].kind).toBe("prepaid");
  expect(rows[1].kind).toBe("betaalpas");
});

describe("the default route, and what an alternative costs against it", () => {
  const CATALOGUE = [
    card("ing-betaalpas", "ING betaalpas", "ING Bank N.V.", 1.4),
    card("t212", "212 Card", "Paynetics; Trading 212", 0),
  ];

  test("the default is the cheapest route he can actually use today", () => {
    const rows = rankFxRoutes({ accounts: [acc("NL01ING", "Betaalrekening", "ING")], facts: [], entries: CATALOGUE });
    // Trading 212 is cheaper and it is listed — but he does not hold it, so the
    // amount is not computed with a transfer he cannot make.
    expect(rows[0].bank).toBe("Trading 212");
    const chosen = fxRouteDefault(rows)!;
    expect(chosen.bank).toBe("ING");
    expect(chosen.held).toBe(true);
  });

  test("with nothing held and nothing known there is no default at all", () => {
    expect(fxRouteDefault([])).toBeNull();
    const unknownOnly = rankFxRoutes({ accounts: [acc("A1", "Amex", "American Express", "Creditcard")], facts: [], entries: [] });
    expect(fxRouteDefault(unknownOnly)).toBeNull();
  });

  test("the fee difference is money, in the currency he is sending", () => {
    const rows = rankFxRoutes({ accounts: [acc("NL01ING", "Betaalrekening", "ING")], facts: [], entries: CATALOGUE });
    const ing = rows.find((r) => r.bank === "ING")!;
    const t212 = rows.find((r) => r.bank === "Trading 212")!;
    // €1.000 at 1,4% versus 0%: switching saves €14.
    expect(fxExtraCost(t212, ing, 1000)).toBe(-14);
    expect(fxExtraCost(ing, t212, 1000)).toBe(14);
    expect(fxExtraCost(ing, ing, 1000)).toBe(0);
  });

  test("an unknown fee has no difference to state — never a zero one", () => {
    const rows = rankFxRoutes({ accounts: [acc("A1", "Amex", "American Express", "Creditcard")], facts: [], entries: CATALOGUE });
    const amex = rows.find((r) => r.bank === "American Express")!;
    const ing = rows.find((r) => r.bank === "ING")!;
    expect(fxExtraCost(amex, ing, 1000)).toBeNull();
    expect(fxExtraCost(ing, amex, 1000)).toBeNull();
  });
});
