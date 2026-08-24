// @vitest-environment jsdom
/* DE ING WINKEL, tegen OPGESLAGEN HTML.
 *
 * ── WAT DEZE SUITE NIET BEWIJST, en dat hoort bovenaan te staan ─────────────
 *
 * Dat de lezer in de ECHTE ING Winkel iets vindt. Die is bij het bouwen nooit
 * gezien — niet ingelogd (daar is zijn account voor nodig) en ook niet uitgelogd
 * (www.ing.nl weigert verzoeken van deze machine na een geslaagde TLS-verbinding;
 * dat is botbeheer en het is niet omzeild). Alle fixtures heten daarom
 * `kunstmatig-` en zijn met de hand gemaakt. Dat is een ZWAKKERE basis dan bij
 * Amex, waar de uitgelogde schil tenminste gemeten kon worden.
 *
 * Wat er wél op rust is de VORM van de gegevens, en die is niet verzonnen maar
 * gelezen in de voorwaarden van ING zelf (assets.ing.com, 24 augustus 2026,
 * HTTP 200, 127.289 bytes): een artikel met een aantal punten, meestal een bij
 * te betalen bedrag, en een einddatum met "op=op".
 *
 * Wat deze suite WEL bewijst, en dat is het deel dat een gok kan afvangen:
 *   - dat een puntenprijs iets anders is dan een korting, en dat de zin dat ook
 *     zegt in plaats van "je hebt hier korting";
 *   - dat een ONTBREKEND bijbetaalbedrag niet als nul wordt gepresenteerd;
 *   - dat zijn PUNTENSALDO er niet uit komt, ook niet als het in dezelfde vorm
 *     op dezelfde kaart staat als een prijs;
 *   - dat elke manier waarop de lezing mislukt de juiste oorzaak noemt;
 *   - dat er bij twijfel niets aan een winkel gekoppeld wordt.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ING_BRON,
  ING_MATCH,
  collectIngWinkel,
  ingUrlIsWinkel,
  leesIngAanbod,
} from "./ing.js";
import { AMEX_BRON } from "./amex.js";
import { aanbodVoorWinkel, leesPuntenprijs, type Aanbieding } from "./aanbod-kern.js";
import { aanbodBlok, aanbodLijst } from "./panel.js";
import { aanbodRegel, aanbodStrook, aanbodToestandRegel } from "./lines.js";
import { _schoonAanbod } from "./store.js";
import { padIsSpecifiek } from "./sites.js";
import { BRONNEN } from "./bronnen.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const NU = "2026-08-24";

function lees(naam: string, asOf = NU) {
  const html = readFileSync(join(FIXTURES, naam), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  return leesIngAanbod(collectIngWinkel(doc), asOf);
}

function artikel(p: Partial<Aanbieding> & { winkel: string }): Aanbieding {
  return {
    prijsTekst: "1.250 punten",
    prijs: { punten: 1250, bij: null },
    tot: null,
    totRuw: "",
    domein: null,
    gelezenOp: NU,
    ...p,
  };
}

/* ─────────────────────── waar de extensie mag kijken ─────────────────────── */

describe("het adres waar dit op rust", () => {
  it("wijst een PAD aan en niet een heel domein", () => {
    /* Zonder deze eis zou `https://www.ing.nl/*` erin kunnen glijden, en dan
     * mag de extensie zijn hele bank lezen terwijl er onder het vinkje staat dat
     * het om de winkel gaat. copy-static.mjs weigert zo'n patroon ook. */
    expect(padIsSpecifiek(ING_MATCH)).toBe(true);
  });

  it("laat alleen de winkel door, en niets anders op ing.nl", () => {
    expect(ingUrlIsWinkel("https://www.ing.nl/punten")).toBe(true);
    expect(ingUrlIsWinkel("https://www.ing.nl/punten/artikel/jbl-flip-6")).toBe(true);

    /* Dit is waar de belofte "je saldo en je transacties vallen erbuiten" wordt
     * waargemaakt: in code, en niet in de tekst onder het vinkje. */
    expect(ingUrlIsWinkel("https://www.ing.nl/particulier/betalen")).toBe(false);
    expect(ingUrlIsWinkel("https://mijn.ing.nl/particulier/overzicht")).toBe(false);
    expect(ingUrlIsWinkel("https://www.ing.nl")).toBe(false);
    expect(ingUrlIsWinkel("http://www.ing.nl/punten")).toBe(false);
    expect(ingUrlIsWinkel("https://www.ing.nl:8443/punten")).toBe(false);
    /* Een origin heeft geen pad en mag dus nooit doorkomen. */
    expect(ingUrlIsWinkel("https://www.ing.nl/")).toBe(false);
  });

  it("staat los van het adres van Amex", () => {
    expect(ingUrlIsWinkel("https://global.americanexpress.com/offers/eligible")).toBe(false);
    expect(ING_MATCH).not.toBe(AMEX_BRON.match);
  });
});

