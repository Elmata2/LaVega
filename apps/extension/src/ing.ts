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
 * DIT STOND HIER, EN HET IS ACHTERHAALD: "de echte ING Winkel is nooit gezien".
 * Op 24 augustus 2026 heeft de eigenaar één productkaart uit zijn eigen
 * INGELOGDE winkel gestuurd, en die staat nu in
 * `__fixtures__/ing-winkel-kaart.html` — het enige fixture in deze map dat niet
 * `kunstmatig-` heet, want het is niet nagebouwd.
 *
 * Wat die kaart oplevert, gemeten door hem door `collectIngWinkel` te halen:
 * artikelnaam "JBL Boombox 4 25% kortingsvoucher", prijs "500 Punten" die als
 * `{ punten: 500, bij: null }` uitkomt (een ontbrekend bijbetaalbedrag blijft
 * dus null en wordt geen nul), geen einddatum uit "Op=Op", geen enkele link en
 * dus geen winkeldomein, en `inlogformulier: false`. De selectorlijst hieronder
 * was dus GEEN misser: `[class*='product' i]` raakt `.product-content`, en de
 * naamhaak `[class*='title' i]` raakt `h2.card-title`. Wat er mis was, was het
 * ADRES — zie ING_MATCH hieronder.
 *
 * WAT NOG NIET GEMETEN IS, en dat is precies de duurste kant: hoe zijn
 * puntenSALDO op die pagina staat. Hij heeft alleen de kaart gestuurd. De
 * saldo-grens hieronder rust dus nog volledig op kunstmatige HTML, en dat is de
 * ene plek waar dit bestand nog een gok is. Ook de uitgelogde pagina is niet
 * gezien; www.ing.nl weigert verzoeken van deze machine na een geslaagde
 * TLS-verbinding (botbeheer, niet omzeild).
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
 *  DIT ADRES IS OP 24 AUGUSTUS 2026 GECORRIGEERD DOOR EEN METING, en de manier
 *  waarop het fout stond is leerzamer dan de fout zelf.
 *
 *  Er stond `https://www.ing.nl/punten*`, en dat was niet geraden maar gelezen:
 *  de voorwaarden van ING zeggen letterlijk "De ING Winkel is te vinden via
 *  https://www.ing.nl/punten", en die pagina geeft ook "Welkom in de ING Winkel"
 *  terug. Er stond zelfs bij dat `www.ing.nl` en niet `mijn.ing.nl` een BEWUSTE
 *  keuze was. Toch was het mis: die pagina is de etalage, en de winkel zelf
 *  staat achter zijn login. De eigenaar zat op
 *
 *    https://mijn.ing.nl/punten/overview
 *
 *  en daar draaide de lezer dus NOOIT — niet omdat de selectors misten, maar
 *  omdat het content script op een ander patroon geregistreerd stond en de
 *  toestemming die hij gaf een adres dekte waar hij nooit komt. Er werd geen
 *  regel code uitgevoerd. Dat een gemeten citaat uit de voorwaarden van de
 *  aanbieder zelf naar het verkeerde adres wees, is de bevinding: het document
 *  noemde de INGANG en niet de PAGINA.
 *
 *  Het pad blijft smal met opzet. `/punten*` is de winkel; zijn
 *  rekeningoverzicht, zijn transacties en zijn saldo staan op andere paden van
 *  Mijn ING en vallen hierbuiten. Chrome dwingt dat af omdat dit patroon
 *  letterlijk naar `permissions.request` en naar `registerContentScripts` gaat,
 *  en de build weigert een patroon dat een heel domein aanwijst.
 *
 *  `www.ing.nl/punten` staat er NIET meer bij, en dat is geen vergeetachtigheid.
 *  Die pagina is gemeten als een lege schil: kop, en verder wordt de catalogus
 *  na het laden opgebouwd — voor iemand die niet is ingelogd valt er niets te
 *  lezen. Twee adressen zouden twee toestemmingen en twee vragen betekenen voor
 *  één winkel. Blijkt ING later ook op `www` kaarten te tonen, dan is dat een
 *  losse beslissing met een eigen meting eronder. */
