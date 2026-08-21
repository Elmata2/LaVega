/* Wat hier bewaakt wordt is niet "doet de functie iets", maar de manieren waarop
 * deze datalaag stil fout kan gaan. Drie ervan bestonden al toen de kaart plat
 * was, de vierde is er met de bol bij gekomen:
 *
 *  1. Een land dat verdwijnt. De sweep vereenvoudigt vlakken tot ze in de bundel
 *     passen, en een te grove drempel gooit Malta of Monaco weg zonder één
 *     foutmelding. Vandaar de tellingen en de eis dat elk vlak nog een echte
 *     omtrek is.
 *  2. Een leemte die zich voordoet als een nul. Een valuta zonder koers, een land
 *     met twee valuta's, een euroland: drie verschillende antwoorden en ze mogen
 *     geen van drieën als "0%" of "gratis" eindigen.
 *  3. Coördinaten die omgekeerd staan. [52.2, 5.7] legt Nederland in de Indische
 *     Oceaan, en dat is een fout die er in een tabel met tienduizend getallen
 *     precies zo uitziet als goed.
 *  4. NIEUW MET DE BOL: het tekenen en het aanwijzen die uit elkaar lopen. De
 *     component vult met de even-odd-regel, `countryAtLonLat()` telt kruisingen
 *     met dezelfde regel, en de sweep zet de speld met een derde kopie van die
 *     regel. Wijkt er één af, dan klikt de gebruiker op vulling die volgens ons
 *     geen land is. Daar is één test voor die alle drie tegen elkaar aan legt: de
 *     speld van elk getekend land moet volgens de klikbepaling in dat land liggen.
 *
 * Deze tests lezen de GEBUNDELDE tabel en niet een verzinsel. Dat is opzet: de
 * data zijn hier het product, en een test met een eigen vlakje erin zou groen
 * blijven terwijl de sweep de halve wereld weglaat.
 */
import { describe, expect, it } from "vitest";
import {
  WORLD_LATLON_BOUNDS,
  WORLD_MAP_FILL_RULE,
  WORLD_MAP_SOURCES,
  allCountries,
  conversionFor,
  countryAtLonLat,
  countryById,
  countryFocus,
  countryLabel,
  currenciesFor,
  mapCountries,
  searchCountries,
} from "./worldMap.js";

const D2R = Math.PI / 180;

/** Dezelfde grove hoekafstand die de sweep gebruikt om lange stukken op te
 *  delen: een graad lengte krimpt met cos van de breedte, een graad breedte
 *  niet. Hij hoort hier ook zo te staan — met de platte afstand zou de test bij
 *  Groenland stukken van 20° lengtegraad goedkeuren die op de bol kort zijn, en
 *  bij de evenaar niets. */
function angularSpan([lon1, lat1]: readonly [number, number], [lon2, lat2]: readonly [number, number]): number {
  const k = Math.cos(((lat1 + lat2) / 2) * D2R);
  return Math.hypot((lon2 - lon1) * k, lat2 - lat1);
}

