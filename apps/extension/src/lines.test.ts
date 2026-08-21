/* De zinnen. De belangrijkste test in dit bestand is niet dat er iets staat
 * maar dat er iets NIET staat. */

import { describe, it, expect } from "vitest";
import { rankCheckout, type Ranking } from "./rank.js";
import { rowLine, headline, unknownLine, sourceLine, korteUitgever } from "./lines.js";
import type { CheckoutCard, CardFee } from "./types.js";

const ASOF = "2026-08-21";

function sourced(value: number, checkedAt = "2026-06-15") {
  return { value, sourceUrl: "https://voorbeeld.nl/voorwaarden", checkedAt, conditions: null };
}
function fee(value: number, period: "maand" | "jaar"): CardFee {
  return { value, period, sourceUrl: "https://voorbeeld.nl/tarieven", checkedAt: "2026-01-15", conditions: null };
}
function card(p: Partial<CheckoutCard> & { id: string; product: string }): CheckoutCard {
  return {
    issuer: "Bank Voorbeeld",
    kind: "creditcard",
    fxFeePct: null,
    cashbackPct: null,
    pointsPerEuro: null,
    fee: null,
    ...p,
  };
}

function rank(cards: CheckoutCard[], heldIds: string[], amountCents: number | null, currency = "EUR"): Ranking {
  return rankCheckout({ cards, heldIds, currency, amountCents, asOf: ASOF });
}

describe('het woord "netto" bij onbekende kaartkosten', () => {
  it("valt niet in de regel, want die bewering kan een ontbrekend cijfer niet dragen", () => {
    const onbekend = card({ id: "x", product: "Kaart Zonder Prijskaartje", cashbackPct: sourced(4), fxFeePct: sourced(0) });
    const r = rank([onbekend], [], 30000);
    const regel = rowLine(r.openUnknownCost[0]!);

    expect(regel).toContain("brutobedrag");
    expect(regel.toLowerCase()).not.toContain("netto");
    /* En de onbekendheid staat er met zoveel woorden, niet als een lege plek. */
    expect(regel).toContain("staat niet in onze gegevens");
    expect(regel).toContain("Bank Voorbeeld");
  });

  it("valt wél in de regel zodra de kosten bekend zijn, met de periode erbij", () => {
    const bekend = card({
      id: "y",
      product: "Kaart Met Prijskaartje",
      cashbackPct: sourced(4),
      fxFeePct: sourced(0),
      fee: fee(1, "maand"),
    });
    const r = rank([bekend], [], 100000);
    const regel = rowLine(r.openWorthIt[0]!);
    /* De vergeleken periode is een heel jaar, bij élke kaart — zie de kop van
     * horizon.ts. De termijnen waarin je betaalt staan er los bij: 12 × € 1. */
    expect(regel).toContain("Netto over 1 jaar");
    expect(regel).toContain("(12 maanden)");
    expect(regel).toContain("€ 28,00"); // € 40,00 opbrengst min 12 × € 1,00 kaartkosten
  });
});

describe("de regel onder een kaart die hij al heeft", () => {
  it("noemt de kaartkosten in hun eigen periode en zegt dat ze niet in de som zitten", () => {
    const amex = card({
      id: "amex",
      product: "Amex Business Gold",
      cashbackPct: sourced(2.5),
      fxFeePct: sourced(0),
      fee: fee(270, "jaar"),
    });
    const r = rank([amex], ["amex"], 30000, "USD");
    const regel = rowLine(r.mine[0]!);
    expect(regel).toContain("Levert € 7,50 op");
    expect(regel).toContain("€ 270,00 per jaar");
    expect(regel).toContain("lopen door of je hier nu mee betaalt of niet");
    /* Geen netto, want er is niets te verrekenen: hij betaalt die € 270 toch. */
    expect(regel.toLowerCase()).not.toContain("netto");
  });

  it("een kaart die geld kost, zegt dat het koersopslag is", () => {
    const pas = card({ id: "pas", product: "ING betaalpas", fxFeePct: sourced(1.4), cashbackPct: sourced(0) });
    const r = rank([pas], ["pas"], 100000, "USD");
    expect(rowLine(r.mine[0]!)).toBe("Kost € 14,00 aan koersopslag.");
  });
});

