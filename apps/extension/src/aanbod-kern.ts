/* WAT TWEE AANBIEDINGENBRONNEN GEMEEN HEBBEN. Eén kopie, en dat is de hele
 * reden dat dit bestand bestaat.
 *
 * ── WAAROM DIT ER IS ───────────────────────────────────────────────────────
 *
 * Toen hier alleen Amex stond, stond deze code in amex.ts en dat was goed: één
 * bron, één bestand. Bij de tweede bron (de ING Winkel) is er een keuze, en er
 * is er maar één die over een half jaar nog klopt.
 *
 * De verleiding is `ing.ts` naast `amex.ts` te zetten met dezelfde vorm erin.
 * Dat leest prettig — elk bestand vertelt zijn eigen verhaal — en het gaat
 * gegarandeerd stuk. De koppelregel (`hoortBijWinkel`) is de enige die
 * tegenhoudt dat een aanbieding van Nike op `nike-outlet-fake.nl` verschijnt.
 * Twee kopieën daarvan betekent dat een reparatie aan de ene kant de andere
 * kant niet bereikt, en dat je dat pas merkt aan een kassa. Hetzelfde geldt
 * voor `leesEinddatum`, die met opzet een cijferdatum WEIGERT die twee datums
 * tegelijk kan zijn: één kopie die dat vergeet, zet een verlopen aanbieding
 * neer als geldig.
 *
 * Dus: alles wat niet per bron VERSCHILT, staat hier. Wat wel verschilt, staat
 * in `amex.ts` en `ing.ts`, en dat is precies twee dingen — het aftasten van de
 * pagina (dat is per bron een andere pagina) en de zinnen (dat is per bron een
 * andere bewering).
 *
 * ── WAT ER PER BRON VERSCHILT, EN DAT IS MEER DAN EEN NAAM ─────────────────
 *
 * Een Amex-aanbieding is een KORTING BIJ EEN WINKEL: "30% korting bij JBL". Die
 * gebruikt hij aan de kassa van jbl.nl, dus hem daar neerzetten is precies goed.
 *
 * Een regel uit de ING Winkel is iets anders: een PRODUCT dat hij bij ING koopt
 * met punten plus een bij te betalen bedrag. Uit de voorwaarden van ING zelf
 * (opgehaald 24 augustus 2026, HTTP 200, 127.289 bytes):
 *
 *   "Je betaalt de meeste producten met Punten, plus een bij te betalen bedrag.
 *    Soms wissel je alleen Punten in, zoals bij kortingsbonnen. Het aantal
 *    Punten en het bij te betalen bedrag vermelden we bij het product"
 *
 * "500 punten voor een JBL-speaker" is dus GEEN korting bij JBL. Het is een
 * aankoop bij ING. Dat verschil is niet cosmetisch: aan de kassa van jbl.nl is
 * "je hebt hier een aanbieding" bij Amex waar en bij ING onwaar. Vandaar
 * `prijsSoort` hieronder — niet om een ander woord te kiezen, maar omdat er een
 * andere bewering bij hoort, en die staat in lines.ts.
 *
 * ── WAT ER NIET PER BRON MAG VERSCHILLEN ───────────────────────────────────
 *
 * De verouderingsgrenzen. Die staan hier als één paar getallen en niet als een
 * veld in `Bron`, zodat er geen bron kan bestaan die zijn eigen ruimere grens
 * meebrengt. */

/* ─────────────────────────── de bron zelf ─────────────────────────────────── */

/** Wat voor prijs een bron draagt. Bepaalt welke zin er mag staan, niet welk
 *  woord er staat. */
export type PrijsSoort = "korting" | "punten";

/** Eén aanbiedingenbron: een pagina waar hij is ingelogd en die op zijn eigen
 *  toestemming staat.
 *
 *  `match` gaat ONVERANDERD naar `chrome.permissions.request` én naar
 *  `chrome.scripting.registerContentScripts`. Die twee moeten letterlijk
 *  hetzelfde patroon gebruiken; anders mislukt de registratie met een melding
 *  die niets over de oorzaak zegt. */
export type Bron = {
  id: string;
  /** Wat er in het optiescherm boven de schakelaar staat. */
  label: string;
  match: string;
  /** De naam van de aanbieder in een zin: "American Express", "ING". */
  merk: string;
  /** Hoe de pagina in een zin heet: "je aanbiedingenpagina", "de ING Winkel". */
  paginaNaam: string;
  /** Wat er gelezen en bewaard wordt. Gaat ONBEWERKT naar het optiescherm: één
   *  plek waar de belofte staat, zodat de UI hem niet kan herformuleren. */
  watWel: readonly string[];
  /** En wat niet. Even letterlijk, want dit is de helft van de vraag. */
  watNiet: readonly string[];
  /** De sleutels in chrome.storage.local. Per bron eigen sleutels, zodat
   *  uitzetten van de ene niets van de andere weghaalt — en zodat er geen
   *  gedeelde sleutel is waar twee bronnen elkaars gegevens in overschrijven. */
  sleutels: { aan: string; aanbod: string; lezing: string };
  /** Hosts die van de AANBIEDER zelf zijn en dus nooit de winkel aanwijzen. Een
   *  kaart linkt vaak naar de eigen detailpagina; die host als "winkel"
   *  behandelen zou elke aanbieding aan de aanbieder koppelen. Wordt als
   *  achtervoegsel vergeleken, dus "amex.com" dekt ook "www.amex.com". */
  eigenHosts: readonly string[];
  prijsSoort: PrijsSoort;
  /** Waarom deze bron alleen zo te lezen is, in gewone taal, mét de meting
   *  eronder. Staat in het optiescherm boven de schakelaar — wie toestemming
   *  geeft, hoort te zien waarop die toestemming rust. */
  uitleg: string;
  /** Wat er NIET aan gemeten is. Staat er even hard bij, en dat is ongemakkelijk
   *  met opzet: de ingelogde pagina is bij geen van beide bronnen ooit gezien,
   *  dus de lezer is op nagebouwde HTML gemaakt. Dat hoort te staan waar hij ja
   *  zegt en niet in een README. */
  voorbehoud: string;
  /** Het aftasten van DEZE pagina. Staat in de descriptor zodat de service
   *  worker niet hoeft te weten welke bron hij voor zich heeft: hij geeft dit
   *  veld door aan `chrome.scripting.executeScript({ func })`.
   *
   *  DE FUNCTIE MOET OP ZICHZELF STAAN — geen imports, geen verwijzing naar
   *  iets buiten haar eigen body. Chrome verstuurt haar als TEKST naar de
   *  pagina, dus alles wat ze van buiten zou gebruiken is daar `undefined`. Dat
   *  is de reden dat dit de ENIGE plek is waar amex.ts en ing.ts op elkaar
   *  lijken zonder dat het gedeeld kan worden. */
  collect: (doc?: Document | null) => RuweLezing;
};

