/* De rangschikking. Elke test hier hoort bij een regel die het schoongehouden
 * geval niet zou hebben gevonden. */

import { describe, it, expect } from "vitest";
import { rankCheckout } from "./rank.js";
import { CHECKOUT_CARDS } from "./generated/catalog.generated.js";
import type { CheckoutCard, CardFee } from "./types.js";

const ASOF = "2026-08-21";

function sourced(value: number, checkedAt = "2026-06-15") {
  return { value, sourceUrl: "https://voorbeeld.nl/voorwaarden", checkedAt, conditions: null };
}
function fee(value: number, period: "maand" | "jaar"): CardFee {
  return { value, period, sourceUrl: "https://voorbeeld.nl/tarieven", checkedAt: "2026-01-15", conditions: null };
}
function card(p: Partial<CheckoutCard> & { id: string }): CheckoutCard {
  return {
    product: p.id,
    issuer: "Bank Voorbeeld",
    kind: "creditcard",
    fxFeePct: null,
    cashbackPct: null,
    pointsPerEuro: null,
    fee: null,
    ...p,
  };
}

/* Twee kaarten die hij heeft en twee die hij niet heeft, met opzet zo gekozen
 * dat de kosten de orde kunnen omdraaien. */
const GRATIS_1PCT = card({ id: "gratis-1pct", cashbackPct: sourced(1), fxFeePct: sourced(0), fee: fee(0, "maand") });
const DUUR_3PCT = card({ id: "duur-3pct", cashbackPct: sourced(3), fxFeePct: sourced(0), fee: fee(270, "jaar") });
const MIJN_2PCT = card({ id: "mijn-2pct", cashbackPct: sourced(2), fxFeePct: sourced(0) });
const MIJN_HALF = card({ id: "mijn-half", cashbackPct: sourced(0.5), fxFeePct: sourced(2.5) });
const FX_ONBEKEND = card({ id: "fx-onbekend", cashbackPct: sourced(1) });
const CASHBACK_ONBEKEND = card({ id: "cashback-onbekend", fxFeePct: sourced(1.4) });

describe("onbekend is nooit nul", () => {
  it("een eigen kaart zonder koersopslagcijfer wordt niet gerangschikt maar gemeld", () => {
    const r = rankCheckout({
      cards: [FX_ONBEKEND],
      heldIds: ["fx-onbekend"],
      currency: "USD",
      amountCents: 30000,
      asOf: ASOF,
    });
    expect(r.mine).toEqual([]);
    expect(r.unknowns).toHaveLength(1);
    expect(r.unknowns[0]!.reason).toBe("geen-koersopslag-bekend");
  });

  it("een eigen kaart zonder cashbackcijfer wordt niet gerangschikt maar gemeld", () => {
    const r = rankCheckout({
      cards: [CASHBACK_ONBEKEND],
      heldIds: ["cashback-onbekend"],
      currency: "EUR",
      amountCents: 30000,
      asOf: ASOF,
    });
    expect(r.mine).toEqual([]);
    expect(r.unknowns[0]!.reason).toBe("geen-cashback-bekend");
  });

  it("een onbekende kaart die hij niet heeft wordt niet opgesomd", () => {
    /* 77 kaarten in de bundel en hij heeft er drie. Alle onbekenden opsommen is
     * een lijst van zeventig regels waar hij niets mee kan; dat is ruis, niet
     * eerlijkheid. Zwijgen over een kaart die hij niet heeft en waarvan we niets
     * weten, is geen bewering. */
    const r = rankCheckout({
      cards: [FX_ONBEKEND, MIJN_2PCT],
      heldIds: ["mijn-2pct"],
      currency: "USD",
      amountCents: 30000,
      asOf: ASOF,
    });
    expect(r.unknowns).toEqual([]);
  });
});

describe("een aankoop in euro's wordt niet omgerekend", () => {
  it("dan is de koersopslag nul omdát de handeling niet plaatsvindt, met de reden erbij", () => {
    const r = rankCheckout({
      cards: [FX_ONBEKEND],
      heldIds: ["fx-onbekend"],
      currency: "EUR",
      amountCents: 30000,
      asOf: ASOF,
    });
    /* Let op het verschil met de eerste test: dezelfde kaart, hetzelfde
     * ontbrekende cijfer, maar in euro's is er niets om te te weten. ING zegt
     * het zelf in zijn tarievenblad: "betalingen in euro's € 0,00". */
    expect(r.mine).toHaveLength(1);
    expect(r.mine[0]!.fxPct).toBe(0);
    expect(r.mine[0]!.fxNote).toBe("geen omrekening nodig");
    expect(r.mine[0]!.grossCents).toBe(300);
  });

  it("in dollars kost dezelfde kaart wél koersopslag", () => {
    const r = rankCheckout({
      cards: [MIJN_HALF],
      heldIds: ["mijn-half"],
      currency: "USD",
      amountCents: 30000,
      asOf: ASOF,
    });
    expect(r.mine[0]!.grossPct).toBe(-2);
    expect(r.mine[0]!.grossCents).toBe(-600);
  });
});

