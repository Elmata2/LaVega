/* De rangschikking. Elke test hier hoort bij een regel die het schoongehouden
 * geval niet zou hebben gevonden. */

import { describe, it, expect } from "vitest";
import { rankCheckout } from "./rank.js";
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
    expect(duur.charge).toEqual({ cents: 27000, periods: 1, label: "1 jaar" });
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
    const een = rankCheckout({ cards: [maandkaart], heldIds: [], currency: "EUR", amountCents: 30000, asOf: ASOF });
    const zes = rankCheckout({ cards: [maandkaart], heldIds: [], currency: "EUR", amountCents: 30000, horizonMonths: 6, asOf: ASOF });
    expect(een.openWorthIt[0]!.resultCents).toBe(900 - 500);
    expect(zes.openBackwards[0]!.resultCents).toBe(900 - 3000);
    expect(zes.openBackwards[0]!.charge!.label).toBe("6 maanden");
  });

  it("vijf euro per maand kosten en drie opleveren is achteruit, en staat er zo", () => {
    /* Het geval uit de opdracht, letterlijk. */
    const kaart = card({ id: "vijf-kost-drie-levert", cashbackPct: sourced(1), fxFeePct: sourced(0), fee: fee(5, "maand") });
    const r = rankCheckout({ cards: [kaart], heldIds: [], currency: "EUR", amountCents: 30000, asOf: ASOF });
    expect(r.openWorthIt).toEqual([]);
    expect(r.openBackwards[0]!.resultCents).toBe(300 - 500);
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
      amountCents: 30000,
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
