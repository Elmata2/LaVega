/* ZIJN EIGEN AMEX-AANBIEDINGEN LEZEN. Dit bestand is de stap naar binnen, en het
 * is de eerste plek waar deze extensie iets aanraakt waar hij is ingelogd.
 *
 * WAT HIER NOG STAAT EN WAT NIET MEER. Sinds er een tweede bron is (de ING
 * Winkel, zie ing.ts) staat alles wat niet per bron verschilt in aanbod-kern.ts:
 * de koppelregel, het lezen van een einddatum, de verouderingsgrenzen, de zeef
 * en de toestanden. Hier blijft over wat écht van Amex is — het adres, de tekst
 * van de vraag, en het aftasten van deze ene pagina. Waarom dat zo gesplitst is,
 * staat in de kop van aanbod-kern.ts; de korte versie is dat twee kopieën van
 * `hoortBijWinkel` betekent dat een reparatie er maar één bereikt.
 *
 * ── WAAROM DIT DE ENIGE WEG IS, en dat is gemeten en niet aangenomen ────────
 *
 * De aanbiedingen zijn PERSOONLIJK. Op 22 augustus 2026 zelf opgehaald met kale
 * curl en een gewone browser-UA, redirects gevolgd:
 *
 *   https://global.americanexpress.com/offers/eligible   HTTP 200, 676.522 bytes
 *
 * Op 24 augustus 2026 opnieuw gemeten: HTTP 200, 676.541 bytes. Nog steeds de
 * SCHIL van de app — `<div id="root">` met de globale koptekst erin, en in de
 * modulelijst `axp-offers-container`, `axp-offers-hub` en `axp-offers`: bundels
 * die de aanbiedingen NA het inloggen in de browser opbouwen. In die 676 kB
 * staat geen enkele aanbieding, geen winkelnaam en geen einddatum. Van buitenaf
 * is er dus niets te lezen, en dat is geen bot-blokkade die je met een andere
 * kop omzeilt: de gegevens zitten achter zijn sessie.
 *
 * MAAR HIJ IS INGELOGD. Een extensie in zijn eigen browser kan zijn eigen pagina
 * lezen. Er gaat nog steeds geen byte naar een server.
 *
 * ── DE TOESTEMMING IS HET ONTWERP, en niet een vinkje eromheen ──────────────
 *
 * Vier dingen, en ze zitten alle vier in de code en niet in een belofte:
 *
 *   1. APART van de toestemming per winkel, en apart van de ING-schakelaar. Wie
 *      ja zegt tegen "lees de prijs op ikea.nl" heeft daarmee geen ja gezegd
 *      tegen "lees mijn Amex-account", en wie ja zei tegen zijn ING-account ook
 *      niet. Drie vragen, drie antwoorden, drie schakelaars, alle standaard uit.
 *   2. De vraag zegt in gewone taal WAT er gelezen wordt en wat niet. Die tekst
 *      staat in `AMEX_WAT_WEL` / `AMEX_WAT_NIET` en gaat onbewerkt naar het
 *      optiescherm, zodat er niet twee versies van de belofte kunnen bestaan.
 *   3. Uitzetten heeft ONMIDDELLIJK effect en het opgeslagene gaat weg. Een
 *      schakelaar die alleen toekomstig gedrag verandert is geen intrekking; zie
 *      `wisBron` in store.ts en de afhandelaar in background.ts, die ook afgaat
 *      als hij de toestemming in chrome://extensions intrekt.
 *   4. `host_permissions` blijft leeg. Dit loopt via `optional_host_permissions`
 *      op PRECIES het pad van de aanbiedingenpagina, zodat Chrome het afdwingt
 *      en niet onze eigen vlag. De build weigert een patroon dat een heel domein
 *      aanwijst (controle 4 in copy-static.mjs).
 *
 * ── DE GRENS VAN DEZE CODE, en die hoort hier te staan ──────────────────────
 *
 * DE ECHTE, INGELOGDE PAGINA IS NIET GEZIEN. Er is geen manier om vanaf hier in
 * zijn account te komen, dus de lezer is gebouwd op HTML die ik zelf heb
 * gemaakt. Wat wél gemeten is aan de echte pagina, is de vorm van de
 * klassenamen: de schil draagt `_globalHeader_n0dcp_11`,
 * `_hamburgerMenuToggle_n0dcp_111`, `_navSticky_n0dcp_468` — CSS-modules die de
 * betekenisvolle naam vóór de hash bewaren. Daarom staat `[class*="offer" i]` in
 * de selectorlijst: een gok op een gemeten patroon, niet op een verzonnen naam.
 * Het blijft een gok. */