describe("een kaart die hij AL heeft: de kosten lopen door", () => {
  it("de vaste kosten worden niet van deze aankoop afgetrokken", () => {
    /* Toen dat wél gebeurde, kwam er dit uit: Amex Business Gold (€ 270 per
     * jaar) leverde op € 300 in dollars € 7,50 op, de rangschikking maakte er
     * € 7,50 − € 270 = −€ 262,50 van en adviseerde de kaart NIET te gebruiken.
     * Hij betaalt die € 270 dit jaar toch; door de kaart niet te gebruiken
     * houdt hij niets over, hij laat € 7,50 liggen. */
    const amex = card({
      id: "amex-business-gold",
      cashbackPct: sourced(2.5),
      fxFeePct: sourced(0),
      fee: fee(270, "jaar"),
    });
    const r = rankCheckout({
      cards: [amex],
      heldIds: ["amex-business-gold"],
      currency: "USD",
      amountCents: 30000,
      asOf: ASOF,
    });
    const row = r.mine[0]!;
    expect(row.basis).toBe("opbrengst");
    expect(row.grossCents).toBe(750);
    expect(row.resultCents).toBe(750);
    expect(row.charge).toBeNull();
    /* De kosten zijn niet verdwenen — ze staan als feit in de rij, met hun
     * eigen periode, zodat de UI ze kan noemen zonder ze af te trekken. */
    expect(row.fee).toEqual(fee(270, "jaar"));
  });

  it("eigen kaarten staan op percentage gesorteerd, beste eerst", () => {
    const r = rankCheckout({
      cards: [MIJN_HALF, MIJN_2PCT],
      heldIds: ["mijn-half", "mijn-2pct"],
      currency: "EUR",
      amountCents: 10000,
      asOf: ASOF,
    });
    expect(r.mine.map((x) => x.card.id)).toEqual(["mijn-2pct", "mijn-half"]);
  });
});