/* ──────────────────────────── hoe oud is te oud ───────────────────────────── */

/** Na hoeveel dagen een gelezen aanbieding "oud" heet.
 *
 *  VEERTIEN, en dat is een keuze met een reden. Een aanbieding kan tussen twee
 *  bezoeken verdwijnen: hij kan al gebruikt zijn, van de lijst gehaald zijn, of
 *  de voorwaarden kunnen veranderd zijn. Wij zien daar niets van — we hebben één
 *  momentopname en geen verbinding om hem te verversen. Aan een kassa is de kost
 *  van een verkeerde belofte hoog: hij rekent op de korting en rekent af.
 *
 *  Waarom niet korter: bij zeven dagen zou vrijwel elke lezing bij het volgende
 *  bezoek al "oud" heten, en een waarschuwing die er altijd staat wordt niet
 *  meer gelezen. Waarom niet langer: bij dertig dagen kan een aanbieding een
 *  maand geleden zijn opgezegd zonder dat er iets bij staat.
 *
 *  ÉÉN GETAL VOOR BEIDE BRONNEN, en dat is met opzet geen veld in `Bron`. Bij
 *  ING is er reden om te denken dat het sneller veroudert — de voorwaarden
 *  zeggen "ING heeft het recht om het aantal te besteden ING Punten per artikel
 *  tijdelijk of permanent te wijzigen" en "op=op" — maar dat is een argument om
 *  de grens voor ALLEBEI te heroverwegen, niet om er per bron een eigen getal
 *  van te maken. Een veld hier zou betekenen dat een bron zijn eigen ruimere
 *  grens kan meebrengen, en dat is precies de uitzondering die niemand een
 *  tweede keer afweegt. Wat er bij ING wél bij hoort, staat in de zin zelf: dat
 *  op=op geldt en dat de puntenprijs kan veranderen. */
export const AANBOD_OUD_NA_DAGEN = 14;

/** En wanneer we er aan een kassa helemaal niets meer over zeggen.
 *
 *  ZESTIG DAGEN. Twee grenzen in plaats van één, omdat "oud" en "onbruikbaar"
 *  verschillende gevolgen horen te hebben. Tussen 14 en 60 dagen staat de
 *  aanbieding er nog mét de mededeling dat hij oud is — hij kán nog kloppen en
 *  de datum staat erbij, dus hij kan het zelf nagaan. Na 60 dagen is de kans dat
 *  een aanbieding nog geldt zo klein dat hem tonen bij het afrekenen een belofte
 *  is die de gegevens niet kunnen dragen; dan noemt het paneel alleen nog dat de
 *  laatste lezing te oud is, met de datum. In het optiescherm blijft de lijst
 *  wel staan, want daar is het geen belofte maar een verantwoording van wat er
 *  is opgeslagen. */
export const AANBOD_TE_OUD_NA_DAGEN = 60;

/** Hoeveel titels een gehedgde merknaam-match aan een kassa mag laten zien.
 *  Meer dan dit wordt niet stilgehouden — `totaal` in de uitkomst telt ongekapt
 *  door, en de zin in lines.ts zegt dat er meer zijn. */
export const MOGELIJKE_MATCH_MAX = 3;

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

/* ─────────────────────────── waar we mogen kijken ─────────────────────────── */

/** Een matchpatroon uit elkaar getrokken: het hostdeel en het VASTE stuk pad dat
 *  ervoor staat. Zelfde vorm als `ontleedMatch` in bronnen.ts — dat is inmiddels
 *  een kopie van een kopie: `ontleedMatch` verscheen later en importeert
 *  `urlValtBinnen` uit dit bestand al, dus de cirkelvrees die deze eigen kopie
 *  ooit rechtvaardigde speelt hier niet meer. De duplicatie is nu puur
 *  historisch; `bronnen.ts` zou `ontleedMatch` (of deze functie, verplaatst)
 *  rechtstreeks kunnen hergebruiken, maar dat is een structuurwijziging en
 *  hoort niet in deze documentatieronde. */
function ontleed(match: string): { host: string; padPrefix: string } | null {
  const m = /^https:\/\/([a-z0-9.-]+)(\/[^*]*)\*$/.exec(match);
  if (!m) return null;
  return { host: m[1].toLowerCase(), padPrefix: m[2] };
}

