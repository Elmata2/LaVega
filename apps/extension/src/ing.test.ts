// @vitest-environment jsdom
/* DE ING WINKEL, tegen OPGESLAGEN HTML.
 *
 * ── WAT DEZE SUITE WEL EN NIET BEWIJST, en dat hoort bovenaan te staan ──────
 *
 * ER IS NU ÉÉN ECHT FIXTURE, en dat verandert de eerste alinea van dit bestand.
 * `ing-winkel-kaart.html` komt uit de ingelogde winkel van de eigenaar zelf
 * (24 augustus 2026, mijn.ing.nl/punten/overview) en heet daarom niet
 * `kunstmatig-`. Daarop rust nu gemeten wat eerst gegokt was: dat de selectors
 * een echte productkaart raken, dat de puntenprijs eruit komt, dat een
 * ontbrekend bijbetaalbedrag null blijft, dat "Op=Op" geen einddatum wordt en
 * dat een kaart zonder links geen winkeldomein oplevert.
 *
 * Wat nog NIET gemeten is, en het is de duurste kant: hoe zijn puntenSALDO op
 * die pagina staat. Hij heeft alleen een kaart gestuurd. Alles wat hieronder
 * over de saldo-grens gaat, staat dus nog op fixtures die `kunstmatig-` heten en
 * met de hand zijn gemaakt. Ook de uitgelogde pagina is nooit gezien
 * (www.ing.nl weigert verzoeken van deze machine na een geslaagde
 * TLS-verbinding; dat is botbeheer en het is niet omzeild).
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
import { aanbodVoorWinkel, leesPuntenprijs, MOGELIJKE_MATCH_MAX, type Aanbieding } from "./aanbod-kern.js";
import { aanbodBlok, aanbodLijst } from "./panel.js";
import { aanbodRegel, aanbodStrook, aanbodToestandRegel } from "./lines.js";
import { _schoonAanbod, _schoonLezing } from "./store.js";
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
    /* HET ADRES DAT DE EIGENAAR MAT: dit is de pagina waar hij stond terwijl de
     * lezer nooit draaide. Zie ING_MATCH in ing.ts voor waarom het eerst fout
     * stond en waarom een citaat uit de voorwaarden van ING dat niet voorkwam. */
    expect(ingUrlIsWinkel("https://mijn.ing.nl/punten/overview")).toBe(true);
    expect(ingUrlIsWinkel("https://mijn.ing.nl/punten")).toBe(true);
    expect(ingUrlIsWinkel("https://mijn.ing.nl/punten/artikel/jbl-flip-6")).toBe(true);

    /* HET OUDE ADRES MOET NU FALEN. Deze regel is de hele bevinding van
     * 24 augustus 2026 in één assertie: stond hier `true`, dan draaide het
     * content script weer op een pagina waar de winkel niet staat. */
    expect(ingUrlIsWinkel("https://www.ing.nl/punten")).toBe(false);
    expect(ingUrlIsWinkel("https://www.ing.nl/particulier/betalen")).toBe(false);

    /* Dit is waar de belofte "je saldo en je transacties vallen erbuiten" wordt
     * waargemaakt: in code, en niet in de tekst onder het vinkje. En hij is nu
     * SCHERPER dan eerst, want het gaat om dezelfde host: alleen het pad scheidt
     * de winkel van zijn rekeningoverzicht. */
    expect(ingUrlIsWinkel("https://mijn.ing.nl/particulier/overzicht")).toBe(false);
    expect(ingUrlIsWinkel("https://mijn.ing.nl/betalen")).toBe(false);
    expect(ingUrlIsWinkel("https://mijn.ing.nl")).toBe(false);
    expect(ingUrlIsWinkel("http://mijn.ing.nl/punten")).toBe(false);
    expect(ingUrlIsWinkel("https://mijn.ing.nl:8443/punten")).toBe(false);
    /* Een origin heeft geen pad en mag dus nooit doorkomen. */
    expect(ingUrlIsWinkel("https://mijn.ing.nl/")).toBe(false);
  });

  it("staat los van het adres van Amex", () => {
    expect(ingUrlIsWinkel("https://global.americanexpress.com/offers/eligible")).toBe(false);
    expect(ING_MATCH).not.toBe(AMEX_BRON.match);
  });
});

/* ──────────────── de ECHTE kaart, en wat die wel en niet vaststelt ────────── */

/** De ruwe lezing, want deze suite wil ook aan `inlogformulier` kunnen komen. */
function ruweLezing(naam: string) {
  const html = readFileSync(join(FIXTURES, naam), "utf8");
  return collectIngWinkel(new DOMParser().parseFromString(html, "text/html"));
}

