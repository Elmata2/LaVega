/* ZIJN EIGEN AMEX-AANBIEDINGEN LEZEN. Dit bestand is de hele stap naar binnen,
 * en het is de eerste keer dat deze extensie iets aanraakt waar hij is ingelogd.
 *
 * ── WAAROM DIT DE ENIGE WEG IS, en dat is gemeten en niet aangenomen ────────
 *
 * De aanbiedingen zijn PERSOONLIJK. Op 22 augustus 2026 zelf opgehaald met kale
 * curl en een gewone browser-UA, redirects gevolgd:
 *
 *   https://global.americanexpress.com/offers/eligible   HTTP 200, 676.522 bytes
 *
 * Tweehonderd is hier geen goed nieuws. Wat er terugkomt is de SCHIL van de
 * app: `<div id="root">` met de globale koptekst erin, en in de modulelijst
 * `axp-offers-container` 2.6.6, `axp-offers-hub` 2.12.2 en `axp-offers` 6.9.1 —
 * drie bundels die de aanbiedingen NA het inloggen in de browser opbouwen. In
 * die 676 kB staat geen enkele aanbieding, geen winkelnaam en geen einddatum.
 * Van buitenaf is er dus niets te lezen, en dat is geen bot-blokkade die je met
 * een andere kop omzeilt: de gegevens zitten achter zijn sessie en komen pas na
 * authenticatie de browser in.
 *
 * MAAR HIJ IS INGELOGD. Een extensie in zijn eigen browser kan zijn eigen
 * pagina lezen. Dat is precies waar extensies voor bestaan, en het is tegelijk
 * de grens die deze extensie tot vandaag niet overging: alles hiervoor werkt
 * zonder één verbinding naar buiten en zonder toegang tot iets waar hij is
 * ingelogd. Dit doorbreekt dat laatste — niet naar buiten, maar naar binnen.
 * Er gaat nog steeds geen byte naar een server.
 *
 * ── DE TOESTEMMING IS HET ONTWERP, en niet een vinkje eromheen ──────────────
 *
 * Vier dingen, en ze zitten alle vier in de code en niet in een belofte:
 *
 *   1. APART van de toestemming per winkel. Wie ja zegt tegen "lees de prijs op
 *      ikea.nl" heeft daarmee geen ja gezegd tegen "lees mijn Amex-account".
 *      Twee vragen, twee antwoorden, twee schakelaars, en deze staat standaard
 *      uit (`getAmexAan` in store.ts geeft false zolang er niets staat).
 *   2. De vraag zegt in gewone taal WAT er gelezen wordt en wat niet. Niet
 *      "toegang tot americanexpress.com" maar: welke aanbiedingen er voor je
 *      klaarstaan, bij welke winkel en tot wanneer — en NIET je saldo, je
 *      transacties, je kaartnummer of je naam. Die tekst staat in
 *      `AMEX_WAT_WEL` / `AMEX_WAT_NIET` hieronder en gaat onbewerkt naar het
 *      optiescherm, zodat er niet twee versies van de belofte kunnen bestaan.
 *   3. Uitzetten heeft ONMIDDELLIJK effect en het opgeslagene gaat weg. Een
 *      schakelaar die alleen toekomstig gedrag verandert is geen intrekking; zie
 *      `wisAmex` in store.ts en de afhandelaar in background.ts, die ook afgaat
 *      als hij de toestemming in chrome://extensions intrekt in plaats van hier.
 *   4. `host_permissions` blijft leeg. Dit loopt via `optional_host_permissions`
 *      op PRECIES het pad van de aanbiedingenpagina, zodat Chrome het afdwingt
 *      en niet onze eigen vlag. De build weigert een patroon dat een heel
 *      domein aanwijst (controle 4 in copy-static.mjs), dus
 *      `https://global.americanexpress.com/*` kan er niet ongemerkt in glijden.
 *
 * ── WAT ER GELEZEN EN BEWAARD WORDT, en dat is de hele lijst ────────────────
 *
 * De winkelnaam, de korting zoals die er staat, en de einddatum. Verder niets.
 * GEEN bedragen van zijn rekening, GEEN kaartnummer, GEEN naam, GEEN
 * transacties, GEEN saldo. `collectAanbod` hieronder geeft niet de tekst van de
 * pagina terug en ook niet de tekst van een kaart, maar alleen de stukjes die op
 * een patroon passen: de winkelnaam uit de kop van de kaart (hooguit 60 tekens),
 * de gevonden kortingsvormen (hooguit 120 tekens samen) en de gevonden
 * datumaanduiding (hooguit 40). Wat niet op een patroon past, komt de extensie
 * niet binnen — niet omdat we het netjes weggooien, maar omdat het er nooit is
 * geweest. amex.test.ts legt een fixture met een saldo, een kaartnummer en een
 * naam erin voor en controleert dat geen van die drie in de uitkomst staat.
 *
 * ── DE GRENS VAN DEZE CODE, en die hoort hier te staan ──────────────────────
 *
 * DE ECHTE, INGELOGDE PAGINA IS NIET GEZIEN. Er is geen manier om vanaf hier in
 * zijn account te komen, dus de lezer is gebouwd op HTML die ik zelf heb
 * gemaakt. Wat wél gemeten is aan de echte pagina, is de vorm van de
 * klassenamen: de schil draagt `_globalHeader_n0dcp_11`,
 * `_hamburgerMenuToggle_n0dcp_111`, `_navSticky_n0dcp_468` — CSS-modules die de
 * betekenisvolle naam vóór de hash bewaren. Daarom staat `[class*="offer" i]` in
 * de selectorlijst: dat is een gok op een gemeten patroon, niet op een naam die
 * iemand verzonnen heeft. Het blijft een gok.
 *
 * De consequentie staat in de code in plaats van in een voorbehoud: vindt de
 * lezer niets, dan ZEGT hij dat, met de echte oorzaak erbij, en dan blijft er
 * geen oude lijst staan die er vers uitziet. Dat is het stuk dat HIJ moet
 * verifiëren voordat dit iets waard is. */