import type { Bron, RuwAanbod, RuweLezing, Aanbieding, Lezing } from "./aanbod-kern.js";
import {
  urlValtBinnen,
  leesAanbod as leesAanbodKern,
  domeinVanKaart as domeinVanKaartKern,
} from "./aanbod-kern.js";

/* Alles wat de rest van de extensie van de kern nodig heeft, loopt hier langs.
 * Dat is geen tweede definitie maar dezelfde binding onder dezelfde naam: er is
 * één implementatie, in aanbod-kern.ts. */
export {
  AANBOD_OUD_NA_DAGEN,
  AANBOD_TE_OUD_NA_DAGEN,
  MOGELIJKE_MATCH_MAX,
  dagenTussen,
  registreerbaarDomein,
  hoortBijWinkel,
  mogelijkeMerknaamMatch,
  mogelijkeProductMatch,
  leesEinddatum,
  leesPuntenprijs,
  aanbodVoorWinkel,
  urlValtBinnen,
} from "./aanbod-kern.js";
export type {
  Bron,
  RuwAanbod,
  RuweLezing,
  Aanbieding,
  Lezing,
  LezingUitkomst,
  AanbodToestand,
  AanbodUitkomst,
  Puntenprijs,
} from "./aanbod-kern.js";

/* ─────────────────────────── waar we mogen kijken ─────────────────────────── */

/** Het ene adres dat deze extensie op americanexpress.com mag lezen.
 *
 *  ÉÉN PATROON EN NIET VIER. De verleiding is om ook
 *  `https://www.americanexpress.com/nl-nl/account/offers*` en een paar andere
 *  gangbare vormen mee te vragen, "voor het geval dat". Dat is precies de vorm
 *  van vragen waar niemand ja op hoort te zeggen: dan staat er in het
 *  toestemmingsvenster meer dan we kunnen verantwoorden. Als zijn
 *  aanbiedingenpagina een ander adres heeft, leest LaVega niets en zegt het
 *  optiescherm dat — met dit adres eronder, zodat hij het kan vergelijken met
 *  wat er in zijn adresbalk staat. Eén regel erbij is dan de reparatie.
 *
 *  Het pad staat erin en dat is geen decoratie: `/offers/eligible` is de lijst
 *  met aanbiedingen. Het overzicht van zijn rekening, zijn transacties en zijn
 *  saldo vallen erbuiten, en Chrome dwingt dat af omdat het matchpatroon dat
 *  hier staat letterlijk naar `permissions.request` en naar
 *  `registerContentScripts` gaat. */
export const AMEX_MATCH = "https://global.americanexpress.com/offers/eligible*";

/** Het id waaronder dit in de opslag en in de registratie staat. */
export const AMEX_ID = "amex-aanbod";

export const AMEX_LABEL = "Mijn Amex-aanbiedingen lezen";

/** Wat er gelezen en bewaard wordt. Gaat onbewerkt naar het optiescherm: één
 *  plek waar de belofte staat, zodat de UI hem niet kan herformuleren. */
export const AMEX_WAT_WEL: readonly string[] = [
  "bij welke winkel een aanbieding voor je klaarstaat",
  "de korting zoals die er staat",
  "tot wanneer hij loopt",
];

/** En wat niet. Even letterlijk, want dit is de helft van de vraag. */
export const AMEX_WAT_NIET: readonly string[] = [
  "je saldo",
  "je transacties",
  "je kaartnummer",
  "je naam",
];

