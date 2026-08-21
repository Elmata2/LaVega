/* De zinnen. De belangrijkste test in dit bestand is niet dat er iets staat
 * maar dat er iets NIET staat. */

import { describe, it, expect } from "vitest";
import { rankCheckout, type Ranking } from "./rank.js";
import { rowLine, headline, unknownLine, sourceLine } from "./lines.js";
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
    const r = rank([bekend], [], 30000);
    const regel = rowLine(r.openWorthIt[0]!);
    expect(regel).toContain("Netto over 1 maand");
    expect(regel).toContain("€ 11,00"); // € 12,00 opbrengst min € 1,00 kaartkosten
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
    expect(regel).toContain("Netto over 1 maand: -€ 2,00");
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
    expect(headline(r)).toContain("wat het kost om zo'n kaart te openen");
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