describe("achteruit staat er als achteruit", () => {
  it("vijf euro per maand kosten en drie opleveren, in woorden", () => {
    const kaart = card({ id: "k", product: "Kaart Achteruit", cashbackPct: sourced(1), fxFeePct: sourced(0), fee: fee(5, "maand") });
    const r = rank([kaart], [], 30000);
    const regel = rowLine(r.openBackwards[0]!);
    expect(regel).toContain("Netto over 1 jaar: -€ 57,00");
    expect(regel).toContain("dat is achteruit, dus dit is geen aanbeveling");
  });
});

describe("de kop", () => {
  it("noemt de kaart en het bedrag als er iets te zeggen is", () => {
    const a = card({ id: "a", product: "Revolut Metal", cashbackPct: sourced(0), fxFeePct: sourced(0) });
    const b = card({ id: "b", product: "ING betaalpas", cashbackPct: sourced(0), fxFeePct: sourced(1.4) });
    const r = rank([a, b], ["a", "b"], 100000, "USD");
    expect(headline(r)).toBe("Betaal met Revolut Metal. Die kost je hier niets extra.");
  });

  it("beweert niets als er niets bekend is", () => {
    const leeg = rank([], [], 30000);
    expect(headline(leeg)).toBe("Er staat geen kaart aangevinkt en er is niets bekend om te vergelijken.");
  });

  it("zegt bij alleen-onbekende eigen kaarten wat er aan de hand is, en niet dat het goed zit", () => {
    /* Dit is de fout "je saldi staan al op de beste plek", overgezet naar dit
     * oppervlak: een leeg scherm dat klinkt als een gunstige uitkomst. */
    const onbekend = card({ id: "u", product: "Kaart Onbekend", fxFeePct: sourced(1) });
    const r = rank([onbekend], ["u"], 30000);
    expect(headline(r)).toContain("weten we bij geen enkele wat deze aankoop oplevert");
  });

  it("zonder bedrag noemt hij het percentage en vraagt om het bedrag", () => {
    const a = card({ id: "a", product: "Kaart A", cashbackPct: sourced(2), fxFeePct: sourced(0) });
    const r = rank([a], ["a"], null);
    expect(headline(r)).toBe("Van jouw kaarten levert Kaart A hier het meeste op: 2%. Vul het bedrag in voor de euro's.");
  });

  it("zonder aangevinkte kaarten zegt hij wat het openen kost, niet dat hij moet overstappen", () => {
    const a = card({ id: "a", product: "Kaart A", cashbackPct: sourced(2), fxFeePct: sourced(0), fee: fee(1, "maand") });
    const r = rank([a], [], 30000);
    expect(headline(r)).toContain("wat het openen kost");
  });
});

describe("de onbekend-melding noemt de echte oorzaak", () => {
  it("bij een ontbrekende koersopslag staat de uitgever erin, niet een categorie", () => {
    const u = card({ id: "u", product: "Kaart Onbekend", issuer: "Knab", cashbackPct: sourced(1) });
    const r = rank([u], ["u"], 30000, "USD");
    const regel = unknownLine(r.unknowns[0]!);
    expect(regel).toContain("Knab");
    expect(regel).toContain("Onbekend is niet nul");
  });
});

describe("de bron staat er altijd bij", () => {
  it("met de datum, want aan een kassa is dat het enige waarop hij kan afgaan", () => {
    const a = card({ id: "a", product: "Kaart A", cashbackPct: sourced(2, "2026-06-15"), fxFeePct: sourced(1.4, "2026-06-15") });
    const r = rank([a], ["a"], 30000, "USD");
    const regel = sourceLine(r.mine[0]!);
    expect(regel).toContain("gecontroleerd 15 juni 2026");
    expect(regel).toContain("cashback 2%");
    expect(regel).toContain("koersopslag 1,4%");
  });

  it("bij een euro-aankoop staat de reden van de nul erbij en niet een datum", () => {
    const a = card({ id: "a", product: "Kaart A", cashbackPct: sourced(2), fxFeePct: sourced(1.4) });
    const r = rank([a], ["a"], 30000, "EUR");
    expect(sourceLine(r.mine[0]!)).toContain("koersopslag 0% — geen omrekening nodig");
  });
});