/** Valt deze volledige URL binnen het matchpatroon van deze bron?
 *
 *  Dezelfde drie eisen als bij `bronVoorUrl`/`ontleedMatch` in bronnen.ts, en om
 *  dezelfde reden: het matchpatroon zegt waar we toestemming voor vroegen en
 *  niet welke pagina ons aanspreekt. Https, geen poort, host letterlijk gelijk,
 *  en het pad begint met het vaste stuk. Geef hier een origin aan door en het
 *  antwoord is false — een origin heeft geen pad. */
export function urlValtBinnen(match: string, url: string): boolean {
  const d = ontleed(match);
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
  "co.uk",
  "org.uk",
  "me.uk",
  "ac.uk",
  "gov.uk",
  "ltd.uk",
  "plc.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.za",
  "co.jp",
  "co.kr",
  "co.in",
  "com.br",
  "com.mx",
  "com.tr",
  "com.sg",
  "com.hk",
  "com.cn",
  "com.pl",
  "com.pt",
  "com.es",
];

/** Kop-TLD's van één deel die we vertrouwen om een domein uit te rekenen.
 *
 *  Ook deze lijst is eindig en dat is de bedoeling. Een hostnaam op een TLD die
 *  hier niet staat, levert geen domein op en dus geen koppeling. Liever een
 *  aanbieding die niet verschijnt dan een aanbieding die bij de verkeerde winkel
 *  verschijnt: aan de kassa is dat tweede erger. */