describe("een kaart die hij NIET heeft: openen kost geld", () => {
  it("netto = opbrengst min minstens één periode, en de periode staat erbij", () => {
    const r = rankCheckout({
      cards: [MIJN_2PCT, GRATIS_1PCT, DUUR_3PCT],
      heldIds: ["mijn-2pct"],
      currency: "EUR",
      amountCents: 30000,
      asOf: ASOF,
    });
    /* GRATIS_1PCT doet 1% en zijn eigen kaart 2%, dus die wordt niet genoemd:
     * "open een kaart om er minder aan over te houden" is geen advies. */
    expect(r.openWorthIt.map((x) => x.card.id)).not.toContain("gratis-1pct");

    /* DUUR_3PCT doet 3% = € 9,00 op € 300, en kost € 270 voor een heel jaar.
     * Netto € 9,00 − € 270 = −€ 261,00. Achteruit, dus geen aanbeveling — maar
     * hij moet het kunnen zien staan in plaats van het te moeten uitrekenen. */
    expect(r.openWorthIt).toEqual([]);
    expect(r.openBackwards).toHaveLength(1);
    const duur = r.openBackwards[0]!;
    expect(duur.basis).toBe("netto");
    expect(duur.grossCents).toBe(900);
    expect(duur.charge).toEqual({
      cents: 27000, periods: 1, label: "1 jaar", spanMonths: 12, spanLabel: "1 jaar",
    });
    expect(duur.resultCents).toBe(-26100);
  });

  it("bij een bedrag dat de kosten wél goedmaakt, is het een aanbeveling", () => {
    const r = rankCheckout({
      cards: [MIJN_2PCT, DUUR_3PCT],
      heldIds: ["mijn-2pct"],
      currency: "EUR",
      amountCents: 5_000_000, // € 50.000
      asOf: ASOF,
    });
    // 3% van € 50.000 = € 1.500; min € 270 = € 1.230.
    expect(r.openWorthIt).toHaveLength(1);
    expect(r.openWorthIt[0]!.resultCents).toBe(123000);
    expect(r.openBackwards).toEqual([]);
  });

  it("de horizon verlengen maakt de kosten groter, niet het percentage", () => {
    const maandkaart = card({ id: "vijf-per-maand", cashbackPct: sourced(3), fxFeePct: sourced(0), fee: fee(5, "maand") });
    const een = rankCheckout({ cards: [maandkaart], heldIds: [], currency: "EUR", amountCents: 300000, asOf: ASOF });
    const twee = rankCheckout({ cards: [maandkaart], heldIds: [], currency: "EUR", amountCents: 300000, horizonMonths: 13, asOf: ASOF });
    // € 3.000 × 3% = € 90; een jaar kaart kost 12 × € 5 = € 60.
    expect(een.openWorthIt[0]!.resultCents).toBe(9000 - 6000);
    expect(een.openWorthIt[0]!.charge!.spanLabel).toBe("1 jaar");
    // Dertien maanden wordt twee jaar: 24 × € 5 = € 120, en dan is het achteruit.
    expect(twee.openBackwards[0]!.resultCents).toBe(9000 - 12000);
    expect(twee.openBackwards[0]!.charge!.label).toBe("24 maanden");
    expect(twee.openBackwards[0]!.charge!.spanLabel).toBe("2 jaar");
  });

  it("vijf euro per maand kosten en drie opleveren is achteruit, en staat er zo", () => {
    /* Het geval uit de opdracht, letterlijk — nu over een heel jaar gerekend:
     * € 3,00 opbrengst tegen 12 × € 5 = € 60 aan kaartkosten. */
    const kaart = card({ id: "vijf-kost-drie-levert", cashbackPct: sourced(1), fxFeePct: sourced(0), fee: fee(5, "maand") });
    const r = rankCheckout({ cards: [kaart], heldIds: [], currency: "EUR", amountCents: 30000, asOf: ASOF });
    expect(r.openWorthIt).toEqual([]);
    expect(r.openBackwards[0]!.resultCents).toBe(300 - 6000);
  });

  it("een maandkaart en een jaarkaart worden over dezelfde periode vergeleken", () => {
    /* DE FOUT DIE HIER GEVANGEN WORDT, gemeten in de review: met een horizon van
     * één maand kostte een kaart van € 9 per maand één maand (€ 9) en een kaart
     * van € 60 per jaar een heel jaar (€ 60). Netto € 91 tegen € 40, en dus
     * stond de kaart die per jaar € 108 kost boven de kaart die € 60 kost. Elke
     * regel noemde keurig zijn eigen periode, dus de TEKST loog niet — maar de
     * positie in de lijst is de uitspraak "deze is beter", en die rustte op een
     * vergelijking van twee eenheden. */
    const maand = card({ id: "negen-per-maand", product: "Maandkaart", cashbackPct: sourced(1), fxFeePct: sourced(0), fee: fee(9, "maand") });
    const jaar = card({ id: "zestig-per-jaar", product: "Jaarkaart", cashbackPct: sourced(1), fxFeePct: sourced(0), fee: fee(60, "jaar") });
    const r = rankCheckout({ cards: [maand, jaar], heldIds: [], currency: "EUR", amountCents: 1_000_000, asOf: ASOF });

    const spans = [...r.openWorthIt, ...r.openBackwards].map((x) => x.charge!.spanMonths);
    expect(new Set(spans).size).toBe(1);
    expect(r.openWorthIt.map((x) => x.card.id)).toEqual(["zestig-per-jaar"]);
    expect(r.openWorthIt[0]!.resultCents).toBe(10000 - 6000);
    expect(r.openBackwards.map((x) => x.card.id)).toEqual(["negen-per-maand"]);
    expect(r.openBackwards[0]!.resultCents).toBe(10000 - 10800);
  });
});

describe("kosten onbekend: bruto, en nooit stilzwijgend gratis", () => {
  it("een kaart zonder kostencijfer komt in een eigen groep met basis bruto", () => {
    const onbekend = card({ id: "kosten-onbekend", cashbackPct: sourced(4), fxFeePct: sourced(0) });
    const r = rankCheckout({
      cards: [MIJN_2PCT, onbekend],
      heldIds: ["mijn-2pct"],
      currency: "EUR",
      amountCents: 30000,
      asOf: ASOF,
    });
    expect(r.openUnknownCost).toHaveLength(1);
    const row = r.openUnknownCost[0]!;
    expect(row.basis).toBe("bruto");
    expect(row.charge).toBeNull();
    expect(row.resultCents).toBe(row.grossCents);
    /* En hij wordt niet verzwegen: 4% is beter dan zijn 2%, dus de kaart hoort
     * genoemd te worden — met de onbekendheid erbij, niet als gratis. */
    expect(r.openWorthIt).toEqual([]);
    expect(r.openBackwards).toEqual([]);
  });

  it("bruto en netto worden niet door elkaar gesorteerd", () => {
    /* Een netto van € 4,20 naast een bruto van € 7,50 leggen en de hoogste
     * bovenaan zetten, is een vergelijking waarvan één kant een onbekende
     * bevat. Daarom twee lijsten en niet één. */
    const brutoKaart = card({ id: "bruto-5pct", cashbackPct: sourced(5), fxFeePct: sourced(0) });
    const nettoKaart = card({ id: "netto-4pct", cashbackPct: sourced(4), fxFeePct: sourced(0), fee: fee(1, "maand") });
    const r = rankCheckout({
      cards: [brutoKaart, nettoKaart],
      heldIds: [],
      currency: "EUR",
      amountCents: 100000,
      asOf: ASOF,
    });
    expect(r.openUnknownCost.map((x) => x.card.id)).toEqual(["bruto-5pct"]);
    expect(r.openWorthIt.map((x) => x.card.id)).toEqual(["netto-4pct"]);
  });
});