describe("de echte kaart uit zijn eigen winkel", () => {
  /* HET FIXTURE DAT NIET `kunstmatig-` HEET. Eén productkaart, letterlijk zoals
   * ING hem levert op mijn.ing.nl/punten/overview. Wat hieronder staat is dus
   * GEMETEN en niet gehoopt — en het weerlegt het voorbehoud dat in ing.ts stond
   * dat de selectors een gok waren. Ze raken. Het adres was fout. */
  it("leest artikelnaam en puntenprijs uit echte ING-HTML", () => {
    const { lezing, aanbiedingen } = lees("ing-winkel-kaart.html");
    expect(lezing.uitkomst).toBe("gelezen");
    expect(aanbiedingen).toHaveLength(1);
    expect(aanbiedingen[0]!.winkel).toBe("JBL Boombox 4 25% kortingsvoucher");
    expect(aanbiedingen[0]!.prijsTekst).toBe("500 Punten");
    expect(aanbiedingen[0]!.prijs).toEqual({ punten: 500, bij: null });
  });

  it("laat een ontbrekend bijbetaalbedrag null en maakt er geen nul van", () => {
    /* "Points only" betekent dat er niets bij te betalen valt. Dat is iets
     * anders dan € 0,00, en het verschil is precies de fout die deze repo bij
     * catalogusnullen twee keer heeft gevangen. */
    const { aanbiedingen } = lees("ing-winkel-kaart.html");
    const prijs = aanbiedingen[0]!.prijs;
    expect(prijs).not.toBeUndefined();
    expect(prijs!.bij).toBeNull();
  });

  it("maakt van Op=Op geen einddatum", () => {
    /* Op de kaart staat "Op=Op" en geen "geldig tot". Volgens de voorwaarden van
     * ING geldt op=op voor ELKE aanbieding, dus het hoort in de zin en niet in
     * een datumveld. Een verzonnen einddatum zou hier het ergste zijn: hij zou
     * de kaart op een dag laten vervallen die ING nooit genoemd heeft. */
    const { aanbiedingen } = lees("ing-winkel-kaart.html");
    expect(aanbiedingen[0]!.tot).toBeNull();
    expect(aanbiedingen[0]!.totRuw).toBe("");
  });

  it("koppelt hem aan geen enkele winkel, ook al staat er JBL in de titel", () => {
    /* DE SCHERPSTE REGEL VAN DEZE BRON, en de echte kaart bewijst hem: er staat
     * geen enkele <a href> in. Geen link, geen domein. De verleiding is groot —
     * het is een JBL-kortingsvoucher, dus jbl.nl lijkt te kloppen — maar de
     * titel is geen domein en `hostUitNaam` eist dat de HELE naam er een is.
     * Aan de kassa van jbl.nl verschijnt hier dus niets, en dat is het goede
     * antwoord: hij koopt de voucher bij ING. */
    const { aanbiedingen } = lees("ing-winkel-kaart.html");
    expect(aanbiedingen[0]!.domein).toBeNull();
  });

  it("hangt niet aan de lit-hash, die per build van ING verandert", () => {
    /* De kaart is bezaaid met `<!--?lit$844341481$-->`. Dat getal is een
     * bouwnummer van ING en verandert zonder aankondiging. Zou er ooit iets op
     * gematcht worden, dan werkt de lezer één release lang. */
    const html = readFileSync(join(FIXTURES, "ing-winkel-kaart.html"), "utf8");
    const anders = html.replace(/lit\$844341481\$/g, "lit$99$");
    expect(anders).not.toBe(html);
    const uit = collectIngWinkel(new DOMParser().parseFromString(anders, "text/html"));
    expect(uit.kandidaten).toHaveLength(1);
    expect(uit.kandidaten[0]!.winkel).toBe("JBL Boombox 4 25% kortingsvoucher");
    expect(uit.kandidaten[0]!.prijsTekst).toBe("500 Punten");
  });

  it("ziet dat hij ingelogd is", () => {
    expect(ruweLezing("ing-winkel-kaart.html").inlogformulier).toBe(false);
  });

  it("levert nog steeds exact dezelfde getallen op na de schaduwreparatie", () => {
    /* DE ANKERREGEL VAN 24 AUGUSTUS 2026. De wandeling over schaduwwortels
     * hieronder in ing.ts raakt élke kandidaat aan; deze test pint de gemeten
     * uitkomst op zijn ECHTE kaart vast zodat een volgende uitbreiding niet
     * ongemerkt iets aan zijn eigen markup verandert.
     *
     * markers 6: `[class*='product' i]` raakt product-img, product-label-wrapper
     * (twee keer), product-label, product-info en product-content.
     * afgeschermd 0: er staat geen eigen element in dit fixture — de kaart is
     * plat, want DevTools kopieert schaduwinhoud plat mee. Dát is precies waarom
     * dit bestand wél leest en zijn pagina niet. */
    const ruw = ruweLezing("ing-winkel-kaart.html");
    expect(ruw.markers).toBe(6);
    expect(ruw.afgeschermd).toBe(0);
    expect(ruw.geenAanbiedingen).toBe("");
    expect(ruw.kandidaten).toEqual([
      {
        winkel: "JBL Boombox 4 25% kortingsvoucher",
        prijsTekst: "500 Punten",
        totRuw: "",
        hosts: [],
      },
    ]);
  });
});