import { ontleedMatch } from "./sites.js";

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

/** Valt deze volledige URL binnen de aanbiedingenpagina?
 *
 *  Dezelfde drie eisen als `siteForUrl` in sites.ts, en om dezelfde reden: het
 *  matchpatroon zegt waar we toestemming voor vroegen en niet welke pagina ons
 *  aanspreekt. Https, geen poort, host letterlijk gelijk, en het pad begint met
 *  het vaste stuk. Geef hier een origin aan door en het antwoord is false — een
 *  origin heeft geen pad. */
export function amexUrlIsAanbiedingen(url: string): boolean {
  const d = ontleedMatch(AMEX_MATCH);
  if (!d) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.port !== "") return false;
  if (u.hostname.toLowerCase() !== d.host) return false;
  return u.pathname.startsWith(d.padPrefix);
}

/* ──────────────────────────── hoe oud is te oud ───────────────────────────── */

/** Na hoeveel dagen een gelezen aanbieding "oud" heet.
 *
 *  VEERTIEN, en dat is een keuze met een reden. Een Amex-aanbieding kan tussen
 *  twee bezoeken aan die pagina verdwijnen: hij kan al gebruikt zijn, hij kan
 *  van de lijst gehaald zijn, of de voorwaarden kunnen veranderd zijn. Wij zien
 *  daar niets van — we hebben één momentopname en geen verbinding om hem te
 *  verversen. Aan een kassa is de kost van een verkeerde belofte hoog: hij
 *  rekent op de korting en rekent af.
 *
 *  Waarom niet korter: bij zeven dagen zou vrijwel elke lezing bij het volgende
 *  bezoek al "oud" heten, en een waarschuwing die er altijd staat wordt niet
 *  meer gelezen. Waarom niet langer: bij dertig dagen kan een aanbieding een
 *  maand geleden zijn opgezegd zonder dat er iets bij staat.
 *
 *  Anders dan `VEROUDERD_NA_DAGEN` (90 dagen, puntensaldi) en dat is met opzet:
 *  een puntensaldo is ZIJN opgave over zichzelf en verandert langzaam, een
 *  aanbieding is een aanbod van iemand anders dat elk moment kan aflopen. Twee
 *  soorten gegevens, twee grenzen. */
export const AANBOD_OUD_NA_DAGEN = 14;

/** En wanneer we er aan een kassa helemaal niets meer over zeggen.
 *
 *  ZESTIG DAGEN. Twee grenzen in plaats van één, omdat "oud" en "onbruikbaar"
 *  verschillende gevolgen horen te hebben. Tussen 14 en 60 dagen staat de
 *  aanbieding er nog mét de mededeling dat hij oud is — hij kán nog kloppen en
 *  de datum staat erbij, dus hij kan het zelf nagaan. Na 60 dagen is de kans
 *  dat een aanbieding nog geldt zo klein dat hem tonen bij het afrekenen een
 *  belofte is die de gegevens niet kunnen dragen; dan noemt het paneel alleen
 *  nog dat de laatste lezing te oud is, met de datum. In het optiescherm blijft
 *  de lijst wel staan, want daar is het geen belofte maar een verantwoording van
 *  wat er is opgeslagen. */
