/* Geldnotatie, en vooral de twee tekens die je NIET ziet staan.
 *
 * Dit bestand bestaat door een testmelding die letterlijk luidde:
 *   expected 'Kost € 14,00 aan koersopslag.' to be 'Kost € 14,00 aan koersopslag.'
 * Twee strings die identiek ogen en het niet zijn. Het verschil zat in de spatie
 * na het euroteken: Intl zet er in nl-NL een HARDE spatie (U+00A0) neer, de test
 * had een gewone (U+0020). Zulke fouten kosten een half uur en zijn onzichtbaar
 * in een diff, dus staan de codepunten hier uitgeschreven in plaats van dat het
 * bij een string blijft die je moet vertrouwen. */

import { describe, it, expect } from "vitest";
import { euro, pct, points, eurosToCents, pctOfCents, dateNL, getal } from "./money.js";

/** De codepunten als leesbare hex, zodat een melding het VERSCHIL laat zien en
 *  niet twee keer dezelfde regel. */
function codepunten(s: string): string {
  return [...s].map((c) => c.codePointAt(0)!.toString(16).padStart(4, "0")).join(" ");
}

describe("de spatie na het euroteken", () => {
  it("is een harde spatie, want een bedrag mag niet over twee regels breken", () => {
    expect(codepunten(euro(1400))).toBe("20ac 00a0 0031 0034 002c 0030 0030");
  });

  it("staat er ook bij een negatief bedrag, met het minteken ervóór", () => {
    /* Niet "€ -2,00" zoals Intl het schrijft: dan zit het minteken op de derde
     * positie, achter het teken en de spatie, terwijl het oog na "€ " al besloten
     * heeft dat er een bedrag komt. In "Netto over 1 maand: … — dat is achteruit"
     * draagt dat ene teken de hele uitkomst. */
    expect(codepunten(euro(-200))).toBe("002d 20ac 00a0 0032 002c 0030 0030");
  });

  it("geeft -0 geen minteken, want dat is geen verlies", () => {
    expect(euro(-0)).toBe(euro(0));
  });
});

describe("hele centen, want de uitkomsten worden van elkaar afgetrokken", () => {
  it("2,55 euro is 255 centen en niet 254,99999", () => {
    expect(eurosToCents(2.55)).toBe(255);
  });

  it("rondt een percentage op hele centen af in plaats van af te kappen", () => {
    /* 2,5% van € 299,99 is 749,975 cent. Naar 750, niet naar 749: een halve cent
     * per rij weggooien maakt de ranglijst niet eerlijker. */
    expect(pctOfCents(29999, 2.5)).toBe(750);
  });
});

describe("de rest van de notatie", () => {
  it("schrijft een uitgesproken nul als 0% en niet als 0,00%", () => {
    /* 0,00% leest als een meting met precisie; 0% leest als een uitspraak. */
    expect(pct(0)).toBe("0%");
    expect(pct(1.4)).toBe("1,4%");
  });

  it("rondt punten naar beneden, want een halve mijl komt er niet", () => {
    expect(points(19999, 1)).toBe(199);
  });

  it("schrijft een gewoon getal Nederlands, met een duizendteken", () => {
    /* Hier zat de bevinding die twee ronden overleefde: het optiescherm zette
     * `${c.pointsPerEuro.value}` neer en dat gaf "0.5 punt(en) per euro" — een
     * Engelse punt op een Nederlands scherm, niet te onderscheiden van 0,5 of
     * 05. Het bedrag ernaast liep al door `euro`; dit veld was vergeten. */
    expect(getal(0.5)).toBe("0,5");
    expect(getal(1.5)).toBe("1,5");
    expect(getal(42000, 0)).toBe("42.000");
    expect(getal(1)).toBe("1");
  });

  it("geeft een onleesbare datum onveranderd door in plaats van hem weg te laten", () => {
    /* Liever "2026-13" op het scherm dan een lege plek waar de gebruiker een
     * verse meting invult. */
    expect(dateNL("2026-06-15")).toBe("15 juni 2026");
    expect(dateNL("2026-13")).toBe("2026-13");
  });
});