describe("zonder bedrag", () => {
  it("blijft de orde staan, maar zijn er geen euro's en geen uitkomst", () => {
    const r = rankCheckout({
      cards: [MIJN_HALF, MIJN_2PCT],
      heldIds: ["mijn-half", "mijn-2pct"],
      currency: "EUR",
      amountCents: null,
      asOf: ASOF,
    });
    expect(r.mine.map((x) => x.card.id)).toEqual(["mijn-2pct", "mijn-half"]);
    expect(r.mine[0]!.grossCents).toBeNull();
    expect(r.mine[0]!.resultCents).toBeNull();
  });

  it('wordt niets "achteruit" genoemd, want dat kan een leeg bedrag niet dragen', () => {
    const r = rankCheckout({ cards: [DUUR_3PCT], heldIds: [], currency: "EUR", amountCents: null, asOf: ASOF });
    expect(r.openBackwards).toEqual([]);
    expect(r.openWorthIt).toHaveLength(1);
    expect(r.openWorthIt[0]!.resultCents).toBeNull();
  });
});

describe("punten worden getoond, nooit geprijsd", () => {
  it("punten staan als aantal in de rij en niet in de euro's", () => {
    const puntenkaart = card({
      id: "punten-kaart",
      cashbackPct: sourced(0),
      fxFeePct: sourced(0),
      pointsPerEuro: sourced(1),
    });
    const r = rankCheckout({
      cards: [puntenkaart],
      heldIds: ["punten-kaart"],
      currency: "EUR",
      amountCents: 30000,
      asOf: ASOF,
    });
    expect(r.mine[0]!.points).toBe(300);
    expect(r.mine[0]!.grossCents).toBe(0);
    expect(r.mine[0]!.resultCents).toBe(0);
  });
});

describe("de lege toestand is een eersteklas uitkomst", () => {
  it("geen kaarten, geen catalogus: lege lijsten en geen kop die iets beweert", () => {
    const r = rankCheckout({ cards: [], heldIds: [], currency: "EUR", amountCents: 30000, asOf: ASOF });
    expect(r).toMatchObject({
      mine: [], openWorthIt: [], openBackwards: [], openUnknownCost: [], unknowns: [],
    });
  });

  it("niets aangevinkt: dan is er geen drempel en zijn alle kaarten kandidaat", () => {
    const r = rankCheckout({
      cards: [GRATIS_1PCT, DUUR_3PCT],
      heldIds: [],
      currency: "EUR",
      amountCents: 30000,
      asOf: ASOF,
    });
    expect(r.mine).toEqual([]);
    expect([...r.openWorthIt, ...r.openBackwards].map((x) => x.card.id).sort()).toEqual([
      "duur-3pct",
      "gratis-1pct",
    ]);
  });
});

describe("de peildatum komt van de aanroeper", () => {
  it("gaat er ongewijzigd weer uit; er staat geen Date.now() in dit bestand", () => {
    const r = rankCheckout({ cards: [], heldIds: [], currency: "eur", amountCents: null, asOf: "2020-01-01" });
    expect(r.asOf).toBe("2020-01-01");
    expect(r.currency).toBe("EUR");
  });
});

/* ────────────────────── de voorwaarden worden gelezen ────────────────────── */