export const AANBOD_TE_OUD_NA_DAGEN = 60;

/** Dagen tussen twee ISO-datums; NaN als er iets onleesbaar is.
 *
 *  Geen `new Date(string)`: die accepteert van alles en maakt er stilletjes een
 *  datum van. NaN is hier een bruikbaar antwoord — de aanroeper behandelt het
 *  als "leeftijd onbekend", en onbekend is niet nul dagen oud. */
export function dagenTussen(vanISO: string, totISO: string): number {
  const p = (s: string): number | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  const a = p(vanISO);
  const b = p(totISO);
  if (a === null || b === null) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/* ────────────────────────── de koppeling aan een winkel ───────────────────── */

/** Achtervoegsels van twee delen. Zonder deze lijst is de koppelregel gevaarlijk
 *  in plaats van streng.
 *
 *  DIT IS DE FOUT DIE HIER BIJNA IN ZAT. "Neem de laatste twee delen van de
 *  hostnaam" geeft bij `jbl.co.uk` het domein `co.uk`, en dan is ELKE Britse
 *  winkel gelijk aan elke andere Britse winkel: een aanbieding van JBL zou dan
 *  op tesco.co.uk verschijnen. Eén regel te weinig en de strengste regel in dit
 *  bestand keert om in de losste.
 *
 *  De lijst is met opzet kort en niet de volledige publicsuffixlijst: die is
 *  tienduizend regels, verandert, en zou opgehaald moeten worden. Wat er niet in
 *  staat en ook geen bekende kop-TLD is, levert `null` op — geen domein, dus
 *  geen koppeling, dus niets op het scherm. Onbekend is hier zwijgen. */
const MEERDELIGE_SUFFIXEN: readonly string[] = [
  "co.uk", "org.uk", "me.uk", "ac.uk", "gov.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au",
  "co.nz", "co.za", "co.jp", "co.kr", "co.in", "com.br", "com.mx", "com.tr",
  "com.sg", "com.hk", "com.cn", "com.pl", "com.pt", "com.es",
];

/** Kop-TLD's van één deel die we vertrouwen om een domein uit te rekenen.
 *
 *  Ook deze lijst is eindig en dat is de bedoeling. Een hostnaam op een TLD die
 *  hier niet staat, levert geen domein op en dus geen koppeling. Liever een
 *  aanbieding die niet verschijnt dan een aanbieding die bij de verkeerde winkel
 *  verschijnt: aan de kassa is dat tweede erger. */
const ENKELE_TLDS: readonly string[] = [
  "nl", "be", "de", "fr", "es", "it", "at", "ch", "dk", "se", "no", "fi", "pl",
  "pt", "ie", "lu", "cz", "sk", "hu", "ro", "gr", "bg", "hr", "si", "lt", "lv",
  "ee", "eu", "uk", "us", "ca", "au", "nz", "jp", "kr", "in", "br", "mx", "tr",
  "com", "net", "org", "info", "biz", "shop", "store", "nu", "io", "app", "dev",
];

/** Het domein waarop we mogen vergelijken: één label plus het achtervoegsel.
 *
 *  `www.jbl.nl` → `jbl.nl`, `shop.jbl.co.uk` → `jbl.co.uk`, `co.uk` → null.
 *  Onbekend achtervoegsel → null, en dat is het antwoord en niet een fout. */
export function registreerbaarDomein(host: string): string | null {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (h === "" || /[^a-z0-9.-]/.test(h)) return null;
  const delen = h.split(".").filter((d) => d !== "");
  if (delen.length < 2) return null;

  const tweeDelig = delen.slice(-2).join(".");
  if (MEERDELIGE_SUFFIXEN.includes(tweeDelig)) {
    if (delen.length < 3) return null;
    return delen.slice(-3).join(".");
  }
  if (!ENKELE_TLDS.includes(delen[delen.length - 1]!)) return null;
  return tweeDelig;
}

/** Hoort deze aanbieding bij deze winkel?
 *
 *  ── WAAROM DIT OP HET DOMEIN GAAT EN NIET OP DE NAAM ───────────────────────
 *
 *  Hij staat op jbl.nl en de aanbieding zegt "JBL". Dat is een naamvergelijking
 *  en die gaat op twee manieren fout, in tegengestelde richtingen:
 *
 *    - te ruim: een aanbieding van "Nike" komt op `nike-outlet-fake.nl` te
 *      staan, want die hostnaam bevat "nike". Aan een kassa van een namaakwinkel
 *      staat dan een Amex-aanbieding die de indruk geeft dat het klopt. Dat is
 *      de gevaarlijkste fout die deze extensie kan maken;
 *    - te streng en toch fout: "Zalando Payments" en "zalando.nl" zijn dezelfde
 *      winkel maar niet dezelfde tekst, dus een letterlijke vergelijking mist
 *      hem. Een fuzzy vergelijking die dat wél pakt, pakt `nike-outlet-fake.nl`
 *      er gratis bij.
 *
 *  Er is geen versie van "naam vergelijken" die de eerste fout uitsluit. Dus
 *  wordt er niet op tekst vergeleken maar op DOMEIN, en het domein komt uit de
 *  aanbieding zelf: uit een link in de kaart, of uit de winkelnaam als die
 *  letterlijk een hostnaam is ("jbl.nl"). Levert dat geen domein op, dan is er
 *  geen koppeling en verschijnt er bij de winkel NIETS. De aanbieding staat dan
 *  nog wel in het optiescherm en in het werkbalkvenster, waar hij zelf de naam
 *  leest en zelf de koppeling maakt — daar is een lijst een lijst en geen
 *  bewering over de pagina waar hij op staat.
 *
 *  Een gok is hier duurder dan zwijgen: een verkeerde aanbieding aan de kassa
 *  kost hem geld en vertrouwen, een ontbrekende aanbieding kost hem een
 *  herinnering. */
export function hoortBijWinkel(aanbieding: Aanbieding, winkelHost: string): boolean {
  if (aanbieding.domein === null) return false;
  const winkel = registreerbaarDomein(winkelHost);
  if (winkel === null) return false;
  return aanbieding.domein === winkel;
}

/* ──────────────────── wat er uit de pagina terugkomt ──────────────────────── */

/** Wat `collectAanbod` per kaart teruggeeft. Alleen stukjes die op een patroon
 *  pasten, geen paginatekst. */
export type RuwAanbod = {
  /** De kop van de kaart, hooguit 60 tekens. */
  winkel: string;
  /** De gevonden kortingsvormen, samengevoegd, hooguit 120 tekens. */
  korting: string;
  /** De gevonden datumaanduiding zoals die er staat, hooguit 40 tekens. "" als
   *  er geen datum op de kaart stond. */
  totRuw: string;
  /** De hostnamen van de links in deze kaart, hooguit vijf. Het filteren van
   *  Amex' eigen hosts gebeurt in de pure laag hieronder, niet hier: beleid
   *  hoort in code die te testen is. */
  hosts: string[];
};

export type RuweLezing = {
  /** Staat er een inlogformulier op deze pagina? Een POSITIEVE vaststelling:
   *  false betekent "geen wachtwoordveld gezien", niet "hij is ingelogd". Dat
   *  onderscheid is het verschil tussen een oorzaak noemen en er een verzinnen. */
  inlogformulier: boolean;
  /** De zin waarmee de pagina zelf zegt dat er geen aanbiedingen zijn, of "".
   *  Letterlijk overgenomen zoals hij er staat — samenvatten zou van een
   *  uitspraak van Amex een uitspraak van ons maken. */
  geenAanbiedingen: string;
  /** Hoeveel knopen er op de selectorlijst pasten. Nul betekent dat er geen
   *  aanbiedingenblok op deze pagina staat; meer dan nul met geen enkele
   *  bruikbare kaart betekent dat het blok er is maar er anders uitziet. */
  markers: number;
  kandidaten: RuwAanbod[];
};

/** Eén opgeslagen aanbieding. Dit is alles wat er in chrome.storage.local komt. */
export type Aanbieding = {
  winkel: string;
  korting: string;
  /** De einddatum als ISO-datum, of null. Null heeft twee oorzaken en die zijn
   *  niet hetzelfde: stond er geen datum (`totRuw === ""`), of stond er een
   *  datum die niet eenduidig te lezen was (`totRuw` gevuld, zie
   *  `leesEinddatum`). De zin op het scherm noemt welke van de twee. */
  tot: string | null;
  totRuw: string;
  /** Het domein waarop gekoppeld mag worden, of null als de aanbieding er geen
   *  draagt. Null betekent: nooit bij een winkel tonen. */
  domein: string | null;
  /** De dag waarop WIJ dit gelezen hebben. Draagt elke aanbieding, want zonder
   *  deze datum is er geen manier om te zien of de lijst vers is — en een oude
   *  lijst die vers lijkt is precies de fout die dit bestand niet mag maken. */
  gelezenOp: string;
};

/** Wat de lezing heeft opgeleverd. Vier uitkomsten, vier oorzaken, vier zinnen.
 *  Ze samenvoegen tot "er is niets gelezen" zou van vier verschillende feiten
 *  één vage mededeling maken, en dan kan hij niet zien wat hij eraan kan doen. */
export type LezingUitkomst =
  /** Er zijn aanbiedingen gelezen. */
  | "gelezen"
  /** Er staat een inlogformulier op de pagina: hij was hier niet ingelogd. */
  | "niet-ingelogd"
  /** De pagina zegt ZELF dat er nu niets klaarstaat. Dat is de keerzijde van
   *  "onbekend is nooit nul": een uitgesproken nul is wel een bekende nul, en
   *  die mag genoemd worden. Hem op één hoop gooien met "we konden niets lezen"
   *  zou een antwoord van Amex verbouwen tot een gat in onze meting. */
  | "uitgesproken-geen-aanbiedingen"
  /** Geen enkele knoop paste op de selectorlijst: dit lijkt de
   *  aanbiedingenpagina niet (meer) te zijn. */
  | "geen-aanbiedingenblok"
  /** Het blok staat er, maar er kwam geen bruikbare kaart uit: de pagina is
   *  veranderd, of hij was nog aan het laden. */
  | "blok-zonder-kaarten";

export type Lezing = {
  uitkomst: LezingUitkomst;
  /** Hoeveel aanbiedingen er uit kwamen. */
  aantal: number;
  /** De dag van de lezing. */
  op: string;
  /** De zin waarmee de pagina zelf zei dat er niets klaarstond, letterlijk.
   *  Alleen gevuld bij `uitgesproken-geen-aanbiedingen`; dan mag de melding hem
   *  citeren in plaats van hem samen te vatten, net als bij de puntenkoersen. */
  citaat: string;
};

/* ─────────────────────────── de datum uitlezen ────────────────────────────── */

const MAAND_NAMEN: Record<string, number> = {
  januari: 1, january: 1, jan: 1,
  februari: 2, february: 2, feb: 2,
  maart: 3, march: 3, mrt: 3, mar: 3,
  april: 4, apr: 4,
  mei: 5, may: 5,
  juni: 6, june: 6, jun: 6,
  juli: 7, july: 7, jul: 7,
  augustus: 8, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, october: 10, okt: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

function isoUit(jaar: number, maand: number, dag: number): string | null {
  if (maand < 1 || maand > 12 || dag < 1 || dag > 31) return null;
  const d = new Date(Date.UTC(jaar, maand - 1, dag));
  /* Zo valt 31 februari eruit: JavaScript rolt die door naar 3 maart, en dan
   * zou er een einddatum op het scherm komen die niet op de pagina stond. */
  if (d.getUTCFullYear() !== jaar || d.getUTCMonth() !== maand - 1 || d.getUTCDate() !== dag) {
    return null;
  }
  const mm = String(maand).padStart(2, "0");
  const dd = String(dag).padStart(2, "0");
  return `${jaar}-${mm}-${dd}`;
}

/** De einddatum uit de tekst die op de kaart stond.
 *
 *  ── WAAROM 31/12/26 GEWEIGERD WORDT ───────────────────────────────────────
 *
 *  Dit is de gevaarlijkste kleine beslissing in dit bestand. Zijn Amex-account
 *  is Nederlands (dd-mm) maar `global.americanexpress.com` serveerde op
 *  22 augustus 2026 een schil met `class="… dls7-us"` — een Amerikaanse
 *  opmaakkeuze (mm/dd). Welke van de twee er in zijn ingelogde pagina staat, is
 *  niet gemeten en dus niet bekend. Bij "05/03/2026" is het verschil twee
 *  maanden, en twee maanden verschil in een einddatum is precies het soort fout
 *  waarbij het paneel een aanbieding aanbiedt die al verlopen is.
 *
 *  Dus: een cijferdatum wordt alleen gelezen als hij ZICHZELF eenduidig maakt —
 *  één van de twee getallen boven de twaalf, of een ISO-vorm. Staat er een
 *  maandNAAM, dan is er geen twijfel en wordt hij gelezen. In alle andere
 *  gevallen komt er `null` uit en blijft de ruwe tekst bewaard, zodat de zin op
 *  het scherm kan zeggen wat er stond en waarom we er niet mee rekenen. */
export function leesEinddatum(ruw: string, asOf: string): string | null {
  const t = ruw.trim();
  if (t === "") return null;

  /* Relatief: "verloopt over 5 dagen", "expires in 5 days". Eenduidig, dus
   *  gewoon uitrekenen — met de peildatum van de aanroeper, niet met een klok. */
  const rel = /(?:over|in|nog)\s+(\d{1,3})\s*(?:dagen|dag|days|day)/i.exec(t);
  if (rel) {
    const basis = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf.trim());
    if (!basis) return null;
    const ms = Date.UTC(Number(basis[1]), Number(basis[2]) - 1, Number(basis[3])) + Number(rel[1]) * 86_400_000;
    const d = new Date(ms);
    return isoUit(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return isoUit(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  /* DE CIJFERVORM WORDT VÓÓR DE MAANDNAAM GEPROBEERD, en dat is geen
   * smaakkwestie. In "Geldig tot 05/03/2026" zit met wat goede wil ook een
   * maandnaamvorm te lezen — een regex die letters en cijfers combineert, vindt
   * er wel iets. Zou die eerst draaien, dan kwam er een datum uit een tekst die
   * juist geweigerd hoort te worden. Wat cijfers zijn, wordt als cijfers
   * behandeld, en cijfers moeten zichzelf eenduidig maken. */
  const cijfers = /(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4}|\d{2})\b/.exec(t);
  if (cijfers) {
    const a = Number(cijfers[1]);
    const b = Number(cijfers[2]);
    const jaar = volJaar(cijfers[3]!);
    if (a > 12 && b <= 12) return isoUit(jaar, b, a);
    if (b > 12 && a <= 12) return isoUit(jaar, a, b);
    return null;
  }

  /* "31 december 2026" en "31 dec 2026". */
  const dagEerst = /(\d{1,2})\s*[.\-\s]\s*([a-z]{3,9})\.?\s*,?\s*(\d{4}|\d{2})\b/i.exec(t);
  if (dagEerst) {
    const maand = MAAND_NAMEN[dagEerst[2]!.toLowerCase()];
    if (maand !== undefined) return isoUit(volJaar(dagEerst[3]!), maand, Number(dagEerst[1]));
  }

  /* "December 31, 2026". */
  const maandEerst = /([a-z]{3,9})\.?\s*(\d{1,2})\s*,?\s*(\d{4}|\d{2})\b/i.exec(t);
  if (maandEerst) {
    const maand = MAAND_NAMEN[maandEerst[1]!.toLowerCase()];
    if (maand !== undefined) return isoUit(volJaar(maandEerst[3]!), maand, Number(maandEerst[2]));
  }

  return null;
}

function volJaar(ruw: string): number {
  const n = Number(ruw);
  return ruw.length === 2 ? 2000 + n : n;
}

/* ───────────────────── van ruwe kaarten naar aanbiedingen ─────────────────── */

/** Hosts die van Amex zelf zijn en dus nooit de winkel aanwijzen. Een
 *  aanbiedingenkaart linkt vaak naar Amex' eigen detailpagina; die host als
 *  "winkel" behandelen zou elke aanbieding aan americanexpress.com koppelen. */
function isAmexHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "americanexpress.com" ||
    h.endsWith(".americanexpress.com") ||
    h === "aexp-static.com" ||
    h.endsWith(".aexp-static.com") ||
    h.endsWith(".amex.com") ||
    h === "amex.com"
  );
}

/** Ziet deze winkelnaam er letterlijk uit als een hostnaam? Dan mag hij het
 *  domein leveren. "jbl.nl" wel, "JBL" niet, "Nike Store" niet.
 *
 *  Dit is geen naamvergelijking maar het lezen van een hostnaam die er als
 *  hostnaam staat. Het verschil: hier wordt niets aan de tekst toegevoegd of
 *  geraden — er staat een punt en een bekend achtervoegsel in, of niet. */
function hostUitNaam(naam: string): string | null {
  const t = naam.trim().toLowerCase().replace(/^www\./, "");
  if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(t)) return null;
  return registreerbaarDomein(t);
}

