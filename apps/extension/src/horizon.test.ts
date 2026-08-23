/* De horizonregel. Deze tests bestaan omdat de fout die ze tegenhouden een
 * factor twaalf is en op het scherm nergens aan te zien. */

import { describe, it, expect } from "vitest";
import { minimumCharge, comparableHorizonMonths, MINIMUM_PERIODS, DEFAULT_HORIZON_MONTHS } from "./horizon.js";
import type { CardFee } from "./types.js";

function fee(value: number, period: "maand" | "jaar"): CardFee {
  return { value, period, sourceUrl: "https://voorbeeld.nl/tarieven", checkedAt: "2026-01-15", conditions: null };
}

describe("de ondergrens", () => {
  it("is één periode, en staat als constante zodat de test hem kan aanwijzen", () => {
    expect(MINIMUM_PERIODS).toBe(1);
  });

  it("de vergeleken periode is een heel jaar, want daar passen allebei de tariefvormen in", () => {
    expect(DEFAULT_HORIZON_MONTHS).toBe(12);
    expect(minimumCharge(fee(2.55, "maand")).spanLabel).toBe("1 jaar");
    expect(minimumCharge(fee(270, "jaar")).spanLabel).toBe("1 jaar");
  });

  it("een maandkaart kost minstens één maand, ook bij een horizon van nul", () => {
    /* Nul maanden bestaat niet: er wordt naar boven afgerond op hele jaren, dus
     * ook hier betaal je een heel jaar en niet één termijn. */
    expect(minimumCharge(fee(2.55, "maand"), 0)).toEqual({
      cents: 3060, periods: 12, label: "12 maanden", spanMonths: 12, spanLabel: "1 jaar",
    });
  });

  it("de termijnen staan in het label en de vergeleken periode in spanLabel", () => {
    /* Twee verschillende dingen, en het scherm noemt ze allebei: HOE je betaalt
     * (twaalf maandtermijnen) en WAAROVER gerekend is (één jaar). */
    const maand = minimumCharge(fee(9, "maand"));
    expect(maand.label).toBe("12 maanden");
    expect(maand.spanLabel).toBe("1 jaar");
    const jaar = minimumCharge(fee(60, "jaar"), 24);
    expect(jaar.label).toBe("2 jaar");
    expect(jaar.spanLabel).toBe("2 jaar");
  });
});

describe("dezelfde eenheid voor élke kaart", () => {
  it("de gevraagde horizon wordt naar boven afgerond op hele jaren", () => {
    /* Zonder deze afronding krijgt een maandkaart bij een horizon van zes
     * maanden een half jaar en een jaarkaart een heel jaar, en dan vergelijkt de
     * sortering in rank.ts weer twee verschillende eenheden. */
    expect(comparableHorizonMonths(1)).toBe(12);
    expect(comparableHorizonMonths(6)).toBe(12);
    expect(comparableHorizonMonths(12)).toBe(12);
    expect(comparableHorizonMonths(13)).toBe(24);
  });

  it("spanMonths is gelijk bij een maandkaart en een jaarkaart, bij elke horizon", () => {
    for (const h of [1, 5, 12, 13, 30]) {
      expect(minimumCharge(fee(9, "maand"), h).spanMonths).toBe(minimumCharge(fee(60, "jaar"), h).spanMonths);
    }
  });

  it("de maandkaart van € 9 is over een jaar duurder dan de jaarkaart van € 60", () => {
    /* Dit is de fout uit de review, in getallen. Met een horizon van één maand
     * kostte de maandkaart € 9 en de jaarkaart € 60, en dan stond de duurste
     * kaart bovenaan in een lijst waarvan de volgorde "beter" betekent. */
    expect(minimumCharge(fee(9, "maand")).cents).toBe(10800);
    expect(minimumCharge(fee(60, "jaar")).cents).toBe(6000);
  });
});

describe("een jaarprijs is geen maandprijs", () => {
  it("een jaarkaart kost een heel jaar, niet de jaarprijs gedeeld door twaalf", () => {
    /* Amex Business Gold, € 270 per jaar. € 270 / 12 = € 22,50 en dat bedrag
     * betaal je nergens: je kunt de kaart niet voor één maand openen. Een kost
     * te laag inschatten maakt van een verlies een aanbeveling, en dat is de
     * enige fout in dit bestand die echt geld kost. */
    expect(minimumCharge(fee(270, "jaar"), 1)).toEqual({
      cents: 27000, periods: 1, label: "1 jaar", spanMonths: 12, spanLabel: "1 jaar",
    });
    expect(minimumCharge(fee(270, "jaar"), 1).cents).not.toBe(2250);
  });

  it("elf maanden op een jaarkaart is één jaar, dertien maanden is twee", () => {
    expect(minimumCharge(fee(270, "jaar"), 11).periods).toBe(1);
    expect(minimumCharge(fee(270, "jaar"), 12).periods).toBe(1);
    expect(minimumCharge(fee(270, "jaar"), 13).periods).toBe(2);
  });

  it("dezelfde prijs, andere periode, twaalf keer zoveel geld", () => {
    const perMaand = minimumCharge(fee(37.5, "maand"), 12).cents;
    const perJaar = minimumCharge(fee(37.5, "jaar"), 12).cents;
    expect(perMaand).toBe(45000);
    expect(perJaar).toBe(3750);
    expect(perMaand).toBe(perJaar * 12);
  });
});

describe("centen, niet floats", () => {
  it("€ 2,55 is 255 centen en niet 254,99999", () => {
    expect(minimumCharge(fee(2.55, "maand"), 1).cents).toBe(255 * 12);
    expect(minimumCharge(fee(4.45, "maand"), 3).cents).toBe(445 * 12);
    expect(Number.isInteger(minimumCharge(fee(16.99, "maand"), 7).cents)).toBe(true);
  });
});