describe("een voorwaarde bij een cijfer is geen groen licht", () => {
  const CRO = card({
    id: "cro",
    product: "Tokenkaart",
    cashbackPct: {
      value: 2,
      sourceUrl: "https://voorbeeld.nl/rewards",
      checkedAt: "2026-01-01",
      conditions:
        "CAP: spend above $1,250 per calendar month earns nothing. TIER GATE: requires an active Plus subscription. PAID IN CRO, not euro.",
    },
    fxFeePct: sourced(0),
  });

  it("een uitkering in een token levert GEEN euro-bedrag op", () => {
    /* Het gemeten geval uit de review: "Betaal met Crypto.com Plus. Dat levert
     * € 80,00 op" bij € 4.000, terwijl de uitkering in CRO is. */
    const r = rankCheckout({ cards: [CRO], heldIds: ["cro"], currency: "EUR", amountCents: 400000, asOf: ASOF });
    const row = r.mine[0]!;
    expect(row.claim).toEqual({ soort: "niet-in-euro", token: "CRO" });
    expect(row.euroCents).toBeNull();
    expect(row.resultCents).toBeNull();
    /* De rekensom bestaat nog wel — hij mag alleen niet als euro's naar buiten. */
    expect(row.grossCents).toBe(8000);
  });

  it("de voorwaarden staan in de rij, alle drie, en met hun soort erbij", () => {
    const r = rankCheckout({ cards: [CRO], heldIds: ["cro"], currency: "EUR", amountCents: 400000, asOf: ASOF });
    expect(r.mine[0]!.caveats.map((c) => c.soort).sort()).toEqual([
      "drempel",
      "in-token",
      "plafond-zonder-bedrag",
    ]);
  });

  it("een kaart die hij niet heeft en niet in euro's uitkeert, komt niet in de vergelijking", () => {
    /* "Beter dan jouw ING-pas" is een uitspraak, en die kunnen we over een
     * uitkering in CRO niet doen. Zwijgen is dan geen verzwijgen. */
    const ing = card({ id: "ing", product: "ING betaalpas", cashbackPct: sourced(0), fxFeePct: sourced(0) });
    const r = rankCheckout({ cards: [ing, CRO], heldIds: ["ing"], currency: "EUR", amountCents: 400000, asOf: ASOF });
    expect(r.openWorthIt).toEqual([]);
    expect(r.openUnknownCost).toEqual([]);
    /* Heeft hij niets aangevinkt, dan wordt er niets vergeleken en mag de kaart
     * er mét zijn voorwaarde bij staan. */
    const leeg = rankCheckout({ cards: [ing, CRO], heldIds: [], currency: "EUR", amountCents: 400000, asOf: ASOF });
    expect(leeg.openUnknownCost.map((x) => x.card.id)).toContain("cro");
  });

  it("een kaart die niet in euro's uitkeert staat ONDER een kaart die dat wel doet", () => {
    /* 5% in CRO boven 1% in euro's zetten is dezelfde eenhedenfout als een
     * maandbedrag met een jaarbedrag vergelijken, één laag hoger. */
    const euroKaart = card({ id: "euro", product: "Eurokaart", cashbackPct: sourced(1), fxFeePct: sourced(0) });
    const r = rankCheckout({ cards: [CRO, euroKaart], heldIds: ["cro", "euro"], currency: "EUR", amountCents: 400000, asOf: ASOF });
    expect(r.mine.map((x) => x.card.id)).toEqual(["euro", "cro"]);
  });

  it("een plafond per transactie in euro's wordt toegepast, en dat is te zien", () => {
    const bleap = card({
      id: "bleap",
      product: "Bleap",
      cashbackPct: {
        value: 1,
        sourceUrl: "https://voorbeeld.nl/bleap",
        checkedAt: "2026-05-01",
        conditions: "Default ongoing rate, with a fair-usage cap of €500 per transaction and €3,000 per month.",
      },
      fxFeePct: sourced(0),
    });
    const groot = rankCheckout({ cards: [bleap], heldIds: ["bleap"], currency: "EUR", amountCents: 400000, asOf: ASOF });
    expect(groot.mine[0]!.claim).toEqual({ soort: "hooguit", capCents: 50000, capBasis: "transactie" });
    expect(groot.mine[0]!.grossCents).toBe(4000);
    expect(groot.mine[0]!.euroCents).toBe(500); // 1% van € 500, niet van € 4.000

    /* Blijft de aankoop ONDER het plafond, dan mag het gewone bedrag er staan —
     * met het plafond erbij, want dat is de voorwaarde waaronder het geldt. */
    const klein = rankCheckout({ cards: [bleap], heldIds: ["bleap"], currency: "EUR", amountCents: 10000, asOf: ASOF });
    expect(klein.mine[0]!.euroCents).toBe(100);
    expect(klein.mine[0]!.caveats.some((c) => c.soort === "plafond")).toBe(true);
  });

  it("een voorwaarde die we niet kunnen duiden, geeft geen bedrag maar een melding", () => {
    const raar = card({
      id: "raar",
      product: "Onduidelijke Kaart",
      cashbackPct: {
        value: 3,
        sourceUrl: "https://voorbeeld.nl/x",
        checkedAt: "2026-05-01",
        conditions: "Alleen op dinsdagen in even weken, mits de maan vol is.",
      },
      fxFeePct: sourced(0),
    });
    const r = rankCheckout({ cards: [raar], heldIds: ["raar"], currency: "EUR", amountCents: 30000, asOf: ASOF });
    expect(r.mine[0]!.claim).toEqual({ soort: "onbeoordeeld" });
    expect(r.mine[0]!.euroCents).toBeNull();
    expect(r.mine[0]!.caveats).toEqual([{ soort: "onbeoordeeld", veld: "cashback" }]);
  });

  it("een programma dat op de peildatum is afgelopen, telt niet meer mee", () => {
    const afgelopen = card({
      id: "af",
      product: "Afgelopen Programma",
      cashbackPct: {
        value: 4,
        sourceUrl: "https://voorbeeld.nl/x",
        checkedAt: "2025-11-09",
        conditions: "Interim programme, active until 30 September 2026.",
      },
      fxFeePct: sourced(0),
    });
    const voor = rankCheckout({ cards: [afgelopen], heldIds: ["af"], currency: "EUR", amountCents: 30000, asOf: "2026-08-21" });
    expect(voor.mine[0]!.claim.soort).toBe("hooguit");
    const na = rankCheckout({ cards: [afgelopen], heldIds: ["af"], currency: "EUR", amountCents: 30000, asOf: "2026-10-01" });
    expect(na.mine[0]!.claim).toEqual({ soort: "vervallen", datum: "2026-09-30" });
    expect(na.mine[0]!.euroCents).toBeNull();
  });

  it("zonder voorwaarden verandert er niets: het bedrag staat er kaal", () => {
    const schoon = card({ id: "schoon", product: "Schone Kaart", cashbackPct: sourced(2), fxFeePct: sourced(0) });
    const r = rankCheckout({ cards: [schoon], heldIds: ["schoon"], currency: "EUR", amountCents: 30000, asOf: ASOF });
    expect(r.mine[0]!.claim).toEqual({ soort: "vast" });
    expect(r.mine[0]!.euroCents).toBe(600);
    expect(r.mine[0]!.caveats).toEqual([]);
  });

  it("de voorwaarden van de koersopslag tellen alleen mee als er omgerekend wordt", () => {
    /* ING Platinum: fxFeePct 0 met "0% koersopslag voor transacties tot € 1.000
     * per maandelijkse incassoperiode, daarna 2,00%". Een voorwaardelijke nul.
     * Bij een aankoop in euro's vindt de omrekening niet plaats en is de nul
     * uitgesproken — dan doet die voorwaarde niet ter zake. */
    const platinum = card({
      id: "platinum",
      product: "Platinum",
      cashbackPct: sourced(1),
      fxFeePct: {
        value: 0,
        sourceUrl: "https://voorbeeld.nl/x",
        checkedAt: "2026-01-01",
        conditions: "0% koersopslag voor transacties tot € 1.000 per maandelijkse incassoperiode, daarna 2,00%.",
      },
    });
    const inEuro = rankCheckout({ cards: [platinum], heldIds: ["platinum"], currency: "EUR", amountCents: 400000, asOf: ASOF });
    expect(inEuro.mine[0]!.caveats).toEqual([]);
    expect(inEuro.mine[0]!.claim).toEqual({ soort: "vast" });

    /* IN DOLLARS gebeurt de omrekening wel, en dan bijt die voorwaardelijke nul:
     * boven 1.000 euro is het geen 0% maar 2,00%. De assertie stond hier eerst op
     * `claim.soort === "hooguit"`, omdat cashback en koersopslag toen tot EEN
     * claim werden versmolten. Dat was de bug: een plafond op de opslag werd zo
     * ook een plafond op de cashback, en een verlopen actie op de opslag kwam
     * eruit als een verlopen cashback.
     *
     * Nu draagt elk cijfer zijn eigen claim. De cashback van 1% heeft geen enkele
     * voorwaarde en is dus gewoon "vast"; de onzekerheid zit waar hij hoort, bij
     * de koersopslag. En omdat een van de twee termen van de som onzeker is,
     * noemt het scherm HELEMAAL GEEN bedrag - strenger dan het oude gedrag, dat
     * hier een gecapt bedrag toonde alsof het de bovengrens was. */
    const inDollars = rankCheckout({ cards: [platinum], heldIds: ["platinum"], currency: "USD", amountCents: 400000, asOf: ASOF });
    expect(inDollars.mine[0]!.caveats.map((c) => c.soort)).toContain("voorwaardelijke-nul");
    expect(inDollars.mine[0]!.claim.soort).toBe("vast");
    expect(inDollars.mine[0]!.fxClaim.soort).toBe("hooguit");
    expect(inDollars.mine[0]!.euroCents).toBeNull();
  });
});