export const ING_MATCH = "https://mijn.ing.nl/punten*";

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
    '"de meeste producten met Punten, plus een bij te betalen bedrag". LaVega leest dus wat er in die ' +
    "winkel staat en voor hoeveel punten, en niet wat je ergens anders korting krijgt. De winkel staat " +
    "binnen Mijn ING, dus LaVega leest daar mee — maar alleen op /punten. Je rekeningoverzicht, je " +
    "transacties en je saldo staan op andere paden van Mijn ING en vallen buiten de toestemming die je " +
    "hier geeft.",
  voorbehoud:
    "Eerlijk over de grens, en die is op 24 augustus 2026 een stuk kleiner geworden: er is één ECHTE " +
    "productkaart uit de ingelogde winkel doorgemeten, en daar komt de artikelnaam, de puntenprijs, het " +
    "ontbreken van een einddatum en het ontbreken van een winkeldomein alle vier goed uit. Dat is geen " +
    "nagebouwde HTML meer. Wat nog WEL ongemeten is: hoe jouw puntensaldo op die pagina staat — dat is " +
    "de grens die het meest kan kosten, want een saldo ziet eruit als een prijs — en hoe de pagina " +
    "eruitziet als je niet bent ingelogd. Sinds 24 augustus 2026 kijkt LaVega ook in de onderdelen " +
    "waaruit die pagina zichzelf opbouwt, want anders zag hij de kaarten helemaal niet; daardoor komt " +
    "hij dichter langs dat saldo dan eerst, en zijn de zeven die het tegenhouden juist strenger " +
    "gemaakt in plaats van gelijk gelaten. Die zeven zijn op 25 augustus 2026 nagemeten en er zaten " +
    "vijf gaten in: één ontbrekende spatie tussen twee stukjes opmaak zette de hele " +
    "saldo-woordenlijst uit, een saldoblok zonder saldowoord kwam er als artikel uit zodra er even geen " +
    "kaarten waren, van de zestien manieren waarop een winkel opschrijft wat je overhoudt werden er drie " +
    "gevangen, de beschermende zeef las minder tekst dan de zeef die de prijs uitpakt, en voor je " +
    "transacties, je rekeningnummer en je naam stond er nog niets in code. Alle vijf zijn dicht en alle " +
    "vijf staan nu in de tests. Bij twijfel valt de kaart af: liever geen enkel artikel dan één " +
    "keer jouw saldo als prijs. Vindt hij bij jou niets, dan zegt hij dát met de reden erbij — en " +
    "als een deel van de pagina dicht is, zegt hij dat het dicht is en niet dat het leeg is.",
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
 *  staat hier NIET. Dat geldt óók voor de schaduwwandeling hieronder: die staat
 *  binnen deze body en niet als hulpfunctie ernaast, want "ernaast" bestaat op
 *  die pagina niet. ing.test.ts bouwt deze functie daarom met `new Function` uit
 *  haar eigen tekst opnieuw op, precies zoals Chrome dat doet.
 *
 *  WAT ER MEEKOMT is per kaart: de artikelnaam (60), de prijsvormen (120 samen),
 *  de datumaanduiding (40) en de hostnamen van de links (vijf). Niet de tekst van
 *  de kaart, niet de tekst van de pagina, en niets buiten de kaarten.
 *
 *  ── 24 AUGUSTUS 2026: WAAROM HIER EEN SCHADUWWANDELING IN STAAT ────────────
 *
 *  De eigenaar stond met de toestemming aan op
 *  https://mijn.ing.nl/punten/overview. De strook VERSCHEEN — het adrespatroon,
 *  de toestemming en de registratie werken dus — en zei: "LaVega vindt op deze
 *  pagina geen artikelen." Dat is `markers === 0`: geen enkele knoop op die hele
 *  pagina paste op ook maar één van de zeven selectors hieronder.
 *
 *  En tegelijk levert zijn ECHTE kaart, opgeslagen als
 *  `__fixtures__/ing-winkel-kaart.html`, door dezelfde functie precies één
 *  kandidaat op. Dezelfde selectors, dezelfde markup, twee uitkomsten.
 *
 *  DAT VERSCHIL IS NAGEBOUWD EN GEMETEN, niet beredeneerd. Zijn eigen
 *  kaartmarkup, letterlijk uit dat fixture gehaald, in zeven vormen:
 *
 *    plat in het lichte document        markers 18   kandidaten 3   (de controle)
 *    één open wortel om alle kaarten    markers  0   kandidaten 0   ← zijn beeld
 *    één open wortel per kaart          markers  0   kandidaten 0   ← zijn beeld
 *    twee wortels diep genest           markers  0   kandidaten 0   ← zijn beeld
 *    de gastheer draagt zelf de klasse  markers  3   kandidaten 0   (ándere zin)
 *    een <slot>, inhoud in het licht    markers  6   kandidaten 1   (zou lukken)
 *    een GESLOTEN wortel                markers  0   kandidaten 0   ← zijn beeld
 *
 *  `document.querySelectorAll` gaat niet door een schaduwwortel heen; ook
 *  `textContent` en `contains` niet. Dat het fixture wél werkt, komt doordat de
 *  Elements-tab van DevTools schaduwinhoud plat meekopieert. De
 *  lit-commentaarknopen (`<!--?lit$…$-->`) in dat bestand zijn het spoor van
 *  precies die componenten — op die hash mag nooit gematcht worden, hij
 *  verandert per build van ING, maar hij is wél de aanleiding geweest.
 *
 *  WAT HIERMEE NIET BEWEZEN IS, en dat hoort er in dezelfde adem bij: dat ING
 *  het ook echt zo doet. Twee andere oorzaken geven op het scherm hetzelfde
 *  beeld. Een pagina die zijn catalogus later opbouwt geeft ook markers 0 — al
 *  is dat zwakker geworden, want aanbod-content.ts leest vier keer, tot ruim
 *  veertien seconden na `document_idle`, en alle vier gaven 0. En een catalogus
 *  in een IFRAME geeft het ook, want noch de registratie (background.ts) noch de
 *  injectie zet `allFrames`. Alleen zijn eigen ingelogde pagina kan die drie uit
 *  elkaar halen; wat hier staat, maakt de eerste twee zichtbaar en laat de derde
 *  staan.
 *
 *  ── EN DE PRIJS VAN DEZE REPARATIE, want die is er ─────────────────────────
 *
 *  Door schaduwwortels heen kijken betekent dat deze lezer MEER van zijn pagina
 *  ziet dan ooit. Zijn puntenSALDO staat op precies deze pagina, in precies de
 *  vorm van een puntenPRIJS. De saldo-grens hieronder wordt daarmee zwaarder
 *  belast, niet lichter — en hij is daarom niet alleen gehandhaafd maar ook
 *  verbreed, met drie zeven in plaats van één. Zie SALDO, SALDO_HAAK en
 *  SALDO_NAAM.
 *
 *  ── 25 AUGUSTUS 2026: DIE DRIE ZEVEN ZIJN NAGEMETEN, EN ZE LEKTEN ─────────
 *
 *  Vijf gaten, alle vijf gemeten in plaats van bedacht, en alle vijf hieronder
 *  gedicht met een test die eerst rood stond:
 *
 *    1. `textContent` zet geen witruimte op een elementgrens, en álle
 *       saldo-patronen beginnen met `\b`. Eén ontbrekende spatie tussen twee
 *       broertjes zette de hele woordenlijst uit terwijl het prijspatroon gewoon
 *       bleef werken — de zeef die BESCHERMT viel weg en de zeef die UITPAKT
 *       bleef staan. Zie `tekstVan` hieronder.
 *    2. Een saldoblok zonder saldowoord werd een gewone kandidaat zodra er geen
 *       kaart was om hem te verdringen (lege catalogus; aanbod-content.ts leest
 *       ook op 0 ms). De verankerde namenlijst ving "Punten" en liet
 *       "Puntenstand", "Spaarpunten" en "Punten beschikbaar" door.
 *    3. Van de zestien manieren waarop een winkel opschrijft wat je overhoudt,
 *       ving de vormlijst er drie. De acht die doorkwamen kwamen eruit ónder de
 *       ECHTE artikelnaam, dus als volstrekt geloofwaardige prijs.
 *    4. De saldo-zeef las dezelfde 600 tekens als de prijs-zeef. Getal vooraan,
 *       signaalwoord achteraan, en het blok kwam er gewoon uit.
 *    5. Voor drie van de vijf beloften onder het vinkje — je transacties, je
 *       rekeningnummer, je naam — stond er nog geen regel code. Een IBAN kwam er
 *       als artikelnaam uit, een begroeting met zijn voornaam ook, en een
 *       puntentransactie als aanbieding bij die winkel.
 *
 *  Wat daarvoor in de plaats staat is niet "meer woorden" maar een ander soort
 *  zeef: de VORM van een saldozin (NABIJ), de VINDPLAATS (drie haaklijsten met
 *  elk hun eigen reikwijdte), de NAAM als woordenverzameling in plaats van als
 *  verankerde string, en de KALE DATUM. De keerzijde staat in dezelfde tests:
 *  zijn echte kaart en de vier nagebouwde artikelen komen er ongewijzigd
 *  doorheen. */
