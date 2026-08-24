/* DE ING WINKEL LEZEN. De tweede aanbiedingenbron, en hij lijkt minder op de
 * eerste dan je zou hopen.
 *
 * ── WAT DE ING WINKEL IS, en dit is de belangrijkste alinea van dit bestand ─
 *
 * Niet: een lijst met kortingen bij winkels, zoals bij Amex. Wel: de eigen
 * webwinkel van ING, waar hij zijn ING Punten uitgeeft aan producten en
 * vouchers. Dat is geen detail — het verandert wat er aan een kassa gezegd mag
 * worden, en het verandert de koppeling aan een winkel.
 *
 * Dit is niet aangenomen maar gelezen, in de voorwaarden van ING zelf. Op
 * 24 augustus 2026 opgehaald met kale curl en een gewone browser-UA:
 *
 *   https://assets.ing.com/m/410cccd97ce258bd/original/
 *     Voorwaarden-ING-Punten-vanaf-1-oktober-2025.pdf   HTTP 200, 127.289 bytes
 *
 * Wat daarin staat, woordelijk:
 *
 *   "Je kunt ING Punten alleen online uitgeven in de ING Winkel. De ING Winkel
 *    is te vinden via https://www.ing.nl/punten"
 *
 *   "Je betaalt de meeste producten met Punten, plus een bij te betalen bedrag.
 *    Soms wissel je alleen Punten in, zoals bij kortingsbonnen. Het aantal
 *    Punten en het bij te betalen bedrag vermelden we bij het product"
 *
 *   "Aanbiedingen zijn tijdelijk. Ze zijn geldig tot de datum die bij de
 *    aanbieding staat, maar op=op"
 *
 *   "Bestellen en betalen kan alleen via Mijn ING (internetbankieren)."
 *
 *   "ING heeft het recht om het aantal te besteden ING Punten per artikel
 *    tijdelijk of permanent te wijzigen"
 *
 * Daaruit volgt de hele vorm van dit bestand: een regel is ARTIKEL + AANTAL
 * PUNTEN + eventueel een BIJ TE BETALEN BEDRAG + een EINDDATUM. Geen percentage,
 * geen winkelnaam.
 *
 * ── WAT DAT BETEKENT VOOR DE KOPPELING AAN EEN WINKEL ──────────────────────
 *
 * Bij Amex is "30% korting bij JBL" een aanbieding die hij AAN DE KASSA VAN
 * JBL gebruikt. Hem daar neerzetten is precies goed.
 *
 * "Een JBL-speaker voor 1.250 punten plus € 19,95" is iets anders: dat koopt hij
 * BIJ ING, via Mijn ING, en niet bij JBL. Op de kassa van jbl.nl is dat dus geen
 * aanbieding die hij daar kan gebruiken. De Amex-zin ("er ligt hier een
 * aanbieding voor je") zou daar een onwaarheid zijn.
 *
 * In de praktijk komt het bijna nooit zover, en dat is precies de bedoeling: een
 * productkaart in de winkel van ING linkt naar ING en niet naar de fabrikant,
 * dus `domeinVanKaart` levert null op en er verschijnt aan een kassa NIETS. Dat
 * is geen gebrek in de lezer maar het goede antwoord. De verleiding om dat te
 * repareren met een merknaamvergelijking ("de kaart zegt JBL, de winkel heet
 * jbl.nl") is dezelfde fout die bij Amex al is afgewezen — en hier erger, want
 * dan zou een AANKOOP BIJ ING op de kassa van een andere winkel verschijnen. De
 * lijst hoort thuis in het werkbalkvenster en in het optiescherm, waar hij een
 * lijst is en geen bewering over de pagina waar hij op staat.
 *
 * ── IS DIE PAGINA BEREIKBAAR? GEMETEN, EN HET ANTWOORD IS NEE ──────────────
 *
 * Op 24 augustus 2026 vanaf deze machine, met een gewone browser-UA:
 *
 *   https://www.ing.nl/                 code 000 — geen HTTP-antwoord
 *   https://www.ing.nl/particulier/...  code 000 — geen HTTP-antwoord
 *   https://example.com                 HTTP 200, 559 bytes
 *   https://global.americanexpress.com/offers/eligible  HTTP 200, 676.541 bytes
 *
 * Dat "000" is geen storing en geen netwerkprobleem aan onze kant. DNS lost op
 * (www.ing.nl → Akamai, 184.24.26.239), de TCP-verbinding komt tot stand, en de
 * TLS-handshake wordt compleet afgerond met een echt ING-certificaat
 * (O=ING Groep N.V., CN=www.ing.nl, uitgegeven door HydrantID). Pas daarna
 * verbreekt de server de HTTP/2-stroom: "stream 1 was not closed cleanly:
 * INTERNAL_ERROR". Met HTTP/1.1 afgedwongen loopt het verzoek in een time-out.
 *
 * Dat is dus een WEIGERING op applicatieniveau — botbeheer van Akamai — en geen
 * afwezigheid. Een weigering is een antwoord: hij staat hier genoteerd en er is
 * niet geprobeerd hem te omzeilen.
 *
 * De pagina zelf bestaat wel en is via een andere weg wel opgevraagd:
 * https://www.ing.nl/punten geeft de kop "Welkom in de ING Winkel" en verder een
 * lege schil — de catalogus wordt, net als bij Amex, ná het laden in de browser
 * opgebouwd.
 *
 * ── DE GRENS VAN DEZE CODE, en die is groter dan bij Amex ──────────────────
 *
 * DE ECHTE ING WINKEL IS NOOIT GEZIEN — niet uitgelogd (botbeheer) en niet
 * ingelogd (daar is zijn account voor nodig). Van de Amex-pagina was tenminste
 * de uitgelogde schil gemeten, zodat de vorm van de klassenamen bekend was. Hier
 * is zelfs dat er niet. De selectorlijst en de patronen hieronder zijn dus
 * volledig gebouwd op HTML die ik zelf heb gemaakt, en dat is een zwakkere basis
 * dan bij Amex. Wat er wél op rust is de VORM van de gegevens, en die komt uit
 * de voorwaarden hierboven en niet uit een aanname.
 *
 * De consequentie staat in de code in plaats van in een voorbehoud: vindt de
 * lezer niets, dan zegt hij dát, met de echte oorzaak erbij, en er blijft geen
 * oude lijst staan die er vers uitziet. Dat is het stuk dat HIJ moet verifiëren
 * voordat dit iets waard is — en het staat ook in het optiescherm, waar hij ja
 * zegt, en niet alleen hier. */