/** Het domein van één ruwe kaart, of null.
 *
 *  Spreken de links elkaar tegen — twee verschillende winkeldomeinen in dezelfde
 *  kaart — dan is er geen domein. Twijfel is hier geen reden om de eerste te
 *  pakken; het is de reden om niets te tonen. */
export function domeinVanKaart(ruw: RuwAanbod): string | null {
  const domeinen = new Set<string>();
  for (const h of ruw.hosts) {
    if (isAmexHost(h)) continue;
    const d = registreerbaarDomein(h);
    if (d) domeinen.add(d);
  }
  if (domeinen.size === 1) return [...domeinen][0]!;
  if (domeinen.size > 1) return null;
  return hostUitNaam(ruw.winkel);
}

/** Van wat de pagina teruggaf naar wat er bewaard wordt.
 *
 *  Puur, en dat is nodig: dit is de laag waar de test op staat, want de laag
 *  erboven zit in een browser waar we niet in kunnen loggen. */
export function leesAanbod(ruw: RuweLezing, asOf: string): { lezing: Lezing; aanbiedingen: Aanbieding[] } {
  const aanbiedingen: Aanbieding[] = [];
  const gezien = new Set<string>();

  for (const k of ruw.kandidaten) {
    const winkel = k.winkel.trim().slice(0, 60);
    const korting = k.korting.trim().slice(0, 120);
    /* Een kaart zonder winkelnaam of zonder korting is geen aanbieding maar een
     * halve lezing, en een halve aanbieding op het scherm is een gok met een
     * lege plek erin. Weglaten, en de uitkomst hieronder zegt dat het blok er
     * wel was. */
    if (winkel === "" || korting === "") continue;

    const totRuw = k.totRuw.trim().slice(0, 40);
    /* Eén regel per winkel-plus-korting. Dezelfde aanbieding twee keer in de
     * lijst zou aan de kassa twee keer verschijnen alsof er twee zijn. */
    const sleutel = `${winkel.toLowerCase()}|${korting.toLowerCase()}`;
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);

    aanbiedingen.push({
      winkel,
      korting,
      tot: leesEinddatum(totRuw, asOf),
      totRuw,
      domein: domeinVanKaart({ ...k, winkel, korting }),
      gelezenOp: asOf,
    });
  }

  /* DE VOLGORDE IS DE UITSPRAAK. Eerst wat we hebben gelezen, dan wat de pagina
   * over zichzelf zegt (een inlogformulier, of met zoveel woorden dat er niets
   * klaarstaat), en pas als laatste onze eigen tekortkoming. Andersom zou "de
   * pagina is veranderd" over een pagina komen te staan die gewoon antwoord gaf. */
  let uitkomst: LezingUitkomst;
  if (aanbiedingen.length > 0) uitkomst = "gelezen";
  else if (ruw.inlogformulier) uitkomst = "niet-ingelogd";
  else if (ruw.geenAanbiedingen.trim() !== "") uitkomst = "uitgesproken-geen-aanbiedingen";
  else if (ruw.markers === 0) uitkomst = "geen-aanbiedingenblok";
  else uitkomst = "blok-zonder-kaarten";

  return {
    lezing: {
      uitkomst,
      aantal: aanbiedingen.length,
      op: asOf,
      citaat: uitkomst === "uitgesproken-geen-aanbiedingen" ? ruw.geenAanbiedingen.trim().slice(0, 120) : "",
    },
    aanbiedingen,
  };
}