/* ───────────── een cijfer met een voorwaarde is geen kaal bedrag ─────────── */

function metVoorwaarde(voorwaarde: string, value = 2, checkedAt = "2026-01-01") {
  return { value, sourceUrl: "https://voorbeeld.nl/voorwaarden", checkedAt, conditions: voorwaarde };
}

describe("een uitkering in een token is geen euro-opbrengst", () => {
  const cro = card({
    id: "cro",
    product: "Tokenkaart",
    issuer: "Crypto.com (EEA entity; prepaid Visa, issuing bank not named on the page)",
    cashbackPct: metVoorwaarde(
      "CAP: spend above $1,250 per calendar month earns nothing. TIER GATE: requires an active Plus subscription. PAID IN CRO, not euro.",
    ),
    fxFeePct: sourced(0),
  });

  it("er staat GEEN euroteken in de regel, en de uitkeringsmunt staat er wel", () => {
    /* De gemeten regel uit de review, bij € 4.000: "Betaal met Crypto.com Plus.
     * Dat levert € 80,00 op." Het getal was niet te hoog — het was de verkeerde
     * eenheid, en er stond geen voorbehoud bij. */
    const r = rank([cro], ["cro"], 400000);
    const regel = rowLine(r.mine[0]!);
    expect(regel).not.toContain("€");
    expect(regel).toContain("CRO");
    expect(regel).toContain("niet in euro's");
  });

  it("ook de kop noemt geen bedrag", () => {
    const r = rank([cro], ["cro"], 400000);
    const kop = headline(r);
    expect(kop).not.toContain("€");
    expect(kop).not.toContain("Betaal met");
    expect(kop).toContain("CRO");
  });

  it("de drempel en het plafond staan in de regel, want dat zijn de voorwaarden", () => {
    const r = rank([cro], ["cro"], 400000);
    const regel = rowLine(r.mine[0]!);
    expect(regel).toContain("drempel");
    expect(regel).toContain("plafond");
  });
});

describe("een plafond in euro's wordt genoemd, en toegepast als het bijt", () => {
  const bleap = card({
    id: "bleap",
    product: "Bleap",
    issuer: "Bleap SIA (Latvia), Mastercard debit, self-custodial",
    cashbackPct: metVoorwaarde("Default ongoing rate, with a fair-usage cap of €500 per transaction.", 1),
    fxFeePct: sourced(0),
  });

  it("boven het plafond wordt met het plafond gerekend, en dat staat er ook", () => {
    const r = rank([bleap], ["bleap"], 400000);
    const regel = rowLine(r.mine[0]!);
    expect(regel).toContain("Levert hooguit");
    expect(regel).toContain("Gerekend met het plafond");
    expect(regel).toContain("per transactie");
    /* 1% van € 500 en niet van € 4.000. */
    expect(regel).toContain("5,00");
    expect(regel).not.toContain("40,00");
  });

  it("onder het plafond mag het bedrag er staan, met het plafond erbij", () => {
    const r = rank([bleap], ["bleap"], 10000);
    const regel = rowLine(r.mine[0]!);
    expect(regel).toContain("1,00");
    expect(regel).toContain("er telt hooguit");
    expect(regel).not.toContain("Gerekend met het plafond");
  });
});

describe("een voorwaarde die we niet kunnen duiden, wordt genoemd en niet weggelaten", () => {
  it("geen bedrag, wel de mededeling dat we het niet konden beoordelen", () => {
    const raar = card({
      id: "raar",
      product: "Onduidelijke Kaart",
      cashbackPct: metVoorwaarde("Alleen op dinsdagen in even weken, mits de maan vol is.", 3),
      fxFeePct: sourced(0),
    });
    const r = rank([raar], ["raar"], 30000);
    const regel = rowLine(r.mine[0]!);
    expect(regel).not.toContain("€");
    expect(regel).toContain("niet machinaal konden beoordelen");
  });
});