import type { Bron, RuwAanbod, RuweLezing, Aanbieding, Lezing } from "./aanbod-kern.js";
import {
  urlValtBinnen,
  leesAanbod as leesAanbodKern,
  domeinVanKaart as domeinVanKaartKern,
} from "./aanbod-kern.js";

/* ─────────────────────────── waar we mogen kijken ─────────────────────────── */

/** Het ene adres dat deze extensie op ing.nl mag lezen.
 *
 *  HET ADRES KOMT UIT DE VOORWAARDEN VAN ING ZELF en is niet geraden: "De ING
 *  Winkel is te vinden via https://www.ing.nl/punten". Dat is ook nagegaan — de
 *  pagina geeft "Welkom in de ING Winkel" terug. Vier andere paden die voor de
 *  hand leken te liggen (`/particulier/winkel`, `/particulier/aanbiedingen`,
 *  `/particulier/kortingen`, `/zakelijk/winkel`) geven alle vier een HTTP 404,
 *  dus die staan er niet in.
 *
 *  Het pad is smal met opzet. `/punten` is de winkel; zijn rekeningoverzicht,
 *  zijn transacties en zijn saldo staan op Mijn ING en op andere paden, en die
 *  vallen hierbuiten. Chrome dwingt dat af omdat dit patroon letterlijk naar
 *  `permissions.request` en naar `registerContentScripts` gaat, en de build
 *  weigert een patroon dat een heel domein aanwijst.
 *
 *  Het staat op `www.ing.nl` en niet op `mijn.ing.nl`, en dat is een bewuste
 *  beperking: bestellen gebeurt volgens de voorwaarden via Mijn ING, maar
 *  daarvoor hoeft LaVega niet mee te kijken. De winkel bekijken is genoeg. */
export const ING_MATCH = "https://www.ing.nl/punten*";

/** Het id waaronder dit in de opslag en in de registratie staat. */
export const ING_ID = "ing-winkel";

export const ING_LABEL = "Mijn ING Winkel lezen";

/** Wat er gelezen en bewaard wordt. Gaat onbewerkt naar het optiescherm. */
export const ING_WAT_WEL: readonly string[] = [
  "welk artikel er in de ING Winkel staat",
  "hoeveel punten het kost en wat je er eventueel bij betaalt",
  "tot wanneer de aanbieding loopt",
];

