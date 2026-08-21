/* Wat hier bewaakt wordt is niet "doet de functie iets", maar de twee manieren
 * waarop deze datalaag stil fout kan gaan:
 *
 *  1. Een land dat verdwijnt. De sweep vereenvoudigt vlakken tot ze in de bundel
 *     passen, en een te grove drempel gooit Malta of Monaco weg zonder één
 *     foutmelding. Vandaar de tellingen en de controle dat elk vlak nog een
 *     echte omtrek is.
 *  2. Een leemte die zich voordoet als een nul. Een valuta zonder koers, een
 *     land met twee valuta's, een eurozone-land: het zijn drie verschillende
 *     antwoorden en ze mogen geen van drieën als "0%" of "gratis" eindigen.
 */
import { describe, expect, it } from "vitest";
import {
  WORLD_MAP_BOUNDS,
  WORLD_MAP_SOURCES,
  WORLD_MAP_VIEWBOX,
  allCountries,
  conversionFor,
  countryById,
  countryLabel,
  currenciesFor,
  mapCountries,
  searchCountries,
} from "./worldMap.js";

describe("de gebundelde kaart", () => {
  it("is er echt en is niet leeg", () => {
    expect(allCountries().length).toBeGreaterThan(150);
    expect(mapCountries().length).toBeGreaterThan(150);
    expect(WORLD_MAP_SOURCES.geometry.url).toMatch(/^https:\/\//);
    expect(WORLD_MAP_SOURCES.currencies.url).toMatch(/^https:\/\//);
    expect(WORLD_MAP_SOURCES.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("heeft per land één ISO-code en geen dubbelen", () => {
    const ids = allCountries().map((c) => c.id);
    expect(ids.every((id) => /^[A-Z]{2}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("laat Antarctica weg — de enige bewuste gat in de tabel", () => {
    expect(countryById("AQ")).toBeNull();
  });

  it("tekent alleen paden die een browser kan lezen, binnen de viewBox", () => {
    for (const c of mapCountries()) {
      expect(c.path.startsWith("M"), `${c.id} begint niet met M`).toBe(true);
      expect(c.path.endsWith("Z"), `${c.id} eindigt niet met Z`).toBe(true);
      expect(/^[MZ0-9., -]+$/.test(c.path), `${c.id} heeft een raar teken in het pad`).toBe(true);
      // Minstens drie punten in het grootste vlak: minder is geen vlak maar een
      // streep, en dat is precies hoe een klein land ongemerkt verdwijnt.
      expect(c.path.split("Z")[0].split(" ").length, `${c.id} heeft een ontaard vlak`).toBeGreaterThanOrEqual(3);
    }
  });

  it("houdt elk punt binnen 1000 bij 500", () => {
    for (const c of mapCountries()) {
      for (const pair of c.path.replace(/[MZ]/g, " ").trim().split(/\s+/)) {
        const [x, y] = pair.split(",").map(Number);
        expect(Number.isFinite(x) && Number.isFinite(y), `${c.id}: "${pair}"`).toBe(true);
        expect(x >= 0 && x <= WORLD_MAP_VIEWBOX.width, `${c.id}: x=${x}`).toBe(true);
        expect(y >= 0 && y <= WORLD_MAP_VIEWBOX.height, `${c.id}: y=${y}`).toBe(true);
      }
    }
  });

  it("laat de bbox en de speld bij het vlak horen", () => {
    for (const c of mapCountries()) {
      const [x0, y0, x1, y1] = c.bbox!;
      const [px, py] = c.pin!;
      expect(x1).toBeGreaterThanOrEqual(x0);
      expect(y1).toBeGreaterThanOrEqual(y0);
      // De speld ligt in het grootste vlak, en dat vlak ligt in de bbox van
      // alles — met een marge van een afronding op één decimaal.
      expect(px).toBeGreaterThanOrEqual(x0 - 0.05);
      expect(px).toBeLessThanOrEqual(x1 + 0.05);
      expect(py).toBeGreaterThanOrEqual(y0 - 0.05);
      expect(py).toBeLessThanOrEqual(y1 + 0.05);
    }
  });

  it("zet Nederland waar Nederland ligt", () => {
    // 4,9° OL en 52,2° NB in een equirectangular doek van 1000 bij 500.
    const [px, py] = countryById("NL")!.pin!;
    expect(px).toBeCloseTo(((4.9 + 180) / 360) * 1000, -1);
    expect(py).toBeCloseTo(((90 - 52.2) / 180) * 500, -1);
    expect(WORLD_MAP_BOUNDS[3]).toBeLessThan(WORLD_MAP_VIEWBOX.height);
  });

  it("houdt de kleine landen die een grove kaart weggeneraliseert", () => {
    // Precies de landen waarvoor 110m te grof was: dit is de reden dat de sweep
    // op 50m draait, dus het hoort in een test en niet alleen in een comment.
    for (const id of ["SG", "MT", "MC", "BH", "LI", "VA", "SM", "AD"]) {
      expect(countryById(id)?.path, `${id} is van de kaart gevallen`).toBeTruthy();
    }
  });
});

describe("van land naar valuta", () => {
  it("noemt de eurozone een eigen antwoord en niet 'gratis'", () => {
    for (const id of ["NL", "DE", "FR"]) {
      const a = conversionFor(id);
      expect(a.kind, id).toBe("euro");
      expect(a.currencies.map((c) => c.code)).toEqual(["EUR"]);
    }
  });

  it("geeft voor Japan en de Verenigde Staten een valuta die wij kunnen prijzen", () => {
    const jp = conversionFor("JP");
    expect(jp.kind).toBe("priceable");
    expect(jp.kind === "priceable" && jp.currency.code).toBe("JPY");
    const us = conversionFor("US");
    expect(us.kind).toBe("priceable");
    expect(us.kind === "priceable" && us.currency.code).toBe("USD");
  });

  it("kiest bij twee valuta's niet stilletjes één van de twee", () => {
    const pa = conversionFor("PA");
    expect(pa.kind).toBe("choice");
    expect(pa.currencies.map((c) => c.code).sort()).toEqual(["PAB", "USD"]);
    // En het verschil dat het kiezen gevaarlijk maakt: van de één hebben wij een
    // koers, van de ander niet.
    expect(pa.currencies.find((c) => c.code === "USD")?.priceable).toBe(true);
    expect(pa.currencies.find((c) => c.code === "PAB")?.priceable).toBe(false);
  });

  it("zegt bij een valuta zonder koers dat WIJ hem niet hebben", () => {
    const ma = conversionFor("MA");
    expect(ma.kind).toBe("noRate");
    expect(ma.kind === "noRate" && ma.currency.code).toBe("MAD");
    expect(ma.currencies.every((c) => !c.priceable)).toBe(true);
  });

  it("geeft onbekend terug voor wat het niet kent, nooit een gegokt land", () => {
    for (const id of ["", "zz", "QQ", "nonsens", "NLD"]) {
      const a = conversionFor(id);
      expect(a.kind, id).toBe("unknown");
      expect(a.currencies).toEqual([]);
    }
    expect(countryById("QQ")).toBeNull();
    expect(currenciesFor("QQ")).toEqual([]);
  });

  it("beantwoordt ook landen die op deze schaal geen eigen vlak hebben", () => {
    const gi = countryById("GI");
    expect(gi?.path).toBeNull();
    expect(gi?.currencies.map((c) => c.code)).toEqual(["GIP"]);
    expect(conversionFor("GI").kind).toBe("noRate");
  });

  it("laat geen land zonder antwoord achter", () => {
    const kinds = new Set(allCountries().map((c) => conversionFor(c.id).kind));
    // Alle vier de antwoorden komen voor, en "unknown" komt bij een land dat in
    // de tabel staat NIET voor: de valutabron dekt ze alle 249. Zou dat ooit
    // veranderen, dan valt deze test om in plaats van dat er ergens een leeg
    // vakje verschijnt.
    expect([...kinds].sort()).toEqual(["choice", "euro", "noRate", "priceable"]);
    for (const c of allCountries()) {
      const a = conversionFor(c.id);
      expect(c.currencies.length, `${c.id} heeft geen valuta`).toBeGreaterThan(0);
      expect(a.currencies.map((x) => x.code)).toEqual(c.currencies.map((x) => x.code));
    }
  });

  it("noemt Montenegro een euroland zonder iets over lidmaatschap te beweren", () => {
    // ME en XK betalen in euro's zonder lid te zijn. Voor "moet ik wisselen" is
    // dat hetzelfde antwoord; de tabel doet geen uitspraak over de eurozone.
    expect(conversionFor("ME").kind).toBe("euro");
    expect(conversionFor("XK").kind).toBe("euro");
  });
});

describe("zoeken en benoemen", () => {
  it("noemt landen in het Nederlands", () => {
    expect(countryLabel("DE")).toBe("Duitsland");
    expect(countryLabel("NL")).toBe("Nederland");
    expect(countryLabel("QQ")).toBe("");
  });

  it("vindt een land op naam, op Engelse naam en op code", () => {
    expect(searchCountries("japan")[0]?.id).toBe("JP");
    expect(searchCountries("nederl")[0]?.id).toBe("NL");
    expect(searchCountries("south africa")[0]?.id).toBe("ZA");
    expect(searchCountries("US")[0]?.id).toBe("US");
  });

  it("trekt zich niets aan van accenten en hoofdletters", () => {
    expect(searchCountries("curacao")[0]?.id).toBe("CW");
    expect(searchCountries("CURAÇAO")[0]?.id).toBe("CW");
  });

  it("zet wat met de zoekterm begint boven wat hem alleen bevat", () => {
    const ids = searchCountries("ind", 10).map((c) => c.id);
    expect(ids).toContain("IN");
    expect(ids.indexOf("IN")).toBeLessThan(ids.indexOf("ID") === -1 ? 99 : ids.indexOf("ID") + 1);
  });

  it("geeft niets terug op een lege vraag, in plaats van alles", () => {
    expect(searchCountries("")).toEqual([]);
    expect(searchCountries("   ")).toEqual([]);
    expect(searchCountries("japan", 0)).toEqual([]);
  });
});
