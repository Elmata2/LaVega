import { describe, expect, test } from "vitest";
import type { Account } from "./model.js";
import { TRAVEL_AGENT, productOf } from "./travel.js";
import { makeFact } from "./facts.js";
import type { CatalogueEntryLike } from "./catalogRates.js";
import {
  fxBankKey,
  fxBrandOf,
  fxRouteDefault,
  fxRouteDelta,
  fxRouteSwitch,
  rankFxRoutes,
} from "./fxRoutes.js";

/** Het bedrag waarop dit hele bestand rangschikt, tenzij een test iets anders
 *  zegt. Zijn eigen voorbeeld: duizend euro omzetten. */
const TRANSFER = 1000;

/** Rangschikken op TRANSFER, zodat de tests over de volgorde blijven gaan en niet
 *  over het bedrag. `rankFxRoutes` vraagt het bedrag met opzet verplicht en met
 *  opzet in euro's — een percentage en een maandprijs kunnen alleen op één bedrag
 *  in één valuta bij elkaar komen. */
const ranked = (
  input: Omit<Parameters<typeof rankFxRoutes>[0], "amountEur"> & { amountEur?: number },
) => rankFxRoutes({ amountEur: TRANSFER, ...input });

/** A covered catalogue card with an fx surcharge. */
function card(
  id: string,
  product: string,
  issuer: string,
  pct: number,
  extra: {
    conditions?: string | null;
    conditionsKnown?: boolean;
    checkedAt?: string;
    route?: string;
  } = {},
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

const acc = (key: string, name: string, bank: string, type?: string): Account =>
  ({
    key,
    iban: key,
    name,
    bank,
    entity: "Prive",
    currency: "EUR",
    balance: 1000,
    ...(type ? { type } : {}),
  }) as Account;

describe("fxBrandOf — the bank a card belongs to, as the owner would name it", () => {
  test("strips the card type and its tier, so one bank is one name", () => {
    expect(fxBrandOf("ING betaalpas", "ING Bank N.V.")).toBe("ING");
    expect(fxBrandOf("ING creditcard", "International Card Services (ICS)")).toBe("ING");
    expect(fxBrandOf("ING Platinumcard", "International Card Services (ICS)")).toBe("ING");
    expect(fxBrandOf("ICS Visa World Card Gold", "International Card Services B.V. (ICS)")).toBe(
      "ICS",
    );
    expect(fxBrandOf("bunq Core Business betaalpas", "bunq B.V.; Mastercard")).toBe("bunq");
    expect(
      fxBrandOf("Crypto.com Prepaid Card — Private (Obsidian)", "Crypto.com (EEA entity)"),
    ).toBe("Crypto.com");
    expect(fxBrandOf("Openbank betaalpas (R42 Betaalpas)", "Open Bank S.A. (Spain)")).toBe(
      "Openbank",
    );
  });

  test("keeps a name that only LOOKS like a tier word", () => {
    // "Blue" here is half the brand, not the tier of an Amex card.
    expect(fxBrandOf("Flying Blue - American Express Gold Card", "American Express")).toBe(
      "Flying Blue",
    );
    expect(fxBrandOf("American Express Blue Card", "American Express")).toBe("American Express");
  });

  test("falls back to the issuer when the product name carries no brand", () => {
    expect(fxBrandOf("Creditcard", "Knab (Aegon Bank N.V.)")).toBe("Knab");
  });

  test("a brand the product name hides is named the way he says it", () => {
    // He calls this Trading 212 (review item 8); "212" alone is not a bank.
    expect(fxBrandOf("212 Card", "Paynetics (card issuer); NL customers under Trading 212")).toBe(
      "Trading 212",
    );
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
    const rows = ranked({ accounts: [], facts: [], entries: CATALOGUE });
    const ing = rows.filter((r) => r.bank === "ING");
    expect(ing).toHaveLength(1);
    expect(ing[0].collapsed).toBe(3);
  });

  test("two spellings of one bank collapse, and the fuller name is the one shown", () => {
    const rows = ranked({ accounts: [], facts: [], entries: CATALOGUE });
    expect(rows.filter((r) => fxBankKey(r.bank) === fxBankKey("Rabobank"))).toHaveLength(1);
    expect(rows.some((r) => r.bank === "Rabobank")).toBe(true);
    expect(rows.some((r) => r.bank === "Rabo")).toBe(false);
  });

  test("the collapsed row keeps the best figure at that bank and names the product that gets it", () => {
    const rows = ranked({ accounts: [], facts: [], entries: CATALOGUE });
    const ing = rows.find((r) => r.bank === "ING")!;
    expect(ing.pct).toBe(0);
    expect(ing.product).toBe("ING Platinumcard");
    expect(ing.sourceUrl).toBe("https://example.test/ing-platinum");
  });

  test("cheapest first, and a bank he holds wins a tie against one he does not", () => {
    const accounts = [acc("NL01RABO", "Betaalrekening", "Rabobank")];
    const rows = ranked({
      accounts,
      facts: [],
      entries: [
        card("a", "Rabobank betaalpas", "Rabobank U.A.", 0.5),
        card("b", "Zeal Card", "Monavate", 0.5),
        card("c", "Plutus Card", "Plutus", 2.5),
      ],
    });
    expect(rows.map((r) => r.bank)).toEqual(["Rabobank", "Zeal", "Plutus"]);
    expect(rows[0].held).toBe(true);
    expect(rows[1].held).toBe(false);
  });

  test("a bank he holds is never dropped, even with no figure anywhere — and it is not 0%", () => {
    const rows = ranked({
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
    expect(ranked({ accounts: [], facts: [], entries })).toHaveLength(0);
    const rows = ranked({ accounts: [acc("BY", "Bybit", "Bybit")], facts: [], entries });
    expect(rows).toHaveLength(1);
    expect(rows[0].pct).toBeNull();
  });

  test("for a bank he holds the row prices HIS product, and names the cheaper one beside it", () => {
    const rows = ranked({
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
      makeFact({
        agent: TRAVEL_AGENT,
        subject: productOf(accounts[0]),
        key: "fxFeePct",
        value: "1,1",
        source: "user",
        updatedAt: "2026-08-19",
      }),
    ];
    const ing = ranked({ accounts, facts, entries: CATALOGUE }).find((r) => r.bank === "ING")!;
    expect(ing.pct).toBe(1.1);
    expect(ing.origin).toBe("user");
  });

  test("a bank only the vault knows about is ranked too", () => {
    const accounts = [acc("W1", "Wise", "Wise")];
    const facts = [
      makeFact({
        agent: TRAVEL_AGENT,
        subject: productOf(accounts[0]),
        key: "fxFeePct",
        value: "0,4",
        source: "agent",
        updatedAt: "2026-08-19",
      }),
    ];
    const rows = ranked({ accounts, facts, entries: CATALOGUE });
    const wise = rows.find((r) => r.bank === "Wise")!;
    expect(wise.pct).toBe(0.4);
    expect(wise.origin).toBe("agent");
    expect(wise.held).toBe(true);
  });

  test("savings and investment accounts do not make a bank a conversion route on their own", () => {
    const rows = ranked({
      accounts: [acc("S1", "Spaarrekening", "Nexent")],
      facts: [],
      entries: CATALOGUE,
    });
    expect(rows.some((r) => r.bank === "Nexent")).toBe(false);
  });
});

describe("a bank whose products all agree needs no 'which one is yours' caveat", () => {
  const AMEX = [
    card("amex-green", "American Express Green Card", "American Express", 2.5, {
      checkedAt: "2022-03-01",
    }),
    card("amex-gold", "American Express Gold Card", "American Express", 2.5, {
      checkedAt: "2026-08-19",
    }),
  ];
  const BUNQ = [
    card("bunq-free", "bunq Free betaalpas", "bunq B.V.", 3),
    card("bunq-core", "bunq Core betaalpas", "bunq B.V.", 0.5),
  ];

  test("all products the same: the row says so instead of naming one of them", () => {
    const rows = ranked({
      accounts: [acc("A1", "Amex", "American Express", "Creditcard")],
      facts: [],
      entries: AMEX,
    });
    expect(rows[0].uniformAcrossBank).toBe(true);
    expect(rows[0].why).toContain("hetzelfde bij alle 2 American Express-producten");
    expect(rows[0].why).not.toContain("weet LaVega niet");
  });

  test("products that disagree: the row names the product and admits the doubt", () => {
    const rows = ranked({ accounts: [acc("B1", "bunq", "bunq")], facts: [], entries: BUNQ });
    expect(rows[0].uniformAcrossBank).toBe(false);
    expect(rows[0].why).toContain("bunq Core betaalpas");
    expect(rows[0].why).toContain(
      "of jouw pakket bij deze bank hetzelfde rekent, weet LaVega niet",
    );
  });

  test("the transfer is never priced on a package he may not be on", () => {
    const accounts = [acc("B1", "bunq", "bunq"), acc("NL01ING", "Betaalrekening", "ING")];
    const rows = ranked({
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
    const accounts = [
      acc("B1", "bunq", "bunq"),
      acc("A1", "Amex", "American Express", "Creditcard"),
    ];
    const chosen = fxRouteDefault(ranked({ accounts, facts: [], entries: [...BUNQ, ...AMEX] }))!;
    expect(chosen.bank).toBe("American Express");
    expect(chosen.uniformAcrossBank).toBe(true);
  });
});

test("the row admits what kind of product the figure belongs to", () => {
  const rows = ranked({
    accounts: [],
    facts: [],
    entries: [
      {
        ...card("cdc", "Crypto.com Prepaid Card — Private (Obsidian)", "Crypto.com", 0),
        kind: "prepaid",
      },
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
    const rows = ranked({
      accounts: [acc("NL01ING", "Betaalrekening", "ING")],
      facts: [],
      entries: CATALOGUE,
    });
    // Trading 212 is cheaper and it is listed — but he does not hold it, so the
    // amount is not computed with a transfer he cannot make.
    expect(rows[0].bank).toBe("Trading 212");
    const chosen = fxRouteDefault(rows)!;
    expect(chosen.bank).toBe("ING");
    expect(chosen.held).toBe(true);
  });

  test("with nothing held and nothing known there is no default at all", () => {
    expect(fxRouteDefault([])).toBeNull();
    const unknownOnly = ranked({
      accounts: [acc("A1", "Amex", "American Express", "Creditcard")],
      facts: [],
      entries: [],
    });
    expect(fxRouteDefault(unknownOnly)).toBeNull();
  });

  test("the fee difference is money, in the currency he is sending", () => {
    const rows = ranked({
      accounts: [acc("NL01ING", "Betaalrekening", "ING")],
      facts: [],
      entries: CATALOGUE,
    });
    const ing = rows.find((r) => r.bank === "ING")!;
    const t212 = rows.find((r) => r.bank === "Trading 212")!;
    // €1.000 at 1,4% versus 0%: switching saves €14. Trading 212 carries no
    // price in this catalogue, so the difference is the SURCHARGE difference and
    // says so — no "net" is claimed over a figure that is only half there.
    expect(fxRouteDelta(t212, ing)).toEqual({
      kind: "gross-cost-unknown",
      cents: -1400,
      reason: "no-source",
    });
    expect(fxRouteDelta(ing, t212)).toEqual({
      kind: "gross-cost-unknown",
      cents: 1400,
      reason: "no-source",
    });
    expect(fxRouteDelta(ing, ing)).toEqual({ kind: "net", cents: 0 });
  });

  test("an unknown fee has no difference to state — never a zero one", () => {
    const rows = ranked({
      accounts: [acc("A1", "Amex", "American Express", "Creditcard")],
      facts: [],
      entries: CATALOGUE,
    });
    const amex = rows.find((r) => r.bank === "American Express")!;
    const ing = rows.find((r) => r.bank === "ING")!;
    expect(fxRouteDelta(amex, ing)).toEqual({ kind: "unknown" });
    expect(fxRouteDelta(ing, amex)).toEqual({ kind: "unknown" });
    expect(fxRouteDelta(ing, null)).toEqual({ kind: "unknown" });
  });
});

/* ════════════════════ DE HORIZONREGEL OP EEN CONVERSIE ════════════════════
 *
 * Wat een rekening kost om te HEBBEN hoort in de volgorde, en dit scherm was de
 * laatste plek met een aanbeveling die hem negeerde. Zijn zin: een bank die drie
 * euro goedkoper is maar vijf euro per maand kost, is voor één conversie duurder.
 *
 * De drie gevallen hieronder zijn de drie die de eigenaar noemde, en het zijn ook
 * de drie toestanden uit het type: een prijs die het voordeel opeet, een bank die
 * hij al heeft (marginaal nul, en die nul is BEKEND), en een prijs die we niet
 * kennen (bruto, met de reden, en zonder het woord netto). */

/** Dezelfde kaart, plus de maand- of jaarprijs die zijn eigen document noemt. */
function pricedCard(
  id: string,
  product: string,
  issuer: string,
  pct: number,
  fee: { value: number; period: "maand" | "jaar" },
): CatalogueEntryLike {
  const base = card(id, product, issuer, pct);
  return {
    ...base,
    fields: {
      ...base.fields,
      // `period` hoort bij een BEDRAG en niet bij een percentage, dus het staat
      // niet in `CatalogValue` — accountCosts.ts leest het veld los uit de ruwe
      // JSON. Vandaar de cast: dit is precies de vorm die de catalogus draagt.
      accountFee: {
        value: fee.value,
        period: fee.period,
        route: "provider-pdf",
        sourceUrl: `https://example.test/${id}-tarieven`,
        checkedAt: "2026-08-01",
        conditions: "vaste bijdrage per periode",
        conditionsKnown: true,
      } as never,
    },
  };
}

describe("de horizonregel: een goedkopere bank die door zijn maandprijs duurder wordt", () => {
  // Zijn eigen ING-pas rekent 1,4% — op € 1.000 is dat € 14. N26 Metal rekent 0%
  // en kost € 16,90 per maand. Op de opslag alleen is N26 veertien euro
  // goedkoper; op één conversie is hij € 2,90 duurder.
  const ENTRIES = [
    card("ing-betaalpas", "ING betaalpas", "ING Bank N.V.", 1.4),
    pricedCard("n26-metal", "N26 Metal betaalpas", "N26 Bank AG", 0, {
      value: 16.9,
      period: "maand",
    }),
  ];
  const ACCOUNTS = [acc("NL01ING", "Betaalrekening", "ING")];

  test("de lagere opslag wint niet: de rekening telt mee, en ING staat bovenaan", () => {
    const rows = ranked({ accounts: ACCOUNTS, facts: [], entries: ENTRIES });
    expect(rows.map((r) => r.bank)).toEqual(["ING", "N26"]);
    // ING: € 14 opslag, geen extra kosten (hij heeft de bank al).
    expect(rows[0].totalCostCents).toBe(1400);
    // N26: geen opslag, wél € 16,90 om de rekening een maand te hebben.
    expect(rows[1].pct).toBe(0);
    expect(rows[1].totalCostCents).toBe(1690);
    expect(rows[1].totalCostKnown).toBe(true);
  });

  test("de periode staat in het antwoord, met de ondergrens van één hele periode", () => {
    const n26 = ranked({ accounts: ACCOUNTS, facts: [], entries: ENTRIES }).find(
      (r) => r.bank === "N26",
    )!;
    // Een conversie duurt geen maand — maar je kunt geen rekening voor een dag
    // openen, dus er wordt er één gerekend en het antwoord zegt dat.
    expect(n26.holdingBasis).toEqual({
      kind: "one-off",
      months: 1,
      periodsCharged: 1,
      flooredToMinimum: true,
      costPeriod: "maand",
    });
  });

  test("het verschil dat het scherm toont is het HELE verschil, niet alleen de opslag", () => {
    const rows = ranked({ accounts: ACCOUNTS, facts: [], entries: ENTRIES });
    const [ing, n26] = rows;
    // Niet −€ 14: overstappen naar N26 kost € 2,90 meer dan blijven waar hij zit.
    expect(fxRouteDelta(n26, ing)).toEqual({ kind: "net", cents: 290 });
  });

  test("geen aanbeveling, en het bedrag staat erbij in plaats van uit te rekenen", () => {
    const rows = ranked({ accounts: ACCOUNTS, facts: [], entries: ENTRIES });
    const gain = fxRouteSwitch(fxRouteDefault(rows), rows)!;
    expect(gain.option.bank).toBe("N26");
    // Bruto blijft bruto: de opslag scheelt echt € 14.
    expect(gain.savingCents).toBe(1400);
    // En netto is het geen aanbeveling — zijn eis, letterlijk: dat moet hij kunnen
    // zien staan in plaats van zelf moeten uitrekenen.
    expect(gain.net.kind).toBe("no-recommendation");
    if (gain.net.kind === "no-recommendation") {
      expect(gain.net.netCents).toBe(-290);
      expect(gain.net.costCents).toBe(1690);
      expect(gain.net.basis).toMatchObject({
        kind: "one-off",
        periodsCharged: 1,
        costPeriod: "maand",
      });
    }
  });

  test("een jaarproduct wordt niet door twaalf gedeeld voor één conversie", () => {
    // € 60 per jaar is geen € 5 voor deze conversie: je koopt geen twaalfde jaar.
    const rows = ranked({
      accounts: ACCOUNTS,
      facts: [],
      entries: [
        ENTRIES[0],
        pricedCard("ics-gold", "ICS Gold creditcard", "International Card Services", 0, {
          value: 60,
          period: "jaar",
        }),
      ],
    });
    const ics = rows.find((r) => r.bank === "ICS")!;
    expect(ics.totalCostCents).toBe(6000);
    expect(ics.holdingBasis).toMatchObject({
      periodsCharged: 1,
      costPeriod: "jaar",
      flooredToMinimum: true,
    });
  });
});

describe("de horizonregel: een bank die hij al heeft", () => {
  // Dezelfde N26 Metal van € 16,90 per maand — maar nu heeft hij hem al.
  const ENTRIES = [
    card("ing-betaalpas", "ING betaalpas", "ING Bank N.V.", 1.4),
    pricedCard("n26-metal", "N26 Metal betaalpas", "N26 Bank AG", 0, {
      value: 16.9,
      period: "maand",
    }),
  ];

  test("die prijs loopt toch al door, dus hij telt niet mee — en de nul is BEKEND", () => {
    const rows = ranked({
      accounts: [acc("NL01ING", "Betaalrekening", "ING"), acc("N26", "N26", "N26")],
      facts: [],
      entries: ENTRIES,
    });
    const n26 = rows.find((r) => r.bank === "N26")!;
    expect(n26.held).toBe(true);
    expect(n26.holdingCost).toMatchObject({ kind: "known", why: "already-held" });
    // Geen opslag, geen extra kosten: deze conversie is gratis via N26.
    expect(n26.totalCostCents).toBe(0);
    expect(n26.totalCostKnown).toBe(true);
    // En nu wint hij wél, want er komt niets bij.
    expect(rows[0].bank).toBe("N26");
  });

  test("de gelijkspelregel wordt niet gebroken maar uitgebreid", () => {
    // Twee banken met dezelfde opslag: de bank die hij heeft kost hem marginaal
    // niets en die nul staat vast, dus hij kan door de regel "wat we kunnen
    // aantonen gaat voor" nooit onder een onbekende prijs zakken.
    const rows = ranked({
      accounts: [acc("N26", "N26", "N26")],
      facts: [],
      entries: [
        pricedCard("n26-metal", "N26 Metal betaalpas", "N26 Bank AG", 0.5, {
          value: 16.9,
          period: "maand",
        }),
        card("zeal", "Zeal Card", "Monavate", 0.5),
      ],
    });
    expect(rows.map((r) => r.bank)).toEqual(["N26", "Zeal"]);
    expect(rows[0].totalCostCents).toBe(500);
    expect(rows[0].totalCostKnown).toBe(true);
    expect(rows[1].totalCostCents).toBe(500);
    expect(rows[1].totalCostKnown).toBe(false);
  });
});

describe("de horizonregel: een bank met onbekende kosten", () => {
  const ENTRIES = [
    card("ing-betaalpas", "ING betaalpas", "ING Bank N.V.", 1.4),
    card("t212", "212 Card", "Paynetics; Trading 212", 0),
  ];
  const ACCOUNTS = [acc("NL01ING", "Betaalrekening", "ING")];

  test("bruto blijft bruto: onbekend is geen nul en het totaal is een ondergrens", () => {
    const rows = ranked({ accounts: ACCOUNTS, facts: [], entries: ENTRIES });
    const t212 = rows.find((r) => r.bank === "Trading 212")!;
    expect(t212.holdingCost).toEqual({ kind: "unknown", reason: "no-source" });
    // Alleen de opslag zit erin, en `totalCostKnown` zegt dat het niet af is.
    expect(t212.totalCostCents).toBe(0);
    expect(t212.totalCostKnown).toBe(false);
    // Er wordt geen periode genoemd, want er is geen bedrag om over uit te smeren.
    expect(t212.holdingBasis).toBeNull();
  });

  test("er is geen netto, en de variant die er wél is heeft er geen veld voor", () => {
    const rows = ranked({ accounts: ACCOUNTS, facts: [], entries: ENTRIES });
    const gain = fxRouteSwitch(fxRouteDefault(rows), rows)!;
    expect(gain.option.bank).toBe("Trading 212");
    expect(gain.savingCents).toBe(1400);
    expect(gain.net.kind).toBe("gross-cost-unknown");
    // Het type draagt de reden en géén nettobedrag: een aanroeper kan een
    // brutobedrag hier niet per ongeluk als netto presenteren.
    expect(gain.net).not.toHaveProperty("netCents");
    if (gain.net.kind === "gross-cost-unknown") {
      expect(gain.net.grossCents).toBe(1400);
      expect(gain.net.cost.reason).toBe("no-source");
    }
  });

  test("een prijs die bovenop een ander product geldt is een ANDERE reden", () => {
    const conditional = pricedCard("zeal-max", "Zeal Card", "Monavate", 0, {
      value: 0,
      period: "maand",
    });
    (conditional.fields!.accountFee as Record<string, unknown>).conditions =
      "Alleen binnen het Zeal Max-pakket (€ 44,99 per maand)";
    const rows = ranked({ accounts: ACCOUNTS, facts: [], entries: [ENTRIES[0], conditional] });
    const max = rows.find((r) => r.bank === "Zeal")!;
    // Nul is hier geen nul: de kaart kost € 0 BOVENOP een pakket dat wél geld
    // kost, en hoeveel het los is staat nergens. Een te lage prijs rekent door.
    expect(max.holdingCost).toEqual({ kind: "unknown", reason: "needs-another-product" });
    expect(max.totalCostKnown).toBe(false);
  });
});

describe("het bedrag waarop gerangschikt wordt", () => {
  const ENTRIES = [
    card("ing-betaalpas", "ING betaalpas", "ING Bank N.V.", 1.4),
    pricedCard("n26-metal", "N26 Metal betaalpas", "N26 Bank AG", 0, {
      value: 16.9,
      period: "maand",
    }),
  ];
  const ACCOUNTS = [acc("NL01ING", "Betaalrekening", "ING")];

  test("op een groot bedrag wint de lage opslag alsnog, en dat is dezelfde rekensom", () => {
    // € 5.000 tegen 1,4% is € 70; de € 16,90 van N26 verdient zich dan terug.
    const rows = ranked({ accounts: ACCOUNTS, facts: [], entries: ENTRIES, amountEur: 5000 });
    expect(rows.map((r) => r.bank)).toEqual(["N26", "ING"]);
    const gain = fxRouteSwitch(fxRouteDefault(rows), rows)!;
    expect(gain.savingCents).toBe(7000);
    expect(gain.net.kind).toBe("net");
    if (gain.net.kind === "net") expect(gain.net.netCents).toBe(5310);
  });

  test("een leeg bedrag is nul en geen NaN, en dan blijft alleen over wat openen kost", () => {
    const rows = ranked({ accounts: ACCOUNTS, facts: [], entries: ENTRIES, amountEur: Number.NaN });
    expect(rows.every((r) => Number.isFinite(r.totalCostCents))).toBe(true);
    // Nul euro omzetten kost via zijn eigen bank niets; via N26 kost het de maand.
    expect(rows.map((r) => r.totalCostCents)).toEqual([0, 1690]);
    // En dan valt er niets over te stappen: er is geen lagere opslag te winnen.
    expect(fxRouteSwitch(fxRouteDefault(rows), rows)).toBeNull();
  });
});