describe("waar de pagina zelf staat beslist wat een inloglink betekent", () => {
  it("dempt het inlogsignaal op mijn.ing.nl, want daar wijst alles daarheen", () => {
    /* DE FOUT DIE HIERONDER LIGT: de lezer nam een link naar mijn.ing.nl als
     * bewijs van uitgelogd zijn. De winkel STAAT op mijn.ing.nl. Zonder deze
     * hostvraag zou hij op precies de pagina die alleen ingelogd bestaat
     * "je bent niet ingelogd" melden — een melding met de verkeerde oorzaak. */
    const uit = ruweLezing("kunstmatig-ing-inloglink-op-mijn.html");
    expect(uit.inlogformulier).toBe(false);
    expect(uit.kandidaten).toHaveLength(1);
  });

  it("laat het signaal wél afgaan op een pagina buiten mijn.ing.nl", () => {
    /* De demping geldt alleen op mijn.ing.nl zelf. Elders is dezelfde link nog
     * steeds wat hij lijkt. */
    expect(ruweLezing("kunstmatig-ing-inloglink-elders.html").inlogformulier).toBe(true);
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
  it("koppelt een artikel dat alleen naar ING linkt nooit met de zekere bewering", () => {
    /* DE NORMALE UITKOMST BLIJFT DEZE: geen domein, dus geen "gevonden" en geen
     * "je hebt hier een aanbieding". Dat "repareren" met een merknaamvergelijking
     * zou een aankoop bij ING neerzetten als een aanbieding van deze winkel, en
     * dat blijft fout. Wat WEL mag, is de veel zwakkere, apart benoemde tak
     * hieronder: een titel die de merknaam raakt, zonder claim over verzilvering.
     * Zie `mogelijkeMerknaamMatch`. */
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
      ING_BRON,
    );
    expect(uit.soort).toBe("mogelijke-merknaam-match");
    expect(aanbodBlok(uit, NU, ING_BRON).regels).toHaveLength(0);
    const regel = aanbodToestandRegel(uit, ING_BRON);
    /* De bewering die hier niet mag staan. */
    expect(regel).not.toMatch(/je (kunt|hebt) hier/i);
    expect(regel).not.toContain("aanbieding voor je");
    expect(regel).toContain("mijn.ing.nl");
  });

  it("legt uit dat dat te verwachten is en geen tekortkoming", () => {
    const { aanbiedingen } = lees("kunstmatig-ing-winkel.html");
    const uit = aanbodVoorWinkel({ aan: true, lezing: null, aanbiedingen }, "www.hema.nl", NU, ING_BRON);
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

    const uit = aanbodVoorWinkel({ aan: true, lezing: null, aanbiedingen }, "www.jbl.nl", NU, ING_BRON);
    expect(uit.soort).toBe("gevonden");

    const blok = aanbodBlok(uit, NU, ING_BRON);
    expect(blok.regels).toHaveLength(1);
    expect(blok.regels[0]!.regel).toContain("ING Winkel via Mijn ING");
    expect(blok.regels[0]!.regel).toContain("op=op");
    /* En nooit de Amex-zin. */
    expect(blok.regels[0]!.regel).not.toContain("Toevoegen aan je kaart");
    expect(blok.regels[0]!.regel).not.toMatch(/korting bij deze winkel/i);
  });

  it("koppelt nooit VOLUIT op de merknaam, en de gehedgde match raakt de namaakwinkel niet", () => {
    /* "JBL Flip 6" bevat JBL, maar draagt geen webadres. Bij het echte jbl.nl
     * mag de gehedgde, zwakkere tak wél vuren (dat is het hele punt van
     * `mogelijkeMerknaamMatch`). Bij een namaakwinkel als "jbl-outlet-nep.nl"
     * mag dat niet — het label is daar "jbl-outlet-nep", geen los woord "jbl"
     * in de titel, dus geen match. En "nike" komt nergens in de titel voor. */
    const zonderAdres = [artikel({ winkel: "JBL Flip 6 bluetoothspeaker", domein: null })];
    const echt = aanbodVoorWinkel({ aan: true, lezing: null, aanbiedingen: zonderAdres }, "www.jbl.nl", NU, ING_BRON);
    expect(echt.soort).toBe("mogelijke-merknaam-match");

    for (const host of ["jbl-outlet-nep.nl", "www.nike.com"]) {
      const uit = aanbodVoorWinkel({ aan: true, lezing: null, aanbiedingen: zonderAdres }, host, NU, ING_BRON);
      expect(uit.soort).toBe("geen-voor-deze-winkel");
    }
  });

  it("kapt de gehedgde matches af maar telt ze ongekapt door", () => {
    /* Vier titels die allemaal "jbl" als los woord dragen. De zin en de
     * uitkomst mogen het bestaan van de vierde niet verzwijgen. */
    const veel = [1, 2, 3, 4].map((n) =>
      artikel({ winkel: `JBL Product ${n} kortingsvoucher`, domein: null, prijsTekst: `${n}00 punten` }),
    );
    const uit = aanbodVoorWinkel({ aan: true, lezing: null, aanbiedingen: veel }, "www.jbl.nl", NU, ING_BRON);
    expect(uit.soort).toBe("mogelijke-merknaam-match");
    if (uit.soort !== "mogelijke-merknaam-match") return;
    expect(uit.matches).toHaveLength(MOGELIJKE_MATCH_MAX);
    expect(uit.totaal).toBe(4);

    const regel = aanbodToestandRegel(uit, ING_BRON);
    expect(regel).toContain("1 andere titel(s)");
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
    const uit = aanbodVoorWinkel({ aan: false, lezing: null, aanbiedingen }, "www.jbl.nl", NU, ING_BRON);
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
    const uit = aanbodVoorWinkel({ aan: true, lezing: null, aanbiedingen: oud }, "www.jbl.nl", NU, ING_BRON);
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

/* ══════════════════════════════════════════════════════════════════════════
 * DE SCHADUW-DOM: waarom de strook op zijn echte pagina niets vond
 * ══════════════════════════════════════════════════════════════════════════
 *
 * DIT IS DE SUITE DIE BIJ EEN GEMETEN MISLUKKING HOORT, en de meting staat
 * erboven in plaats van eronder.
 *
 * Op 24 augustus 2026 stond de eigenaar met de toestemming aan op
 * https://mijn.ing.nl/punten/overview. De strook VERSCHEEN — dus het
 * adrespatroon, de toestemming en de registratie werken — en zei: "LaVega vindt
 * op deze pagina geen artikelen en heeft dus niets gelezen. Het adres dat LaVega
 * leest is https://mijn.ing.nl/punten*."
 *
 * Diezelfde dag leverde zijn ECHTE kaart (`ing-winkel-kaart.html`) door dezelfde
 * functie precies één kandidaat op. Dezelfde selectors, dezelfde markup, twee
 * uitkomsten — en dus zat het verschil niet in de selectorlijst maar in het
 * BEREIK.
 *
 * ELKE TEST HIERONDER BOUWT ZIJN DOM MET `attachShadow` EN NIET MET EEN
 * .html-BESTAND, want een schaduwwortel is in HTML niet uit te drukken: hij
 * ontstaat pas als JavaScript hem aanhangt. Dat is meteen de reden dat het
 * fixture wél werkt en zijn pagina niet — de Elements-tab van DevTools kopieert
 * schaduwinhoud plat mee.
 *
 * De KAARTMARKUP komt letterlijk uit dat fixture (`.card`), zodat deze tests de
 * echte markup blijven testen en niet een nabootsing ervan. */

/** De echte kaart van de eigenaar, als los stukje HTML. */
function echteKaart(naam?: string): string {
  const html = readFileSync(join(FIXTURES, "ing-winkel-kaart.html"), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const kaart = doc.querySelector(".card");
  if (!kaart) throw new Error("ing-winkel-kaart.html heeft geen .card meer");
  const uit = kaart.outerHTML;
  return naam === undefined ? uit : uit.replace("JBL Boombox 4 25% kortingsvoucher", naam);
}

/** Een leeg document met alleen de schil eromheen — precies zoals www.ing.nl/punten
 *  er kaal uitziet: een kop en een lege haak waar de app in gebouwd wordt. */
function schil(): { doc: Document; app: Element } {
  const doc = new DOMParser().parseFromString(
    '<!doctype html><html lang="nl"><head><title>ING Winkel</title>' +
      '<base href="https://mijn.ing.nl/punten/overview"></head>' +
      '<body><h1>Welkom in de ING Winkel</h1><div id="app"></div></body></html>',
    "text/html",
  );
  return { doc, app: doc.getElementById("app")! };
}

/** Hangt een schaduwwortel aan een nieuw element en vult hem. */
function metWortel(
  doc: Document,
  tag: string,
  html: string,
  modus: "open" | "closed" = "open",
  klasse?: string,
): Element {
  const gastheer = doc.createElement(tag);
  if (klasse !== undefined) gastheer.setAttribute("class", klasse);
  const wortel = gastheer.attachShadow({ mode: modus });
  wortel.innerHTML = html;
  return gastheer;
}

describe("de vier vormen waarin zijn pagina de kaarten kan wegstoppen", () => {
  /* DE CONTROLE. Dezelfde markup plat in het lichte document. Zonder deze regel
   * bewijzen de vier hieronder niets: dan kon het ook aan de kaart liggen. */
  it("controle: plat in het lichte dom komen er drie kaarten uit", () => {
    const { doc, app } = schil();
    app.innerHTML = echteKaart("Kaart een") + echteKaart("Kaart twee") + echteKaart("Kaart drie");
    const ruw = collectIngWinkel(doc);
    expect(ruw.markers).toBe(18);
    expect(ruw.kandidaten).toHaveLength(3);
    expect(ruw.kandidaten[0]!.prijsTekst).toBe("500 Punten");
  });

  it("vorm 1: één open wortel om alle kaarten heen", () => {
    /* Vóór deze reparatie: markers 0, kandidaten 0 — exact zijn strook. */
    const { doc, app } = schil();
    app.appendChild(
      metWortel(
        doc,
        "punten-overzicht",
        echteKaart("Kaart een") + echteKaart("Kaart twee") + echteKaart("Kaart drie"),
      ),
    );
    const ruw = collectIngWinkel(doc);
    expect(ruw.markers).toBe(18);
    expect(ruw.kandidaten.map((k) => k.winkel)).toEqual(["Kaart een", "Kaart twee", "Kaart drie"]);
  });

  it("vorm 2: één open wortel per kaart, de gewone LitElement-vorm", () => {
    const { doc, app } = schil();
    for (const naam of ["Kaart een", "Kaart twee", "Kaart drie"]) {
      app.appendChild(metWortel(doc, "product-card", echteKaart(naam)));
    }
    const ruw = collectIngWinkel(doc);
    expect(ruw.markers).toBe(18);
    expect(ruw.kandidaten.map((k) => k.winkel)).toEqual(["Kaart een", "Kaart twee", "Kaart drie"]);
  });

  it("vorm 3: twee wortels diep genest", () => {
    const { doc, app } = schil();
    const buiten = metWortel(doc, "punten-overzicht", "<div id='binnenin'></div>");
    app.appendChild(buiten);
    buiten.shadowRoot!.getElementById("binnenin")!.appendChild(
      metWortel(doc, "product-card", echteKaart()),
    );
    const ruw = collectIngWinkel(doc);
    expect(ruw.kandidaten).toHaveLength(1);
    expect(ruw.kandidaten[0]!.winkel).toBe("JBL Boombox 4 25% kortingsvoucher");
  });

  it("vorm 4: de gastheer draagt zelf een productklasse", () => {
    /* Deze vorm gaf vóór de reparatie markers 3 en nul kaarten — dus een ANDERE
     * zin ("het blok staat er wel"). Hij hoort er toch bij: het is de enige vorm
     * waarin de gastheer zelf op de selectorlijst past, en dan mag de kaart
     * binnenin niet twee keer geteld worden. */
    const { doc, app } = schil();
    app.appendChild(metWortel(doc, "div", echteKaart(), "open", "product-card"));
    const ruw = collectIngWinkel(doc);
    expect(ruw.kandidaten).toHaveLength(1);
    expect(ruw.kandidaten[0]!.winkel).toBe("JBL Boombox 4 25% kortingsvoucher");
  });

  it("een <slot> werkte altijd al, en dat blijft zo", () => {
    /* Bij een slot staat de inhoud in het LICHTE dom en wordt hij alleen ergens
     * anders getoond. `document.querySelectorAll` komt daar gewoon bij. Dit is
     * dus de vorm die de mislukking NIET verklaart, en de test staat er zodat
     * die weerlegging blijft staan. */
    const { doc, app } = schil();
    const gastheer = doc.createElement("punten-overzicht");
    gastheer.attachShadow({ mode: "open" }).innerHTML = "<div><slot></slot></div>";
    gastheer.innerHTML = echteKaart();
    app.appendChild(gastheer);
    const ruw = collectIngWinkel(doc);
    expect(ruw.kandidaten).toHaveLength(1);
  });

  it("telt een kaart één keer, ook als de omhullende lijst in het lichte dom past", () => {
    /* DE DIEPTEOMKERING, en die is gemeten: `contains` en `parentElement` gaan
     * allebei niet door een schaduwgrens heen, dus een kaart IN een wortel telde
     * als ONDIEPER dan haar eigen gastheer (1 tegen 3). Daarmee draaide de
     * van-binnen-naar-buiten-regel om en kwam de omhullende lijst er als eigen
     * kandidaat bij — met de kop van de lijst als "artikelnaam" en de prijs van
     * de kaart eronder. Precies de dubbeltelling die amex.test.ts al verbood. */
    const { doc, app } = schil();
    const lijst = doc.createElement("div");
    lijst.setAttribute("class", "productlijst");
    lijst.innerHTML = '<h2 class="lijst-titel">Voor jou geselecteerd</h2><p>Vanaf 500 Punten</p>';
    lijst.appendChild(metWortel(doc, "product-card", echteKaart()));
    app.appendChild(lijst);

    const ruw = collectIngWinkel(doc);
    expect(ruw.kandidaten).toHaveLength(1);
    expect(ruw.kandidaten[0]!.winkel).toBe("JBL Boombox 4 25% kortingsvoucher");
    expect(ruw.kandidaten.map((k) => k.winkel)).not.toContain("Voor jou geselecteerd");
  });
});

describe("een GESLOTEN wortel: de eerlijke mislukking, en geen fout", () => {
  it("leest niets, gooit niet, en telt het als afgeschermd", () => {
    /* `mode: "closed"` betekent dat `element.shadowRoot` null is — ook voor ons.
     * Er is één gedocumenteerde uitweg (`chrome.dom.openOrClosedShadowRoot`, zie
     * chrome.d.ts), maar die bestaat alleen in een echt content script; in jsdom
     * is er geen `chrome`, dus dit is precies het geval waarin de uitweg er niet
     * is. Dan hoort er een eerlijke zin te komen en geen exception. */
    const { doc, app } = schil();
    const gastheer = metWortel(doc, "punten-overzicht", echteKaart(), "closed");
    app.appendChild(gastheer);
    expect(gastheer.shadowRoot).toBeNull();

    const ruw = collectIngWinkel(doc);
    expect(ruw.markers).toBe(0);
    expect(ruw.kandidaten).toHaveLength(0);
    expect(ruw.afgeschermd).toBe(1);

    const { lezing } = leesIngAanbod(ruw, NU);
    expect(lezing.uitkomst).toBe("afgeschermd");
  });

  it("zegt dat de pagina dicht is, en niet dat de winkel leeg is", () => {
    const { doc, app } = schil();
    app.appendChild(metWortel(doc, "punten-overzicht", echteKaart(), "closed"));
    const { lezing } = leesIngAanbod(collectIngWinkel(doc), NU);

    const strook = aanbodStrook(lezing, [], ING_BRON);
    expect(strook.regel).toContain("niet in kan kijken");
    expect(strook.regel).toContain("niets opgeslagen");
    /* En NOOIT de bewering over zijn winkel, of de wijzende vinger naar het
     * adres: bij een dichte component is het adres niet de oorzaak. */
    expect(strook.regel).not.toMatch(/geen artikelen/i);
    expect(strook.regel).not.toContain(ING_MATCH);

    /* Dezelfde correctie moet ook in het kassa-paneel en het optiescherm staan,
     * want die bouwen hun zin met een andere functie. */
    const regel = aanbodToestandRegel({ soort: "lezing-mislukt", lezing }, ING_BRON);
    expect(regel).toContain("niet in kan kijken");
    expect(regel).not.toMatch(/geen artikelen/i);
  });

  it("blijft een uitkomst die de opslag heen en terug overleeft", () => {
    /* Een nieuwe uitkomst is een wijziging in het OPSLAGSCHEMA. Valt hij uit
     * `schoonLezing`, dan leest het optiescherm "nog nooit gelezen" en ziet hij
     * de oorzaak nooit — de zin zou dan alleen in de strook staan, die weg is
     * zodra hij de pagina verlaat. */
    const heen = { uitkomst: "afgeschermd", aantal: 0, op: NU, citaat: "" };
    expect(_schoonLezing(heen)).toEqual(heen);
  });
});

describe("het onderscheid dat de strook nu maakt", () => {
  it("niets gevonden EN niets dichts: dan noemt hij de twee oorzaken die passen", () => {
    /* De lege schil. Geen enkele knoop op de lijst, en ook geen component om
     * naar te wijzen. Wat er dan vaststaat is alleen: WIJ hebben niets
     * gevonden. */
    const { doc } = schil();
    const ruw = collectIngWinkel(doc);
    expect(ruw.markers).toBe(0);
    expect(ruw.afgeschermd).toBe(0);

    const { lezing } = leesIngAanbod(ruw, NU);
    expect(lezing.uitkomst).toBe("geen-aanbiedingenblok");

    const strook = aanbodStrook(lezing, [], ING_BRON);
    /* DE ZIN DIE HIJ LAS, EN DIE HIER NIET MEER MAG STAAN. "LaVega vindt op deze
     * pagina geen artikelen" is een bewering over de winkel van ING; wij kunnen
     * alleen iets zeggen over onze eigen lezer. */
    expect(strook.regel).not.toMatch(/vindt op deze pagina geen artikelen/i);
    expect(strook.regel).toContain("gevonden");
    expect(strook.regel).toContain("betekent niet dat er niets staat");
    /* Allebei de oorzaken die hierop passen, en de erkenning dat we niet weten
     * welke. Alleen het adres noemen wees hem vorige keer op de ene oorzaak die
     * er níét was. */
    expect(strook.regel).toContain(ING_MATCH);
    expect(strook.regel).toContain("nog aan het opbouwen");
    expect(strook.regel).toContain("weet LaVega niet");
  });

  it("wel knopen maar geen kaart eruit: dat is een ANDERE zin", () => {
    const { lezing } = lees("kunstmatig-ing-veranderd.html");
    expect(lezing.uitkomst).toBe("blok-zonder-kaarten");
    const strook = aanbodStrook(lezing, [], ING_BRON);
    expect(strook.regel).toContain("Het blok staat er wel");
    /* En hij noemt de tweede oorzaak die bij een puntenbron echt kan optreden:
     * dat LaVega de kaart zelf heeft laten vallen omdat er iets in stond dat op
     * zijn saldo leek. Dat verzwijgen zou de saldo-grens onzichtbaar maken op
     * precies het moment dat ze bijt. */
    expect(strook.regel).toContain("puntensaldo");
  });

  it("en bij Amex staat die saldo-zin er niet, want die zeef bestaat daar niet", () => {
    const lezing = { uitkomst: "blok-zonder-kaarten" as const, aantal: 0, op: NU, citaat: "" };
    expect(aanbodStrook(lezing, [], AMEX_BRON).regel).not.toContain("puntensaldo");
  });
});

describe("zijn PUNTENSALDO, nu de lezer verder kijkt dan ooit", () => {
  /* DE SCHERPSTE KANT VAN DEZE HELE WIJZIGING.
   *
   * Door schaduwwortels heen kijken betekent dat deze lezer onderdelen van zijn
   * pagina bezoekt die hij nooit heeft kunnen zien. Zijn puntenSALDO staat op
   * precies die pagina, in precies de vorm van een puntenPRIJS: een getal met
   * "punten" erachter. Tot vandaag zat dat saldo achter dezelfde wortel die ook
   * de kaarten verborg — de blindheid was zijn bescherming. Die is nu weg.
   *
   * WAT DE EIGENAAR NIET GESTUURD HEEFT is zijn saldoblok; hij stuurde alleen
   * een kaart. De drie tests hieronder zijn dus NAGEBOUWD, en elk daarvan pakt
   * met opzet één zeef aan zodat er niet één ding drie keer bewezen wordt. */

  it("zeef 1 — het WOORD: een saldoblok dat 'Saldo' zegt komt er niet uit", () => {
    const { doc, app } = schil();
    app.appendChild(
      metWortel(
        doc,
        "punten-saldo",
        '<div class="product-tile"><h2 class="card-title">Saldo</h2>' +
          '<div class="points-only-amount"><span><strong>3.450</strong></span> Punten</div></div>',
      ),
    );
    app.appendChild(metWortel(doc, "product-card", echteKaart()));

    const ruw = collectIngWinkel(doc);
    const alles = JSON.stringify(ruw);
    expect(alles).not.toContain("3.450");
    expect(alles).not.toContain("3450");
    expect(ruw.kandidaten).toHaveLength(1);
    expect(ruw.kandidaten[0]!.winkel).toBe("JBL Boombox 4 25% kortingsvoucher");
  });

  it("zeef 2 — de HAAK: geen saldowoord in de tekst, wel in de tagnaam", () => {
    /* Hier staat NERGENS een woord uit de saldolijst: "Om te gebruiken" is geen
     * "je hebt", geen "saldo", geen "tegoed". De enige aanwijzing is dat het
     * blok in `<ing-wallet>` hangt. Zonder de haakzeef zou hier
     * { winkel: "Om te gebruiken", prijsTekst: "3.450 Punten" } uit komen — zijn
     * saldo, opgeslagen als de prijs van een artikel. */
    const { doc, app } = schil();
    app.appendChild(
      metWortel(
        doc,
        "ing-wallet",
        '<div class="product-tile"><h2 class="card-title">Om te gebruiken</h2>' +
          '<div class="points-only-amount"><span><strong>3.450</strong></span> Punten</div></div>',
      ),
    );
    app.appendChild(metWortel(doc, "product-card", echteKaart()));

    const ruw = collectIngWinkel(doc);
    expect(JSON.stringify(ruw)).not.toContain("3.450");
    expect(ruw.kandidaten.map((k) => k.winkel)).toEqual(["JBL Boombox 4 25% kortingsvoucher"]);
  });

  it("zeef 3 — de NAAM: een kaart die 'Punten' heet en punten 'kost'", () => {
    /* Geen saldowoord in de tekst en geen haak in de tagnaam of de klassen: de
     * enige aanwijzing is dat de kop letterlijk het woord is waarmee een bank
     * een saldo aankondigt. Een echt artikel heet "JBL Boombox 4 …". */
    const { doc, app } = schil();
    app.appendChild(
      metWortel(
        doc,
        "ing-header",
        '<div class="product-summary"><h2 class="card-title">Punten</h2>' +
          "<div><span><strong>3.450</strong></span> Punten</div></div>",
      ),
    );
    app.appendChild(metWortel(doc, "product-card", echteKaart()));

    const ruw = collectIngWinkel(doc);
    expect(JSON.stringify(ruw)).not.toContain("3.450");
    expect(ruw.kandidaten.map((k) => k.winkel)).toEqual(["JBL Boombox 4 25% kortingsvoucher"]);
  });

  it("en met alle drie de vormen tegelijk op de pagina blijft er één artikel over", () => {
    const { doc, app } = schil();
    app.appendChild(
      metWortel(
        doc,
        "punten-saldo",
        '<div class="product-tile"><h2 class="card-title">Jouw saldo</h2><p>Je hebt 3.450 punten</p></div>',
      ),
    );
    app.appendChild(
      metWortel(
        doc,
        "ing-wallet",
        '<div class="product-tile"><h2 class="card-title">Om te gebruiken</h2><p>3.450 Punten</p></div>',
      ),
    );
    app.appendChild(
      metWortel(
        doc,
        "ing-header",
        '<div class="product-summary"><h2 class="card-title">Punten</h2><p>3.450 Punten</p></div>',
      ),
    );
    app.appendChild(metWortel(doc, "product-card", echteKaart()));

    const ruw = collectIngWinkel(doc);
    const { aanbiedingen } = leesIngAanbod(ruw, NU);
    expect(JSON.stringify(ruw)).not.toContain("3.450");
    expect(JSON.stringify(aanbiedingen)).not.toContain("3.450");
    expect(aanbiedingen).toHaveLength(1);
    expect(aanbiedingen[0]!.prijs).toEqual({ punten: 500, bij: null });
  });

  it("houdt de vorm van wat er meekomt precies gelijk", () => {
    /* De vorm IS de grens. Er is één veld bij gekomen (`afgeschermd`, een
     * geheel getal) en dat is opzet; komt er ooit iets anders bij, dan hoort
     * deze regel rood te worden. */
    const { doc, app } = schil();
    app.appendChild(metWortel(doc, "product-card", echteKaart()));
    const ruw = collectIngWinkel(doc);
    expect(Object.keys(ruw).sort()).toEqual([
      "afgeschermd",
      "geenAanbiedingen",
      "inlogformulier",
      "kandidaten",
      "markers",
    ]);
    for (const k of ruw.kandidaten) {
      expect(Object.keys(k).sort()).toEqual(["hosts", "prijsTekst", "totRuw", "winkel"]);
    }
  });
});

describe("de rest van de pagina wordt in dezelfde wortels gelezen", () => {
  it("ziet een inlogscherm dat in een component staat", () => {
    /* Zonder deze regel zou de reparatie de melding SLECHTER maken: wel door de
     * kaarten heen kijken, niet door het inlogscherm — en dan meldt hij "geen
     * blok gevonden" op een pagina waar staat dat je moet inloggen. */
    const { doc, app } = schil();
    app.appendChild(
      metWortel(doc, "ing-login", "<form><input type='password' name='w'></form>"),
    );
    const ruw = collectIngWinkel(doc);
    expect(ruw.inlogformulier).toBe(true);
    expect(leesIngAanbod(ruw, NU).lezing.uitkomst).toBe("niet-ingelogd");
  });

  it("leest een uitgesproken nul die in een component staat", () => {
    const { doc, app } = schil();
    app.appendChild(
      metWortel(
        doc,
        "punten-overzicht",
        '<section class="productoverzicht"><p>Er zijn op dit moment geen artikelen beschikbaar in de ING Winkel.</p></section>',
      ),
    );
    const { lezing } = leesIngAanbod(collectIngWinkel(doc), NU);
    expect(lezing.uitkomst).toBe("uitgesproken-geen-aanbiedingen");
    expect(lezing.citaat).toContain("geen artikelen");
  });
});

describe("de wandeling heeft een plafond, en dat plafond is te zien", () => {
  it("kijkt tot tien wortels diep en niet verder", () => {
    /* Het plafond is geen smaak maar een rem: dit draait op een grote
     * bankapplicatie, en aanbod-content.ts probeert het VIER keer per
     * paginabezoek. Wat eronder valt wordt gelezen, wat erboven valt niet — en
     * dan is de uitkomst "niets gevonden" en geen vastloper. */
    const bouw = (diep: number): Document => {
      const { doc, app } = schil();
      let hier: Element | ShadowRoot = app;
      for (let i = 0; i < diep; i++) {
        const gastheer = doc.createElement("laag-" + String(i));
        const wortel = gastheer.attachShadow({ mode: "open" });
        hier.appendChild(gastheer);
        hier = wortel;
      }
      const kaart = doc.createElement("div");
      kaart.innerHTML = echteKaart();
      hier.appendChild(kaart);
      return doc;
    };

    expect(collectIngWinkel(bouw(9)).kandidaten).toHaveLength(1);
    const teDiep = collectIngWinkel(bouw(15));
    expect(teDiep.kandidaten).toHaveLength(0);
    expect(teDiep.markers).toBe(0);
  });

  it("loopt niet vast op een pagina met heel veel componenten", () => {
    /* 900 gastheren met een wortel elk, dus ruim boven het plafond van 400. Er
     * mag hier geen exception uit komen: een injectie die gooit levert
     * `undefined` op in background.ts, en dan verschijnt er HELEMAAL geen
     * strook — de ene uitkomst die hem niets vertelt. */
    const { doc, app } = schil();
    for (let i = 0; i < 900; i++) {
      app.appendChild(metWortel(doc, "vul-blok", "<div class='niets'>x</div>"));
    }
    app.appendChild(metWortel(doc, "product-card", echteKaart()));
    const begin = Date.now();
    const ruw = collectIngWinkel(doc);
    expect(Date.now() - begin).toBeLessThan(5000);
    expect(ruw.kandidaten.length).toBeLessThanOrEqual(1);
  });
});

describe("de ING-lezer staat op zichzelf, net als die van Amex", () => {
  it("werkt ook zonder de module eromheen — mét de schaduwwandeling erin", () => {
    /* DEZELFDE TEST DIE AMEX AL HAD (amex.test.ts), en die voor ING ontbrak.
     * `chrome.scripting.executeScript({ func })` serialiseert deze functie naar
     * TEKST; alles wat ze van buiten haar body gebruikt bestaat op zijn pagina
     * niet. Dat is precies de fout die je hier niet ziet en in zijn console wél.
     *
     * Deze test is er nu bij gekomen omdat de reparatie een WANDELING in die
     * body zet die naar `chrome.dom` grijpt. Een kale `chrome`-verwijzing zou
     * hier al een ReferenceError geven — jsdom heeft geen `chrome` — en daarom
     * staat er `globalThis` met een controle omheen. */
    const { doc, app } = schil();
    app.appendChild(metWortel(doc, "product-card", echteKaart()));

    const losgemaakt = new Function(
      `return (${collectIngWinkel.toString()})`,
    )() as typeof collectIngWinkel;

    const ruw = losgemaakt(doc);
    expect(ruw.kandidaten).toHaveLength(1);
    expect(ruw.kandidaten[0]!.winkel).toBe("JBL Boombox 4 25% kortingsvoucher");
    expect(ruw.kandidaten[0]!.prijsTekst).toBe("500 Punten");
  });

  it("levert losgemaakt exact hetzelfde op voor zijn echte kaart", () => {
    const html = readFileSync(join(FIXTURES, "ing-winkel-kaart.html"), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const losgemaakt = new Function(
      `return (${collectIngWinkel.toString()})`,
    )() as typeof collectIngWinkel;
    expect(losgemaakt(doc)).toEqual(collectIngWinkel(doc));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * DE VIJF GEMETEN LEKKEN IN DE SALDO-GRENS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * DEZE SUITE IS GESCHREVEN VOORDAT DE REPARATIE ER WAS, en elke test hieronder
 * is eerst ROOD gezien op de code van 24 augustus 2026. Dat hoort erbij: de
 * vorige ronde had drie tests die groen stonden zonder ooit te vuren, en dan
 * bewijst groen niets.
 *
 * Wat ze samen bewaken is één regel, en die staat boven alles in dit bestand:
 * liever geen enkel artikel dan één keer zijn puntenSALDO als prijs. Vier van de
 * vijf gaan over dat saldo; de vijfde gaat over de drie andere beloften onder
 * het vinkje — zijn transacties, zijn rekeningnummer en zijn naam. */

/** Een blok in een open schaduwwortel, met een tagnaam die met OPZET niets
 *  zegt: `ing-blok` raakt geen enkele haak, dus wat hier tegengehouden wordt,
 *  wordt op de TEKST of op de NAAM tegengehouden en niet op de vindplaats. */
function blok(html: string, tag = "ing-blok"): Document {
  const { doc, app } = schil();
  app.appendChild(metWortel(doc, tag, html));
  return doc;
}

describe("lek 1 — één ontbrekende spatie zette de hele saldolijst uit", () => {
  /* GEMETEN, met dezelfde DOM en als enige verschil één spatie tussen twee
   * broertjes: zonder die spatie plakt `textContent` "Je puntensaldo" aan
   * "Je hebt 3.450 Punten" vast, en dan faalt élk patroon dat met `\b` begint —
   * dat zijn ze alle zeventien. Het prijspatroon overleeft het wel, want dat
   * heeft alleen een `\b` ná "punten". Precies de verkeerde asymmetrie: de zeef
   * die beschermt viel weg, de zeef die uitpakt bleef staan. */
  it("houdt een saldoblok tegen dat zonder witruimte tussen de elementen staat", () => {
    const doc = blok(
      '<div class="product-card"><h2 class="card-title">Je puntensaldo</h2>' +
        "<p>Je hebt 3.450 Punten</p></div>",
    );
    const ruw = collectIngWinkel(doc);
    const alles = JSON.stringify(ruw);
    expect(alles).not.toContain("3.450");
    expect(alles).not.toContain("3450");
    expect(alles).not.toContain("puntensaldo");
    expect(ruw.kandidaten).toHaveLength(0);
  });

  it("houdt hem ook tegen als de saldoregel tegen zijn ECHTE kaart aan geplakt staat", () => {
    /* Zijn eigen kaartmarkup, met de prijs eruit en een saldoregel direct achter
     * de kop. Zo staat een saldo op een componentenpagina: geen witruimte, want
     * die markup wordt niet met de hand ingesprongen maar door een template
     * uitgespuugd. */
    for (const regel of [
      "Je hebt 12.345 Punten",
      "Jouw stand: 12.345 Punten",
      "Je puntensaldo is 12.345 Punten",
    ]) {
      const kaart = echteKaart()
        .replace(/<div class="points-only-amount">[\s\S]*?<\/div>/, "")
        .replace("</h2>", "</h2><span>" + regel + "</span>");
      const ruw = collectIngWinkel(blok(kaart));
      expect(JSON.stringify(ruw)).not.toContain("12.345");
      expect(ruw.kandidaten).toHaveLength(0);
    }
  });

  it("plakt een artikelnaam die op een cijfer eindigt niet aan de prijs eronder vast", () => {
    /* Dezelfde ontbrekende witruimte, maar dan aan de PRIJSKANT: `textContent`
     * maakt van "JBL Boombox 4" + "500 Punten" één string, en de
     * duizendscheiding in het prijspatroon slikt dat als "4 500 Punten". Negen
     * keer te duur op het scherm, zonder enige aanwijzing dat er iets mis is. */
    const ruw = collectIngWinkel(
      blok(
        '<div class="product-content"><h2 class="card-title">JBL Boombox 4</h2>' +
          "<p>500 Punten</p></div>",
      ),
    );
    expect(ruw.kandidaten).toHaveLength(1);
    expect(ruw.kandidaten[0]!.winkel).toBe("JBL Boombox 4");
    expect(ruw.kandidaten[0]!.prijsTekst).toBe("500 Punten");
    expect(leesPuntenprijs(ruw.kandidaten[0]!.prijsTekst)).toEqual({ punten: 500, bij: null });
  });
});

describe("lek 2 — een saldo zonder signaalwoord, met geen kaart om hem te verdringen", () => {
  /* De van-binnen-naar-buiten-regel beschermt alleen zolang er kaarten IN de
   * omhullende knoop staan. Bij een lege catalogus — en aanbod-content.ts leest
   * ook op 0 ms, dus dat gebeurt écht — is het saldo niet de bijvangst maar het
   * ENIGE dat hij te zien krijgt. Op de code van vóór de schaduwwandeling gaf
   * dezelfde markup nul kandidaten; het is dus een regressie van die wandeling
   * en geen oud gat. */
  it("levert bij een lege catalogus geen saldo als het enige 'artikel'", () => {
    const ruw = collectIngWinkel(
      blok(
        '<div class="product-overview"><h2 class="kop">Punten beschikbaar</h2>' +
          '<div class="points-only-amount"><span><strong>12.345</strong></span> Punten</div>' +
          '<div class="product-grid"></div></div>',
      ),
    );
    expect(JSON.stringify(ruw)).not.toContain("12.345");
    expect(ruw.kandidaten).toHaveLength(0);
  });

  it("herkent elke gemeten vorm van een saldoKOP en niet alleen de zeven verankerde", () => {
    /* GEMETEN LEKLIJST. De naamzeef ving alleen exact-verankerde koppen, dus
     * "Punten" werd tegengehouden en "Puntenstand" niet. Een kop is een saldokop
     * als er, na het wegstrepen van vulwoorden, alléén saldowoorden overblijven
     * — samenstellingen inbegrepen. */
    for (const kop of [
      "Punten",
      "Punten beschikbaar",
      "Je puntentegoed",
      "Totaal punten",
      "Spaarpunten",
      "Puntenstand",
      "Ingezameld",
      "Puntenteller",
      "Jouw saldo",
      "Beschikbare punten",
    ]) {
      const ruw = collectIngWinkel(
        blok(
          '<div class="product-tile"><h2 class="card-title">' +
            kop +
            "</h2>" +
            '<div class="points-only-amount"><span><strong>12.345</strong></span> Punten</div></div>',
        ),
      );
      expect(`${kop}: ${JSON.stringify(ruw.kandidaten)}`).toBe(`${kop}: []`);
    }
  });

  it("laat een gewone artikelnaam wél door, ook al staat er een saldowoord in", () => {
    /* De keerzijde, en die hoort er in dezelfde test bij: de naamzeef mag niet
     * elke kop met het woord "punten" erin opeten. */
    const ruw = collectIngWinkel(
      blok(
        '<div class="product-tile"><h2 class="card-title">Spaarpot van hout</h2>' +
          '<div class="points-only-amount"><span><strong>500</strong></span> Punten</div></div>',
      ),
    );
    expect(ruw.kandidaten.map((k) => k.winkel)).toEqual(["Spaarpot van hout"]);
  });
});

describe("lek 3 — de restsaldo- en betaalbaarheidszinnen op een kaart", () => {
  /* HET GEVAARLIJKSTE LEK VAN DE VIJF, want wat hier doorkomt, komt eruit onder
   * de ECHTE artikelnaam en leest dus als een volstrekt geloofwaardige prijs.
   * Het commentaar bij de drie vormpatronen beweerde dat er op de VORM van zo'n
   * zin gelet werd; gemeten dekten ze 3 van de 16 formuleringen. */
  const RESTSALDO = [
    "Bestel je dit, dan houd je nog 2.200 punten over",
    "Na deze bestelling heb je nog 2.200 punten",
    "Hierna heb je nog 2.200 punten",
    "Dan blijven er 2.200 punten staan",
    "Je saldo wordt 2.200 punten",
    "Overgebleven: 2.200 punten",
    "Resterend: 2.200 punten",
    "Je hebt 2.200 punten",
    "Beschikbaar: 2.200 punten",
    "Punten beschikbaar: 2.200 punten",
    "Nog te besteden: 2.200 punten",
    "Je puntentegoed is 2.200 punten",
    "Je spaart nu 2.200 punten",
    "Huidige stand: 2.200 punten",
    "Jij: 2.200 punten",
    "Je komt 2.200 punten tekort",
    "Nog 2.200 punten nodig",
    "Van jouw 2.200 Punten",
    "2.200 Punten beschikbaar",
    "Met 2.200 Punten kun je dit kopen",
  ];

  it("laat de kaart vallen bij elke gemeten restsaldo- of betaalbaarheidszin", () => {
    for (const zin of RESTSALDO) {
      const ruw = collectIngWinkel(
        blok(
          '<div class="product-content"><h2 class="card-title">JBL Boombox 4 25% kortingsvoucher</h2>' +
            "<p>" +
            zin +
            "</p>" +
            '<div class="points-only-amount"><span><strong>500</strong></span> Punten</div></div>',
        ),
      );
      expect(`${zin} -> ${JSON.stringify(ruw.kandidaten)}`).toBe(`${zin} -> []`);
    }
  });

  it("laat dezelfde kaart zonder zo'n zin gewoon door", () => {
    const ruw = collectIngWinkel(blok(echteKaart()));
    expect(ruw.kandidaten.map((k) => k.prijsTekst)).toEqual(["500 Punten"]);
  });
});

describe("lek 4 — de saldo-zeef las minder tekst dan de prijs-zeef", () => {
  it("kijkt voor het saldo verder dan voor de prijs", () => {
    /* `const tekst = plat(...).slice(0, 600)` gold voor ALLEBEI. Staat het getal
     * vooraan en het signaalwoord achteraan — precies de vorm van een saldoblok
     * met een uitlegzin eronder — dan haalt de prijszeef het getal wél en mist
     * de saldozeef zijn eigen woord. De invariant die dat dichtzet: wat de
     * prijszeef leest is een PREFIX van wat de saldozeef leest. */
    /* De uitlegzin draagt met OPZET geen enkel woord dat een andere zeef zou
     * pakken: geen "je" of "over" bij het bedrag in de buurt, geen datum, geen
     * haak. Het enige dat dit blok verraadt is het woord "puntensaldo", en dat
     * staat voorbij teken 600. Zonder de ruimere beschermingslezing is deze test
     * rood — dat is nagemeten door BESCHERMING_MAX tijdelijk op 600 te zetten. */
    const uitleg = "Dit product komt uit de catalogus en wordt bezorgd door de fabrikant. ".repeat(
      10,
    );
    const ruw = collectIngWinkel(
      blok(
        '<div class="product-card"><h2 class="kop">Bluetoothspeaker met lampjes</h2>' +
          '<div class="points-amount">12.345 Punten</div>' +
          "<p>" +
          uitleg +
          "Dat is jouw puntensaldo.</p></div>",
      ),
    );
    expect(uitleg.length).toBeGreaterThan(600);
    expect(JSON.stringify(ruw)).not.toContain("12.345");
    expect(ruw.kandidaten).toHaveLength(0);
  });
});

describe("lek 5 — de drie andere beloften onder het vinkje", () => {
  /* ING_WAT_NIET belooft er VIJF: geen puntensaldo, geen saldo, geen
   * transacties, geen rekeningnummer, geen naam. De eerste twee hebben drie
   * zeven; de andere drie hadden er tot nu toe NUL. Zolang de lezer alleen in
   * het lichte dom keek, hield die blindheid ze tegen — de schaduwwandeling
   * haalt precies die barrière weg en zet hem in élk onderdeel van
   * mijn.ing.nl/punten. */
  it("laat zijn NAAM niet als artikelnaam doorgaan", () => {
    const ruw = collectIngWinkel(
      blok(
        '<div class="products-overview"><h1 class="page-title">Hallo Alexander, welkom in de ING Winkel</h1>' +
          '<div class="points-amount">3.450 Punten</div></div>',
      ),
    );
    const alles = JSON.stringify(ruw);
    expect(alles).not.toContain("Alexander");
    expect(alles).not.toContain("3.450");
    expect(ruw.kandidaten).toHaveLength(0);
  });

  it("laat zijn PUNTENTRANSACTIES niet als artikelen doorgaan", () => {
    /* Een transactieregel is een winkelnaam, een aantal punten en een datum.
     * Alle drie de saldo-zeven kijken naar saldowoorden, en een winkelnaam is
     * er geen — dus kwam "Albert Heijn Amsterdam Zuid / 120 Punten" er als
     * aanbieding uit. Wat een transactieregel verraadt is de KALE datum: op een
     * productkaart staat een datum altijd achter "geldig tot". */
    const ruw = collectIngWinkel(
      blok(
        '<div class="product-list">' +
          '<div class="product-row"><span class="row-title">Albert Heijn Amsterdam Zuid</span>' +
          '<span class="row-amount">120 Punten</span><span class="row-date">22 augustus 2026</span></div>' +
          '<div class="product-row"><span class="row-title">Shell Rotterdam</span>' +
          '<span class="row-amount">45 Punten</span><span class="row-date">21 augustus 2026</span></div>' +
          "</div>",
      ),
    );
    const alles = JSON.stringify(ruw);
    expect(alles).not.toContain("Albert Heijn");
    expect(alles).not.toContain("Shell");
    expect(ruw.kandidaten).toHaveLength(0);
  });

  it("laat een kaart met een geldig-tot-datum wél door, want dat is geen transactie", () => {
    /* De keerzijde van de datumregel, en zonder deze test is ze te grof. */
    const ruw = collectIngWinkel(
      blok(
        '<div class="product-content"><h2 class="card-title">Cadeaubon boekhandel</h2>' +
          "<p>2.500 punten</p><p>Geldig tot en met 30 november 2026</p></div>",
      ),
    );
    expect(ruw.kandidaten.map((k) => k.winkel)).toEqual(["Cadeaubon boekhandel"]);
    expect(ruw.kandidaten[0]!.totRuw).toContain("30 november 2026");
  });

  it("laat zijn REKENINGNUMMER niet als artikelnaam doorgaan", () => {
    const ruw = collectIngWinkel(
      blok(
        '<div class="product-card"><h3 class="product-title">Betaalrekening NL12 INGB 0001 2345 67</h3>' +
          '<div class="points">1.250 Punten</div></div>',
      ),
    );
    const alles = JSON.stringify(ruw);
    expect(alles).not.toContain("NL12");
    expect(alles).not.toContain("1.250");
    expect(ruw.kandidaten).toHaveLength(0);
  });

  it("houdt dezelfde drie ook tegen als ze door leesIngAanbod heen gaan", () => {
    /* De zeef zit in `collectIngWinkel`, maar wat telt is wat er in de OPSLAG
     * belandt. Deze regel loopt de hele weg af, want een kandidaat die pas in
     * `leesAanbod` sneuvelt, sneuvelt om de verkeerde reden. */
    const { doc, app } = schil();
    app.appendChild(
      metWortel(
        doc,
        "ing-blok",
        '<div class="products-overview"><h1 class="page-title">Hallo Alexander</h1>' +
          '<div class="points-amount">3.450 Punten</div></div>' +
          '<div class="product-card"><h3 class="product-title">Betaalrekening NL12 INGB 0001 2345 67</h3>' +
          '<div class="points">1.250 Punten</div></div>',
      ),
    );
    app.appendChild(metWortel(doc, "product-card", echteKaart()));

    const { aanbiedingen } = leesIngAanbod(collectIngWinkel(doc), NU);
    expect(aanbiedingen.map((a) => a.winkel)).toEqual(["JBL Boombox 4 25% kortingsvoucher"]);
    const alles = JSON.stringify(aanbiedingen);
    expect(alles).not.toContain("Alexander");
    expect(alles).not.toContain("NL12");
    expect(alles).not.toContain("3.450");
  });
});