/** En wat niet.
 *
 *  "JE PUNTENSALDO" STAAT HIER BOVENAAN EN DAT IS GEEN BELEEFDHEID. Op de
 *  winkelpagina van ING staat vrijwel zeker hoeveel punten hij HEEFT, en dat
 *  getal staat er in exact dezelfde vorm als een puntenPRIJS: een getal met het
 *  woord "punten" erachter. Dit is de scherpste redactiegrens in dit bestand, en
 *  hij wordt hieronder afgedwongen door kaarten met een saldo-aanwijzing
 *  helemaal te laten vallen — niet door het getal er achteraf uit te filteren. */
export const ING_WAT_NIET: readonly string[] = [
  "je puntensaldo",
  "je saldo",
  "je transacties",
  "je rekeningnummer",
  "je naam",
];

/** De bron zoals de rest van de extensie hem gebruikt. */
export const ING_BRON: Bron = {
  id: ING_ID,
  label: ING_LABEL,
  match: ING_MATCH,
  merk: "ING",
  paginaNaam: "de ING Winkel",
  watWel: ING_WAT_WEL,
  watNiet: ING_WAT_NIET,
  sleutels: { aan: "ingAan", aanbod: "ingAanbiedingen", lezing: "ingLezing" },
  eigenHosts: ["ing.nl", "ing.com", "ingbank.nl"],
  prijsSoort: "punten",
  uitleg:
    "In de ING Winkel geef je je ING Punten uit. Let op: dat is iets anders dan een korting bij een " +
    "winkel — je koopt er producten en vouchers BIJ ING, en betaalt volgens de voorwaarden van ING " +
    "\"de meeste producten met Punten, plus een bij te betalen bedrag\". LaVega leest dus wat er in die " +
    "winkel staat en voor hoeveel punten, en niet wat je ergens anders korting krijgt. Bestellen gaat " +
    "via Mijn ING; daar kijkt LaVega niet mee.",
  voorbehoud:
    "Eerlijk over de grens, en die is hier groter dan bij Amex: de ING Winkel is bij het bouwen nooit " +
    "gezien. Niet ingelogd (daar is jouw account voor nodig) en ook niet uitgelogd — www.ing.nl weigert " +
    "verzoeken van deze machine op 24 augustus 2026 na een geslaagde TLS-verbinding, wat botbeheer is en " +
    "geen storing. Die weigering is niet omzeild. De lezer is dus volledig op nagebouwde HTML gemaakt; " +
    "wat er wél op rust is de vorm van de gegevens, en die komt uit de voorwaarden van ING zelf. Vindt " +
    "hij bij jou niets, dan zegt hij dát met de reden erbij.",
  collect: collectIngWinkel,
};

/** Valt deze volledige URL binnen de ING Winkel? */
export function ingUrlIsWinkel(url: string): boolean {
  return urlValtBinnen(ING_MATCH, url);
}

/** De twee kernfuncties met de ING-bron er al aan vast. Geen tweede
 *  implementatie — alleen de descriptor ingevuld. */
export function leesIngAanbod(
  ruw: RuweLezing,
  asOf: string,
): { lezing: Lezing; aanbiedingen: Aanbieding[] } {
  return leesAanbodKern(ruw, asOf, ING_BRON);
}

export function ingDomeinVanKaart(ruw: RuwAanbod): string | null {
  return domeinVanKaartKern(ruw, ING_BRON.eigenHosts);
}

/* ────────────────────────── het aftasten van de pagina ────────────────────── */

/** Haalt de artikelen uit een Document.
 *
 *  STAAT OP ZICHZELF, net als `collectAanbod` in amex.ts en om dezelfde reden:
 *  Chrome verstuurt deze functie als TEKST naar de pagina, dus alles wat ze van
 *  buiten zou gebruiken bestaat daar niet. Dat de vorm op `collectAanbod` lijkt
 *  is dus geen kopie die opgeruimd moet worden — het is de ene plek waar delen
 *  technisch onmogelijk is. Alles wat er wél gedeeld kan worden (de koppelregel,
 *  de datum, de puntenprijs, de zeef, de toestanden) staat in aanbod-kern.ts en
 *  staat hier NIET.
 *
 *  WAT ER MEEKOMT is per kaart: de artikelnaam (60), de prijsvormen (120 samen),
 *  de datumaanduiding (40) en de hostnamen van de links (vijf). Niet de tekst van
 *  de kaart, niet de tekst van de pagina, en niets buiten de kaarten. */