describe("een voorwaarde hoort bij het cijfer waar hij naast staat", () => {
  /* DRIE GEVALLEN DIE MET DE HUIDIGE CATALOGUS ONBEREIKBAAR ZIJN, en die daarom
   * juist een test nodig hebben. Zo werd A4 blokkerend: ongetest, onbereikbaar,
   * en daarna waar zodra er een kaart bijkwam. Elk van deze drie is met de hand
   * gemeten voordat de reparatie erin ging. */

  it("een plafond op de KOERSOPSLAG is geen plafond op de cashback", () => {
    // Gemeten vóór de reparatie: "Kost minstens EUR 19,00 aan koersopslag" waar
    // EUR 10,00 het slechtste geval is — het plafond van het ene cijfer werd op
    // het andere toegepast.
    const gemengd = card({
      id: "gemengd",
      product: "Gemengde Kaart",
      cashbackPct: sourced(1),
      fxFeePct: {
        value: 2,
        sourceUrl: "https://voorbeeld.nl/x",
        checkedAt: "2026-01-01",
        conditions: "Koersopslag met een cap of € 100 per transaction.",
      },
    });
    const r = rankCheckout({ cards: [gemengd], heldIds: ["gemengd"], currency: "USD", amountCents: 100000, asOf: ASOF });
    // De cashback zelf heeft geen enkele voorwaarde en blijft dus onbeperkt.
    expect(r.mine[0]!.claim).toEqual({ soort: "vast" });
    expect(r.mine[0]!.fxClaim.soort).toBe("hooguit");
  });

  it("een verlopen actie op de koersopslag wordt niet voorgelezen als verlopen cashback", () => {
    const verlopen = card({
      id: "verlopen",
      product: "Verlopen Actie",
      cashbackPct: sourced(1),
      fxFeePct: {
        value: 2,
        sourceUrl: "https://voorbeeld.nl/x",
        checkedAt: "2026-01-01",
        conditions: "Actietarief geldig tot 1 januari 2026.",
      },
    });
    const r = rankCheckout({ cards: [verlopen], heldIds: ["verlopen"], currency: "USD", amountCents: 100000, asOf: ASOF });
    // De cashback van 1% is niet verlopen; alleen het opslagcijfer.
    expect(r.mine[0]!.claim.soort).not.toBe("vervallen");
    expect(r.mine[0]!.fxClaim.soort).toBe("vervallen");
  });

  it("een voorwaardelijke nul in de KAARTKOSTEN gaat niet als nul de aftreksom in", () => {
    /* Gemeten vóór de reparatie: "Over 1 jaar kost dat minstens EUR 0,00" naast
     * een regel die zegt dat die nul alleen onder voorwaarden geldt. Een
     * onbekende kostenpost als nul aftrekken maakt van een onzeker nettobedrag
     * een zeker uitziend nettobedrag. */
    const gratisMits = card({
      id: "gratis-mits",
      product: "Gratis Mits",
      cashbackPct: sourced(1),
      fxFeePct: sourced(0),
      fee: {
        value: 0,
        period: "maand",
        sourceUrl: "https://voorbeeld.nl/x",
        checkedAt: "2026-01-01",
        conditions: "Geen kosten bij minimaal € 1.000 aan bijschrijvingen per maand, anders € 4,50 per maand.",
      },
    });
    /* Let op WELKE lijst: bij een kaart die hij AL heeft loopt die maandprijs
     * toch al en zit hij per ontwerp niet in de som (basis "opbrengst"). De
     * aftrekking bestaat alleen bij een kaart die hij zou moeten OPENEN, dus
     * daar moet dit gemeten worden — heldIds leeg. */
    const r = rankCheckout({ cards: [gratisMits], heldIds: [], currency: "EUR", amountCents: 100000, asOf: ASOF });
    const rij = [...r.openWorthIt, ...r.openBackwards, ...r.openUnknownCost][0]!;
    expect(rij.basis).toBe("bruto");
    expect(rij.charge).toBeNull();
    // En de kaart valt dus NIET in de netto-emmers: daar zou de nul zijn afgetrokken.
    expect(r.openWorthIt).toHaveLength(0);
    expect(r.openBackwards).toHaveLength(0);
  });
});