describe("de gebundelde bol", () => {
  it("is er echt en is niet leeg", () => {
    // Meer dan 200: 110m geeft 176 landen en kent Singapore niet. Zakt dit getal
    // onder de 200, dan draait de sweep op de verkeerde schaal.
    expect(allCountries().length).toBeGreaterThan(200);
    expect(mapCountries().length).toBeGreaterThan(200);
    expect(WORLD_MAP_SOURCES.geometry.url).toMatch(/^https:\/\//);
    expect(WORLD_MAP_SOURCES.currencies.url).toMatch(/^https:\/\//);
    expect(WORLD_MAP_SOURCES.priceable.url).toMatch(/^https:\/\//);
    expect(WORLD_MAP_SOURCES.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(WORLD_MAP_FILL_RULE).toBe("evenodd");
  });

  it("heeft per land één ISO-code en geen dubbelen", () => {
    const ids = allCountries().map((c) => c.id);
    expect(ids.every((id) => /^[A-Z]{2}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("laat Antarctica weg — het enige bewuste gat, en op een bol een open punt", () => {
    // Zie GEODATA.md: op de platte kaart was dit opruimen, op een bol kun je naar
    // de zuidpool draaien en is daar niets. De keuze staat bij de eigenaar; deze
    // test legt alleen vast wat er NU in de bundel zit, zodat het terugzetten
    // ervan een zichtbare wijziging is en geen sluipende.
    expect(countryById("AQ")).toBeNull();
    expect(WORLD_LATLON_BOUNDS[1]).toBeGreaterThan(-90);
  });

  it("bewaart geen geprojecteerde paden meer naast de graden", () => {
    // De platte kaart had per land een `path` in een viewBox van 1000×500. Die
    // moet weg zijn en niet ernaast staan: twee vormen van dezelfde grens lopen
    // uit elkaar zodra er één ververst wordt, en de bol kan met een pad niets.
    for (const c of allCountries()) {
      expect("path" in c, `${c.id} heeft nog een geprojecteerd pad`).toBe(false);
    }
  });
});

describe("de ringen zijn ruwe graden", () => {
  it("houdt elk punt binnen −180…180 en −90…90", () => {
    for (const c of mapCountries()) {
      for (const ring of c.rings) {
        for (const [lon, lat] of ring) {
          expect(Number.isFinite(lon) && Number.isFinite(lat), `${c.id}: ${lon},${lat}`).toBe(true);
          expect(lon >= -180 && lon <= 180, `${c.id}: lengtegraad ${lon}`).toBe(true);
          expect(lat >= -90 && lat <= 90, `${c.id}: breedtegraad ${lat}`).toBe(true);
        }
      }
    }
  });

  it("zet lengtegraad vóór breedtegraad, zoals GeoJSON", () => {
    // De omgekeerde volgorde is de klassieke fout en hij valt in een tabel niet
    // op. Nederland is het bewijs uit het ongerijmde: 4,9 en 52,2 kunnen niet
    // verwisseld zijn, want 52,2 is geen breedtegraad van Nederland en 4,9 is
    // geen lengtegraad van iets in de buurt.
    const nl = countryById("NL")!;
    expect(nl.pin![0]).toBeCloseTo(5.6, 0);
    expect(nl.pin![1]).toBeCloseTo(52.4, 0);
    // En over de hele tabel: alle breedtegraden liggen binnen het bereik van een
    // breedtegraad. Stonden ze omgekeerd, dan zat er in de tweede kolom een
    // getal boven 90 (bijna elk land heeft ergens een lengtegraad boven 90).
    const lats = mapCountries().flatMap((c) => c.rings.flatMap((r) => r.map((p) => p[1])));
    expect(Math.max(...lats.map(Math.abs))).toBeLessThanOrEqual(90);
  });

  it("laat elke ring een vlak zijn en niet een streep of een dubbel punt", () => {
    for (const c of mapCountries()) {
      expect(c.rings.length, `${c.id} heeft geen enkele ring`).toBeGreaterThan(0);
      for (const [i, ring] of c.rings.entries()) {
        expect(ring.length, `${c.id} ring ${i} is geen vlak`).toBeGreaterThanOrEqual(3);
        // Impliciet gesloten: het eerste punt staat er niet nog een keer aan het
        // eind. Zou dat er wel staan, dan tekent de component een segment van nul
        // lengte en rekent de klikbepaling een kruising dubbel.
        expect(ring[0], `${c.id} ring ${i} is expliciet gesloten`).not.toEqual(ring[ring.length - 1]);
        for (let k = 1; k < ring.length; k++) {
          expect(ring[k], `${c.id} ring ${i} heeft een dubbel punt op ${k}`).not.toEqual(ring[k - 1]);
        }
      }
    }
  });

  it("houdt elk stuk grens onder 5° hoekafstand", () => {
    // Dit is de bol-eis. Een lijn tussen twee geprojecteerde punten is de koorde
    // dwars door de bol; bij de 49e breedtegraad tussen de VS en Canada is dat
    // 0,86° (±95 km) door Canada heen. De sweep deelt daarom stukken boven 5° op.
    // Met een marge voor het afronden op één decimaal (±0,07° per punt).
    let worst = 0;
    let where = "";
    for (const c of mapCountries()) {
      for (const ring of c.rings) {
        for (let i = 0; i < ring.length; i++) {
          const s = angularSpan(ring[i], ring[(i + 1) % ring.length]);
          if (s > worst) {
            worst = s;
            where = `${c.id} ${ring[i]} → ${ring[(i + 1) % ring.length]}`;
          }
        }
      }
    }
    expect(worst, `langste stuk: ${where}`).toBeLessThanOrEqual(5.2);
  });

  it("laat bbox en speld bij het GROOTSTE vlak horen, niet bij alles", () => {
    // De omhullende van álle ringen van Rusland loopt van −180° tot 180°, want de
    // bron knipt daar. Die is nutteloos om een bol naartoe te draaien, dus hoort
    // `bbox` van rings[0] te zijn — en dat is te controleren door hem opnieuw uit
    // te rekenen.
    for (const c of mapCountries()) {
      const main = c.rings[0];
      const [lonMin, latMin, lonMax, latMax] = c.bbox;
      expect(Math.min(...main.map((p) => p[0])), `${c.id} lonMin`).toBeCloseTo(lonMin, 6);
      expect(Math.min(...main.map((p) => p[1])), `${c.id} latMin`).toBeCloseTo(latMin, 6);
      expect(Math.max(...main.map((p) => p[0])), `${c.id} lonMax`).toBeCloseTo(lonMax, 6);
      expect(Math.max(...main.map((p) => p[1])), `${c.id} latMax`).toBeCloseTo(latMax, 6);
      const [plon, plat] = c.pin;
      expect(plon >= lonMin && plon <= lonMax, `${c.id} speld buiten de bbox`).toBe(true);
      expect(plat >= latMin && plat <= latMax, `${c.id} speld buiten de bbox`).toBe(true);
    }
    // Rusland is het geval waar het om gaat: zijn bbox mag niet de hele wereld
    // zijn, ook al liggen er ringen aan beide kanten van de datumgrens.
    const ru = countryById("RU")!;
    expect(ru.bbox![2] - ru.bbox![0]).toBeLessThan(200);
    expect(Math.min(...ru.rings!.flat().map((p) => p[0]))).toBeLessThan(-100);
  });

  it("noemt een omhullende die klopt met wat er getekend wordt", () => {
    const pts = mapCountries().flatMap((c) => c.rings.flat());
    const [lonMin, latMin, lonMax, latMax] = WORLD_LATLON_BOUNDS;
    // Afgerond op één decimaal in de sweep, dus een halve stap marge.
    expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(lonMin, 1);
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(latMin, 1);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(lonMax, 1);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(latMax, 1);
  });

  it("houdt de kleine landen die een grove kaart weggeneraliseert", () => {
    // Precies de landen waarvoor 110m te grof was: dit is de reden dat de sweep
    // op 50m draait en dat kleine landen een fijner raster krijgen, dus het hoort
    // in een test en niet alleen in een comment.
    for (const id of ["SG", "MT", "MC", "BH", "LI", "VA", "SM", "AD"]) {
      const c = countryById(id);
      expect(c?.rings, `${id} is van de bol gevallen`).toBeTruthy();
      expect(c!.rings!.length, `${id} heeft geen vlak`).toBeGreaterThan(0);
    }
  });

  it("geeft elk getekend land een speld en een omhullende", () => {
    // `mapCountries()` belooft de component dat `rings`, `bbox` én `pin` gevuld
    // zijn, maar filtert alleen op `rings`. Die belofte is dus een aanname over
    // de sweep en die hoort gemeten te worden.
    for (const c of mapCountries()) {
      expect(c.bbox, `${c.id} zonder bbox`).not.toBeNull();
      expect(c.pin, `${c.id} zonder speld`).not.toBeNull();
    }
  });
});

describe("van een punt op de bol naar een land", () => {
  it("wijst de plekken aan die iemand zou aanwijzen", () => {
    expect(countryAtLonLat(4.9, 52.37)?.id).toBe("NL");
    expect(countryAtLonLat(139.7, 35.68)?.id).toBe("JP");
    expect(countryAtLonLat(103.82, 1.36)?.id).toBe("SG");
    // Een los eiland ver van het hoofdvlak: dit is de test die omvalt als de
    // klikbepaling de bbox van rings[0] als voorfilter zou gebruiken.
    expect(countryAtLonLat(-155.5, 19.6)?.id).toBe("US");
  });

  it("zegt 'geen land' waar geen land is, in plaats van het dichtstbijzijnde te gokken", () => {
    expect(countryAtLonLat(-30, 0)).toBeNull();
    expect(countryAtLonLat(3.5, 54)).toBeNull();
    // De zuidpool: hier hoort Antarctica, en daar staat nu niets. Dat is precies
    // het open punt uit GEODATA.md en het antwoord is eerlijk null.
    expect(countryAtLonLat(0, -89)).toBeNull();
  });

  it("laat een enclave voorgaan op het land eromheen", () => {
    // Vaticaanstad en San Marino zijn te klein om als gat in Italië te blijven
    // staan (de sweep laat vlakken onder ±400 km² weg), dus de vlakken
    // OVERLAPPEN echt. Wie daar klikt bedoelt de enclave.
    expect(countryAtLonLat(12.435, 41.902)?.id).toBe("VA");
    expect(countryAtLonLat(12.461, 43.936)?.id).toBe("SM");
    expect(countryAtLonLat(7.408, 43.755)?.id).toBe("MC");
    // En het land eromheen blijft gewoon het land eromheen.
    expect(countryAtLonLat(12.5, 41.8)?.id).toBe("IT");
    expect(countryAtLonLat(2.35, 48.85)?.id).toBe("FR");
  });

  it("houdt een gat een gat", () => {
    // Lesotho is groot genoeg om als ring in Zuid-Afrika te blijven staan. Alleen
    // met de even-odd-regel wordt dat een gat; met de standaard nonzero-regel
    // vult het zich en klikt Lesotho op Zuid-Afrika.
    expect(countryAtLonLat(28.4, -29.5)?.id).toBe("LS");
    expect(countryAtLonLat(24, -29)?.id).toBe("ZA");
  });

  it("rekent een lengtegraad die bij het slepen doorgelopen is terug", () => {
    expect(countryAtLonLat(139.7 + 360, 35.68)?.id).toBe("JP");
    expect(countryAtLonLat(139.7 - 360, 35.68)?.id).toBe("JP");
    expect(countryAtLonLat(4.9 + 720, 52.37)?.id).toBe("NL");
    // Aan de datumgrens zelf: Tsjoekotka ligt net binnen de 180 en moet gewoon
    // Rusland geven, ook al is dat vlak daar afgeknipt.
    expect(countryAtLonLat(179.5, 71.2)?.id).toBe("RU");
  });

  it("geeft niets terug op wat geen punt op een bol is", () => {
    for (const [lon, lat] of [
      [Number.NaN, 52],
      [4.9, Number.NaN],
      [Number.POSITIVE_INFINITY, 52],
      [4.9, 91],
      [4.9, -91],
    ] as [number, number][]) {
      expect(countryAtLonLat(lon, lat), `${lon},${lat}`).toBeNull();
    }
  });

  it("legt tekenen, aanwijzen en spelden op één regel", () => {
    // De drie kopieën van de even-odd-regel (de sweep die de speld plaatst, deze
    // klikbepaling, en de vulregel van de component) moeten hetzelfde zeggen. Als
    // de speld van een land niet in dat land ligt volgens de klikbepaling, dan
    // lopen ze uit elkaar en klikt de gebruiker ergens anders dan hij ziet.
    const mismatch: string[] = [];
    for (const c of mapCountries()) {
      const hit = countryAtLonLat(c.pin[0], c.pin[1]);
      if (hit?.id !== c.id) mismatch.push(`${c.id} → ${hit?.id ?? "niets"}`);
    }
    expect(mismatch).toEqual([]);
  });
});

describe("waar de bol naartoe draait", () => {
  it("geeft een middelpunt in graden dat in de omhullende van het land ligt", () => {
    for (const c of mapCountries()) {
      const f = countryFocus(c.id)!;
      expect(f.from, c.id).toBe("bbox");
      expect(f.center[0] >= c.bbox[0] && f.center[0] <= c.bbox[2], `${c.id} lengtegraad`).toBe(true);
      expect(f.center[1] >= c.bbox[1] && f.center[1] <= c.bbox[3], `${c.id} breedtegraad`).toBe(true);
      expect(f.span![0]).toBeCloseTo(c.bbox[2] - c.bbox[0], 1);
      expect(f.span![1]).toBeCloseTo(c.bbox[3] - c.bbox[1], 1);
    }
  });

  it("draait naar het midden van het land en niet naar het midden van de wereld", () => {
    // Rusland is het geval dat het onderscheid maakt: de omhullende van álle
    // ringen loopt van −180° tot 180°, dus zonder de keuze voor rings[0] zou de
    // bol naar 0° draaien — de Golf van Guinee — bij een zoekopdracht "Rusland".
    const ru = countryFocus("RU")!;
    expect(ru.center[0]).toBeGreaterThan(60);
    expect(ru.center[1]).toBeGreaterThan(40);
    const nl = countryFocus("NL")!;
    expect(nl.center[0]).toBeCloseTo(5.3, 1);
    expect(nl.center[1]).toBeCloseTo(52.1, 1);
  });

  it("noemt de omvang zodat een speldenkop niet als vlak getekend hoeft te worden", () => {
    // Singapore is 0,35° breed: op een bol van 640 px ruim één pixel. De
    // component mag daarop besluiten een punt te tekenen; dat kan alleen als de
    // omvang erbij staat.
    const sg = countryFocus("SG")!;
    expect(sg.span![0]).toBeLessThan(1);
    expect(countryFocus("RU")!.span![0]).toBeGreaterThan(100);
  });

  it("draait ook naar een land dat wij niet tekenen, en zegt dat het dat doet", () => {
    // Gibraltar heeft op deze schaal geen eigen vlak, maar wel een labelpunt. De
    // bol kan er dus naartoe — en `from: "pin"` is het signaal dat de UI hoort te
    // gebruiken om te zeggen dat er niets te zien zal zijn.
    const gi = countryFocus("GI")!;
    expect(gi.from).toBe("pin");
    expect(gi.span).toBeNull();
    expect(gi.center[0]).toBeCloseTo(-5.4, 0);
    expect(gi.center[1]).toBeCloseTo(36.1, 0);
    expect(countryById("GI")!.rings).toBeNull();
  });

  it("verzint geen middelpunt voor een land waarvan wij de plek niet kennen", () => {
    // Geen [0, 0]: dat is een plek in de Golf van Guinee, en een bol die
    // daarheen draait beweert dat Frans-Guyana daar ligt. Null is het antwoord,
    // en de UI hoort te melden dat wij de plek niet hebben.
    const zonder = allCountries().filter((c) => countryFocus(c.id) === null);
    expect(zonder.length).toBeGreaterThan(0);
    for (const c of zonder) {
      expect(c.rings, `${c.id} heeft wel ringen`).toBeNull();
      expect(c.pin, `${c.id} heeft wel een speld`).toBeNull();
      // En ze houden hun valuta-antwoord: niet weten waar iets ligt is geen
      // reden om ook niet te weten waarmee er betaald wordt.
      expect(c.currencies.length, `${c.id} zonder valuta`).toBeGreaterThan(0);
    }
    expect(countryFocus("QQ")).toBeNull();
    expect(countryFocus("")).toBeNull();
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
    expect(gi?.rings).toBeNull();
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

  it("vindt Singapore zonder dat er gedraaid hoeft te worden, en weet waar het is", () => {
    // Dit is waarom er een zoekveld is: Singapore is op een bol van een paar
    // honderd pixels één pixel, en je vindt het niet door te slepen. Zoeken moet
    // dus in één stap bij een middelpunt uitkomen waar de bol naartoe kan.
    const hit = searchCountries("singapore")[0];
    expect(hit?.id).toBe("SG");
    const f = countryFocus(hit!.id)!;
    expect(f.center[0]).toBeCloseTo(103.8, 0);
    expect(f.center[1]).toBeCloseTo(1.4, 0);
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