const ENKELE_TLDS: readonly string[] = [
  "nl",
  "be",
  "de",
  "fr",
  "es",
  "it",
  "at",
  "ch",
  "dk",
  "se",
  "no",
  "fi",
  "pl",
  "pt",
  "ie",
  "lu",
  "cz",
  "sk",
  "hu",
  "ro",
  "gr",
  "bg",
  "hr",
  "si",
  "lt",
  "lv",
  "ee",
  "eu",
  "uk",
  "us",
  "ca",
  "au",
  "nz",
  "jp",
  "kr",
  "in",
  "br",
  "mx",
  "tr",
  "com",
  "net",
  "org",
  "info",
  "biz",
  "shop",
  "store",
  "nu",
  "io",
  "app",
  "dev",
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
 *      staat dan een aanbieding die de indruk geeft dat het klopt. Dat is de
 *      gevaarlijkste fout die deze extensie kan maken;
 *    - te streng en toch fout: "Zalando Payments" en "zalando.nl" zijn dezelfde
 *      winkel maar niet dezelfde tekst, dus een letterlijke vergelijking mist
 *      hem. Een fuzzy vergelijking die dat wél pakt, pakt `nike-outlet-fake.nl`
 *      er gratis bij.
 *
 *  Er is geen versie van "naam vergelijken" die de eerste fout uitsluit. Dus
 *  wordt er niet op tekst vergeleken maar op DOMEIN, en het domein komt uit de
 *  aanbieding zelf: uit een link in de kaart, of uit de winkelnaam als die
 *  letterlijk een hostnaam is ("jbl.nl"). Levert dat geen domein op, dan is er
 *  geen koppeling en verschijnt er bij de winkel NIETS.
 *
 *  BIJ DE ING WINKEL LEVERT DIT MEESTAL NIETS OP, en dat is geen gebrek maar het
 *  goede antwoord. Een productkaart in de winkel van ING linkt naar ING, niet
 *  naar de fabrikant; er is dus geen domein en er verschijnt niets aan een
 *  kassa. De verleiding om dat te "repareren" met een merknaamvergelijking is
 *  precies de eerste fout hierboven, en bij ING is hij erger: daar zou er een
 *  aankoop bij ING worden neergezet als aanbieding bij de winkel waar hij staat. */
export function hoortBijWinkel(aanbieding: Aanbieding, winkelHost: string): boolean {
  if (aanbieding.domein === null) return false;
  const winkel = registreerbaarDomein(winkelHost);
  if (winkel === null) return false;
  return aanbieding.domein === winkel;
}

/** Een zwakkere, gehedgde koppeling op de titel van een PUNTENREGEL — nooit op
 *  een korting-aanbieding, en nooit met de bewering die `hoortBijWinkel` mag
 *  doen.
 *
 *  ── WAAROM DIT NIET DE HIERBOVEN AFGEWEZEN FOUT IS ─────────────────────────
 *
 *  Hierboven staat waarom er nooit op naam gekoppeld wordt: bij een KORTING
 *  (Amex) zou "Nike" op `nike-outlet-fake.nl` een namaakwinkel voorzien van een
 *  bewering die klopt lijkt. Die fout is hier nog steeds fout — deze functie
 *  mag daarom uitsluitend worden aangeroepen voor een PUNTEN-bron; dat bewaakt
 *  `aanbodVoorWinkel`, niet deze functie zelf.
 *
 *  Bij een puntenbron is de zin die hierbij hoort nooit "hier ligt een
 *  aanbieding voor je" (dat zou, precies zoals hierboven, een aankoop bij ING
 *  voorspiegelen als een aanbieding van de winkel zelf). Het is een zwakkere
 *  bewering: "in je ING Punten staat een titel die hierbij kan passen — kijk
 *  zelf of dat klopt en of het hier te verzilveren is". Die zin beweert zelf
 *  geen aanbieding, dus de tweede fout uit `hoortBijWinkel` kan hij niet maken.
 *  Vandaar een eigen `AanbodUitkomst`-tak (`mogelijke-merknaam-match`) die
 *  nooit samenvalt met `gevonden`.
 *
 *  Het label (het eerste deel van het domein, dus "jbl" uit "jbl.nl") moet
 *  minstens 3 tekens zijn en als los woord in de titel voorkomen — niet als
 *  losse substring, anders raakt "ing" op elk woord dat die drie letters
 *  toevallig bevat. */
export function mogelijkeMerknaamMatch(aanbieding: Aanbieding, winkelHost: string): boolean {
  const domein = registreerbaarDomein(winkelHost);
  if (domein === null) return false;
  const label = domein.split(".")[0]!;
  if (label.length < 3) return false;
  const patroon = new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return patroon.test(aanbieding.winkel);
}

/** Woorden uit een voucher-titel die op ELKE titel voorkomen en dus niets
 *  onderscheiden — "korting" op zichzelf zegt niets over WELK product. Zonder
 *  deze lijst zou "ING kortingsvoucher" met "kortingsvoucher" als enige
 *  overgebleven woord op praktisch elke productpagina rondom "korting" kunnen
 *  matchen; met de lijst blijft er dan niets over en matcht hij nergens. */
const PRODUCT_MATCH_STOPWOORDEN = new Set([
  "voor",
  "korting",
  "kortingsbon",
  "kortingsvoucher",
  "voucher",
  "punten",
  "van",
  "een",
  "het",
]);

/** Kleuren tellen niet mee als onderscheidend woord, en dat is GEMETEN nodig.
 *
 *  Op 27 augustus 2026 op de echte pagina's naast elkaar gelegd: ING schrijft
 *  "JBL Tune Flex 2 (zwart) voor € 55 kortingsvoucher" en bol.com noemt exact
 *  hetzelfde artikel "JBL Tune Flex 2 - True Wireless NC Earbuds - Black".
 *  Zelfde product, andere taal voor de kleur — en met de kleur als harde eis
 *  matcht dat nooit. Een kleur is bovendien een VARIANT-eigenschap: de voucher
 *  gaat over de Tune Flex 2, de kleur zegt welke uitvoering. Hem laten vallen
 *  kost precisie op de variant (een voucher voor de zwarte kan nu ook op de
 *  witte pagina raken) en dat is aanvaardbaar, want de zin die erbij hoort
 *  belooft niets over verzilverbaarheid — hij zegt "dit kan passen, check zelf".
 *  Dat kost minder dan de functie helemaal niet laten werken. */
const PRODUCT_MATCH_KLEUREN = new Set([
  "zwart",
  "wit",
  "black",
  "white",
  "blauw",
  "blue",
  "rood",
  "red",
  "groen",
  "green",
  "grijs",
  "grey",
  "gray",
  "roze",
  "pink",
  "beige",
  "paars",
  "purple",
  "geel",
  "yellow",
  "zilver",
  "silver",
  "goud",
  "gold",
]);

/** Een zwakkere, gehedgde koppeling op de PAGINA-INHOUD, niet op de winkelnaam.
 *
 *  ── WAAROM DIT ER NAAST STAAT EN GEEN VERVANGING IS VAN `mogelijkeMerknaamMatch` ──
 *
 *  Die functie koppelt op de HOSTNAAM van de winkel ("jbl" uit jbl.nl) en werkt
 *  daarom alleen op de merknaam-site zelf. Een marktplaats die het artikel van
 *  een ander merk verkoopt (bol.com met een JBL-koptelefoon) heeft een
 *  hostnaam die nooit matcht, hoe duidelijk het artikel ook een JBL is. Deze
 *  functie kijkt daarom naar wat de PAGINA ZELF zegt te verkopen
 *  (`Evidence.productNaam` uit read.ts) in plaats van naar waar hij staat.
 *
 *  ZELFDE GEHEDGDE ZIN, ZELFDE GRENS AAN PUNTEN-BRONNEN: de aanroeper
 *  (`aanbodVoorWinkel`) zet deze functie alleen in voor een PUNTEN-bron, om
 *  precies de reden die bij `hoortBijWinkel` staat — een KORTING-aanbieding
 *  ("30% korting bij JBL") geldt alleen aan de kassa VAN die winkel, hoe
 *  precies de paginainhoud ook overeenkomt.
 *
 *  TWEE EISEN, EN ALLEBEI NODIG: het MERK én minstens één onderscheidend woord.
 *
 *    - het merk is het eerste woord van de titel ("JBL"), en dat mag korter dan
 *      vier tekens zijn — precies omdat de bekendste merken dat zijn. Zonder
 *      deze eis blijft er bij "JBL Grip (zwart) …" na het wegstrepen van de
 *      standaardtaal en de kleur alleen "grip" over, en dan zou elke pagina met
 *      het woord "grip" erin raak zijn. Mét de merkeis moet er óók "jbl" staan;
 *    - én minstens één woord van vier tekens of langer dat geen standaardtaal
 *      en geen kleur is, dat ALLEMAAL moeten raken. Het merk alleen is
 *      nadrukkelijk niet genoeg: "JBL 15% kortingsvoucher" houdt niets
 *      onderscheidends over en matcht daarom nergens, net als "ING
 *      kortingsvoucher". Een merkbrede voucher aan elke pagina van dat merk
 *      hangen is een andere bewering dan deze, en die is hier niet gemaakt.
 *
 *  Zo blijft de fout die `hoortBijWinkel` afwees ook hier uitgesloten: er is
 *  nooit een match op één los, algemeen woord. */
export function mogelijkeProductMatch(aanbieding: Aanbieding, productNaam: string): boolean {
  const alle = aanbieding.winkel
    .toLowerCase()
    .split(/[^a-zà-ÿ0-9]+/i)
    .filter((w) => w !== "");
  const merk = alle[0];
  if (merk === undefined || merk.length < 3) return false;

  const onderscheidend = alle
    .slice(1)
    .filter(
      (w) => w.length >= 4 && !PRODUCT_MATCH_STOPWOORDEN.has(w) && !PRODUCT_MATCH_KLEUREN.has(w),
    );
  if (onderscheidend.length === 0) return false;

  const naam = productNaam.toLowerCase();
  const raakt = (w: string) =>
    new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(naam);
  return raakt(merk) && onderscheidend.every(raakt);
}

/* ──────────────────── wat er uit de pagina terugkomt ──────────────────────── */

/** Wat het aftasten per kaart teruggeeft. Alleen stukjes die op een patroon
 *  pasten, geen paginatekst.
 *
 *  ÉÉN VORM VOOR BEIDE BRONNEN, ook al staat er bij ING een puntenprijs en bij
 *  Amex een korting. Het uitpluizen van die tekst gebeurt hieronder in
 *  `leesPuntenprijs`, in code die zonder browser te testen is — en niet in de
 *  functie die in de pagina wordt geïnjecteerd. Zo is er ook maar één zeef in
 *  store.ts nodig, en kan er geen tweede vorm ontstaan die net iets anders
 *  gefilterd wordt. */
export type RuwAanbod = {
  /** De kop van de kaart, hooguit 60 tekens.
   *
   *  HET VELD HEET `winkel` MAAR DRAAGT NIET ALTIJD EEN WINKEL. Bij Amex is het
   *  de naam van de winkel waar de korting geldt; bij ING is het de naam van het
   *  ARTIKEL in de winkel van ING. Dat is met opzet niet in twee velden
   *  gesplitst — voor alle code hier is het "de kop van de kaart", en meer hoeft
   *  ze er niet van te weten.
   *
   *  Waar het WEL toe doet, is in de zinnen: lines.ts mag dit bij een puntenbron
   *  nooit als winkelnaam presenteren. En het doet er NIET toe voor de
   *  koppeling: die gaat uitsluitend over `domein` en raakt dit veld niet aan.
   *  Dat is precies waarom het hier één veld mag zijn. */
  winkel: string;
  /** De gevonden prijsvormen, samengevoegd, hooguit 120 tekens. Bij Amex is dat
   *  de korting ("30% korting"), bij ING de puntenprijs met het bij te betalen
   *  bedrag ("1.250 punten · € 19,95 bijbetalen"). */
  prijsTekst: string;
  /** De gevonden datumaanduiding zoals die er staat, hooguit 40 tekens. "" als
   *  er geen datum op de kaart stond. */
  totRuw: string;
  /** De hostnamen van de links in deze kaart, hooguit vijf. Het filteren van de
   *  eigen hosts van de aanbieder gebeurt in de pure laag hieronder, niet in de
   *  pagina: beleid hoort in code die te testen is. */
  hosts: string[];
};

export type RuweLezing = {
  /** Staat er een inlogformulier op deze pagina? Een POSITIEVE vaststelling:
   *  false betekent "geen wachtwoordveld gezien", niet "hij is ingelogd". Dat
   *  onderscheid is het verschil tussen een oorzaak noemen en er een verzinnen. */
  inlogformulier: boolean;
  /** De zin waarmee de pagina zelf zegt dat er niets is, of "". Letterlijk
   *  overgenomen zoals hij er staat — samenvatten zou van een uitspraak van de
   *  aanbieder een uitspraak van ons maken. */
  geenAanbiedingen: string;
  /** Hoeveel knopen er op de selectorlijst pasten. Nul betekent dat er niets is
   *  GEVONDEN dat op een aanbiedingenblok lijkt — niet dat er niets stáát, en
   *  dat verschil is op 24 augustus 2026 een ronde komen te kosten. Meer dan nul
   *  met geen enkele bruikbare kaart betekent dat het blok er is maar er anders
   *  uitziet. */
  markers: number;
  /** Hoeveel onderdelen deze pagina zelf opbouwt waar de lezer NIET in kan
   *  kijken: eigen elementen (een streepje in de tagnaam) die leeg zijn en
   *  waarvan geen schaduwwortel te openen viel.
   *
   *  OPTIONEEL, EN DAT IS EEN GRENS EN GEEN GEMAK. Alleen `collectIngWinkel`
   *  telt dit, want alleen daar is gemeten dat het ertoe doet; `collectAanbod`
   *  in amex.ts kijkt niet door schaduwwortels heen en zou hier dus altijd nul
   *  melden — en een nul die "niet gekeken" betekent is precies de soort nul die
   *  deze codebase nergens accepteert. Afwezig betekent hier: niet geteld.
   *
   *  WAT HET WEL EN NIET VASTSTELT: het scheidt een GESLOTEN component van een
   *  pagina waar helemaal niets van dien aard staat. Het scheidt een gesloten
   *  component NIET van een component die nog niet gebouwd was toen we keken —
   *  die twee zien er van buiten identiek uit, en de zin die erbij hoort noemt ze
   *  daarom allebei. */
  afgeschermd?: number;
  kandidaten: RuwAanbod[];
};

/** Een prijs in punten, zoals de ING Winkel hem noemt.
 *
 *  `bij` IS `null` ALS ER GEEN BEDRAG BIJ STOND, en dat is nadrukkelijk niet
 *  hetzelfde als nul. De voorwaarden van ING zeggen dat er meestal wél een
 *  bedrag bij komt ("Je betaalt de meeste producten met Punten, plus een bij te
 *  betalen bedrag") en soms niet ("Soms wissel je alleen Punten in, zoals bij
 *  kortingsbonnen"). Wij kunnen die twee niet uit elkaar houden door de
 *  afwezigheid van een bedrag: dat we geen bedrag lazen, kan ook betekenen dat
 *  het er in een vorm stond die wij niet herkennen. Van `null` "geen
 *  bijbetaling" maken zou een product goedkoper laten lijken dan het is, en dat
 *  is een bewering die een afwezigheid niet kan dragen. De zin op het scherm
 *  zegt daarom dat het er niet bij stond. */
export type Puntenprijs = {
  punten: number;
  /** Het bij te betalen bedrag zoals het er staat ("€ 19,95"), of null. */
  bij: string | null;
};

/** Eén opgeslagen aanbieding. Dit is alles wat er in chrome.storage.local komt. */
export type Aanbieding = {
  winkel: string;
  /** De prijs zoals hij op de kaart stond, onbewerkt. */
  prijsTekst: string;
  /** De uitgepluisde puntenprijs, of null als deze bron geen puntenbron is of
   *  er geen puntenprijs uit kwam. Optioneel omdat een kortingbron hem nooit
   *  draagt. */
  prijs?: Puntenprijs | null;
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
   *  lijst die vers lijkt is precies de fout die hier niet gemaakt mag worden. */
  gelezenOp: string;
};

/** Wat de lezing heeft opgeleverd. Zes uitkomsten, zes oorzaken, zes zinnen.
 *  Ze samenvoegen tot "er is niets gelezen" zou van zes verschillende feiten
 *  één vage mededeling maken, en dan kan hij niet zien wat hij eraan kan doen. */
export type LezingUitkomst =
  /** Er zijn aanbiedingen gelezen. */
  | "gelezen"
  /** Er staat een inlogformulier op de pagina: hij was hier niet ingelogd. */
  | "niet-ingelogd"
  /** De pagina zegt ZELF dat er nu niets klaarstaat. Dat is de keerzijde van
   *  "onbekend is nooit nul": een uitgesproken nul is wel een bekende nul, en
   *  die mag genoemd worden. Hem op één hoop gooien met "we konden niets lezen"
   *  zou een antwoord van de aanbieder verbouwen tot een gat in onze meting. */
  | "uitgesproken-geen-aanbiedingen"
  /** Geen enkele knoop paste op de selectorlijst, MAAR de pagina bouwt zichzelf
   *  wel op uit onderdelen waar de lezer niet in kan kijken.
   *
   *  ERBIJ GEKOMEN OP 24 AUGUSTUS 2026, en met een reden die het waard is te
   *  onthouden. De eigenaar stond op zijn eigen ingelogde winkelpagina en las:
   *  "LaVega vindt op deze pagina geen artikelen … het adres dat LaVega leest is
   *  https://mijn.ing.nl/punten*." Die zin wees hem op het ADRES — de oorzaak
   *  die er die dag NIET was, en de vorige die wél een ronde had gekost. De
   *  echte was bereik: de kaarten stonden in componenten waar
   *  `document.querySelectorAll` niet doorheen komt.
   *
   *  Deze uitkomst bestaat om die twee gevallen uit elkaar te houden, want ze
   *  vragen om een ander antwoord: bij "geen-aanbiedingenblok" kan hij zelf
   *  kijken of hij op het goede adres staat, en hier kan hij dat niet — hier is
   *  het onze grens en hoort dat er te staan. Wat deze uitkomst NIET beweert, is
   *  dat die onderdelen de winkel bevatten; alleen dat ze er zijn en dicht. */
  | "afgeschermd"
  /** Geen enkele knoop paste op de selectorlijst en er stond ook niets dicht:
   *  dit lijkt de pagina niet (meer) te zijn, of ze was nog aan het bouwen. */
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
  januari: 1,
  january: 1,
  jan: 1,
  februari: 2,
  february: 2,
  feb: 2,
  maart: 3,
  march: 3,
  mrt: 3,
  mar: 3,
  april: 4,
  apr: 4,
  mei: 5,
  may: 5,
  juni: 6,
  june: 6,
  jun: 6,
  juli: 7,
  july: 7,
  jul: 7,
  augustus: 8,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  october: 10,
  okt: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
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

function volJaar(ruw: string): number {
  const n = Number(ruw);
  return ruw.length === 2 ? 2000 + n : n;
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
 *  Bij de ING Winkel is de pagina Nederlands en zou dd-mm een veilige aanname
 *  lijken. Die aanname staat hier NIET in, en dat is met opzet: dan zou dezelfde
 *  tekst bij twee bronnen twee verschillende datums opleveren, en zou de
 *  strengheid van deze functie afhangen van wie hem aanroept. Eén regel, voor
 *  allebei.
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
    const ms =
      Date.UTC(Number(basis[1]), Number(basis[2]) - 1, Number(basis[3])) +
      Number(rel[1]) * 86_400_000;
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
  const cijfers = /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4}|\d{2})\b/.exec(t);
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

