/* De horizonregel. Deze tests bestaan omdat de fout die ze tegenhouden een
 * factor twaalf is en op het scherm nergens aan te zien. */

import { describe, it, expect } from "vitest";
import { minimumCharge, MINIMUM_PERIODS, DEFAULT_HORIZON_MONTHS } from "./horizon.js";
import type { CardFee } from "./types.js";

function fee(value: number, period: "maand" | "jaar"): CardFee {
  return { value, period, sourceUrl: "https://voorbeeld.nl/tarieven", checkedAt: "2026-01-15", conditions: null };
}

describe("de ondergrens", () => {
  it("is één periode, en staat als constante zodat de test hem kan aanwijzen", () => {
    expect(MINIMUM_PERIODS).toBe(1);
    expect(DEFAULT_HORIZON_MONTHS).toBe(1);
  });

  it("een maandkaart kost minstens één maand, ook bij een horizon van nul", () => {
    expect(minimumCharge(fee(2.55, "maand"), 0)).toEqual({ cents: 255, periods: 1, label: "1 maand" });
  });

  it("de periode staat in het label, want het scherm moet hem kunnen noemen", () => {
    expect(minimumCharge(fee(2.55, "maand"), 3).label).toBe("3 maanden");
    expect(minimumCharge(fee(270, "jaar"), 24).label).toBe("2 jaar");
  });
});

describe("een jaarprijs is geen maandprijs", () => {
  it("een jaarkaart kost een heel jaar, niet de jaarprijs gedeeld door twaalf", () => {
    /* Amex Business Gold, € 270 per jaar. € 270 / 12 = € 22,50 en dat bedrag
     * betaal je nergens: je kunt de kaart niet voor één maand openen. Een kost
     * te laag inschatten maakt van een verlies een aanbeveling, en dat is de
     * enige fout in dit bestand die echt geld kost. */
    expect(minimumCharge(fee(270, "jaar"), 1)).toEqual({ cents: 27000, periods: 1, label: "1 jaar" });
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
    expect(minimumCharge(fee(2.55, "maand"), 1).cents).toBe(255);
    expect(minimumCharge(fee(4.45, "maand"), 3).cents).toBe(1335);
    expect(Number.isInteger(minimumCharge(fee(16.99, "maand"), 7).cents)).toBe(true);
  });
});
