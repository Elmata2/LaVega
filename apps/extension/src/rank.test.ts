/* De rangschikking. Elke test hier hoort bij een regel die het schoongehouden
 * geval niet zou hebben gevonden. */

import { describe, it, expect } from "vitest";
import { rankCheckout, leesVoorwaarden, leesZin, type Veld } from "./rank.js";
import { CHECKOUT_CARDS } from "./generated/catalog.generated.js";
import type { CheckoutCard, CardFee, Sourced } from "./types.js";

const ASOF = "2026-08-21";

function sourced(value: number, checkedAt = "2026-06-15") {
  return { value, sourceUrl: "https://voorbeeld.nl/voorwaarden", checkedAt, conditions: null };
}
function fee(value: number, period: "maand" | "jaar"): CardFee {
  return {
    value,
    period,
    sourceUrl: "https://voorbeeld.nl/tarieven",
    checkedAt: "2026-01-15",
    conditions: null,
  };
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
const GRATIS_1PCT = card({
  id: "gratis-1pct",
  cashbackPct: sourced(1),
  fxFeePct: sourced(0),
  fee: fee(0, "maand"),
});
const DUUR_3PCT = card({
  id: "duur-3pct",
  cashbackPct: sourced(3),
  fxFeePct: sourced(0),
  fee: fee(270, "jaar"),
});
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
      cents: 27000,
      periods: 1,
      label: "1 jaar",
      spanMonths: 12,
      spanLabel: "1 jaar",
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
    const maandkaart = card({
      id: "vijf-per-maand",
      cashbackPct: sourced(3),
      fxFeePct: sourced(0),
      fee: fee(5, "maand"),
    });
    const een = rankCheckout({
      cards: [maandkaart],
      heldIds: [],
      currency: "EUR",
      amountCents: 300000,
      asOf: ASOF,
    });
    const twee = rankCheckout({
      cards: [maandkaart],
      heldIds: [],
      currency: "EUR",
      amountCents: 300000,
      horizonMonths: 13,
      asOf: ASOF,
    });
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
    const kaart = card({
      id: "vijf-kost-drie-levert",
      cashbackPct: sourced(1),
      fxFeePct: sourced(0),
      fee: fee(5, "maand"),
    });
    const r = rankCheckout({
      cards: [kaart],
      heldIds: [],
      currency: "EUR",
      amountCents: 30000,
      asOf: ASOF,
    });
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
    const maand = card({
      id: "negen-per-maand",
      product: "Maandkaart",
      cashbackPct: sourced(1),
      fxFeePct: sourced(0),
      fee: fee(9, "maand"),
    });
    const jaar = card({
      id: "zestig-per-jaar",
      product: "Jaarkaart",
      cashbackPct: sourced(1),
      fxFeePct: sourced(0),
      fee: fee(60, "jaar"),
    });
    const r = rankCheckout({
      cards: [maand, jaar],
      heldIds: [],
      currency: "EUR",
      amountCents: 1_000_000,
      asOf: ASOF,
    });

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
    const nettoKaart = card({
      id: "netto-4pct",
      cashbackPct: sourced(4),
      fxFeePct: sourced(0),
      fee: fee(1, "maand"),
    });
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
    const r = rankCheckout({
      cards: [DUUR_3PCT],
      heldIds: [],
      currency: "EUR",
      amountCents: null,
      asOf: ASOF,
    });
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
    const r = rankCheckout({
      cards: [],
      heldIds: [],
      currency: "EUR",
      amountCents: 30000,
      asOf: ASOF,
    });
    expect(r).toMatchObject({
      mine: [],
      openWorthIt: [],
      openBackwards: [],
      openUnknownCost: [],
      unknowns: [],
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
    const r = rankCheckout({
      cards: [],
      heldIds: [],
      currency: "eur",
      amountCents: null,
      asOf: "2020-01-01",
    });
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
    const r = rankCheckout({
      cards: [CRO],
      heldIds: ["cro"],
      currency: "EUR",
      amountCents: 400000,
      asOf: ASOF,
    });
    const row = r.mine[0]!;
    expect(row.claim).toEqual({ soort: "niet-in-euro", token: "CRO" });
    expect(row.euroCents).toBeNull();
    expect(row.resultCents).toBeNull();
    /* De rekensom bestaat nog wel — hij mag alleen niet als euro's naar buiten. */
    expect(row.grossCents).toBe(8000);
  });

  it("de voorwaarden staan in de rij, alle drie, en met hun soort erbij", () => {
    const r = rankCheckout({
      cards: [CRO],
      heldIds: ["cro"],
      currency: "EUR",
      amountCents: 400000,
      asOf: ASOF,
    });
    expect(r.mine[0]!.caveats.map((c) => c.soort).sort()).toEqual([
      "drempel",
      "in-token",
      "plafond-zonder-bedrag",
    ]);
  });

  it("een kaart die hij niet heeft en niet in euro's uitkeert, komt niet in de vergelijking", () => {
    /* "Beter dan jouw ING-pas" is een uitspraak, en die kunnen we over een
     * uitkering in CRO niet doen. Zwijgen is dan geen verzwijgen. */
    const ing = card({
      id: "ing",
      product: "ING betaalpas",
      cashbackPct: sourced(0),
      fxFeePct: sourced(0),
    });
    const r = rankCheckout({
      cards: [ing, CRO],
      heldIds: ["ing"],
      currency: "EUR",
      amountCents: 400000,
      asOf: ASOF,
    });
    expect(r.openWorthIt).toEqual([]);
    expect(r.openUnknownCost).toEqual([]);
    /* Heeft hij niets aangevinkt, dan wordt er niets vergeleken en mag de kaart
     * er mét zijn voorwaarde bij staan. */
    const leeg = rankCheckout({
      cards: [ing, CRO],
      heldIds: [],
      currency: "EUR",
      amountCents: 400000,
      asOf: ASOF,
    });
    expect(leeg.openUnknownCost.map((x) => x.card.id)).toContain("cro");
  });

  it("een kaart die niet in euro's uitkeert staat ONDER een kaart die dat wel doet", () => {
    /* 5% in CRO boven 1% in euro's zetten is dezelfde eenhedenfout als een
     * maandbedrag met een jaarbedrag vergelijken, één laag hoger. */
    const euroKaart = card({
      id: "euro",
      product: "Eurokaart",
      cashbackPct: sourced(1),
      fxFeePct: sourced(0),
    });
    const r = rankCheckout({
      cards: [CRO, euroKaart],
      heldIds: ["cro", "euro"],
      currency: "EUR",
      amountCents: 400000,
      asOf: ASOF,
    });
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
        conditions:
          "Default ongoing rate, with a fair-usage cap of €500 per transaction and €3,000 per month.",
      },
      fxFeePct: sourced(0),
    });
    const groot = rankCheckout({
      cards: [bleap],
      heldIds: ["bleap"],
      currency: "EUR",
      amountCents: 400000,
      asOf: ASOF,
    });
    expect(groot.mine[0]!.claim).toEqual({
      soort: "hooguit",
      capCents: 50000,
      capBasis: "transactie",
    });
    expect(groot.mine[0]!.grossCents).toBe(4000);
    expect(groot.mine[0]!.euroCents).toBe(500); // 1% van € 500, niet van € 4.000

    /* Blijft de aankoop ONDER het plafond, dan mag het gewone bedrag er staan —
     * met het plafond erbij, want dat is de voorwaarde waaronder het geldt. */
    const klein = rankCheckout({
      cards: [bleap],
      heldIds: ["bleap"],
      currency: "EUR",
      amountCents: 10000,
      asOf: ASOF,
    });
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
    const r = rankCheckout({
      cards: [raar],
      heldIds: ["raar"],
      currency: "EUR",
      amountCents: 30000,
      asOf: ASOF,
    });
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
    const voor = rankCheckout({
      cards: [afgelopen],
      heldIds: ["af"],
      currency: "EUR",
      amountCents: 30000,
      asOf: "2026-08-21",
    });
    expect(voor.mine[0]!.claim.soort).toBe("hooguit");
    const na = rankCheckout({
      cards: [afgelopen],
      heldIds: ["af"],
      currency: "EUR",
      amountCents: 30000,
      asOf: "2026-10-01",
    });
    expect(na.mine[0]!.claim).toEqual({ soort: "vervallen", datum: "2026-09-30" });
    expect(na.mine[0]!.euroCents).toBeNull();
  });

  it("zonder voorwaarden verandert er niets: het bedrag staat er kaal", () => {
    const schoon = card({
      id: "schoon",
      product: "Schone Kaart",
      cashbackPct: sourced(2),
      fxFeePct: sourced(0),
    });
    const r = rankCheckout({
      cards: [schoon],
      heldIds: ["schoon"],
      currency: "EUR",
      amountCents: 30000,
      asOf: ASOF,
    });
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
        conditions:
          "0% koersopslag voor transacties tot € 1.000 per maandelijkse incassoperiode, daarna 2,00%.",
      },
    });
    const inEuro = rankCheckout({
      cards: [platinum],
      heldIds: ["platinum"],
      currency: "EUR",
      amountCents: 400000,
      asOf: ASOF,
    });
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
    const inDollars = rankCheckout({
      cards: [platinum],
      heldIds: ["platinum"],
      currency: "USD",
      amountCents: 400000,
      asOf: ASOF,
    });
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
    const r = rankCheckout({
      cards: [gemengd],
      heldIds: ["gemengd"],
      currency: "USD",
      amountCents: 100000,
      asOf: ASOF,
    });
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
    const r = rankCheckout({
      cards: [verlopen],
      heldIds: ["verlopen"],
      currency: "USD",
      amountCents: 100000,
      asOf: ASOF,
    });
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
        conditions:
          "Geen kosten bij minimaal € 1.000 aan bijschrijvingen per maand, anders € 4,50 per maand.",
      },
    });
    /* Let op WELKE lijst: bij een kaart die hij AL heeft loopt die maandprijs
     * toch al en zit hij per ontwerp niet in de som (basis "opbrengst"). De
     * aftrekking bestaat alleen bij een kaart die hij zou moeten OPENEN, dus
     * daar moet dit gemeten worden — heldIds leeg. */
    const r = rankCheckout({
      cards: [gratisMits],
      heldIds: [],
      currency: "EUR",
      amountCents: 100000,
      asOf: ASOF,
    });
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
    /* DEZE DRIE GETALLEN ZIJN EEN TRIPWIRE en geen eigenschap: ze horen om te
     * vallen zodra de catalogus verandert, zodat een sweep niet stil de bundel
     * verschuift. Dat is op 24 augustus 2026 ook gebeurd en dit is de stand
     * daarna. 81 -> 84 en 38 -> 41 komen van de FX-gatenronde: ING Creditcard
     * More, Extra en Max kregen hun koersopslag uit ING's eigen kostenoverzicht
     * (15 juni 2026) en zijn daarmee kaarten waarmee je kunt afrekenen. Bleap
     * kreeg in diezelfde ronde ook een koersopslag maar zat er al in.
     * Cashback bleef op 8: die ronde raakte dat veld niet. */
    expect(CHECKOUT_CARDS).toHaveLength(84);
    expect(metCashback).toHaveLength(8);
    expect(metPrijs).toHaveLength(41);
  });

  it("de netto-tak wordt nog steeds niet bereikt, maar niet meer om dezelfde reden", () => {
    /* HIER STOND "GEEN ENKELE KAART HEEFT CASHBACK ÉN EEN PRIJS", en dat is niet
     * langer waar: er zijn er twee. Dat verschil is het hele punt van deze test,
     * dus hij is herschreven en niet weggehaald.
     *
     * TOEN was de netto-tak onbereikbaar door de DATA: `if (!card.fee)` sloeg
     * elke rij af voordat er iets te verrekenen was. NU zijn er twee kaarten met
     * allebei de cijfers, en houdt de VOORWAARDENLEZER ze tegen — en bij die
     * twee is dat de juiste uitkomst, elk om zijn eigen reden:
     *
     *   Bleap — artikel 6.2 van dezelfde bron zegt "Mastercard scheme fees …
     *           may apply and are your responsibility". Er kunnen dus kosten
     *           bijkomen die we niet kennen; die nul is geen volledige prijs.
     *   Wirex — de uitkering is 0,5% Cryptoback, dus de OPBRENGST is niet in
     *           euro's. Er valt geen prijs van af te trekken, hoe goed we die
     *           prijs ook kennen.
     *
     * EN DAT IS DE EERLIJKE KOP VAN DEZE HELE VERANDERING: een echte
     * netto-vergelijking in euro's vraagt nog steeds een kaart die cashback IN
     * EURO'S geeft én een prijs draagt. Die staat niet in de catalogus. Wat er
     * wél is opgelost, staat in het blok "herkomstnotitie of beperking"
     * hieronder: de tak is niet langer dood door een herkomstnotitie. */
    expect(metAllebei.map((c) => c.id)).toEqual(["bleap-card", "wirex-card-wirex-one"]);

    const r = rankCheckout({
      cards: CHECKOUT_CARDS,
      heldIds: [],
      currency: "EUR",
      amountCents: 100000,
      asOf: ASOF,
    });
    expect(r.openWorthIt).toEqual([]);
    expect(r.openBackwards).toEqual([]);
    expect(r.openUnknownCost).toHaveLength(8);
    expect(r.mine).toEqual([]);
    expect(r.unknowns).toEqual([]);

    const bleap = r.openUnknownCost.find((row) => row.card.id === "bleap-card")!;
    expect(bleap.basis).toBe("bruto");
    const wirex = r.openUnknownCost.find((row) => row.card.id === "wirex-card-wirex-one")!;
    expect(wirex.basis).toBe("voorwaardelijk");
    expect(wirex.claim).toEqual({ soort: "niet-in-euro", token: "crypto" });
  });

  it("de acht kaarten die een aanbeveling kunnen dragen, dragen allemaal een voorwaarde", () => {
    const r = rankCheckout({
      cards: CHECKOUT_CARDS,
      heldIds: [],
      currency: "EUR",
      amountCents: 100000,
      asOf: ASOF,
    });
    for (const row of r.openUnknownCost) {
      expect(row.caveats.length).toBeGreaterThan(0);
    }
    /* Zeven van de acht keren uit in een token; alleen Bleap doet dat niet. */
    const tokens = r.openUnknownCost.filter((row) => row.claim.soort === "niet-in-euro");
    expect(tokens).toHaveLength(7);
    expect(
      r.openUnknownCost.filter((row) => row.claim.soort === "hooguit").map((row) => row.card.id),
    ).toEqual(["bleap-card"]);
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
    expect(r.unknowns.map((u) => u.reason)).toEqual([
      "geen-cashback-bekend",
      "geen-cashback-bekend",
    ]);
    expect(r.openWorthIt).toEqual([]);
    expect(r.openBackwards).toEqual([]);

    /* De kaart die het paneel als eerste toont, is niet meer een tokenkaart:
     * die staan onderaan omdat we hun opbrengst niet in euro's kunnen zetten. */
    expect(r.openUnknownCost[0]!.card.id).toBe("bleap-card");
    const obsidian = r.openUnknownCost.find(
      (x) => x.card.id === "crypto-com-prepaid-card-private-obsidian",
    )!;
    expect(obsidian.euroCents).toBeNull();
    expect(obsidian.claim).toEqual({ soort: "niet-in-euro", token: "CRO" });
  });

  it("elke gelezen voorwaarde in de bundel is van een soort die we kunnen benoemen", () => {
    /* Valt hier een NIEUWE soort uit, dan is er voorwaardentekst in de catalogus
     * gekomen die deze lezer anders leest dan voorheen. Dat is geen ramp — het
     * cijfer wordt dan juist NIET als bedrag getoond — maar het hoort op te
     * vallen.
     *
     * "onbeoordeeld" staat er sinds de bundel van 24 augustus 2026 bij, en het
     * is precies de bedoelde uitkomst: het is Bleap en Wirex, waarvan de
     * prijstekst een echte beperking draagt die we niet in één woord kunnen
     * navertellen. Zie de test hierboven. */
    const r = rankCheckout({
      cards: CHECKOUT_CARDS,
      heldIds: [],
      currency: "EUR",
      amountCents: 100000,
      asOf: ASOF,
    });
    const soorten = new Set(r.openUnknownCost.flatMap((row) => row.caveats.map((c) => c.soort)));
    expect([...soorten].sort()).toEqual([
      "drempel",
      "einddatum",
      "geen-plafond",
      "herzien",
      "in-token",
      "onbeoordeeld",
      "plafond",
      "plafond-onbekend",
      "plafond-zonder-bedrag",
      "uitsluitingen",
    ]);
  });
});