/* ───────────────── de rangschikking op de ECHTE gebundelde data ──────────── */

describe("de gebundelde catalogus, zoals hij meegaat naar de browser", () => {
  /* DE GOEDKOOPSTE ONTBREKENDE TEST. 89 groene tests en geen enkele die de
   * meegeleverde kaartenlijst aanraakte; elke netto-test bouwde zijn kaarten met
   * de hand. Daardoor bleef staan dat GEEN ENKELE kaart in de bundel én een
   * cashbackcijfer én een prijs met een periode heeft — de netto-tak van rank.ts
   * en het hele horizon.ts worden door deze data nooit bereikt. Deze test legt
   * die aantallen vast, zodat ze omvallen zodra de catalogus verandert. */

  const metCashback = CHECKOUT_CARDS.filter((c) => c.cashbackPct !== null);
  const metPrijs = CHECKOUT_CARDS.filter((c) => c.fee !== null);
  const metAllebei = CHECKOUT_CARDS.filter((c) => c.cashbackPct !== null && c.fee !== null);

  it("de groepsaantallen staan vast", () => {
    expect(CHECKOUT_CARDS).toHaveLength(77);
    expect(metCashback).toHaveLength(8);
    expect(metPrijs).toHaveLength(27);
  });

  it("GEEN ENKELE kaart heeft cashback én een prijs, dus de netto-tak wordt niet bereikt", () => {
    expect(metAllebei).toEqual([]);

    const r = rankCheckout({ cards: CHECKOUT_CARDS, heldIds: [], currency: "EUR", amountCents: 100000, asOf: ASOF });
    expect(r.openWorthIt).toEqual([]);
    expect(r.openBackwards).toEqual([]);
    expect(r.openUnknownCost).toHaveLength(8);
    expect(r.mine).toEqual([]);
    expect(r.unknowns).toEqual([]);
  });

  it("de acht kaarten die een aanbeveling kunnen dragen, dragen allemaal een voorwaarde", () => {
    const r = rankCheckout({ cards: CHECKOUT_CARDS, heldIds: [], currency: "EUR", amountCents: 100000, asOf: ASOF });
    for (const row of r.openUnknownCost) {
      expect(row.caveats.length).toBeGreaterThan(0);
    }
    /* Zeven van de acht keren uit in een token; alleen Bleap doet dat niet. */
    const tokens = r.openUnknownCost.filter((row) => row.claim.soort === "niet-in-euro");
    expect(tokens).toHaveLength(7);
    expect(r.openUnknownCost.filter((row) => row.claim.soort === "hooguit").map((row) => row.card.id)).toEqual([
      "bleap-card",
    ]);
  });

  it("de Nederlandse doorsnee-gebruiker krijgt geen euro-bedrag te zien bij een kaart die in CRO uitkeert", () => {
    /* Houder van een ING betaalpas en een ABN AMRO creditcard, IKEA-fixture van
     * € 49,99. Dit is de gemeten uitkomst uit de review, waar het paneel
     * "Crypto.com Prepaid Card — Private (Obsidian) … Levert € 2,50 op" bovenaan
     * zette. Van geen van beide eigen kaarten kennen we een cashbackcijfer, dus
     * er valt niets te vergelijken — de andere kaarten mogen dan wél in beeld,
     * maar zonder euro-bedrag en met hun voorwaarde erbij. */
    const r = rankCheckout({
      cards: CHECKOUT_CARDS,
      heldIds: ["ing-betaalpas", "abn-amro-creditcard"],
      currency: "EUR",
      amountCents: 4999,
      asOf: ASOF,
    });
    expect(r.unknowns.map((u) => u.reason)).toEqual(["geen-cashback-bekend", "geen-cashback-bekend"]);
    expect(r.openWorthIt).toEqual([]);
    expect(r.openBackwards).toEqual([]);

    /* De kaart die het paneel als eerste toont, is niet meer een tokenkaart:
     * die staan onderaan omdat we hun opbrengst niet in euro's kunnen zetten. */
    expect(r.openUnknownCost[0]!.card.id).toBe("bleap-card");
    const obsidian = r.openUnknownCost.find((x) => x.card.id === "crypto-com-prepaid-card-private-obsidian")!;
    expect(obsidian.euroCents).toBeNull();
    expect(obsidian.claim).toEqual({ soort: "niet-in-euro", token: "CRO" });
  });

  it("elke gelezen voorwaarde in de bundel is van een soort die we kunnen benoemen", () => {
    /* Valt hier een "onbeoordeeld" uit, dan is er nieuwe voorwaardentekst in de
     * catalogus gekomen die deze lezer niet kent. Dat is geen ramp — het cijfer
     * wordt dan juist NIET als bedrag getoond — maar het hoort op te vallen. */
    const r = rankCheckout({ cards: CHECKOUT_CARDS, heldIds: [], currency: "EUR", amountCents: 100000, asOf: ASOF });
    const soorten = new Set(r.openUnknownCost.flatMap((row) => row.caveats.map((c) => c.soort)));
    expect([...soorten].sort()).toEqual([
      "drempel",
      "einddatum",
      "geen-plafond",
      "herzien",
      "in-token",
      "plafond",
      "plafond-onbekend",
      "plafond-zonder-bedrag",
      "uitsluitingen",
    ]);
  });
});