/* ─────────────────── wat er bij een winkel gezegd mag worden ──────────────── */

export type AanbodToestand = {
  /** Zijn eigen schakelaar. Uit betekent: hier wordt niets over gezegd. */
  aan: boolean;
  lezing: Lezing | null;
  aanbiedingen: readonly Aanbieding[];
};

/** Wat er over aanbiedingen op een winkelpagina mag staan. Zeven toestanden,
 *  elk met een eigen oorzaak; lines.ts heeft er zeven zinnen bij.
 *
 *  DE EERSTE IS "UIT" EN DIE LEVERT NIETS OP. Als hij de schakelaar niet heeft
 *  aangezet, hoort er bij het afrekenen niets over aanbiedingen te staan — ook
 *  geen uitnodiging. Een aanbeveling om een leestoestemming aan te zetten,
 *  neergezet op het moment dat hij aan het afrekenen is, is reclame op het
 *  slechtste moment. Het optiescherm is de plek voor die vraag. */
export type AanbodUitkomst =
  | { soort: "uit" }
  | { soort: "nooit-gelezen" }
  | { soort: "lezing-mislukt"; lezing: Lezing }
  | { soort: "te-oud"; op: string; dagen: number }
  | { soort: "winkel-zonder-domein"; host: string }
  | { soort: "geen-voor-deze-winkel"; op: string; dagen: number; totaal: number }
  | {
      soort: "gevonden";
      op: string;
      dagen: number;
      oud: boolean;
      geldig: Aanbieding[];
      verlopen: Aanbieding[];
    };