/* ────────────────────────── de puntenprijs uitlezen ───────────────────────── */

/** Het aantal punten en het bij te betalen bedrag uit de prijstekst van een
 *  ING-kaart. Null zodra er geen eenduidig aantal punten in staat.
 *
 *  ── WAAROM HET AANTAL PUNTEN VERPLICHT IS EN HET BEDRAG NIET ──────────────
 *
 *  Zonder aantal punten is er geen prijs. Een regel "JBL-speaker, € 19,95
 *  bijbetalen" zonder puntenaantal is geen aanbieding maar een halve lezing, en
 *  een halve prijs op het scherm is een gok met een lege plek erin: hij zou
 *  kunnen denken dat het product € 19,95 kost.
 *
 *  Het bedrag mag wél ontbreken, want dat komt echt voor — ING: "Soms wissel je
 *  alleen Punten in, zoals bij kortingsbonnen". Maar het ontbreken ervan wordt
 *  NIET als nul opgeslagen; zie `Puntenprijs.bij`.
 *
 *  ── WAAROM HET BEDRAG EEN AANLEIDING NODIG HEEFT ──────────────────────────
 *
 *  Op een winkelpagina staan meer euro's dan het bij te betalen bedrag: een
 *  adviesprijs, verzendkosten, een totaal. Het eerste euroteken pakken zou een
 *  willekeurig bedrag tot bijbetaling promoveren. Daarom telt een bedrag alleen
 *  als er een aanleiding bij staat ("bijbetalen", "bij te betalen", "+"), en
 *  anders is het antwoord null — met de zin erbij dat het er niet bij stond.
 *  Twijfel is hier geen reden om het eerste bedrag te pakken. */