export function collectIngWinkel(doc?: Document | null): RuweLezing {
  const d: Document = doc ?? document;

  /* De selectorlijst. Deze is een GOK en dat kan hier niet anders: de echte
   * winkel is nooit gezien, uitgelogd niet (botbeheer) en ingelogd niet. Wat
   * hier staat zijn de haken die een webwinkel gewoonlijk draagt. Levert het
   * niets op, dan zegt de lezer dat met zoveel woorden in plaats van te zwijgen. */
  const SELECTORS = [
    "[data-test*='product' i]",
    "[data-testid*='product' i]",
    "[data-product-id]",
    "[data-article-id]",
    "[class*='product' i]",
    "[class*='artikel' i]",
    "[class*='webshop' i]",
  ];

  /* De vormen waarin een prijs in de ING Winkel staat. Alleen wat hierop past,
   * verlaat de pagina.
   *
   * DE PUNTEN EN HET BEDRAG WORDEN ALLEBEI GEKNIPT maar niet uitgerekend: het
   * uitpluizen gebeurt in `leesPuntenprijs` in aanbod-kern.ts, in code die
   * zonder browser te testen is. Hier wordt alleen bepaald WAT er meekomt. */
  const PRIJS = [
    /\d{1,3}(?:[. ]\d{3})*\s?(?:ing[\s-]?)?punten\b/i,
    /(?:\+|bij\s?betalen|bij te betalen|bijbetaling)\s*:?\s*€\s?\d{1,5}(?:[.,]\d{2})?/i,
    /€\s?\d{1,5}(?:[.,]\d{2})?\s*(?:bij\s?betalen|bij te betalen|erbij)/i,
  ];

  /* DE SALDO-AANWIJZINGEN, en dit is de scherpste grens in dit bestand.
   *
   * Zijn puntenSALDO staat op deze pagina in dezelfde vorm als een
   * puntenPRIJS: een getal met "punten" erachter. Het patroon hierboven kan de
   * twee niet uit elkaar houden, en een saldo dat als prijs de extensie in
   * glipt is precies wat er in ING_WAT_NIET beloofd wordt dat niet gebeurt.
   *
   * Dus wordt een kaart waarin een saldo-aanwijzing staat HELEMAAL laten
   * vallen, en niet "schoongemaakt". Een filter achteraf zou het getal moeten
   * herkennen dat het net niet herkende; weggooien is de enige bewerking die
   * niet van diezelfde herkenning afhangt. Kost dat een enkel echt artikel
   * waarin toevallig het woord "saldo" staat? Ja. Dat is de goede kant om op te
   * verliezen. */
  const SALDO = [
    /\bje\s+(?:hebt|heb|houdt|houd|spaart|spaar)\b/i,
    /\bpuntensaldo\b/i,
    /\b(?:je|jouw|mijn|uw)\s+saldo\b/i,
    /\bbeschikbare?\s+punten\b/i,
    /\b(?:mijn|jouw)\s+punten\b/i,
    /\bpuntenteller\b/i,
    /* DEZE DRIE ZIJN ERBIJ GEKOMEN DOORDAT DE TEST ZE VOND. De eerste versie van
     * deze lijst keek naar "je hebt", "puntensaldo" en "je saldo", en liet
     * "Bestel je dit, dan houd je nog 2.200 punten over" gewoon door. Dat is een
     * SALDO in precies de vorm van een prijs, op een kaart die op de
     * selectorlijst past. Dat het getal er toen niet uit kwam, was geluk: het
     * prijspatroon had de échte prijs al eerder op de kaart gevonden. Stond de
     * restsaldozin bóven de prijs, dan was zijn saldo als puntenprijs opgeslagen.
     *
     * Dus staat er nu ook op de VORM van zo'n zin, en niet alleen op een
     * woordenlijst: wat er na de aankoop overblijft, wat resterend is, en wat
     * "nog N punten over" heet. */
    /\bhoud\w*\s+je\b/i,
    /\bresterend/i,
    /\bnog\s+[\d.\s]+\s*punten\s+over\b/i,
    /\bover\s+na\s+(?:deze\s+)?(?:aankoop|bestelling)\b/i,
  ];

  /* En de vormen waarin een einddatum staat. Er wordt hier niets uitgerekend.
   *
   * "op=op" staat er NIET bij, en dat is met opzet: dat voorbehoud geldt volgens
   * de voorwaarden van ING voor ELKE aanbieding in de winkel, niet alleen voor
   * de kaarten waar het toevallig op staat. Het hoort dus in de zin (lines.ts)
   * en niet in wat we van de pagina knippen. */
  const DATUM = [
    /(?:geldig tot(?: en met)?|t\/m|tot en met|te bestellen tot|actie loopt tot|loopt tot|verloopt op|tot)\s*:?\s*(?:\d{1,2}\s*[\/.\-]\s*\d{1,2}\s*[\/.\-]\s*\d{2,4}|\d{1,2}\s+[a-z]{3,9}\.?\s+\d{4}|\d{4}-\d{2}-\d{2})/i,
    /(?:verloopt over|nog|te bestellen tot over)\s+\d{1,3}\s*(?:dagen|dag)/i,
  ];

  const plat = (s: string): string => s.replace(/\s+/g, " ").trim();

  const kandidaten: RuwAanbod[] = [];
  const gekozen: Element[] = [];
  let markers = 0;

  const knopen: Element[] = [];
  for (const sel of SELECTORS) {
    let gevonden: NodeListOf<Element>;
    try {
      gevonden = d.querySelectorAll(sel);
    } catch {
      continue;
    }
    markers += gevonden.length;
    for (const n of Array.from(gevonden)) if (!knopen.includes(n)) knopen.push(n);
  }

  /* Van binnen naar buiten, zodat een omhullende lijst niet als kaart meetelt. */
  knopen.sort((a, b) => {
    const diep = (n: Element): number => {
      let t = 0;
      let p: Element | null = n;
      while (p) {
        t++;
        p = p.parentElement;
      }
      return t;
    };
    return diep(b) - diep(a);
  });

  for (const knoop of knopen) {
    if (kandidaten.length >= 60) break;
    if (gekozen.some((g) => knoop.contains(g))) continue;

    const tekst = plat(knoop.textContent ?? "").slice(0, 600);
    if (tekst === "") continue;

    /* Eerst de saldo-grens, vóór alle andere patronen. Wat hier afgaat, verlaat
     * de pagina niet — ook de artikelnaam niet. */
    let saldo = false;
    for (const patroon of SALDO) {
      if (patroon.test(tekst)) {
        saldo = true;
        break;
      }
    }
    if (saldo) continue;

    /* Overlappende treffers eruit, en de volgorde van de KAART aanhouden — het
     * aantal punten staat er meestal vóór het bij te betalen bedrag, en zo leest
     * hij het ook. */
    const treffers: { index: number; tekst: string }[] = [];
    for (const patroon of PRIJS) {
      const m = patroon.exec(tekst);
      if (!m) continue;
      const van = m.index;
      const tot = m.index + m[0].length;
      if (treffers.some((t) => van < t.index + t.tekst.length && t.index < tot)) continue;
      treffers.push({ index: van, tekst: plat(m[0]) });
    }
    if (treffers.length === 0) continue;
    treffers.sort((a, b) => a.index - b.index);

    /* De artikelnaam: een expliciete haak, dan een kop, dan de tekst van de
     * eerste link. Nooit "de eerste regel van de kaart" — dat is paginatekst. */
    let naam = "";
    const haak = knoop.querySelector(
      "[data-test*='title' i], [data-testid*='title' i], [class*='title' i], [class*='naam' i]",
    );
    if (haak) naam = plat(haak.textContent ?? "");
    if (naam === "") {
      const kop = knoop.querySelector("h1, h2, h3, h4, h5, h6");
      if (kop) naam = plat(kop.textContent ?? "");
    }
    if (naam === "") {
      const link = knoop.querySelector("a[href]");
      if (link) naam = plat(link.textContent ?? "");
    }
    if (naam === "") continue;

    let totRuw = "";
    for (const patroon of DATUM) {
      const m = patroon.exec(tekst);
      if (m) {
        totRuw = plat(m[0]);
        break;
      }
    }

    const hosts: string[] = [];
    for (const a of Array.from(knoop.querySelectorAll("a[href]")).slice(0, 12)) {
      const rauw = a.getAttribute("href") ?? "";
      if (rauw === "" || rauw.startsWith("#")) continue;
      try {
        const u = new URL(rauw, d.baseURI);
        if (u.protocol !== "https:" && u.protocol !== "http:") continue;
        const h = u.hostname.toLowerCase();
        if (h !== "" && !hosts.includes(h) && hosts.length < 5) hosts.push(h);
      } catch {
        continue;
      }
    }

    kandidaten.push({
      winkel: naam.slice(0, 60),
      prijsTekst: treffers.map((t) => t.tekst).join(" · ").slice(0, 120),
      totRuw: totRuw.slice(0, 40),
      hosts,
    });
    gekozen.push(knoop);
  }

  /* ── IS HIJ INGELOGD? ──────────────────────────────────────────────────────
   *
   * Bij Amex is dit één regel: staat er een wachtwoordveld. Bij ING waarschijnlijk
   * niet, en dat is de reden dat er hier meer staat. Inloggen gebeurt volgens de
   * voorwaarden via Mijn ING — "Bestellen en betalen kan alleen via Mijn ING
   * (internetbankieren)" — dus op www.ing.nl/punten staat vermoedelijk geen
   * wachtwoordveld maar een KNOP die daarheen wijst. Alleen op een wachtwoordveld
   * afgaan zou hier dus "geen aanbiedingenblok" opleveren terwijl de echte
   * oorzaak "je bent niet ingelogd" is, en dat is precies een melding die de
   * verkeerde oorzaak noemt.
   *
   * Daarom twee aanwijzingen, allebei POSITIEF vastgesteld:
   *   - een wachtwoordveld (zoals bij Amex), of
   *   - een link of knop die naar Mijn ING wijst én waarvan de TEKST met
   *     "inloggen" of "log in" begint.
   *
   * Die tweede is streng gehouden. "Mijn ING" alleen is niet genoeg: dat staat
   * op elke pagina van ing.nl, ook als hij is ingelogd. De tekst moet het woord
   * dragen, en dan nog telt het alleen als er geen enkele kaart uit is gekomen —
   * die volgorde zit in `leesAanbod` in aanbod-kern.ts.
   *
   * DIT IS EEN GOK OP EEN PAGINA DIE NIET IS GEZIEN. Hij kan te streng zijn (dan
   * zegt de melding "geen aanbiedingenblok" waar "niet ingelogd" hoorde te
   * staan) of te ruim (dan andersom). Wat hij niet kan, is een saldo of een naam
   * meenemen: er wordt alleen naar het BESTAAN van een element gekeken, en
   * nergens naar de waarde van een veld. */
  let inlogformulier = d.querySelector("input[type='password']") !== null;
  if (!inlogformulier) {
    for (const a of Array.from(d.querySelectorAll("a[href], button")).slice(0, 200)) {
      const t = plat(a.textContent ?? "");
      if (!/^(?:inloggen|log ?in)\b/i.test(t)) continue;
      const href = a.getAttribute("href") ?? "";
      if (href === "") continue;
      try {
        const u = new URL(href, d.baseURI);
        const h = u.hostname.toLowerCase();
        if (h === "mijn.ing.nl" || h.endsWith(".mijn.ing.nl") || /\/(?:login|inloggen)\b/i.test(u.pathname)) {
          inlogformulier = true;
          break;
        }
      } catch {
        continue;
      }
    }
  }

  /* ZEGT DE PAGINA ZELF DAT ER NIETS IS? Een uitgesproken nul is een antwoord en
   * geen mislukking. Alleen binnen de gevonden knopen, en alleen als er geen
   * kaart uit is gekomen. */
  const GEEN = [
    /(?:momenteel|op dit moment|nu)?\s*geen (?:producten|artikelen|aanbiedingen)[^.]{0,60}/i,
    /er zijn (?:op dit moment )?geen (?:producten|artikelen|aanbiedingen)[^.]{0,60}/i,
    /de (?:ing )?winkel is (?:tijdelijk )?(?:gesloten|niet beschikbaar)[^.]{0,60}/i,
    /(?:alles|alle artikelen) is uitverkocht[^.]{0,60}/i,
  ];
  let geenAanbiedingen = "";
  if (kandidaten.length === 0) {
    for (const knoop of knopen) {
      const t = plat(knoop.textContent ?? "").slice(0, 400);
      if (t === "") continue;
      for (const patroon of GEEN) {
        const m = patroon.exec(t);
        if (m) {
          geenAanbiedingen = plat(m[0]).slice(0, 120);
          break;
        }
      }
      if (geenAanbiedingen !== "") break;
    }
  }

  return { inlogformulier, geenAanbiedingen, markers, kandidaten };
}