/* ─── herkomstnotitie of beperking, op ECHTE voorwaardentekst uit de bundel ── */

describe("een herkomstnotitie is geen voorwaarde, en een voorwaarde is geen herkomstnotitie", () => {
  /* WAAROM ELKE STRING IN DIT BLOK UIT DE BUNDEL KOMT, en waarom dat niet
   * vanzelfsprekend was.
   *
   * De fout die deze tests vangen heeft 286 groene tests overleefd, en de reden
   * is in één regel te zien: elke `fee()`-hulpfunctie in dit bestand, in
   * lines.test.ts, in horizon.test.ts en in panel.test.ts zet
   * `conditions: null`. De enige test die `basis === "netto"` beweerde, bouwde
   * zijn kaart met die hulpfunctie. Er is dus nooit een echte
   * voorwaardentekst door de kaartkosten-tak gegaan.
   *
   * Daarom staat hier geen bedachte tekst maar catalogusproza, en bewijst
   * `verbatim()` dat ook: staat een string niet meer letterlijk in de bundel,
   * dan valt de test om op de string en niet op de bewering. */
  const ALLE_PRIJSTEKSTEN = CHECKOUT_CARDS.map((c) => c.fee?.conditions ?? "").join("\n");

  function verbatim(zin: string): string {
    expect(ALLE_PRIJSTEKSTEN).toContain(zin);
    return zin;
  }

  function echteFee(id: string): CardFee {
    const kaart = CHECKOUT_CARDS.find((c) => c.id === id);
    expect(kaart?.fee ?? null).not.toBeNull();
    return kaart!.fee!;
  }

  function feeMetVoorwaarde(value: number, period: "maand" | "jaar", voorwaarde: string): CardFee {
    return { ...fee(value, period), conditions: voorwaarde };
  }

  /** Eén kaart met een SCHONE cashback en de opgegeven prijs, gerangschikt als
   *  kaart die hij nog niet heeft. Zo hangt de uitkomst aan de voorwaardentekst
   *  van de PRIJS en aan niets anders — en alleen bij een kaart die hij zou
   *  moeten openen bestaat de aftreksom (zie de kop van rank.ts). */
  function rijMetPrijs(f: CardFee) {
    const proef = card({ id: "proef", cashbackPct: sourced(1), fxFeePct: sourced(0), fee: f });
    const r = rankCheckout({
      cards: [proef],
      heldIds: [],
      currency: "EUR",
      amountCents: 30000,
      asOf: ASOF,
    });
    return [...r.openWorthIt, ...r.openBackwards, ...r.openUnknownCost][0]!;
  }

  function prijsvoorbehouden(rij: {
    caveats: readonly { soort: string; veld: string }[];
  }): string[] {
    return rij.caveats.filter((c) => c.veld === "kaartkosten").map((c) => c.soort);
  }

  /* ── de bug zelf ──────────────────────────────────────────────────────── */

  it("DE ONTBREKENDE TEST: een prijs met alleen een herkomstnotitie erbij komt op netto uit", () => {
    /* Dit is de test die er niet was. Vóór deze verandering leverde ELKE
     * niet-lege voorwaardentekst een voorbehoud op — ook een zin die alleen zegt
     * wat een EXTRA kaart kost — en dus kon `bepaalClaim` voor de kaartkosten
     * nooit "vast" teruggeven en was de netto-tak van buildRow onbereikbaar. */
    const rij = rijMetPrijs(
      feeMetVoorwaarde(4.45, "maand", verbatim("Extra ABN AMRO Gold Card € 2,10 per maand.")),
    );
    expect(prijsvoorbehouden(rij)).toEqual([]);
    expect(rij.basis).toBe("netto");
    expect(rij.charge).not.toBeNull();
    expect(rij.charge!.cents).toBe(5340);
    /* 1% van € 300 is € 3,00; de kaart kost € 53,40 over een jaar. */
    expect(rij.resultCents).toBe(300 - 5340);
  });

  it("en dat geldt ook voor de hele herkomstparagraaf van Amex, met versiestempel en al", () => {
    const rij = rijMetPrijs(echteFee("american-express-green-card"));
    expect(prijsvoorbehouden(rij)).toEqual([]);
    expect(rij.basis).toBe("netto");
    expect(rij.charge!.cents).toBe(7800);
    expect(rij.resultCents).toBe(300 - 7800);
  });

  /* ── de zuurtest: de vijf rijen die er op 24 augustus bij kwamen ───────── */

  /* ALLE VIJF ZEGGEN HETZELFDE, en het is geen herkomst: de prijs die de bron
   * noemt komt BOVENOP de rekening of het pakket. In de catalogus staat dat als
   * `pricedOnItsOwn: false`. Zulke prijzen mogen nooit als kaal nettobedrag op
   * het scherm komen, want dan lijkt de kaart goedkoper dan hij is — precies de
   * fout die deze catalogus twee keer eerder heeft gevangen. */
  const VIJF_NIEUWE = [
    "abn-amro-betaalpas",
    "ing-creditcard",
    "ing-platinumcard",
    "rabo-goldcard",
    "knab-creditcard",
  ];

  it.each(VIJF_NIEUWE)("%s: de prijs komt bovenop de rekening, dus geen kaal nettobedrag", (id) => {
    const rij = rijMetPrijs(echteFee(id));
    expect(prijsvoorbehouden(rij)).toContain("bovenop");
    expect(rij.basis).toBe("bruto");
    expect(rij.charge).toBeNull();
    expect(rij.resultCents).toBe(rij.euroCents);
  });

  it("de vijf nieuwe rijen halen samen nul netto-uitkomsten", () => {
    /* Niet per rij maar als groep, zodat één rij die er stilletjes doorheen
     * glipt hier ook omvalt. */
    const kaarten = VIJF_NIEUWE.map((id) =>
      card({ id, cashbackPct: sourced(1), fxFeePct: sourced(0), fee: echteFee(id) }),
    );
    const r = rankCheckout({
      cards: kaarten,
      heldIds: [],
      currency: "EUR",
      amountCents: 30000,
      asOf: ASOF,
    });
    expect(r.openWorthIt).toEqual([]);
    expect(r.openBackwards).toEqual([]);
    expect(r.openUnknownCost.map((x) => x.basis)).toEqual([
      "bruto",
      "bruto",
      "bruto",
      "bruto",
      "bruto",
    ]);
  });

  /* ── de twee valse voorbehouden, met naam ─────────────────────────────── */

  it("Bleap: 'geen eenmalige formulering' is geen eenmalige kostenpost", () => {
    /* De oude /\beenmalig/ vuurde op een woord dat de FORMULERING van de bron
     * beschrijft, en nog ontkennend ook, en zette "er komen eenmalige kosten
     * bij" op het scherm. */
    const rij = rijMetPrijs(echteFee("bleap-card"));
    expect(prijsvoorbehouden(rij)).not.toContain("eenmalig");
    /* En tóch niet vrijgegeven, want artikel 6.2 van dezelfde bron zegt dat er
     * andere kosten "may apply". Dat is een echte beperking. */
    expect(prijsvoorbehouden(rij)).toEqual(["onbeoordeeld"]);
    expect(rij.basis).toBe("bruto");
  });

  it("Wirex: een PRIJS wordt niet in crypto uitgekeerd", () => {
    /* De herkomstnotitie bij de prijs citeert de merknaam van de CASHBACK
     * ("het niveau waar de 0,5% Cryptoback bij hoort"), en daaruit kwam "de
     * uitkering is in crypto en niet in euro's" — over een prijs. */
    const rij = rijMetPrijs(echteFee("wirex-card-wirex-one"));
    expect(prijsvoorbehouden(rij)).not.toContain("in-token");
    expect(prijsvoorbehouden(rij)).toEqual(["onbeoordeeld"]);
    expect(rij.basis).toBe("bruto");
  });

  /* ── elke beperkingsvorm die de lezer kent, met een echte zin erbij ───── */

  const BEPERKINGEN: ReadonlyArray<readonly [string, string]> = [
    [
      "geschiktheid",
      "Uitsluitend voor inwoners van geselecteerde Europese landen (EER en Verenigd Koninkrijk).",
    ],
    ["pakketkoppeling", "Bovenop de € 4,00 per maand van het ING OranjePakket."],
    ["ander-tarief", "Tarief bij Betaalrekening Plus Betalen."],
    /* Dezelfde vorm aan het BEGIN van een tekst, met een hoofdletter-B. Dat is
     * een aparte regel in de vormherkenning en dus een aparte zin hier. */
    ["ander-tarief", "Bij een SNS Studentenrekening € 27,50 per jaar."],
    ["drempel", "Bij een minimale besteding van € 3.000 per jaar."],
    [
      "tijdelijk",
      "Het eerste jaar kosteloos zolang je een American Express consumentenkaart blijft gebruiken;",
    ],
    ["aangekondigd", "Per 15 september 2026 gaat de jaarbijdrage naar € 59,50"],
    ["extra-kosten", "Eenmalige kosten voor de fysieke kaart komen er wel:"],
    [
      "gesloten",
      "de tekst 'Dienst niet beschikbaar' met de voetnoot dat alle kosten aan ICS worden betaald",
    ],
    ["onzeker-product", "Zie 'openstaandeVragen' in het verslag."],
    ["plafond-of-uitsluiting", "daglimiet € 400."],
  ];

  it.each(BEPERKINGEN)("een %s-zin houdt de prijs tegen", (vorm, zin) => {
    expect(leesZin(verbatim(zin))).toEqual({ zin, soort: "restrictie", vorm });
    const rij = rijMetPrijs(feeMetVoorwaarde(3, "maand", zin));
    expect(prijsvoorbehouden(rij).length).toBeGreaterThan(0);
    expect(rij.basis).toBe("bruto");
    expect(rij.charge).toBeNull();
  });

  /* ── en waarom dit behoudend is ──────────────────────────────────────── */

  it("een zin die we niet herkennen houdt de prijs óók tegen: onbekend is geen groen licht", () => {
    const nieuw = "De kaart is paars en het pasje is van gerecycled plastic.";
    expect(leesZin(nieuw).soort).toBe("onbekend");
    const rij = rijMetPrijs(feeMetVoorwaarde(3, "maand", nieuw));
    expect(prijsvoorbehouden(rij)).toEqual(["onbeoordeeld"]);
    expect(rij.basis).toBe("bruto");
  });

  it("één onbekende zin naast louter herkomst is genoeg om tegen te houden", () => {
    const tekst = `${verbatim("Extra ABN AMRO Gold Card € 2,10 per maand.")} De kaart is paars.`;
    const rij = rijMetPrijs(feeMetVoorwaarde(4.45, "maand", tekst));
    expect(prijsvoorbehouden(rij)).toEqual(["onbeoordeeld"]);
    expect(rij.basis).toBe("bruto");
  });

  it("een bedrag zonder eigenaar in de zin is geen herkomstnotitie", () => {
    /* De echte Amex-zin komt door omdat er "inclusief 2 extra kaarten" bij
     * staat: dan blijkt van WIE het tweede bedrag is. Haal die halve zin weg —
     * dit is de enige geknipte string in dit blok, en met opzet — en de zin valt
     * naar "onbekend". Bedragen zijn de gevaarlijke inhoud van dit veld, dus
     * zonder eigenaar geen herkomst. */
    const heel = verbatim(
      '"Overzicht Kaartlidmaatschapsbijdragen", rij "The Green Card € 6,50 per maand", inclusief 2 extra kaarten;',
    );
    expect(leesZin(heel).soort).toBe("herkomst");
    const geknipt =
      '"Overzicht Kaartlidmaatschapsbijdragen", rij "The Green Card € 6,50 per maand".';
    expect(leesZin(geknipt).soort).toBe("onbekend");
  });

  it("een nul die alleen buiten een abonnement geldt, blijft een voorwaardelijke nul", () => {
    /* Regel 2 van de opdracht, in de lezer. "€ 0 zolang Travel+ uit staat" is
     * geen uitgesproken nul, en de zinslezer mag daar niet langs. Stap 7 leest
     * daarom de VOLLEDIGE tekst en niet de ingekorte. */
    const zin = verbatim(
      "Abonnementskosten zijn € 0 zolang Travel+ uit staat; met Travel+ ingeschakeld € 4,99 per maand.",
    );
    const rij = rijMetPrijs(feeMetVoorwaarde(0, "maand", zin));
    expect(prijsvoorbehouden(rij)).toContain("voorwaardelijke-nul");
    expect(rij.basis).toBe("bruto");
  });

  it("de ontsnapping geldt alleen voor de kaartkosten, en dat is een dosering en geen principe", () => {
    /* Gemeten: veldonafhankelijk zouden 29 fxFeePct-velden in één stap van
     * "onbeoordeeld" naar "vast" schuiven, en dat zet euro-bedragen aan bij elke
     * aankoop in een vreemde munt. Die verbreding verdient zijn eigen ronde. */
    const zin = verbatim("Extra ABN AMRO Gold Card € 2,10 per maand.");
    expect(leesVoorwaarden(zin, "kaartkosten", 4.45, ASOF)).toEqual([]);
    expect(leesVoorwaarden(zin, "koersopslag", 1.4, ASOF)).toEqual([
      { soort: "onbeoordeeld", veld: "koersopslag" },
    ]);
    expect(leesVoorwaarden(zin, "cashback", 1, ASOF)).toEqual([
      { soort: "onbeoordeeld", veld: "cashback" },
    ]);
  });

  /* ── één herkomstwoord is niet genoeg: de HELE zin moet gelezen zijn ──── */

  /* WAT DEZE VIJF TESTS VANGEN. De eerste versie van de zinslezer las de zin PER
   * WOORD: één herkomstwoord ergens in de zin maakte de hele zin herkomst, en de
   * rest werd niet meer bekeken. Elke beperking die de vormenlijst nog niet kende
   * viel dus weg zodra de zin ook een brondocument noemde — en dan is de uitkomst
   * geen voorbehoud maar een KAAL nettobedrag met een aanbeveling erbij. */

  it("de rabo-zin uit de bundel haalt op zichzelf geen netto-uitspraak", () => {
    /* Deze zin staat letterlijk in de bundel, bij rabo-goldcard. Gemeten vóór de
     * reparatie: leesZin → herkomst/vindplaats, geen enkel voorbehoud, basis
     * netto, en de rij kwam in openWorthIt — een aanbeveling op een prijs die
     * alleen BOVENOP Rabo Standaard bestaat. Dat de echte rij toch behoudend
     * uitkwam, hing er alleen aan dat de BUURZIN het woord "bovenop" gebruikt;
     * deze test knipt die buurzin er met opzet af. */
    const zin = verbatim(
      "dit document is het Informatiedocument van dat pakket en noemt de kaart bij naam.",
    );
    expect(leesZin(zin).soort).toBe("onbekend");
    const rij = rijMetPrijs(feeMetVoorwaarde(2, "maand", zin));
    expect(prijsvoorbehouden(rij)).toEqual(["onbeoordeeld"]);
    expect(rij.basis).toBe("bruto");
    expect(rij.charge).toBeNull();
  });

  it("en de Wirex-waarschuwing over de ONTBREKENDE periode ook niet", () => {
    /* Óók letterlijk uit de bundel, en het is precies een waarschuwing bij regel
     * 3: de bron hangt geen periode aan het woord "free", dus dat de eenheid op
     * "maand" staat is een gevolgtrekking en geen citaat. Die zin las als
     * herkomst/vindplaats, op het woord "document". */
    const zin = verbatim('HET DOCUMENT HANGT GEEN PERIODE AAN HET WOORD "FREE";');
    expect(leesZin(zin).soort).toBe("onbekend");
    const rij = rijMetPrijs(feeMetVoorwaarde(2, "maand", zin));
    expect(prijsvoorbehouden(rij)).toEqual(["onbeoordeeld"]);
    expect(rij.basis).toBe("bruto");
  });

  /* Zeven vormen die de beperkingslijst NIET kent, elk met een brondocument in
   * dezelfde zin. Gemeten vóór de reparatie: alle zeven herkomst/vindplaats,
   * alle zeven basis=netto. Dit is de categorie waarvan we per definitie niet
   * weten wat er nog in zit, dus de test is er niet om de zeven te dekken maar
   * om te bewijzen dat een onbekende bewering náást een vindplaats de zin niet
   * meer vrijgeeft. */
  const NIET_GEKENDE_BEPERKINGEN = [
    "De prijs staat in de tarieventabel van het Compleet Pakket.",
    "Volgens de tarievenwijzer stijgt de jaarbijdrage volgend jaar.",
    "De prijslijst vermeldt dit bedrag vanaf het tweede jaar.",
    "Het informatieblad zet dit bedrag in de kolom voor studenten.",
    "De tarieventabel hangt dit bedrag aan een spaartegoed boven de grens.",
    "De prijslijst zet dit bedrag in de kolom van het instapniveau.",
    "De productpagina neemt de kaart niet langer op in het aanbod.",
  ];

  it.each(NIET_GEKENDE_BEPERKINGEN)(
    "een vindplaats naast een onbekende bewering geeft niets vrij: %s",
    (zin) => {
      expect(leesZin(zin).soort).toBe("onbekend");
      const rij = rijMetPrijs(feeMetVoorwaarde(4.45, "maand", zin));
      expect(prijsvoorbehouden(rij)).toEqual(["onbeoordeeld"]);
      expect(rij.basis).toBe("bruto");
      expect(rij.charge).toBeNull();
    },
  );

  it("en één onbekend woord in een zin die verder louter herkomst is, is al genoeg", () => {
    /* De echte zin komt door; met één woord erbij dat niet in het gesloten
     * woordenboek staat, niet meer. Dat is de hele reparatie in één regel. */
    const echt = verbatim("Extra ABN AMRO Gold Card € 2,10 per maand.");
    expect(leesZin(echt).soort).toBe("herkomst");
    expect(leesZin("Extra ABN AMRO Gold Card € 2,10 per maand voor studenten.").soort).toBe(
      "onbekend",
    );
  });

  /* ── een ONTKENDE uitgesproken nul is geen nul ──────────────────────────── */

  it("'geen uitgesproken nul' blijft een voorwaardelijke nul, ontkenning en al", () => {
    /* HET MINIMALE PAAR, en het verschil is één woord. Vóór de reparatie werd op
     * de substring "uitgesproken nul" getoetst, dus de ONTKENNING onderdrukte
     * stap 7, en de herkomstvorm maakte van dezelfde zin een herkomstnotitie —
     * waardoor stap 10 ook geen "onbeoordeeld" meer toevoegde. Wat er uitkwam was
     * een kale € 0,00 in de nettosom: regel 2 van de opdracht, precies de valse
     * nul van RegioBank en Trade Republic.
     *
     * De formulering is niet bedacht. docs/catalog/staging-kaartkosten.json
     * schrijft haar drie keer uit, op regel 361, 386 en 398. */
    const bevestigd = rijMetPrijs(feeMetVoorwaarde(0, "maand", "Uitgesproken nul."));
    expect(prijsvoorbehouden(bevestigd)).toEqual([]);
    expect(bevestigd.basis).toBe("netto");
    expect(bevestigd.charge!.cents).toBe(0);

    const ontkend = rijMetPrijs(feeMetVoorwaarde(0, "maand", "Dit is geen uitgesproken nul."));
    expect(leesZin("Dit is geen uitgesproken nul.").soort).toBe("onbekend");
    expect(prijsvoorbehouden(ontkend)).toContain("voorwaardelijke-nul");
    expect(ontkend.basis).toBe("bruto");
    expect(ontkend.charge).toBeNull();
  });

  it("en dat geldt ook voor de staging-formulering waar hij vandaan komt", () => {
    /* Letterlijk docs/catalog/staging-kaartkosten.json regel 361. Eén merge van
     * een accountFee-rij verwijderd, en dan gaat hij door deze lezer heen. */
    const tekst =
      "Allemaal eenmalig. De EEA-tabel van Krak heeft GEEN rij voor maand- of jaarkosten " +
      "— dat is een ontbrekende rij, geen uitgesproken nul.";
    const rij = rijMetPrijs(feeMetVoorwaarde(0, "maand", tekst));
    expect(prijsvoorbehouden(rij)).toContain("voorwaardelijke-nul");
    expect(rij.basis).toBe("bruto");
    expect(rij.charge).toBeNull();
  });

  /* ── de teller die elke verbreding zichtbaar maakt ────────────────────── */

  it("hoeveel velden in de BUNDEL geen enkel voorbehoud dragen, staat vast", () => {
    /* Elke regel die aan de herkomstlijst wordt toegevoegd, verplaatst velden
     * van "geen uitspraak" naar "vaste uitspraak". Dit is de teller die dat
     * zichtbaar maakt, per veld, met de zeven bij naam. */
    const zonderVoorbehoud: Record<Veld, string[]> = {
      cashback: [],
      koersopslag: [],
      kaartkosten: [],
    };
    for (const c of CHECKOUT_CARDS) {
      const bronnen: ReadonlyArray<readonly [Veld, Sourced | null]> = [
        ["cashback", c.cashbackPct],
        ["koersopslag", c.fxFeePct],
        ["kaartkosten", c.fee],
      ];
      for (const [veld, bron] of bronnen) {
        if (!bron) continue;
        if (leesVoorwaarden(bron.conditions, veld, bron.value, ASOF).length === 0)
          zonderVoorbehoud[veld].push(c.id);
      }
    }
    expect(zonderVoorbehoud.cashback).toEqual([]);
    expect(zonderVoorbehoud.koersopslag).toHaveLength(9);
    expect(zonderVoorbehoud.kaartkosten).toEqual([
      "abn-amro-gold-card",
      "american-express-green-card",
      "american-express-gold-card",
      "flying-blue-american-express-entry-card",
      "flying-blue-american-express-silver-card",
      "flying-blue-american-express-gold-card",
      "flying-blue-american-express-platinum-card",
    ]);
  });

  it("en tóch komt er op de ECHTE bundel geen enkele netto-rij uit, en dat is de eerlijke kop", () => {
    /* De zeven hierboven zijn allemaal Amex- en ABN-kaarten ZONDER cashbackcijfer,
     * dus ze halen de kaartkosten-tak van buildRow niet eens. De twee kaarten die
     * allebei de cijfers hebben — Bleap en Wirex — worden om hun eigen, juiste
     * reden tegengehouden. Netto op de echte data: 0 vóór deze verandering, 0 na.
     * Wat deze verandering oplost is dat er geen ONWARE voorbehouden meer bij
     * staan en dat de tak niet langer bij ongeluk dood is; een netto-bedrag
     * vraagt DATA die er niet is: een kaart met cashback in euro's én een prijs. */
    const r = rankCheckout({
      cards: CHECKOUT_CARDS,
      heldIds: [],
      currency: "EUR",
      amountCents: 30000,
      asOf: ASOF,
    });
    const alle = [...r.mine, ...r.openWorthIt, ...r.openBackwards, ...r.openUnknownCost];
    expect(alle.filter((row) => row.basis === "netto")).toEqual([]);
  });
});