/** De bron zoals de rest van de extensie hem gebruikt. */
export const AMEX_BRON: Bron = {
  id: AMEX_ID,
  label: AMEX_LABEL,
  match: AMEX_MATCH,
  merk: "American Express",
  paginaNaam: "je Amex-aanbiedingenpagina",
  watWel: AMEX_WAT_WEL,
  watNiet: AMEX_WAT_NIET,
  sleutels: { aan: "amexAan", aanbod: "amexAanbiedingen", lezing: "amexLezing" },
  eigenHosts: ["americanexpress.com", "aexp-static.com", "amex.com"],
  prijsSoort: "korting",
  uitleg:
    "Amex zet aanbiedingen klaar die alleen voor jouw kaart gelden — \"30% korting bij deze winkel\", " +
    "\"€ 20 terug bij besteding van € 100\". Die staan achter je login en zijn van buitenaf niet te zien: " +
    "op 24 augustus 2026 gemeten geeft de aanbiedingenpagina zonder login 676.541 bytes terug met alleen " +
    "de schil van de app erin, zonder één aanbieding. In jouw browser ben jíj ingelogd, en daar kan LaVega " +
    "die pagina wél lezen. Er gaat nog steeds niets naar een server.",
  voorbehoud:
    "Eerlijk over de grens: de echte, ingelogde aanbiedingenpagina is bij het bouwen nooit gezien — dat " +
    "kan niet zonder jouw account. De lezer is gemaakt op nagebouwde HTML. Vindt hij bij jou niets, dan " +
    "zegt hij dát, met de reden erbij, en blijft er geen oude lijst staan die vers lijkt.",
  collect: collectAanbod,
};

/** Valt deze volledige URL binnen de aanbiedingenpagina? */
export function amexUrlIsAanbiedingen(url: string): boolean {
  return urlValtBinnen(AMEX_MATCH, url);
}

/** De twee kernfuncties met de Amex-bron er al aan vast. Geen tweede
 *  implementatie — alleen de descriptor ingevuld, zodat de aanroepers hier niet
 *  overal `AMEX_BRON` hoeven mee te geven. */
export function leesAanbod(
  ruw: RuweLezing,
  asOf: string,
): { lezing: Lezing; aanbiedingen: Aanbieding[] } {
  return leesAanbodKern(ruw, asOf, AMEX_BRON);
}

export function domeinVanKaart(ruw: RuwAanbod): string | null {
  return domeinVanKaartKern(ruw, AMEX_BRON.eigenHosts);
}

/* ────────────────────────── het aftasten van de pagina ────────────────────── */

/** Haalt de aanbiedingen uit een Document.
 *
 *  DEZE FUNCTIE STAAT OPZETTELIJK OP ZICHZELF, precies zoals `collectEvidence`
 *  in read.ts: geen imports, geen verwijzing naar iets buiten haar eigen body.
 *  Chrome injecteert haar via `chrome.scripting.executeScript({ func })` en dat
 *  gebeurt door de functie als TEKST te versturen; alles wat ze van buiten zou
 *  gebruiken bestaat daar niet. De selectorlijst en de patronen staan daarom
 *  hieronder als literal in de body, en nergens anders — ze zijn met opzet NIET
 *  gedeeld met de rest van het bestand, want een gedeelde constante zou hier
 *  compileren en in de pagina `undefined` zijn. Dat geldt ook voor het delen met
 *  ing.ts: die heeft zijn eigen kopie van deze vorm, en dat is de ene plek waar
 *  twee kopieën niet te vermijden zijn. Ze lezen dan ook verschillende pagina's.
 *
 *  DEZE FUNCTIE KIEST NIET en ze VERTAALT NIET. Ze knipt uit wat op een patroon
 *  past en laat `leesAanbod` beslissen. Dat is niet alleen netjes: de beslissing
 *  hoort in code die te testen is zonder browser, want de enige browser waarin
 *  deze functie echt iets vindt, is de zijne.
 *
 *  ER GAAT GEEN DATUM IN. De peildatum hoort bij `leesAanbod` en niet hier: die
 *  functie zet "verloopt over 5 dagen" om in een datum, en dat is een BESLISSING
 *  die in testbare code hoort.
 *
 *  WAT ER MEEKOMT is per kaart: de kop (60), de kortingsvormen (120 samen), de
 *  datumaanduiding (40) en de hostnamen van de links (vijf). Niet de tekst van
 *  de kaart, niet de tekst van de pagina, en niets buiten de kaarten.
 *
 *  ── EEN GEMETEN BLINDE VLEK DIE HIER MET OPZET BLIJFT STAAN ───────────────
 *
 *  Deze functie kijkt alleen in het LICHTE dom: `d.querySelectorAll`, `d.query
 *  Selector("input[type='password']")` en de GEEN-scan lopen geen van drieën
 *  door een schaduwwortel heen. Zet Amex zijn aanbiedingen in webcomponenten,
 *  dan meldt deze lezer `markers === 0` op een pagina die vol staat — precies de
 *  fout die de ING-kant op 24 augustus 2026 gemaakt heeft. `collectIngWinkel` in
 *  ing.ts heeft daar sindsdien een wandeling over schaduwwortels voor, met de
 *  varianttests eronder; die zijn hier zo over te nemen.
 *
 *  WAAROM DAT HIER TOCH NIET GEBEURD IS, en dat is een keuze en geen
 *  vergeetachtigheid:
 *
 *   1. ER IS GEEN METING DIE ZEGT DAT HET HIER BIJT. Bij ING is er een echte
 *      pagina die faalt. Bij Amex is er alleen de UITGELOGDE schil, en wat daar
 *      gemeten is (`_globalHeader_n0dcp_11`, `_navSticky_n0dcp_468`) is een
 *      vingerafdruk van CSS-modules — een bundler, geen schaduw-DOM.
 *   2. DE TWEE FUNCTIES KUNNEN DE WANDELING NIET DELEN. Chrome verstuurt ze als
 *      tekst; een gedeelde hulpfunctie bestaat op de pagina niet. Hem hier
 *      overnemen betekent dus een tweede, ONGETESTE kopie in de bron waar geen
 *      aanleiding voor is.
 *   3. HET VERBREEDT WAT DE LEZER ZIET, op de rekeningpagina van een
 *      creditcard. Bij ING is dat verantwoord met drie saldo-zeven eronder; hier
 *      zou het bereik groeien zonder dat er één meting om vraagt.
 *
 *  Print de strook op zijn Amex-pagina ooit "LaVega heeft hier geen blok met
 *  aanbiedingen gevonden" terwijl er wél aanbiedingen staan, dan is dit de
 *  eerste plek om te kijken — en ing.test.ts levert het sjabloon. */