export function collectIngWinkel(doc?: Document | null): RuweLezing {
  const d: Document = doc ?? document;

  /* De selectorlijst. Deze was een GOK en is dat niet meer: zijn echte kaart
   * levert er zes treffers op — `[class*='product' i]` raakt `product-img`,
   * `product-label-wrapper` (twee keer), `product-label`, `product-info` en
   * `product-content`. Wat er op 24 augustus 2026 misging, zat niet hier maar
   * eerst in het ADRES (zie ING_MATCH) en daarna in het BEREIK (zie de
   * schaduwwandeling hieronder). */
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
   * verliezen, en op 25 augustus 2026 is die keuze nog een slag verder
   * doorgetrokken: liever geen enkel artikel dan één keer zijn saldo. */
  const SALDO = [
    /\bje\s+(?:hebt|heb|houdt|houd|spaart|spaar)\b/i,
    /puntensaldo\b/i,
    /\b(?:je|jouw|mijn|uw)\s+saldo\b/i,
    /\bbeschikbare?\s+punten\b/i,
    /\b(?:mijn|jouw)\s+punten\b/i,
    /puntenteller\b/i,
    /* DEZE DRIE ZIJN ERBIJ GEKOMEN DOORDAT DE TEST ZE VOND. De eerste versie van
     * deze lijst keek naar "je hebt", "puntensaldo" en "je saldo", en liet
     * "Bestel je dit, dan houd je nog 2.200 punten over" gewoon door. Dat is een
     * SALDO in precies de vorm van een prijs, op een kaart die op de
     * selectorlijst past. Dat het getal er toen niet uit kwam, was geluk: het
     * prijspatroon had de échte prijs al eerder op de kaart gevonden. Stond de
     * restsaldozin bóven de prijs, dan was zijn saldo als puntenprijs opgeslagen.
     *
     * ER STOND BIJ DAT ER "OP DE VORM VAN ZO'N ZIN" GELET WERD, EN DIE CLAIM WAS
     * TE GROOT. Gemeten op 25 augustus 2026, met zijn eigen kaartmarkup en de
     * restsaldozin bóven de prijs: van de zestien formuleringen die een
     * puntenwinkel voor "wat je overhoudt" gebruikt, dekten deze drie er DRIE.
     * "Na deze bestelling heb je nog 2.200 punten", "Hierna heb je nog 2.200
     * punten", "Dan blijven er 2.200 punten staan", "Overgebleven: 2.200
     * punten", "Beschikbaar: 2.200 punten", "Huidige stand: 2.200 punten" en
     * "Jij: 2.200 punten" kwamen er alle zeven uit — ónder de echte artikelnaam,
     * dus als volstrekt geloofwaardige prijs.
     *
     * Een woordenlijst kan die dertien niet inhalen; dat is het lek in de vorm
     * van de zeef en niet in de lengte ervan. Wat het wél doet, staat hieronder
     * bij NABIJ: niet WELKE woorden er staan, maar of er een saldowoord VLAK
     * BIJ een puntenbedrag staat. Deze drie blijven staan omdat ze goedkoper
     * zijn en al bewezen bijten. */
    /\bhoud\w*\s+je\b/i,
    /\bresterend/i,
    /\bnog\s+[\d.\s]+\s*punten\s+over\b/i,
    /\bover\s+na\s+(?:deze\s+)?(?:aankoop|bestelling)\b/i,
    /* EN DEZE ZEVEN ZIJN ERBIJ GEKOMEN DOOR DE SCHADUWWANDELING, want die is de
     * enige wijziging in dit bestand die de lezer MEER laat zien.
     *
     * Tot vandaag kon een saldocomponent van ING onmogelijk in beeld komen: hij
     * zat achter dezelfde wortel die ook de kaarten verborg. Nu wordt hij wél
     * bezocht, en dan is "je hebt" niet genoeg — een saldoblok kan net zo goed
     * een kop "Saldo" of "Tegoed" dragen met het getal eronder, zonder één
     * werkwoord ertussen. Het Engels staat erbij omdat ING zijn eigen markup in
     * het Engels benoemt: zijn echte kaart draagt letterlijk `points-only` en
     * `card-price-labels`.
     *
     * Wat dit kost is gecontroleerd en niet geschat: zijn ECHTE kaart ("JBL
     * Boombox 4 25% kortingsvoucher … Points only … 500 Punten") raakt geen van
     * deze zeven, en de vier artikelen uit het nagebouwde fixture ook niet.
     *
     * `saldo` en `tegoed` staan hier ZONDER `\b` ervoor, en dat is gemeten: in
     * "je puntensaldo" en "restsaldo" faalde het linkeranker, en dan hangt alles
     * af van de vraag of het woord toevallig los staat. */
    /saldo\b/i,
    /tegoed\b/i,
    /\bte\s+besteden\b/i,
    /\b(?:gespaard|verzameld)\b/i,
    /\bbalans\b/i,
    /\bbalance\b/i,
    /\b(?:my|your)\s+points\b/i,
  ];

  /* ── ZEEF 1b: DE NABIJHEIDSREGEL, en die kijkt naar de VORM ────────────────
   *
   * DIT IS DE ZEEF DIE DE WOORDENLIJST NIET KON ZIJN. Een restsaldozin heeft
   * geen vaste bewoording — er zijn er zestien gemeten en er is geen reden om
   * aan te nemen dat dat alle zestien waren — maar hij heeft wél altijd
   * dezelfde vorm: een woord dat over JOU of over WAT ER OVERBLIJFT gaat, vlak
   * naast een puntenbedrag. "Je komt 2.200 punten tekort", "Overgebleven: 2.200
   * punten", "12.345 Punten beschikbaar": drie zinnen, één vorm.
   *
   * De twee lijsten zijn NIET dezelfde, en dat is met opzet. "over" links van
   * een bedrag is doodgewoon ("meer over dit product · 500 punten") en rechts
   * ervan is het een saldo ("2.200 punten over"). Eén lijst voor beide kanten
   * zou hier of lekken of zijn halve winkel opeten.
   *
   * DE VENSTERBREEDTE IS DERTIG TEKENS. Ruim genoeg voor "Na deze bestelling
   * heb je nog 2.200 punten" (van "je" naar het bedrag: acht tekens) en smal
   * genoeg dat een woord drie zinnen verderop niet meetelt. `[^.!?]` houdt hem
   * bovendien binnen één zin.
   *
   * WAT DIT KOST, en het is niet niks: een echte kaart die "bestel je hier" of
   * "nog 3 op voorraad" vlak bij de prijs zet, valt af. Dat is de kant die de
   * opdracht aanwijst — liever niets vinden dan zijn saldo tonen — en het is
   * geen stille keuze: `ing.test.ts` legt de hele lijst vast, inclusief de
   * keerzijde (zijn echte kaart en de vier nagebouwde artikelen komen er
   * ongewijzigd doorheen). */
  const BEDRAG = "\\d{1,3}(?:[. ]\\d{3})*\\s?(?:ing\\s?)?punten";
  const NABIJ_VOOR =
    "(?:je|jij|jou|jouw|mijn|uw|hebt|heb|heeft|hebben|houd|houdt|hou|houden|" +
    "spaar|spaart|spaarde|saldo|tegoed|stand|standen|teller|beschikbaar|" +
    "beschikbare|available|balance|balans|overgebleven|resterend|resterende|" +
    "restant|blijft|blijven|blijf|verzameld|verzamelde|gespaard|ingezameld|" +
    "totaal|huidig|huidige|actueel|actuele|besteden|tekort|nodig|remaining|" +
    "left|wallet|portemonnee)";
  const NABIJ_NA =
    "(?:over|overgebleven|nodig|tekort|beschikbaar|beschikbare|resterend|" +
    "resterende|staan|te\\s+besteden|te\\s+gaan|je|jij|jou|jouw|mijn|uw|hebt|" +
    "heb|heeft|saldo|tegoed|gespaard|verzameld|kwijt|available|balance|balans|" +
    "remaining|left)";
  const NABIJ = [
    new RegExp("\\b" + NABIJ_VOOR + "\\b[^.!?]{0,30}?" + BEDRAG + "\\b", "i"),
    new RegExp(BEDRAG + "\\b[^.!?]{0,30}?\\b" + NABIJ_NA + "\\b", "i"),
  ];

  /* DE TWEEDE ZEEF: waar de knoop HANGT, en niet wat er in staat.
   *
   * De woordenlijst hierboven leest de TEKST van de kandidaat. Een saldoblok
   * hoeft die tekst niet te dragen: `<div class="points-balance"><h2>Saldo</h2>`
   * met het getal in een broertje eronder levert een kandidaat op waarvan de
   * gekozen knoop alleen "3.450 Punten" bevat. Dan is er geen woord om op af te
   * gaan — maar er is wel een HAAK, want zo'n blok heet ergens op zijn pad naar
   * boven wat het is.
   *
   * Er wordt hier alleen gekeken naar de TAGNAAM en naar `class`, `id`,
   * `data-test` en `data-testid` van de knoop zelf en van zijn voorouders, over
   * de schaduwgrens heen (via `host`). Die strings worden nergens bewaard en
   * verlaten de pagina niet; ze gaan alleen door deze patronen.
   *
   * WAT ER MET OPZET NIET IN STAAT: `beschikbaar`/`available` en
   * `overzicht`/`overview`. Die klinken als saldo maar zijn het niet — "op
   * voorraad" is een productlabel, en zijn eigen kaart hangt letterlijk in
   * `class="points-overview"`. Ze zouden dus niet zijn saldo tegenhouden maar
   * zijn hele winkel. */
  const SALDO_HAAK = [
    /saldo/i,
    /balans/i,
    /balance/i,
    /tegoed/i,
    /wallet/i,
    /puntenteller/i,
    /mijn[\s_-]?punten/i,
    /(?:my|your)[\s_-]?points/i,
  ];

  /* DE HAKEN VOOR DE DRIE ANDERE BELOFTEN, en ze staan bewust apart van de
   * saldohaak omdat ze een ANDER BEREIK hebben.
   *
   * ING_WAT_NIET belooft er vijf: geen puntensaldo, geen saldo, geen
   * transacties, geen rekeningnummer, geen naam. De eerste twee hadden drie
   * zeven; de andere drie hadden er NUL. Zolang de lezer alleen in het lichte
   * dom keek, hield die blindheid ze tegen — de schaduwwandeling haalt precies
   * die barrière weg en zet hem in élk onderdeel van mijn.ing.nl/punten.
   *
   * TRANSACTIE_HAAK loopt net zo ver omhoog als de saldohaak (25). Een woord
   * als "transactie" of "mutatie" wikkelt nooit een winkelcatalogus in; daar is
   * de kans op een misser dus klein en de winst groot.
   *
   * PERSOON_HAAK loopt maar ZES stappen, en dat is geen slordigheid maar de
   * enige veilige maat. Dit draait bínnen Mijn ING: dat "account", "klant" of
   * "rekening" ergens hoog in de boom in een klassenaam staat, is op een
   * bankpagina eerder regel dan uitzondering. Op 25 stappen zou deze lijst niet
   * zijn naam tegenhouden maar zijn hele winkel. Zes stappen dekt het BLOK waar
   * de knoop in zit en niet de PAGINA eromheen.
   *
   * EERLIJK OVER WAT HIER NIET GEMETEN IS: geen van deze klassenamen komt van
   * zijn pagina. Ze zijn gekozen omdat het de woorden zijn waarmee ING zijn
   * eigen onderdelen benoemt (zijn kaart draagt Engelse klassen: `points-only`,
   * `card-price-labels`), en niet omdat ze gezien zijn. */
  const TRANSACTIE_HAAK = [
    /transactie/i,
    /transaction/i,
    /histor/i,
    /mutatie/i,
    /activiteit/i,
    /activity/i,
    /afschrift/i,
    /statement/i,
    /timeline/i,
  ];
  const PERSOON_HAAK = [
    /klant/i,
    /customer/i,
    /account/i,
    /rekening/i,
    /\biban/i,
    /profiel/i,
    /profile/i,
    /gebruiker/i,
    /username/i,
    /greeting/i,
    /begroeting/i,
    /welkom/i,
    /welcome/i,
  ];

  /* DE DERDE ZEEF: de NAAM die eruit zou komen.
   *
   * Blijft er na de zeven hierboven toch een kandidaat over waarvan de kop
   * niets anders is dan het woord waarmee een bank een saldo aankondigt, dan is
   * dat geen artikel. Een echte kaart heet "JBL Boombox 4 25% kortingsvoucher";
   * een kaart die "Punten" heet en 3.450 punten "kost", is zijn saldo.
   *
   * DE VERANKERDE LIJST WAS TE KRAP, en dat is gemeten. Hij ving "Punten" en
   * liet "Punten beschikbaar", "Je puntentegoed", "Totaal punten",
   * "Spaarpunten", "Puntenstand" en "Ingezameld" allemaal door — zes vormen van
   * hetzelfde ding, en elke keer met zijn saldo als prijs erachter.
   *
   * De regel die dat wél dekt kijkt niet naar de hele kop maar naar de WOORDEN
   * waaruit hij bestaat: streep de vulwoorden weg, en blijft er dan alleen
   * saldovocabulaire over (samenstellingen inbegrepen — "puntenstand" is
   * "punten" + "stand"), dan is dit geen artikelnaam. Eén woord dat er niet in
   * staat is genoeg om hem door te laten: "Spaarpot van hout" blijft een
   * artikel, want "spaarpot" is geen samenstelling van twee saldowoorden. */
  const SALDO_NAAM = [
    /^(?:ing\s+)?punten$/i,
    /^(?:mijn|jouw|je|uw)\s+(?:ing\s+)?punten$/i,
    /^punten\s*saldo$/i,
    /^(?:(?:je|jouw|mijn|uw)\s+)?saldo$/i,
    /^punten\s*teller$/i,
    /^spaar\s*(?:saldo|tegoed)$/i,
    /^(?:points|points\s+balance|balance)$/i,
  ];

  /** De woorden waar een saldokop uit bestaat. KERN draagt de betekenis, VUL
   *  hangt er alleen omheen; een kop is pas een saldokop als er minstens één
   *  KERN in zit en er geen enkel ander woord overblijft. */
  const SALDO_KERN =
    /^(?:punt|punten|point|points|saldo|saldi|tegoed|tegoeden|stand|standen|teller|totaal|total|balans|balance|beschikbaar|beschikbare|available|verzameld|verzamelde|gespaard|gespaarde|ingezameld|ingezamelde|spaar|huidig|huidige|actueel|actuele|resterend|resterende|rest|restant|remaining|left|wallet|portemonnee)$/i;
  const SALDO_VUL =
    /^(?:de|het|een|en|of|in|op|nu|te|er|is|zijn|aan|van|voor|je|jij|jou|jouw|mijn|uw|my|your|the|and|ing)$/i;

  /* De koppen van een SECTIE, en die zijn nooit een artikelnaam. Dit is de
   * vangnetregel onder de vorige: een saldoblok dat "Overzicht" heet draagt geen
   * enkel saldowoord, en toch is "Overzicht · 12.345 Punten" geen aanbieding. */
  const NAVIGATIE_NAAM = [
    /^(?:overzicht|overview|home|start|dashboard|menu|winkel|(?:de\s+)?ing\s+winkel|mijn\s+ing)$/i,
    /^(?:alle\s+)?(?:producten|artikelen|aanbiedingen|cadeaus)$/i,
    /^(?:filter|filters|sorteren|zoeken|categorie|categorien|categorieen|categorieën)$/i,
  ];

  /* EN ZIJN NAAM. Een begroeting is de ene plek waar een bank de naam van de
   * klant in een kop zet, en dat is precies een kop die op de selectorlijst kan
   * passen: "Hallo Alexander, welkom in de ING Winkel · 3.450 Punten". */
  const PERSOON_NAAM = [
    /^(?:hallo|hoi|hey|hi|dag|goede(?:morgen|middag|navond|nacht))\b/i,
    /\bwelkom\b/i,
  ];

  /* ── ZEEF 4: WAT ER IN DE TEKST STAAT DAT NOOIT VAN DE WINKEL IS ──────────
   *
   * Een rekeningnummer, een begroeting en een transactieregel zijn geen
   * saldowoorden, dus geen van de drie zeven hierboven kijkt ernaar. Gemeten
   * kwamen ze er alle drie uit als artikel — met een IBAN als "artikelnaam" en,
   * doordat `textContent` de cijfers aan de prijs plakte, met "345 671.250
   * Punten" als "prijs". Dat is drie van de vijf beloften onder het vinkje.
   *
   * Het IBAN-patroon is de vorm en niet de lijst: twee letters, twee cijfers en
   * dan minstens tien letters of cijfers. Dat is elk IBAN ter wereld, en het is
   * smal genoeg dat een productcode als "WH1000XM5" er niet op past (te kort). */
  const PRIVE = [
    /\b(?:hallo|hoi|goedemorgen|goedemiddag|goedenavond|welkom\s+terug)\b/i,
    /\b(?:iban|rekeningnummer|betaalrekening|spaarrekening|bankrekening|kaartnummer|klantnummer|burgerservicenummer|bsn)\b/i,
    /\b[a-z]{2}\d{2}(?:[ .-]?[a-z0-9]){10,30}\b/i,
    /\b(?:transacties?|mutaties?|afschrift(?:en)?|overboeking(?:en)?|bijgeschreven|afgeschreven)\b/i,
  ];

  /* ── ZEEF 5: DE KALE DATUM ────────────────────────────────────────────────
   *
   * Wat een puntenTRANSACTIE verraadt is niet zijn tekst maar zijn vorm: een
   * winkelnaam, een aantal punten en een DATUM. Gemeten kwam
   * "Albert Heijn Amsterdam Zuid · 120 Punten · 22 augustus 2026" er als
   * aanbieding uit, met de winkelnaam als artikelnaam.
   *
   * Op een productkaart staat een datum nooit kaal: hij hoort bij "geldig tot",
   * "te bestellen tot", "vanaf" of "bezorgd voor" — dat is letterlijk de vorm
   * die DATUM hierboven zoekt, en die uit de voorwaarden van ING komt
   * ("Ze zijn geldig tot de datum die bij de aanbieding staat"). Een datum
   * zónder zo'n aanleiding, binnen vierentwintig tekens, is dus geen einddatum
   * maar een gebeurtenis — en een gebeurtenis met een puntenbedrag ernaast is
   * een transactie.
   *
   * DE KEERZIJDE IS GETEST en staat er niet voor niets bij: een kaart met
   * "Geldig tot en met 30 november 2026" komt er gewoon doorheen. */
  const DATUMVORM =
    /\b(?:\d{1,2}\s+(?:januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+\d{4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})\b/gi;
  const DATUM_AANLEIDING =
    /(?:geldig|t\/m|tot|vanaf|verloopt|loopt|bestel|beschikbaar|bezorg|lever|verzend|uiterlijk|sinds|actie|start|eindig)/i;

  /* En de vormen waarin een einddatum staat. Er wordt hier niets uitgerekend.
   *
   * "op=op" staat er NIET bij, en dat is met opzet: dat voorbehoud geldt volgens
   * de voorwaarden van ING voor ELKE aanbieding in de winkel, niet alleen voor
   * de kaarten waar het toevallig op staat. Het hoort dus in de zin (lines.ts)
   * en niet in wat we van de pagina knippen. */
  const DATUM = [
    /(?:geldig tot(?: en met)?|t\/m|tot en met|te bestellen tot|actie loopt tot|loopt tot|verloopt op|tot)\s*:?\s*(?:\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}|\d{1,2}\s+[a-z]{3,9}\.?\s+\d{4}|\d{4}-\d{2}-\d{2})/i,
    /(?:verloopt over|nog|te bestellen tot over)\s+\d{1,3}\s*(?:dagen|dag)/i,
  ];

  const plat = (s: string): string => s.replace(/\s+/g, " ").trim();

  /* ── DE TEKST VAN EEN KNOOP, MÉT DE GRENZEN TUSSEN DE ELEMENTEN ERIN ──────
   *
   * DIT IS DE REPARATIE VAN EEN GEMETEN LEK EN GEEN OPSCHONING. Hiervoor stond
   * er overal `plat(knoop.textContent)`, en `textContent` plakt de tekst van
   * twee broertjes AAN ELKAAR: op een elementgrens komt geen witruimte.
   * (`innerText` doet dat wél, maar die bestaat alleen voor zichtbare knopen en
   * dwingt een layout af — vier keer per paginabezoek, op de pagina waar hij
   * zijn geld beheert. Dat is de reden dat hier zelf geteld wordt.)
   *
   * WAT DIE ENE ONTBREKENDE SPATIE KOSTTE, gemeten op 25 augustus 2026 met
   * dezelfde DOM en als enige verschil één spatie tussen twee broertjes:
   *
   *   zonder: "JBL Boombox 4 kortingsvoucherJe hebt 12.345 Punten"
   *           /\bje\s+hebt\b/ raakt NIET  -> kandidaat "12.345 Punten"
   *   met   : "JBL Boombox 4 kortingsvoucher Je hebt 12.345 Punten"
   *           /\bje\s+hebt\b/ raakt WEL   -> geen enkele kandidaat
   *
   * Alle saldo-patronen beginnen met `\b`, dus één ontbrekende spatie zette de
   * HELE woordenlijst uit — terwijl het prijspatroon bleef werken, want dat
   * heeft alleen een `\b` ná "punten". Die asymmetrie is precies de verkeerde
   * kant op: de zeef die BESCHERMT viel weg, de zeef die UITPAKT bleef staan.
   *
   * DE GRENS WORDT EEN REGELOVERGANG EN GEEN SPATIE, en dat is niet
   * cosmetisch — het sluit een tweede gemeten lek in dezelfde greep. `\s` dekt
   * "\n", dus `\bje\s+hebt\b` en `500\nPunten` werken allebei gewoon; maar de
   * duizendscheiding in het prijspatroon (`[. ]`) dekt "\n" NIET. Daarmee kan
   * een artikelnaam die op een cijfer eindigt niet meer aan de prijs van het
   * broertje eronder plakken:
   *
   *   <h2>JBL Boombox 4</h2><p>500 Punten</p>
   *   textContent       -> "JBL Boombox 4500 Punten"   -> "4500 Punten"  (9x te duur)
   *   met een spatie    -> "JBL Boombox 4 500 Punten"  -> "4 500 Punten" (idem)
   *   met een grens     -> "JBL Boombox 4\n500 Punten" -> "500 Punten"   (goed)
   *
   * En hetzelfde in de andere richting: "2.500 puntenGeldig tot..." liet
   * `punten\b` afketsen op de "G", dus een ECHTE prijs werd onzichtbaar. Dat
   * was geen lek maar wel een stille misser, en hij is met dezelfde greep weg.
   *
   * SCRIPT, STYLE, TEMPLATE en NOSCRIPT worden overgeslagen: hun inhoud is code
   * en geen tekst, en een JSON-blok met "punten" erin is geen prijs. */
  const tekstVan = (start: Node, max: number): string => {
    let uit = "";
    const stapel: (Node | string)[] = [start];
    while (stapel.length > 0 && uit.length < max) {
      const k = stapel.pop();
      if (k === undefined) break;
      if (typeof k === "string") {
        uit += k;
        continue;
      }
      if (k.nodeType === 3) {
        uit += k.nodeValue ?? "";
        continue;
      }
      if (k.nodeType !== 1) continue;
      const el = k as Element;
      const tag = el.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE" || tag === "NOSCRIPT") continue;
      /* Omgekeerd op de stapel, met een grens vóór en achter elk kind, zodat er
       * in leesvolgorde uit komt: grens, kind, grens, kind, … , grens. */
      const kinderen = el.childNodes;
      stapel.push("\n");
      for (let i = kinderen.length - 1; i >= 0; i--) {
        stapel.push(kinderen[i] as Node);
        stapel.push("\n");
      }
    }
    return uit;
  };

  /* Witruimte samentrekken zónder de grenzen kwijt te raken: een reeks die een
   * regelovergang bevat wordt één "\n", de rest wordt één spatie. */
  const platBoom = (s: string): string =>
    s
      .replace(/\s*\n\s*/g, "\n")
      .replace(/[^\S\n]+/g, " ")
      .trim();

  /* HOEVEEL ER GELEZEN WORDT, en de verhouding tussen die twee getallen is de
   * hele bevinding.
   *
   * Hiervoor stond er één `slice(0, 600)` en die gold voor ALLEBEI de zeven.
   * Gemeten gevolg: staat het getal vooraan en het signaalwoord achteraan —
   * precies de vorm van een saldoblok met een uitlegzin eronder — dan haalde de
   * prijszeef het getal wél binnen en miste de saldozeef zijn eigen woord. Een
   * blok van 843 tekens met "puntensaldo" op teken 700 kwam er zo uit als
   * { winkel: "Overzicht", prijsTekst: "12.345 Punten" }.
   *
   * De invariant die dat dichtzet staat hieronder in code en niet in een
   * afspraak: wat de PRIJSzeef leest is een PREFIX van wat de SALDOzeef leest.
   * Verhoog `PRIJS_MAX` nooit boven `BESCHERMING_MAX`. */
  const TEKST_RUW_MAX = 20000;
  const BESCHERMING_MAX = 4000;
  const PRIJS_MAX = 600;

  /** De volledige, grensbewuste tekst van een knoop — de string waar élke zeef
   *  op werkt. */
  const bloktekst = (n: Node): string =>
    platBoom(tekstVan(n, TEKST_RUW_MAX)).slice(0, BESCHERMING_MAX);

  /* ── DE SCHADUWWANDELING, met haar grenzen erbij ───────────────────────────
   *
   * WAAROM ER GRENZEN OP STAAN. Dit draait op mijn.ing.nl, een grote
   * bankapplicatie, en het draait er VIER KEER: aanbod-content.ts probeert het
   * op 0, 1500, 4000 en 9000 ms. Een wandeling zonder plafond kan die pagina dus
   * vier keer laten stotteren, en dat op het scherm waar hij zijn geld beheert.
   *
   * De vier getallen hieronder zijn NIET op mijn.ing.nl gemeten — daar komt deze
   * machine niet (Akamai weigert), en dat is precies waarom er een plafond staat
   * in plaats van een verwachting. Ze zijn zo gekozen dat het slechtste geval
   * begrensd is: hooguit 400 wortels open, hooguit 20.000 elementen aangeraakt,
   * hooguit 10 wortels diep, hooguit 1.200 kandidaatknopen. Ter maat: zijn eigen
   * kaart raakt zes knopen, en de nagebouwde winkel met zes kaarten raakt er 27.
   *
   * EN WAT ER GEBEURT ALS EEN PLAFOND GERAAKT WORDT: de wandeling stopt stil en
   * de lezing gaat verder met wat er is. Nooit een exception — een injectie die
   * gooit levert `undefined` op in background.ts en dan verschijnt er helemaal
   * geen strook, en dat is de ene uitkomst die hem niets vertelt. */
  const WORTEL_MAX = 400;
  const KNOOP_MAX = 20000;
  const DIEPTE_MAX = 10;
  const KANDIDAATKNOPEN_MAX = 1200;

  /* Eén wortel openen. De open wortel is de gewone weg; `chrome.dom` staat
   * erachter voor het gesloten geval.
   *
   * DAT TWEEDE IS BEWUST EN HET IS ONGEVERIFIEERD, allebei. `chrome.dom.
   * openOrClosedShadowRoot` bestaat alleen in een content script, vraagt geen
   * enkele extra toestemming en zit sinds Chrome 88 in de browser — ruim onder
   * de `minimum_chrome_version` 102 van dit manifest. Hij staat daarom ook in
   * chrome.d.ts, want dat bestand is de lijst van wat deze extensie mag
   * aanroepen en zo'n toevoeging hoort zichtbaar te zijn.
   *
   * Wat NIET vaststaat, is dat Brave hem heeft. Dat is vanaf deze machine niet
   * te controleren. Daarom wordt hij van `globalThis` gelezen en niet als vrije
   * naam gebruikt: deze functie draait ook in jsdom (waar er geen `chrome`
   * bestaat) en wordt door Chrome uit haar eigen tekst opgebouwd, en een kale
   * `chrome`-verwijzing zou daar een ReferenceError zijn die alleen in ZIJN
   * console te zien is. Ontbreekt hij, dan blijft een gesloten wortel
   * onbereikbaar, wordt hij hieronder als `afgeschermd` geteld, en zegt de
   * strook dát — in plaats van te doen alsof de winkel leeg is.
   *
   * WAT HIER MET OPZET NIET STAAT: injecteren met `world: "MAIN"` en bij
   * `document_start` `Element.prototype.attachShadow` afvangen. Dat werkt, en
   * het is de enige overgebleven weg als de wortels gesloten zijn én
   * `chrome.dom` ontbreekt. Het betekent ook dat onze code in de JavaScript-
   * wereld van zijn BANK draait, vóór de scripts van die bank, leesbaar voor de
   * pagina. Dat is een veel grotere belofte dan die onder het vinkje staat, en
   * ze zou hier gedaan worden voor een winkellijst. Nee dus. */
  const openWortel = (el: Element): ShadowRoot | null => {
    try {
      if (el.shadowRoot) return el.shadowRoot;
    } catch {
      /* Een element dat niet over zijn eigen wortel wil praten, is een element
       * zonder bereikbare wortel. Meer hoeft er hier niet van gevonden te
       * worden. */
    }
    try {
      const chroom = (globalThis as unknown as { chrome?: typeof chrome }).chrome;
      const via = chroom?.dom?.openOrClosedShadowRoot;
      if (typeof via === "function") return via(el) ?? null;
    } catch {
      /* Idem. */
    }
    return null;
  };

  /* Breedte-eerst over het lichte document en elke wortel die we onderweg
   * tegenkomen. `wortels` is daarna de enige lijst waar de rest van deze functie
   * op zoekt — `d` staat er als eerste in, dus het lichte document blijft de
   * hoofdweg en niet een bijzonder geval. */
  const wortels: (Document | ShadowRoot)[] = [d];
  const rij: { wortel: Document | ShadowRoot; diepte: number }[] = [{ wortel: d, diepte: 0 }];
  let bezocht = 0;
  let plafond = false;

  /* Hoeveel eigen elementen ("er zit een streepje in de tagnaam") we tegenkwamen
   * die leeg zijn EN waarvan geen wortel te openen viel. Dat is de handtekening
   * van een gesloten schaduwwortel — en ook van een component die nog niet
   * gebouwd is. Die twee zijn hier niet uit elkaar te houden, en de zin die
   * erbij hoort zegt dat dan ook allebei. Wat het NIET is, is "deze pagina is
   * leeg": dat is de bewering die vandaag een ronde gekost heeft. */
  let afgeschermd = 0;

  while (rij.length > 0) {
    const nu = rij.shift();
    if (!nu) break;
    let alle: NodeListOf<Element>;
    try {
      alle = nu.wortel.querySelectorAll("*");
    } catch {
      continue;
    }
    for (const el of alle) {
      if (bezocht >= KNOOP_MAX) {
        plafond = true;
        break;
      }
      bezocht++;
      const wortel = openWortel(el);
      if (wortel) {
        /* Te diep: deze tak houdt hier op, maar de rest van deze wortel wordt
         * gewoon afgelopen. Een dieptegrens is geen reden om de wandeling te
         * staken — de kaarten kunnen één laag hoger prima staan. */
        if (nu.diepte + 1 > DIEPTE_MAX) continue;
        if (wortels.length >= WORTEL_MAX) {
          plafond = true;
          break;
        }
        wortels.push(wortel);
        rij.push({ wortel, diepte: nu.diepte + 1 });
      } else if (
        el.tagName.indexOf("-") > -1 &&
        el.children.length === 0 &&
        plat(el.textContent ?? "") === ""
      ) {
        afgeschermd++;
      }
    }
    if (plafond) break;
  }

  /* Omhoog lopen dwars door schaduwgrenzen heen. `parentElement` stopt bij de
   * wortel; `parentNode` levert daar de ShadowRoot op, en die heeft een `host`
   * waar de boom verdergaat. Dit is niet netjes-doen: zonder deze sprong meet de
   * dieptefunctie hieronder een kaart IN een wortel als ondieper dan haar eigen
   * gastheer in het lichte dom (gemeten: 1 tegen 3), en dan draait de
   * van-binnen-naar-buiten-regel precies om. */
  const omhoog = (knoop: Node): Node | null => {
    const ouder = knoop.parentNode;
    if (ouder) return ouder;
    const gastheer = (knoop as unknown as { host?: Element | null }).host;
    return gastheer ?? null;
  };

  const kandidaten: RuwAanbod[] = [];
  const gekozen: Element[] = [];
  let markers = 0;

  const knopen: Element[] = [];
  const gezien = new Set<Element>();
  for (const sel of SELECTORS) {
    for (const wortel of wortels) {
      let gevonden: NodeListOf<Element>;
      try {
        gevonden = wortel.querySelectorAll(sel);
      } catch {
        /* Een selector die deze browser niet kent, kent ze in geen enkele
         * wortel — dus door naar de volgende selector, en niet de hele lezing
         * laten vallen. */
        break;
      }
      markers += gevonden.length;
      for (const n of gevonden) {
        if (gezien.has(n)) continue;
        /* Het laatste plafond, en het enige dat `markers` NIET raakt: hoeveel we
         * er vinden blijft geteld, hoeveel we er uitpluizen niet. Dat is met
         * opzet — `markers` is het getal waarop de melding besluit of er hier
         * iets stond, en dat mag niet door een rem van ons vertekend raken. */
        if (knopen.length >= KANDIDAATKNOPEN_MAX) break;
        gezien.add(n);
        knopen.push(n);
      }
    }
  }

  /* Van binnen naar buiten, zodat een omhullende lijst niet als kaart meetelt.
   * De diepte wordt één keer per knoop uitgerekend en bewaard: de sorteervolgorde
   * roept haar anders O(n log n) keer aan, en de wandeling omhoog is nu langer
   * dan een `parentElement`-lus. */
  const diepte = new Map<Element, number>();
  for (const n of knopen) {
    let t = 0;
    let p: Node | null = n;
    let stap = 0;
    while (p && stap < 400) {
      stap++;
      if (p.nodeType === 1) t++;
      p = omhoog(p);
    }
    diepte.set(n, t);
  }
  knopen.sort((a, b) => (diepte.get(b) ?? 0) - (diepte.get(a) ?? 0));

  /* `Element.contains` kijkt niet door een schaduwgrens: een gastheer in het
   * lichte dom "bevat" de kaart in zijn eigen wortel niet. Dat is geen fout van
   * de browser maar wel een gat in de dubbeltelregel hierboven, dus loopt deze
   * versie omhoog langs dezelfde weg als de dieptemeting. */
  const bevat = (buiten: Element, binnen: Element): boolean => {
    let p: Node | null = binnen;
    let stap = 0;
    while (p && stap < 400) {
      stap++;
      if (p === buiten) return true;
      p = omhoog(p);
    }
    return false;
  };

  /* De haak van één knoop: zijn tagnaam en de vier attributen waarin een
   * component zichzelf benoemt. Deze string wordt nergens bewaard en verlaat de
   * pagina niet; hij gaat alleen door de patronen hierboven. */
  const haakVan = (el: Element): string => {
    let haak = el.tagName;
    for (const attr of ["class", "id", "data-test", "data-testid"]) {
      const v = el.getAttribute(attr);
      if (v) haak += " " + v;
    }
    return haak;
  };

  /* Draagt deze knoop of een van zijn voorouders zo'n haak? Het aantal stappen
   * staat per lijst apart, want ze hebben niet dezelfde reikwijdte — zie de
   * uitleg bij PERSOON_HAAK. */
  const haakRaakt = (n: Element, patronen: RegExp[], stappen: number): boolean => {
    let p: Node | null = n;
    let stap = 0;
    while (p && stap < stappen) {
      stap++;
      if (p.nodeType === 1) {
        const haak = haakVan(p as Element);
        for (const patroon of patronen) if (patroon.test(haak)) return true;
      }
      p = omhoog(p);
    }
    return false;
  };

  /* De losse woorden van een kop, zonder leestekens en zonder kale getallen —
   * "JBL Boombox 4 25% kortingsvoucher" wordt [jbl, boombox, kortingsvoucher]. */
  const woordenVan = (naam: string): string[] => {
    const uit: string[] = [];
    for (const w of naam.toLowerCase().split(/[^a-zÀ-ſ0-9]+/)) {
      if (w === "" || /^\d+$/.test(w)) continue;
      uit.push(w);
    }
    return uit;
  };

  /* Is dit woord een samenstelling van twee saldowoorden? "puntensaldo",
   * "puntenstand", "spaarpunten", "puntentegoed" — allemaal vormen die de
   * verankerde lijst hierboven niet ving. */
  const saldoSamenstelling = (w: string): boolean => {
    for (let i = 3; i <= w.length - 3; i++) {
      const a = w.slice(0, i);
      const b = w.slice(i);
      const aOk = SALDO_KERN.test(a) || SALDO_VUL.test(a);
      const bOk = SALDO_KERN.test(b) || SALDO_VUL.test(b);
      if (aOk && bOk && (SALDO_KERN.test(a) || SALDO_KERN.test(b))) return true;
    }
    return false;
  };

  /* Is deze kop een saldokop in plaats van een artikelnaam? */
  const isSaldoNaam = (naam: string): boolean => {
    for (const patroon of SALDO_NAAM) if (patroon.test(naam)) return true;
    const ws = woordenVan(naam);
    if (ws.length === 0) return false;
    let kern = false;
    for (const w of ws) {
      if (SALDO_KERN.test(w) || saldoSamenstelling(w)) {
        kern = true;
        continue;
      }
      if (SALDO_VUL.test(w)) continue;
      /* Eén woord dat geen saldowoord is, en dit is gewoon een artikel. */
      return false;
    }
    return kern;
  };

  /* Staat er een datum in zonder aanleiding? Zie ZEEF 5 hierboven. */
  const kaleDatum = (tekst: string): boolean => {
    DATUMVORM.lastIndex = 0;
    let m = DATUMVORM.exec(tekst);
    while (m !== null) {
      const voor = tekst.slice(Math.max(0, m.index - 24), m.index);
      if (!DATUM_AANLEIDING.test(voor)) return true;
      m = DATUMVORM.exec(tekst);
    }
    return false;
  };

  /* ── DE HELE GRENS IN ÉÉN VRAAG ───────────────────────────────────────────
   *
   * Alles wat hier `true` teruggeeft, verlaat de pagina niet — ook de
   * artikelnaam niet. Er wordt geen enkele kandidaat "schoongemaakt": dat zou
   * betekenen dat we het getal moeten herkennen dat we net niet herkenden.
   *
   * DE VOLGORDE IS DE GOEDKOOPSTE EERST, maar dat is niet waarom hij zo staat.
   * Hij staat zo omdat elke zeef een ander soort bewijs gebruikt: de TEKST, de
   * VORM van de tekst, de VINDPLAATS, en de DATUM. Ze zijn niet elkaars
   * reserve, ze dekken elkaars blinde vlek. */
  const nietVanDeWinkel = (knoop: Element, tekst: string): boolean => {
    for (const patroon of SALDO) if (patroon.test(tekst)) return true;
    for (const patroon of NABIJ) if (patroon.test(tekst)) return true;
    for (const patroon of PRIVE) if (patroon.test(tekst)) return true;
    if (kaleDatum(tekst)) return true;
    if (haakRaakt(knoop, SALDO_HAAK, 25)) return true;
    if (haakRaakt(knoop, TRANSACTIE_HAAK, 25)) return true;
    if (haakRaakt(knoop, PERSOON_HAAK, 6)) return true;
    return false;
  };

  /* En dezelfde vraag over de NAAM die eruit zou komen. Staat apart omdat de
   * naam pas bekend is nadat de prijs gevonden is. */
  const naamIsNietVanEenArtikel = (naam: string): boolean => {
    if (isSaldoNaam(naam)) return true;
    for (const patroon of NAVIGATIE_NAAM) if (patroon.test(naam)) return true;
    for (const patroon of PERSOON_NAAM) if (patroon.test(naam)) return true;
    return false;
  };

  for (const knoop of knopen) {
    if (kandidaten.length >= 60) break;
    if (gekozen.some((g) => bevat(knoop, g))) continue;

    /* De BESCHERMENDE tekst, en de UITPAKKENDE tekst is er een PREFIX van.
     * Zie BESCHERMING_MAX hierboven: hiervoor lazen beide zeven dezelfde 600
     * tekens, en dan glipt een saldoblok met een uitlegzin eronder er gewoon
     * doorheen — het getal stond binnen de 600, het woord erbuiten. */
    const tekstVol = bloktekst(knoop);
    if (tekstVol === "") continue;
    const tekst = tekstVol.slice(0, PRIJS_MAX);

    /* Eerst de grens, vóór alle andere patronen. Wat hier afgaat, verlaat de
     * pagina niet — ook de artikelnaam niet. */
    if (nietVanDeWinkel(knoop, tekstVol)) continue;

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
    if (haak) naam = plat(tekstVan(haak, 600));
    if (naam === "") {
      const kop = knoop.querySelector("h1, h2, h3, h4, h5, h6");
      if (kop) naam = plat(tekstVan(kop, 600));
    }
    if (naam === "") {
      const link = knoop.querySelector("a[href]");
      if (link) naam = plat(tekstVan(link, 600));
    }
    if (naam === "") continue;

    /* De zeven die op de NAAM zitten: zijn saldo, een sectiekop, zijn naam. */
    if (naamIsNietVanEenArtikel(naam)) continue;

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
      prijsTekst: treffers
        .map((t) => t.tekst)
        .join(" · ")
        .slice(0, 120),
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
   * ALLEBEI LOPEN ZE NU OVER ALLE WORTELS, en dat is geen uitbreiding maar het
   * sluitstuk van de reparatie: bouwt ING zijn winkel in componenten, dan bouwt
   * hij zijn inlogscherm daar vrijwel zeker ook in. Een lezer die wél door de
   * kaarten heen kijkt maar niet door het inlogscherm, zou "geen aanbiedingen-
   * blok" melden op een pagina waar in werkelijkheid staat dat je moet inloggen.
   *
   * DIT BLIJFT EEN GOK OP EEN PAGINA DIE NIET IS GEZIEN. Hij kan te streng zijn
   * of te ruim. Wat hij niet kan, is een saldo of een naam meenemen: er wordt
   * alleen naar het BESTAAN van een element gekeken, en nergens naar de waarde
   * van een veld. */
  let inlogformulier = false;
  for (const wortel of wortels) {
    try {
      if (wortel.querySelector("input[type='password']") !== null) {
        inlogformulier = true;
        break;
      }
    } catch {
      continue;
    }
  }

  /* WAAR STAAN WE ZELF? Dat beslist wat een link naar Mijn ING betekent, en die
   * vraag ontbrak hier — met de fout erin die de meting van 24 augustus 2026
   * blootlegde. Een link naar `mijn.ing.nl` gold als "je bent niet ingelogd",
   * maar de winkel STAAT op `mijn.ing.nl`: daar is elke interne link er een naar
   * mijn.ing.nl, en dan zou de lezer op precies de pagina die alleen ingelogd
   * bestaat concluderen dat je niet ingelogd bent.
   *
   * In jsdom is `baseURI` bij een los geparseerd document "about:blank" en dus
   * hostloos; dan blijft het gedrag zoals het was. De fixtures die dit wél
   * uitproberen dragen daarom een echte `<base href>`. */
  let hierHost = "";
  try {
    hierHost = new URL(d.baseURI).hostname.toLowerCase();
  } catch {
    hierHost = "";
  }
  const opMijnIng = hierHost === "mijn.ing.nl" || hierHost.endsWith(".mijn.ing.nl");

  if (!inlogformulier) {
    const klikbaar: Element[] = [];
    for (const wortel of wortels) {
      if (klikbaar.length >= 200) break;
      let gevonden: NodeListOf<Element>;
      try {
        gevonden = wortel.querySelectorAll("a[href], button");
      } catch {
        continue;
      }
      for (const n of gevonden) {
        if (klikbaar.length >= 200) break;
        klikbaar.push(n);
      }
    }
    for (const a of klikbaar) {
      const t = plat(a.textContent ?? "");
      if (!/^(?:inloggen|log ?in)\b/i.test(t)) continue;
      const href = a.getAttribute("href") ?? "";
      if (href === "") continue;
      try {
        const u = new URL(href, d.baseURI);
        const h = u.hostname.toLowerCase();
        const naarMijnIng = h === "mijn.ing.nl" || h.endsWith(".mijn.ing.nl");
        const naarInlogpad = /\/(?:login|inloggen)\b/i.test(u.pathname);
        if ((naarMijnIng && !opMijnIng) || naarInlogpad) {
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
   * kaart uit is gekomen. `knopen` loopt nu over alle wortels, dus deze zin
   * wordt ook gevonden als ING hem in een component zet. */
  const GEEN = [
    /(?:momenteel|op dit moment|nu)?\s*geen (?:producten|artikelen|aanbiedingen)[^.]{0,60}/i,
    /er zijn (?:op dit moment )?geen (?:producten|artikelen|aanbiedingen)[^.]{0,60}/i,
    /de (?:ing )?winkel is (?:tijdelijk )?(?:gesloten|niet beschikbaar)[^.]{0,60}/i,
    /(?:alles|alle artikelen) is uitverkocht[^.]{0,60}/i,
  ];
  let geenAanbiedingen = "";
  if (kandidaten.length === 0) {
    for (const knoop of knopen) {
      const t = bloktekst(knoop).slice(0, 400);
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

  return { inlogformulier, geenAanbiedingen, markers, kandidaten, afgeschermd };
}