export function leesPuntenprijs(ruw: string): Puntenprijs | null {
  const t = ruw.trim();
  if (t === "") return null;

  /* Het aantal punten. Duizendtallen met een punt of een spatie ("1.250",
   * "1 250") worden samengetrokken; een komma is hier GEEN scheidingsteken,
   * want "1,5 punten" bestaat niet en zou anders 15 opleveren. */
  const m = /(\d{1,3}(?:[. ]\d{3})*|\d+)\s*(?:ing[\s-]?)?punten\b/i.exec(t);
  if (!m) return null;
  const punten = Number(m[1]!.replace(/[. ]/g, ""));
  if (
    !Number.isFinite(punten) ||
    !Number.isInteger(punten) ||
    punten <= 0 ||
    punten > 100_000_000
  ) {
    return null;
  }

  /* Het bij te betalen bedrag, en alleen met een aanleiding ernaast. Twee
   * volgordes, want beide komen voor: "+ € 19,95 bijbetalen" en
   * "bij te betalen: € 19,95". */
  const bijPatronen = [
    /(?:\+|bij\s?betalen|bij te betalen|bijbetaling|meebetalen)\s*:?\s*(€\s?\d{1,5}(?:[.,]\d{2})?)/i,
    /(€\s?\d{1,5}(?:[.,]\d{2})?)\s*(?:bij\s?betalen|bij te betalen|bijbetaling|erbij)/i,
  ];
  for (const p of bijPatronen) {
    const b = p.exec(t);
    if (b) return { punten, bij: b[1]!.replace(/\s+/g, " ").trim() };
  }
  return { punten, bij: null };
}