export function collectAanbod(doc?: Document | null): RuweLezing {
  const d: Document = doc ?? document;

  /* De selectorlijst. Van boven naar beneden: eerst wat Amex bedoeld heeft als
   * haak (`data-*`), dan de klassenaam. Die laatste staat er op grond van een
   * meting aan de UITGELOGDE pagina: die draagt `_globalHeader_n0dcp_11` en
   * `_navSticky_n0dcp_468`, dus de CSS-modules bewaren de betekenisvolle naam
   * voor de hash. Het blijft een gok op de ingelogde pagina. */
  const SELECTORS = [
    "[data-test*='offer' i]",
    "[data-testid*='offer' i]",
    "[data-module-name*='offer' i]",
    "[data-offer-id]",
    "[class*='offer' i]",
    "[class*='aanbieding' i]",
  ];

  /* De vormen waarin een korting op zo'n kaart staat. Alleen wat hierop past,
   * verlaat de pagina — dat is de redactiegrens, en hij zit in het patroon en
   * niet in een filter erna. */
  const KORTING = [
    /\d{1,3}(?:[.,]\d{1,2})?\s?%\s?(?:korting|terug|back|cashback|off|discount)/i,
    /(?:korting|terug|cashback|back|off)\s(?:van\s)?\d{1,3}(?:[.,]\d{1,2})?\s?%/i,
    /(?:€|EUR|\$|£)\s?\d{1,5}(?:[.,]\d{2})?\s?(?:terug|back|korting|credit|statement credit)/i,
    /(?:krijg|ontvang|get|receive)\s(?:€|EUR|\$|£)?\s?\d{1,5}(?:[.,]\d{2})?/i,
    /(?:besteed|spend)\s(?:€|EUR|\$|£)?\s?\d{1,5}(?:[.,]\d{2})?/i,
    /* DE DREMPEL HOORT ERBIJ. Zonder dit patroon leverde "€ 10 terug bij
     * besteding van € 50" alleen "€ 10 terug" op, en dan staat er aan een kassa
     * een korting zonder de voorwaarde waaronder hij geldt. Dat is dezelfde
     * fout als een cashbackcijfer zonder zijn plafond: het bedrag klopt en het
     * antwoord niet. */
    /(?:bij (?:een )?(?:besteding|aankoop|bestelling|uitgave)(?: van)?|minimaal|minimum(?: spend)?)\s(?:€|EUR|\$|£)?\s?\d{1,5}(?:[.,]\d{2})?/i,
    /\d{1,3}(?:[.,]\d{3})*\s(?:bonus\s)?(?:membership rewards[\s-]?)?punten/i,
    /\d{1,3}(?:[.,]\d{3})*\s(?:bonus\s)?(?:membership rewards[\s-]?)?points/i,
  ];

  /* En de vormen waarin een einddatum staat. Er wordt hier niets uitgerekend:
   * de tekst gaat mee zoals hij er staat en `leesEinddatum` beslist of hij
   * eenduidig is. */
  const DATUM = [
    /(?:t\/m|tot en met|geldig tot(?: en met)?|verloopt op|loopt tot|tot|expires?(?: on)?|valid (?:through|until|to)|until|ends(?: on)?)\s*:?\s*(?:\d{1,2}\s*[\/.\-]\s*\d{1,2}\s*[\/.\-]\s*\d{2,4}|\d{1,2}\s+[a-z]{3,9}\.?\s+\d{4}|[a-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/i,
    /(?:verloopt over|nog|expires? in|ends in)\s+\d{1,3}\s*(?:dagen|dag|days|day)/i,
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
      /* Een selector die deze browser niet kent, is een selector die niets
       * oplevert — niet een reden om de hele lezing te laten vallen. */
      continue;
    }
    markers += gevonden.length;
    for (const n of Array.from(gevonden)) if (!knopen.includes(n)) knopen.push(n);
  }

  /* Van binnen naar buiten. Een kaart die een al gekozen kaart bevat, is de
   * omhullende lijst en niet de kaart zelf; die overslaan voorkomt dat dezelfde
   * aanbieding twee keer in de lijst komt, één keer per nestingsniveau. */
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

    /* Alleen wat op een patroon past verlaat de pagina, en overlappende
     * treffers gaan eruit. Zonder die tweede regel leverde "Besteed € 100 en
     * ontvang € 20 terug" drie stukjes op die elkaar half herhaalden
     * ("€ 20 terug", "ontvang € 20", "Besteed € 100"). Wat overblijft staat in
     * de volgorde waarin het op de kaart stond — voorwaarde vóór uitkomst,
     * zoals hij het leest — en niet in de volgorde van onze patroonlijst. */
    const treffers: { index: number; tekst: string }[] = [];
    for (const patroon of KORTING) {
      const m = patroon.exec(tekst);
      if (!m) continue;
      const van = m.index;
      const tot = m.index + m[0].length;
      if (treffers.some((t) => van < t.index + t.tekst.length && t.index < tot)) continue;
      treffers.push({ index: van, tekst: plat(m[0]) });
    }
    if (treffers.length === 0) continue;
    treffers.sort((a, b) => a.index - b.index);
    const kortingen = treffers.map((t) => t.tekst);

    /* De winkelnaam: een expliciete haak, dan een kop, dan de tekst van de
     * eerste link. Nooit "de eerste regel van de kaart" — dat is paginatekst en
     * die hoort er niet uit te komen. */
    let winkel = "";
    const merk = knoop.querySelector("[data-test*='merchant' i], [data-testid*='merchant' i], [class*='merchant' i]");
    if (merk) winkel = plat(merk.textContent ?? "");
    if (winkel === "") {
      const kop = knoop.querySelector("h1, h2, h3, h4, h5, h6");
      if (kop) winkel = plat(kop.textContent ?? "");
    }
    if (winkel === "") {
      const link = knoop.querySelector("a[href]");
      if (link) winkel = plat(link.textContent ?? "");
    }
    if (winkel === "") continue;

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
      winkel: winkel.slice(0, 60),
      prijsTekst: kortingen.join(" · ").slice(0, 120),
      totRuw: totRuw.slice(0, 40),
      hosts,
    });
    gekozen.push(knoop);
  }

  /* Alleen of er een wachtwoordveld STAAT. De waarde ervan wordt niet gelezen en
   * kan hier ook niet gelezen worden: er staat nergens `.value` in deze
   * functie. Een positieve vaststelling, want "geen wachtwoordveld gezien"
   * betekent niet "hij is ingelogd". */
  const inlogformulier = d.querySelector("input[type='password']") !== null;

  /* ZEGT DE PAGINA ZELF DAT ER NIETS IS? Dat is een antwoord en geen mislukking,
   * en het mag alleen geteld worden als de zin BINNEN het aanbiedingengedeelte
   * staat — een voettekst elders op de pagina zou anders elke lezing tot "geen
   * aanbiedingen" verklaren. Vandaar dat er alleen in de gevonden knopen wordt
   * gekeken, en alleen als er geen kaart uit is gekomen. */
  const GEEN = [
    /(?:momenteel|op dit moment|nu)?\s*geen (?:nieuwe )?aanbiedingen[^.]{0,60}/i,
    /(?:you have )?no (?:new )?offers[^.]{0,60}/i,
    /er zijn geen aanbiedingen[^.]{0,60}/i,
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