describe('"staat niet in onze gegevens" moet waar zijn', () => {
  it("staat de prijs van het HEBBEN wél in de voorwaarden, dan zegt de regel dat niet", () => {
    /* Bij Obsidian staat in dezelfde record "€450,000 12-month CRO staking", en
     * de oude regel stuurde de gebruiker daarvoor naar de website van de
     * uitgever. Dat is geen onbekendheid maar een voorwaarde die we hebben. */
    const obsidian = card({
      id: "obsidian",
      product: "Obsidian",
      issuer: "Crypto.com (EEA entity; prepaid Visa)",
      cashbackPct: metVoorwaarde("TIER GATE: crypto.com/nl/cards prices Obsidian at '€450,000 12-month CRO staking'.", 5),
      fxFeePct: sourced(0),
    });
    const r = rank([obsidian], [], 30000);
    const regel = rowLine(r.openUnknownCost[0]!);
    expect(regel).not.toContain("staat niet in onze gegevens");
    expect(regel).toContain("drempel");
  });

  it("staat er werkelijk niets, dan blijft de zin staan — en is hij waar", () => {
    const kaal = card({ id: "kaal", product: "Kale Kaart", cashbackPct: sourced(3), fxFeePct: sourced(0) });
    const r = rank([kaal], [], 30000);
    expect(rowLine(r.openUnknownCost[0]!)).toContain("staat niet in onze gegevens");
  });
});

describe("de uitgeversnaam past in een Nederlandse zin", () => {
  it("de toelichting achter de naam gaat eruit", () => {
    expect(korteUitgever("Wirex; card issuer previously UAB PayrNet, current EEA issuer not stated")).toBe("Wirex");
    expect(korteUitgever("Crypto.com (EEA entity; prepaid Visa, issuing bank not named)")).toBe("Crypto.com");
    /* En een punt die bij de naam hoort, blijft staan. */
    expect(korteUitgever("ING Bank N.V.")).toBe("ING Bank N.V.");
  });

  it("blijft er geen bruikbare naam over, dan noemt de zin de uitgever niet", () => {
    const lang = "Een uitgever met een naam die veel te lang is om in een zin te zetten";
    expect(korteUitgever(lang)).toBeNull();
    const kaart = card({ id: "l", product: "Lange Uitgever", issuer: lang, cashbackPct: sourced(3), fxFeePct: sourced(0) });
    const r = rank([kaart], [], 30000);
    const regel = rowLine(r.openUnknownCost[0]!);
    expect(regel).toContain("Zoek dat op bij de uitgever");
    expect(regel).not.toContain(lang);
  });
});

describe("de kop belooft niets wat de lijst niet kan waarmaken", () => {
  it('zegt niet "er is niets bekend" boven een uitgerekende achteruit-regel', () => {
    /* Gemeten in de review: de kop zei "Er staat geen kaart aangevinkt en er is
     * niets bekend om te vergelijken" terwijl er een regel onder stond met
     * "Netto over 1 jaar: -€ 269,50". openBackwards telde niet mee in de
     * leegtest. */
    const duur = card({ id: "d", product: "Dure Kaart", cashbackPct: sourced(1), fxFeePct: sourced(0), fee: fee(270, "jaar") });
    const r = rank([duur], [], 5000);
    expect(r.openBackwards).toHaveLength(1);
    expect(headline(r)).not.toContain("niets bekend");
  });

  it("belooft de kaartkosten alleen als er een kaart mét prijs in de lijst staat", () => {
    /* Van de 77 kaarten in de bundel heeft er geen enkele én cashback én een
     * prijs. De kop mag dan niet zeggen "en wat het kost om zo'n kaart te
     * openen", want dat komt er nooit. */
    const zonderPrijs = card({ id: "z", product: "Zonder Prijs", cashbackPct: sourced(3), fxFeePct: sourced(0) });
    const r = rank([zonderPrijs], [], 30000);
    const kop = headline(r);
    expect(kop).toContain("bij geen van deze kaarten kennen we een prijs");
    expect(kop).not.toContain("wat het openen kost");
  });
});