/* ───────────────────── van ruwe kaarten naar aanbiedingen ─────────────────── */

/** Ziet deze winkelnaam er letterlijk uit als een hostnaam? Dan mag hij het
 *  domein leveren. "jbl.nl" wel, "JBL" niet, "Nike Store" niet.
 *
 *  Dit is geen naamvergelijking maar het lezen van een hostnaam die er als
 *  hostnaam staat. Het verschil: hier wordt niets aan de tekst toegevoegd of
 *  geraden — er staat een punt en een bekend achtervoegsel in, of niet. */
function hostUitNaam(naam: string): string | null {
  const t = naam
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(t)) return null;
  return registreerbaarDomein(t);
}

/** Is dit een host van de aanbieder zelf? */
function isEigenHost(host: string, eigen: readonly string[]): boolean {
  const h = host.trim().toLowerCase();
  return eigen.some((e) => h === e || h.endsWith(`.${e}`));
}

/** Het domein van één ruwe kaart, of null.
 *
 *  Spreken de links elkaar tegen — twee verschillende winkeldomeinen in dezelfde
 *  kaart — dan is er geen domein. Twijfel is hier geen reden om de eerste te
 *  pakken; het is de reden om niets te tonen. */
export function domeinVanKaart(ruw: RuwAanbod, eigenHosts: readonly string[]): string | null {
  const domeinen = new Set<string>();
  for (const h of ruw.hosts) {
    if (isEigenHost(h, eigenHosts)) continue;
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
export function leesAanbod(
  ruw: RuweLezing,
  asOf: string,
  bron: Bron,
): { lezing: Lezing; aanbiedingen: Aanbieding[] } {
  const aanbiedingen: Aanbieding[] = [];
  const gezien = new Set<string>();

  for (const k of ruw.kandidaten) {
    const winkel = k.winkel.trim().slice(0, 60);
    const prijsTekst = k.prijsTekst.trim().slice(0, 120);
    /* Een kaart zonder winkelnaam of zonder prijs is geen aanbieding maar een
     * halve lezing, en een halve aanbieding op het scherm is een gok met een
     * lege plek erin. Weglaten, en de uitkomst hieronder zegt dat het blok er
     * wel was. */
    if (winkel === "" || prijsTekst === "") continue;

    /* Bij een puntenbron moet er ook echt een puntenprijs uit komen. Zo niet,
     * dan is dit geen regel uit de winkel maar iets anders wat toevallig op de
     * selector paste — en die neerzetten met alleen een naam erbij zou een
     * product suggereren zonder te zeggen wat het kost. */
    let prijs: Puntenprijs | null = null;
    if (bron.prijsSoort === "punten") {
      prijs = leesPuntenprijs(prijsTekst);
      if (prijs === null) continue;
    }

    const totRuw = k.totRuw.trim().slice(0, 40);
    /* Eén regel per winkel-plus-prijs. Dezelfde aanbieding twee keer in de lijst
     * zou aan de kassa twee keer verschijnen alsof er twee zijn. */
    const sleutel = `${winkel.toLowerCase()}|${prijsTekst.toLowerCase()}`;
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);

    aanbiedingen.push({
      winkel,
      prijsTekst,
      prijs,
      tot: leesEinddatum(totRuw, asOf),
      totRuw,
      domein: domeinVanKaart({ ...k, winkel, prijsTekst }, bron.eigenHosts),
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
  /* AFGESCHERMD GAAT VÓÓR "GEEN BLOK", en alleen als er ook echt niets gevonden
   * is. Vonden we wél knopen (markers > 0), dan is "het blok staat er maar we
   * lezen er niets uit" het scherpere antwoord — dan hebben we tenminste iets
   * gezien. Vonden we niets én stond er iets dicht, dan is die afscherming het
   * enige wat we kunnen aanwijzen, en dan hoort dát er te staan in plaats van
   * een zin die naar het adres wijst.
   *
   * `?? 0` en niet `!`: een bron die niet telt (amex.ts) meldt hier niets, en
   * "niet geteld" mag nooit als "nul gevonden" gaan gelden. */
  else if (ruw.markers === 0 && (ruw.afgeschermd ?? 0) > 0) uitkomst = "afgeschermd";
  else if (ruw.markers === 0) uitkomst = "geen-aanbiedingenblok";
  else uitkomst = "blok-zonder-kaarten";

  return {
    lezing: {
      uitkomst,
      aantal: aanbiedingen.length,
      op: asOf,
      citaat:
        uitkomst === "uitgesproken-geen-aanbiedingen"
          ? ruw.geenAanbiedingen.trim().slice(0, 120)
          : "",
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
  /** Geen enkele regel koppelt op domein, maar bij een PUNTEN-bron staat er wel
   *  een titel die de merknaam van deze winkel raakt (zie
   *  `mogelijkeMerknaamMatch`). Zwakker dan "gevonden": dit beweert geen
   *  aanbieding, alleen een mogelijke match op tekst. `matches` is afgekapt op
   *  `MOGELIJKE_MATCH_MAX`; `totaal` telt ongekapt, zodat een afgekapte lijst
   *  dat ook zegt in plaats van te verzwijgen. */
  | {
      soort: "mogelijke-merknaam-match";
      op: string;
      dagen: number;
      matches: readonly Aanbieding[];
      totaal: number;
    }
  /** Zelfde soort zwakke koppeling als hierboven, maar op de PAGINA-INHOUD in
   *  plaats van de winkelnaam (zie `mogelijkeProductMatch`) — dit is de tak die
   *  ook op een marktplaats vuurt die het artikel van een ander merk verkoopt.
   *  Wordt pas geprobeerd als de merknaam-match niets vond: een match op de
   *  winkelnaam zelf is minstens zo specifiek en gaat voor. */
  | {
      soort: "mogelijke-product-match";
      op: string;
      dagen: number;
      matches: readonly Aanbieding[];
      totaal: number;
    }
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
  bron: Bron,
  productNaam: string | null,
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
    /* Alleen bij een PUNTEN-bron, en dat is de bewaking waar de rejection-
     * comment bij `hoortBijWinkel` om vraagt: bij een KORTING-bron zou dit de
     * Nike/nike-outlet-fake.nl-fout terugbrengen. */
    if (bron.prijsSoort === "punten") {
      const merknaamMatches = toestand.aanbiedingen.filter((a) =>
        mogelijkeMerknaamMatch(a, winkelHost),
      );
      if (merknaamMatches.length > 0) {
        return {
          soort: "mogelijke-merknaam-match",
          op,
          dagen,
          matches: merknaamMatches.slice(0, MOGELIJKE_MATCH_MAX),
          totaal: merknaamMatches.length,
        };
      }
      /* Pas als de winkelnaam niets opleverde: een match op de winkelnaam zelf
       * is minstens zo specifiek als een match op de paginainhoud, en gaat
       * daarom voor. Zie `mogelijkeProductMatch` voor waarom dit er apart naast
       * staat en niet in de plaats van komt. */
      if (productNaam !== null) {
        const productMatches = toestand.aanbiedingen.filter((a) =>
          mogelijkeProductMatch(a, productNaam),
        );
        if (productMatches.length > 0) {
          return {
            soort: "mogelijke-product-match",
            op,
            dagen,
            matches: productMatches.slice(0, MOGELIJKE_MATCH_MAX),
            totaal: productMatches.length,
          };
        }
      }
    }
    return { soort: "geen-voor-deze-winkel", op, dagen, totaal: toestand.aanbiedingen.length };
  }

  /* Verlopen en geldig apart. Een verlopen aanbieding weglaten zou hem laten
   * denken dat er niets was; hem tussen de geldige zetten zou hem laten denken
   * dat hij nog kan. Twee groepen, twee zinnen. */
  const verlopen = passend.filter((a) => a.tot !== null && a.tot < asOf);
  const geldig = passend.filter((a) => !(a.tot !== null && a.tot < asOf));
  return { soort: "gevonden", op, dagen, oud: dagen > AANBOD_OUD_NA_DAGEN, geldig, verlopen };
}