/* ─────────────────────── de nagebouwde ING Winkel ────────────────────────── */

describe("de nagebouwde ING Winkel", () => {
  it("leest de artikelen met een puntenprijs en laat de rest liggen", () => {
    const { lezing, aanbiedingen } = lees("kunstmatig-ing-winkel.html");
    expect(lezing.uitkomst).toBe("gelezen");

    const namen = aanbiedingen.map((a) => a.winkel);
    expect(namen).toContain("JBL Flip 6 bluetoothspeaker");
    expect(namen).toContain("Cadeaubon boekhandel");
    expect(namen).toContain("Philips Airfryer XXL");
    expect(namen).toContain("JBL Tune 770NC koptelefoon");

    /* De tuinstoel staat er in euro's en zonder punten. Dat is geen artikel dat
     * je met punten koopt, dus er is geen puntenprijs en hij hoort er niet in —
     * hem tonen zou een prijs suggereren die er niet staat. */
    expect(namen).not.toContain("Tuinstoel van hout");
  });

  it("leest het aantal punten EN het bij te betalen bedrag", () => {
    const { aanbiedingen } = lees("kunstmatig-ing-winkel.html");
    const jbl = aanbiedingen.find((a) => a.winkel.startsWith("JBL Flip"))!;
    expect(jbl.prijs).toEqual({ punten: 1250, bij: "€ 19,95" });
  });

  it("zegt bij een ontbrekend bijbetaalbedrag dat het er niet stond, en niet dat het nul is", () => {
    /* DE KERN VAN HUISREGEL 1, in deze bron. ING zegt zelf: "Je betaalt de
     * meeste producten met Punten, plus een bij te betalen bedrag. Soms wissel
     * je alleen Punten in, zoals bij kortingsbonnen." Lazen wij geen bedrag, dan
     * weten we niet welke van die twee het is. Het weglaten van die zin zou het
     * artikel laten lezen als "alleen deze punten" — goedkoper dan het misschien
     * is. */
    const { aanbiedingen } = lees("kunstmatig-ing-winkel.html");
    const bon = aanbiedingen.find((a) => a.winkel === "Cadeaubon boekhandel")!;
    expect(bon.prijs).toEqual({ punten: 2500, bij: null });

    const regel = aanbodRegel(bon, NU, ING_BRON);
    expect(regel).toContain("2.500 punten");
    expect(regel).toContain("stond er niet bij");
    expect(regel).not.toMatch(/gratis|geen bijbetaling|€ 0/i);
  });

  it("weigert de dubbelzinnige einddatum en bewaart wat er stond", () => {
    /* 05/03/2026 is 5 maart of 3 mei, en dat verschil is twee maanden. Op een
     * pagina waarvan de datumopmaak niet gemeten is, wordt er dan niet gekozen. */
    const { aanbiedingen } = lees("kunstmatig-ing-winkel.html");
    const airfryer = aanbiedingen.find((a) => a.winkel === "Philips Airfryer XXL")!;
    expect(airfryer.tot).toBe(null);
    expect(airfryer.totRuw).toContain("05/03/2026");
    expect(aanbodRegel(airfryer, NU, ING_BRON)).toContain("niet eenduidig");
  });

  it("neemt van die pagina NIETS mee behalve artikelnaam, prijs en einddatum", () => {
    const html = readFileSync(join(FIXTURES, "kunstmatig-ing-winkel.html"), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ruw = collectIngWinkel(doc);

    /* De vorm is de grens. Verandert deze lijst, dan verandert de belofte onder
     * de schakelaar. */
    for (const k of ruw.kandidaten) {
      expect(Object.keys(k).sort()).toEqual(["hosts", "prijsTekst", "totRuw", "winkel"]);
    }

    const alles = JSON.stringify(ruw);
    expect(alles).not.toContain("Alexander");
    expect(alles).not.toContain("Steunenberg");
    expect(alles).not.toContain("NL02");
    expect(alles).not.toContain("4.812,03");
  });

  it("laat zijn PUNTENSALDO er niet uit komen, ook niet uit een productkaart", () => {
    /* DE SCHERPSTE GRENS VAN DEZE BRON, en de reden dat ing.ts een saldo-lijst
     * heeft die Amex niet nodig had.
     *
     * Op deze pagina staat zijn saldo in exact dezelfde vorm als een puntenPRIJS:
     * een getal met "punten" erachter. De banner ("Je hebt 3.450 punten") staat
     * buiten de kaarten, maar de Sonos-kaart draagt er zelf een ("dan houd je nog
     * 2.200 punten over") — binnen een knoop die op de selectorlijst past. Die
     * kaart wordt daarom in zijn geheel laten vallen, en niet schoongemaakt: een
     * filter achteraf zou het getal moeten herkennen dat het net niet herkende. */
    const html = readFileSync(join(FIXTURES, "kunstmatig-ing-winkel.html"), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ruw = collectIngWinkel(doc);
    const alles = JSON.stringify(ruw);

    expect(alles).not.toContain("3.450");
    expect(alles).not.toContain("2.200");
    expect(alles).not.toContain("Je hebt");

    const { aanbiedingen } = lees("kunstmatig-ing-winkel.html");
    expect(aanbiedingen.map((a) => a.winkel)).not.toContain("Sonos Era 100");
    for (const a of aanbiedingen) {
      expect(a.prijs?.punten).not.toBe(3450);
      expect(a.prijs?.punten).not.toBe(2200);
    }
  });
});

/* ─────────────────────── de puntenprijs zelf ──────────────────────────────── */

describe("een puntenprijs wordt gelezen of geweigerd, nooit geraden", () => {
  it("trekt duizendtallen samen en laat een komma met rust", () => {
    expect(leesPuntenprijs("1.250 punten")?.punten).toBe(1250);
    expect(leesPuntenprijs("1 250 punten")?.punten).toBe(1250);
    expect(leesPuntenprijs("500 ING Punten")?.punten).toBe(500);
  });

  it("geeft null als er geen aantal punten in staat", () => {
    /* Zonder aantal is er geen prijs. Een regel met alleen een bedrag zou als
     * artikel op het scherm komen met een europrijs erbij, en dan lijkt het iets
     * wat je met geld koopt in plaats van met punten. */
    expect(leesPuntenprijs("€ 19,95 bijbetalen")).toBe(null);
    expect(leesPuntenprijs("Prijs op aanvraag")).toBe(null);
    expect(leesPuntenprijs("")).toBe(null);
  });

  it("neemt een bedrag alleen mee als er een aanleiding bij staat", () => {
    /* Op een winkelpagina staan meer euro's dan de bijbetaling: een adviesprijs,
     * verzendkosten, een totaal. Het eerste euroteken pakken zou een willekeurig
     * bedrag tot bijbetaling promoveren. */
    expect(leesPuntenprijs("1.250 punten + € 19,95")?.bij).toBe("€ 19,95");
    expect(leesPuntenprijs("1.250 punten, € 19,95 bijbetalen")?.bij).toBe("€ 19,95");
    expect(leesPuntenprijs("1.250 punten (adviesprijs € 79,00)")?.bij).toBe(null);
  });
});

/* ────────────────── als er niets te lezen valt, de echte oorzaak ──────────── */

describe("als er niets te lezen valt, staat er de echte oorzaak", () => {
  it("uitgelogd: dat herkent hij aan de inlogknop, niet aan een wachtwoordveld", () => {
    /* HET VERSCHIL MET AMEX. Op deze pagina staat geen wachtwoordveld — inloggen
     * gaat via Mijn ING. Zou de lezer alleen daarop afgaan, dan meldde hij
     * "geen aanbiedingenblok" terwijl de oorzaak "niet ingelogd" is. */
    const { lezing } = lees("kunstmatig-ing-uitgelogd.html");
    expect(lezing.uitkomst).toBe("niet-ingelogd");

    const strook = aanbodStrook(lezing, [], ING_BRON);
    expect(strook.regel).toContain("niet ingelogd");
    expect(strook.regel).toContain("niets opgeslagen");
  });

  it("de pagina zegt zelf dat er niets is: een uitgesproken nul, mét citaat", () => {
    /* De keerzijde van "onbekend is nooit nul". Dit is een antwoord van ING en
     * geen gat in onze meting, dus het wordt geciteerd en niet samengevat. */
    const { lezing, aanbiedingen } = lees("kunstmatig-ing-geen-artikelen.html");
    expect(lezing.uitkomst).toBe("uitgesproken-geen-aanbiedingen");
    expect(lezing.citaat).toContain("geen artikelen");
    expect(aanbiedingen).toHaveLength(0);

    const strook = aanbodStrook(lezing, [], ING_BRON);
    expect(strook.regel).toContain("geen artikelen");
    expect(strook.regel).toContain("geen mislukte lezing");
  });

  it("het blok is er maar onleesbaar: dat is iets anders dan geen artikelen", () => {
    const { lezing, aanbiedingen } = lees("kunstmatig-ing-veranderd.html");
    expect(lezing.uitkomst).toBe("blok-zonder-kaarten");
    expect(aanbiedingen).toHaveLength(0);

    const strook = aanbodStrook(lezing, [], ING_BRON);
    expect(strook.regel).toContain("anders uit dan de lezer verwacht");
    /* En niet: er zijn geen artikelen. Dat zou onwaar zijn. */
    expect(strook.regel).not.toMatch(/geen artikelen (?:beschikbaar|voor je)/i);
  });

  it("noemt bij een veranderde pagina NIET de oude lijst alsof hij vers is", () => {
    /* De expliciete eis uit de opdracht. De lijst blijft staan met zijn eigen
     * leesdatum — dat is `setBronLezing`, die bij een mislukte lezing de lijst
     * met rust laat — maar de melding zegt erbij dat er niets is bijgewerkt. */
    const { lezing } = lees("kunstmatig-ing-veranderd.html");
    const regel = aanbodToestandRegel({ soort: "lezing-mislukt", lezing }, ING_BRON);
    expect(regel).toContain("niet bijgewerkt");
  });

  it("de strook zegt in elke toestand ook wat er NIET gelezen is", () => {
    for (const naam of [
      "kunstmatig-ing-winkel.html",
      "kunstmatig-ing-uitgelogd.html",
      "kunstmatig-ing-geen-artikelen.html",
      "kunstmatig-ing-veranderd.html",
    ]) {
      const { lezing, aanbiedingen } = lees(naam);
      const strook = aanbodStrook(lezing, aanbiedingen.map((a) => a.winkel), ING_BRON);
      expect(strook.noot).toContain("je puntensaldo");
      expect(strook.noot).toContain("niets naar een server");
    }
  });
});

/* ──────────────── de koppeling: een aankoop bij ING is geen korting ────────── */

describe("een artikel uit de ING Winkel is geen aanbieding bij de winkel", () => {
  it("koppelt een artikel dat alleen naar ING linkt aan NIETS", () => {
    /* DE NORMALE UITKOMST, en de goede. Een productkaart in de winkel van ING
     * wijst naar ING, dus er is geen winkeldomein en er verschijnt aan een kassa
     * niets. Dat "repareren" met een merknaamvergelijking zou een aankoop bij
     * ING op de kassa van een andere winkel zetten. */
    const { aanbiedingen } = lees("kunstmatig-ing-winkel.html");
    const jbl = aanbiedingen.find((a) => a.winkel.startsWith("JBL Flip"))!;
    expect(jbl.domein).toBe(null);

    /* Alleen dit artikel, en niet de hele lijst: de Tune-koptelefoon linkt wél
     * naar jbl.nl en hoort daar dus wel bij. Dat is een andere kaart en een
     * andere vraag; zie de test hieronder. */
    const uit = aanbodVoorWinkel(
      { aan: true, lezing: null, aanbiedingen: [jbl] },
      "www.jbl.nl",
      NU,
    );
    expect(uit.soort).toBe("geen-voor-deze-winkel");
    expect(aanbodBlok(uit, NU, ING_BRON).regels).toHaveLength(0);
  });

  it("legt uit dat dat te verwachten is en geen tekortkoming", () => {
    const { aanbiedingen } = lees("kunstmatig-ing-winkel.html");
    const uit = aanbodVoorWinkel({ aan: true, lezing: null, aanbiedingen }, "www.hema.nl", NU);
    const regel = aanbodToestandRegel(uit, ING_BRON);
    expect(regel).toContain("koop je bij ING");
    expect(regel).toContain("LaVega-venster");
  });

  it("zegt ook bij een artikel dat WEL een domein draagt dat je het bij ING bestelt", () => {
    /* De ene kaart die naar jbl.nl linkt. Zelfs dan is de bewering niet "je hebt
     * hier korting" maar "dit staat in de ING Winkel en je bestelt het daar" —
     * dat is het verschil tussen de twee bronnen, en het staat in de zin. */
    const { aanbiedingen } = lees("kunstmatig-ing-winkel.html");
    const tune = aanbiedingen.find((a) => a.winkel.startsWith("JBL Tune"))!;
    expect(tune.domein).toBe("jbl.nl");

    const uit = aanbodVoorWinkel({ aan: true, lezing: null, aanbiedingen }, "www.jbl.nl", NU);
    expect(uit.soort).toBe("gevonden");

    const blok = aanbodBlok(uit, NU, ING_BRON);
    expect(blok.regels).toHaveLength(1);
    expect(blok.regels[0]!.regel).toContain("ING Winkel via Mijn ING");
    expect(blok.regels[0]!.regel).toContain("op=op");
    /* En nooit de Amex-zin. */
    expect(blok.regels[0]!.regel).not.toContain("Toevoegen aan je kaart");
    expect(blok.regels[0]!.regel).not.toMatch(/korting bij deze winkel/i);
  });

  it("koppelt nooit op de merknaam in de artikelnaam", () => {
    /* "JBL Flip 6" bevat JBL, maar draagt geen webadres. Op een namaakwinkel met
     * "jbl" in de hostnaam mag daar niets van verschijnen. */
    const zonderAdres = [artikel({ winkel: "JBL Flip 6 bluetoothspeaker", domein: null })];
    for (const host of ["www.jbl.nl", "jbl-outlet-nep.nl", "www.nike.com"]) {
      const uit = aanbodVoorWinkel({ aan: true, lezing: null, aanbiedingen: zonderAdres }, host, NU);
      expect(uit.soort).toBe("geen-voor-deze-winkel");
    }
  });

  it("toont in het werkbalkvenster wél alles, want daar is het geen bewering", () => {
    const { aanbiedingen } = lees("kunstmatig-ing-winkel.html");
    const blok = aanbodLijst({ aan: true, lezing: null, aanbiedingen }, NU, ING_BRON);
    expect(blok.kop).toBe("Jouw ING Winkel");
    expect(blok.regels.length).toBe(aanbiedingen.length);
  });
});

/* ────────────── twee bronnen, twee toestemmingen, twee lijsten ───────────── */

describe("de ING-schakelaar staat los van die van Amex", () => {
  it("gebruikt andere opslagsleutels dan Amex", () => {
    /* Zo kan het uitzetten van de ene bron de gegevens van de andere niet
     * meenemen, ook niet per ongeluk: `wisBron` haalt alleen de sleutels uit de
     * descriptor weg. */
    expect(ING_BRON.sleutels.aan).not.toBe(AMEX_BRON.sleutels.aan);
    expect(ING_BRON.sleutels.aanbod).not.toBe(AMEX_BRON.sleutels.aanbod);
    expect(ING_BRON.sleutels.lezing).not.toBe(AMEX_BRON.sleutels.lezing);

    const alle = BRONNEN.flatMap((b) => [b.sleutels.aan, b.sleutels.aanbod, b.sleutels.lezing]);
    expect(new Set(alle).size).toBe(alle.length);
  });

  it("zwijgt volledig zolang hij de schakelaar niet heeft aangezet", () => {
    /* Uit is uit — ook geen uitnodiging om hem aan te zetten. Dat is reclame op
     * het slechtste moment: hij staat af te rekenen. */
    const { aanbiedingen } = lees("kunstmatig-ing-winkel.html");
    const uit = aanbodVoorWinkel({ aan: false, lezing: null, aanbiedingen }, "www.jbl.nl", NU);
    expect(uit).toEqual({ soort: "uit" });
    expect(aanbodBlok(uit, NU, ING_BRON)).toEqual({ kop: "", regels: [], toestand: "" });
    expect(aanbodLijst({ aan: false, lezing: null, aanbiedingen }, NU, ING_BRON).kop).toBe("");
  });

  it("draagt bij elk artikel de dag waarop het gelezen is", () => {
    const { aanbiedingen } = lees("kunstmatig-ing-winkel.html");
    for (const a of aanbiedingen) expect(a.gelezenOp).toBe(NU);
  });

  it("verouderd na dezelfde periode als de Amex-kant", () => {
    /* De opdracht eist letterlijk dezelfde periode. Er is dus geen veld per bron
     * waarmee een bron zijn eigen ruimere grens kan meebrengen. */
    const oud = [artikel({ winkel: "JBL Tune 770NC", domein: "jbl.nl", gelezenOp: "2026-06-01" })];
    const uit = aanbodVoorWinkel({ aan: true, lezing: null, aanbiedingen: oud }, "www.jbl.nl", NU);
    expect(uit.soort).toBe("te-oud");
    expect(aanbodToestandRegel(uit, ING_BRON)).toContain("60 dagen");
  });
});

/* ──────────────────── wat er uit de opslag terugkomt ─────────────────────── */

describe("de zeef op de opslag is bij een puntenbron strenger", () => {
  it("gooit een artikel zonder leesbare puntenprijs weg", () => {
    /* Een regel uit de ING Winkel zonder aantal punten is een halve aanbieding:
     * dan komt er een artikel op het scherm zonder wat het kost, en dat leest
     * als gratis. */
    const uit = _schoonAanbod(
      [{ winkel: "JBL", prijsTekst: "1.250 punten", gelezenOp: NU, prijs: null }],
      "punten",
    );
    expect(uit).toHaveLength(0);
  });

  it("laat dezelfde regel bij een kortingbron wél door", () => {
    const uit = _schoonAanbod(
      [{ winkel: "JBL", prijsTekst: "30% korting", gelezenOp: NU }],
      "korting",
    );
    expect(uit).toHaveLength(1);
  });

  it("gooit een puntenprijs met rommel erin weg in plaats van hem te repareren", () => {
    for (const kapot of [{ punten: 0 }, { punten: -5 }, { punten: 1.5 }, { punten: "veel" }]) {
      const uit = _schoonAanbod(
        [{ winkel: "JBL", prijsTekst: "punten", gelezenOp: NU, prijs: kapot }],
        "punten",
      );
      expect(uit).toHaveLength(0);
    }
  });

  it("maakt van een ontbrekend bijbetaalbedrag null en niet een lege string", () => {
    const uit = _schoonAanbod(
      [{ winkel: "Bon", prijsTekst: "2.500 punten", gelezenOp: NU, prijs: { punten: 2500, bij: "" } }],
      "punten",
    );
    expect(uit[0]!.prijs).toEqual({ punten: 2500, bij: null });
  });
});