/** De datum van onze KOPIE: de nieuwste leesdatum die er op een bewaarde
 *  aanbieding staat.
 *
 *  ── WAAROM NIET DE DATUM VAN DE LAATSTE POGING ─────────────────────────────
 *
 *  Dit zat er eerst wél zo in en het was fout. Stel: drie dagen geleden zijn er
 *  vier aanbiedingen gelezen, en vandaag opent hij die pagina terwijl er iets
 *  aan de vormgeving veranderd is, zodat er niets uit komt. De poging van
 *  vandaag mislukt. Als het paneel dan op DIE poging afgaat, zegt het "de pagina
 *  is veranderd" en verzwijgt het vier aanbiedingen die het gewoon heeft — en
 *  die drie dagen oud zijn, met hun eigen datum eronder.
 *
 *  De lijst en de poging beantwoorden verschillende vragen: de lijst zegt wat we
 *  hebben en van wanneer, de poging zegt of het verversen lukte. Aan een kassa
 *  telt de eerste; in het optiescherm staat de tweede, want daar hoort te staan
 *  dat het verversen niet meer werkt. */
function kopieDatum(aanbiedingen: readonly Aanbieding[]): string | null {
  let nieuwste: string | null = null;
  for (const a of aanbiedingen) {
    if (nieuwste === null || a.gelezenOp > nieuwste) nieuwste = a.gelezenOp;
  }
  return nieuwste;
}

export function aanbodVoorWinkel(
  toestand: AanbodToestand,
  winkelHost: string,
  asOf: string,
): AanbodUitkomst {
  if (!toestand.aan) return { soort: "uit" };

  const op = kopieDatum(toestand.aanbiedingen);
  if (op === null) {
    /* Geen enkele bewaarde aanbieding. Dan is de POGING het enige dat we hebben
     * en de oorzaak komt daarvandaan. */
    if (!toestand.lezing) return { soort: "nooit-gelezen" };
    if (toestand.lezing.uitkomst !== "gelezen") {
      return { soort: "lezing-mislukt", lezing: toestand.lezing };
    }
    return { soort: "geen-voor-deze-winkel", op: toestand.lezing.op, dagen: 0, totaal: 0 };
  }

  const dagen = dagenTussen(op, asOf);
  /* NaN is niet vers. Een lijst zonder leesbare datum weten we de leeftijd niet
   * van, en dan is "te oud" het veilige antwoord: liever niets beweren dan een
   * aanbieding tonen waarvan we niet weten uit welke maand hij komt. */
  if (Number.isNaN(dagen) || dagen > AANBOD_TE_OUD_NA_DAGEN) {
    return { soort: "te-oud", op, dagen };
  }

  if (registreerbaarDomein(winkelHost) === null) {
    return { soort: "winkel-zonder-domein", host: winkelHost };
  }

  const passend = toestand.aanbiedingen.filter((a) => hoortBijWinkel(a, winkelHost));
  if (passend.length === 0) {
    return { soort: "geen-voor-deze-winkel", op, dagen, totaal: toestand.aanbiedingen.length };
  }

  /* Verlopen en geldig apart. Een verlopen aanbieding weglaten zou hem laten
   * denken dat er niets was; hem tussen de geldige zetten zou hem laten denken
   * dat hij nog kan. Twee groepen, twee zinnen. */
  const verlopen = passend.filter((a) => a.tot !== null && a.tot < asOf);
  const geldig = passend.filter((a) => !(a.tot !== null && a.tot < asOf));
  return { soort: "gevonden", op, dagen, oud: dagen > AANBOD_OUD_NA_DAGEN, geldig, verlopen };
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
 *  compileren en in de pagina `undefined` zijn.
 *
 *  DEZE FUNCTIE KIEST NIET en ze VERTAALT NIET. Ze knipt uit wat op een patroon
 *  past en laat `leesAanbod` beslissen. Dat is niet alleen netjes: de beslissing
 *  hoort in code die te testen is zonder browser, want de enige browser waarin
 *  deze functie echt iets vindt, is de zijne.
 *
 *  ER GAAT GEEN DATUM IN. De peildatum hoort bij `leesAanbod` en niet hier: die
 *  functie zet "verloopt over 5 dagen" om in een datum, en dat is een BESLISSING
 *  die in testbare code hoort. Een parameter hier die alleen wordt doorgegeven,
 *  zou suggereren dat de pagina er iets mee doet.
 *
 *  WAT ER MEEKOMT is per kaart: de kop (60), de kortingsvormen (120 samen), de
 *  datumaanduiding (40) en de hostnamen van de links (vijf). Niet de tekst van
 *  de kaart, niet de tekst van de pagina, en niets buiten de kaarten. */
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
      korting: kortingen.join(" · ").slice(0, 120),
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
