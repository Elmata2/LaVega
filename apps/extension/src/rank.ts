/* De rangschikking aan de kassa. Puur: de peildatum komt als `asOf` binnen, er
 * wordt niets opgehaald en niets opgeslagen.
 *
 * Dit bestand hoort in packages/core thuis en staat hier omdat de kosten-lane op
 * hetzelfde moment in packages/core werkt. Zie het openstaande punt in het plan:
 * verhuizen is later een verplaatsing, geen herschrijving, want er zit geen DOM
 * en geen chrome.* in.
 *
 * ── DE TWEE SOMMEN, en waarom het er twee zijn ──────────────────────────────
 *
 * De opdracht zegt: verreken de kosten van de kaart. De vraag is bij WELKE kaart
 * dat een echte som is, en het antwoord is niet bij allemaal.
 *
 * EEN KAART DIE HIJ AL HEEFT. Die kosten lopen door of hij hier nu mee betaalt
 * of niet. Ze zijn niet het gevolg van dit advies, dus ze horen niet in de
 * aftreksom van deze aankoop. Toen het wel zo werkte, kwam er dit uit: zijn Amex
 * Business Gold (€ 270 per jaar) leverde op een aankoop van € 300 in dollars
 * € 7,50 op, en de rangschikking zette hem op € 7,50 − € 270 = −€ 262,50 en
 * adviseerde de kaart NIET te gebruiken. Dat is advies dat in de toestand waarin
 * het verschijnt niet kan werken: hij betaalt die € 270 dit jaar toch, en door
 * de kaart niet te gebruiken houdt hij niets over — hij laat € 7,50 liggen.
 * Voor kaarten die hij heeft is de uitkomst dus de OPBRENGST VAN DEZE AANKOOP,
 * en de kaartkosten staan ernaast als feit in hun eigen periode, niet in de som.
 *
 * EEN KAART DIE HIJ NIET HEEFT. Daar is het omgekeerde waar. Om dit advies te
 * kunnen opvolgen moet hij de kaart openen, en dan is de periodeprijs wel een
 * gevolg van dit advies. Daar wordt netto gerekend, over de vergeleken periode
 * uit horizon.ts, en komt daar nul of minder uit dan is het GEEN aanbeveling —
 * dat staat er dan met zoveel woorden bij in plaats van dat hij het moet
 * uitrekenen.
 *
 * ── ONBEKEND ────────────────────────────────────────────────────────────────
 *
 * Ontbreekt de koersopslag of de cashback, dan is de opbrengst onbekend: de rij
 * gaat naar `unknowns` met de reden erbij en wordt NIET gerangschikt. Nooit 0.
 *
 * Zijn de KAARTKOSTEN onbekend van een kaart die hij niet heeft, dan is de
 * opbrengst wél bekend en de uitkomst niet. Die rij komt in een eigen groep met
 * `basis: "bruto"`, en het woord netto valt daar niet — zie lines.ts, waar dat
 * ook getest wordt.
 *
 * DE TWEE GROEPEN WORDEN NIET DOOR ELKAAR GESORTEERD. Een netto van € 4,20
 * naast een bruto van € 7,50 leggen en de hoogste bovenaan zetten, is een
 * vergelijking waarvan één kant een onbekende bevat. Daarom twee lijsten.
 *
 * ── DE VOORWAARDEN, en waarom ze hier gelezen worden en niet in de UI ───────
 *
 * Elk cijfer in de catalogus draagt een `conditions`-tekst mee, en die tekst
 * werd nergens gelezen. Wat dat kostte, in één gemeten regel: bij een aankoop
 * van € 4.000 stond er "Betaal met Crypto.com Plus. Dat levert € 80,00 op",
 * terwijl in DEZELFDE record staat dat er hooguit $ 1.250 per maand meetelt, dat
 * de uitkering in CRO is en dat er een abonnement voor nodig is. Het bedrag was
 * niet te hoog — het was geen euro's, en het stond er zonder enig voorbehoud.
 *
 * Daarom wordt de voorwaardentekst hier gelezen, vóór de rangschikking, en niet
 * in de UI: of een cijfer een uitspraak kan dragen bepaalt in welke groep de
 * kaart hoort en of er überhaupt een bedrag bij mag. Dat is een
 * rangschikkingsbeslissing, geen opmaakbeslissing.
 *
 * WAT DEZE LEZER WEL EN NIET BEWEERT. Hij beweert NIET dat hij de tekst begrijpt.
 * Het is proza uit tarievenpagina's, deels Engels, en er is geen manier om
 * machinaal vast te stellen dat er niets anders in staat. Hij herkent VORMEN —
 * een plafond, een uitkering in een token, een drempel, een einddatum, een
 * uitsluitingslijst — en trekt daaruit altijd de behoudende conclusie: zodra er
 * een voorwaarde bij een cijfer staat, is het bedrag hooguit een bovengrens en
 * nooit een kale toezegging. Herkent hij niks in een tekst die er wél is, dan is
 * dat ONBEKEND: dan komt er geen bedrag op het scherm maar de mededeling dat er
 * een voorwaarde is die we niet konden beoordelen. Liever niets zeggen dan iets
 * onwaars.
 *
 * De ZINNEN staan niet hier maar in lines.ts. Dit bestand levert alleen de
 * bevindingen; een bevinding is nog geen uitspraak op een scherm. */

import type { CheckoutCard, CardFee, Sourced } from "./types.js";
import { pctOfCents, points as pointsOn } from "./money.js";
import {
  minimumCharge,
  comparableHorizonMonths,
  DEFAULT_HORIZON_MONTHS,
  type MinimumCharge,
} from "./horizon.js";

export type Currency = string;

export type RankInput = {
  cards: readonly CheckoutCard[];
  /** De id's die hij in de extensie heeft aangevinkt. */
  heldIds: readonly string[];
  /** De munt waarin afgerekend wordt. "EUR" betekent: geen omrekening. */
  currency: Currency;
  /** Het bedrag, of null zolang het niet gelezen én niet ingevuld is. Zonder
   *  bedrag blijft de ORDE van de percentages staan (die is bedrag-onafhankelijk)
   *  maar zijn er geen euro's en dus geen netto. */
  amountCents: number | null;
  /** Over hoeveel maanden gerekend wordt bij een kaart die hij zou openen.
   *  Wordt door horizon.ts naar boven afgerond op hele jaren, zodat elke kaart
   *  over exact dezelfde periode wordt gemeten. */
  horizonMonths?: number;
  /** De peildatum, van de aanroeper. Hier staat geen Date.now(). */
  asOf: string;
};

/* ────────────────────────── de voorwaardenlezer ──────────────────────────── */

/** Bij welk cijfer een voorwaarde hoort. Zonder dit veld zou "er geldt een
 *  plafond" op het scherm bij het verkeerde getal kunnen belanden. */
export type Veld = "cashback" | "koersopslag" | "kaartkosten";

/** Waar een plafond op slaat. Een plafond per TRANSACTIE bijt bij deze aankoop;
 *  een plafond per maand of week hangt af van wat hij verder die periode
 *  uitgeeft, en dat weten we niet — dus daar rekenen we niet mee, we noemen het. */
export type CapBasis = "transactie" | "maand" | "week" | "jaar";

export type Caveat =
  /** De uitkering is niet in euro's. Een bedrag met een euroteken is dan geen
   *  te lage of te hoge schatting maar een andere eenheid. */
  | { soort: "in-token"; veld: Veld; token: string }
  /** Er telt maar een deel van de besteding mee, en we hebben het bedrag
   *  eenduidig kunnen lezen. Alleen euro's: een plafond in dollars wordt niet
   *  omgerekend, want daar is een koers voor nodig en die halen we nergens op. */
  | { soort: "plafond"; veld: Veld; capCents: number; basis: CapBasis }
  /** Er is een plafond, maar het bedrag is niet eenduidig uit de tekst te lezen
   *  — of het staat in een andere munt. Dan noemen we het plafond wél en het
   *  bedrag niet. Zie de kop van `zoekCap`: hier is een verkeerd getal erger dan
   *  geen getal. */
  | { soort: "plafond-zonder-bedrag"; veld: Veld }
  /** De bron noemt geen plafond en zegt er zelf bij dat dat geen bevestigde
   *  afwezigheid is. Onbekend, dus geen groen licht. */
  | { soort: "plafond-onbekend"; veld: Veld }
  /** Uitgesproken: er is geen plafond. De keerzijde van regel 1. */
  | { soort: "geen-plafond"; veld: Veld }
  /** Abonnement, inleg, staking of een tier die gehaald moet worden. */
  | { soort: "drempel"; veld: Veld }
  /** Het programma loopt af. `verlopen` is gemeten tegen de peildatum. */
  | { soort: "einddatum"; veld: Veld; datum: string; verlopen: boolean }
  /** Categorieën of winkels waarop niets wordt uitgekeerd. */
  | { soort: "uitsluitingen"; veld: Veld }
  /** De bron zegt zelf dat dit cijfer opnieuw gecontroleerd moet worden. */
  | { soort: "herzien"; veld: Veld }
  /** Een nul die alleen onder voorwaarden nul is. Geen uitgesproken nul. */
  | { soort: "voorwaardelijke-nul"; veld: Veld }
  /** Er komen eenmalige kosten bij het periodebedrag. */
  | { soort: "eenmalig"; veld: Veld }
  /** Het bedrag komt bovenop een ander verplicht product. */
  | { soort: "bovenop"; veld: Veld }
  /** Er staat een voorwaarde die we niet machinaal konden duiden. */
  | { soort: "onbeoordeeld"; veld: Veld };

const MAANDEN_EN: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};
const MAANDEN_NL: Record<string, number> = {
  januari: 1,
  februari: 2,
  maart: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  augustus: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
};

/** "30 September 2026" of "30 september 2026" → "2026-09-30". Onleesbaar → null.
 *  Geen Date-constructor: die accepteert van alles en maakt er stilletjes een
 *  datum van, en een verkeerde einddatum is erger dan geen einddatum. */
function leesDatum(dag: string, maand: string, jaar: string): string | null {
  const m = MAANDEN_EN[maand.toLowerCase()] ?? MAANDEN_NL[maand.toLowerCase()];
  if (!m) return null;
  const d = Number(dag);
  if (!Number.isInteger(d) || d < 1 || d > 31) return null;
  return `${jaar}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Een bedrag uit een voorwaardentekst naar centen, of null als het niet
 *  eenduidig is.
 *
 *  DIT IS DE DUIZENDVALKUIL uit read.ts, in een ander bestand. "€ 1.250" is in
 *  het Nederlands duizendtweehonderdvijftig en in het Engels één-euro-vijfentwintig,
 *  en de teksten in de catalogus zijn allebei de talen. De regel hier: een
 *  scheidingsteken met DRIE cijfers erachter is een duizendteken, met twee aan
 *  het eind is het een decimaalteken, en al het andere is dubbelzinnig en levert
 *  null — dan noemen we het plafond wel, maar rekenen we er niet mee. */
function leesBedragCents(ruw: string): number | null {
  const s = ruw.trim();
  if (!/^\d[\d.,]*$/.test(s)) return null;

  const laatste = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  if (laatste === -1) return Math.round(Number(s) * 100);

  const staart = s.slice(laatste + 1);
  const kop = s.slice(0, laatste);
  if (!/^\d+$/.test(staart)) return null;

  if (staart.length === 3) {
    /* Duizendteken. Alle scheidingstekens weg, en dan moet er alleen nog een
     * heel getal overblijven. */
    const heel = s.replace(/[.,]/g, "");
    if (!/^\d+$/.test(heel)) return null;
    return Math.round(Number(heel) * 100);
  }
  if (staart.length === 2) {
    const heel = kop.replace(/[.,]/g, "");
    if (!/^\d+$/.test(heel)) return null;
    return Math.round(Number(heel) * 100) + Number(staart);
  }
  return null;
}

const PERIODE_WOORDEN: Array<[RegExp, CapBasis]> = [
  [/^transaction$|^transactie$/i, "transactie"],
  [/^week(ly)?$/i, "week"],
  [/^(calendar )?month(ly)?$|^maandelijks(e)?$|^maand$/i, "maand"],
  [/^year(ly)?$|^jaar$/i, "jaar"],
];

function capBasisVan(woord: string): CapBasis | null {
  for (const [re, basis] of PERIODE_WOORDEN) if (re.test(woord.trim())) return basis;
  return null;
}

/* HET PLAFONDBEDRAG IS DE PLEK WAAR DEZE LEZER BIJNA DE MIST IN GING, en dat is
 * gemeten en niet bedacht. Een eerste versie pakte elk bedrag met een periode
 * erachter. Dat gaf op de echte catalogus vier onware plafonds achter elkaar:
 *
 *   Crypto.com Plus  "er telt hooguit € 3,99 per maand mee"   ← dat is de PRIJS
 *                                                               van het abonnement
 *   Crypto.com Pro   "€ 24,99 per maand"                      ← idem
 *   Icy White        "€ 45.000,00 per maand"                  ← de CRO-inleg,
 *                                                               uit "12-month staking"
 *   Bleap            "€ 10,00 per maand"                      ← de waarde van de
 *                                                               Amazon Prime-actie
 *
 * Een tarievenpagina staat vol bedragen die geen plafond zijn. Daarom pakt deze
 * versie een BEDRAG alleen als het pal achter het woord "cap"/"plafond" staat en
 * er direct een periode achter komt, en alleen in euro's — een bedrag in dollars
 * omrekenen zou een koers vereisen die we nergens ophalen. In alle andere
 * gevallen stellen we alleen vast DAT er een plafond is. Dat is minder, en het
 * is waar; een verkeerd plafond is hier erger dan geen plafond, want het gaat
 * rechtstreeks de som in. */
const CAP_MET_BEDRAG =
  /\b(?:cap(?:ped)?\s+(?:of|at)|plafond van|maximaal)\s*€\s?([\d][\d.,]*)\s*(?:per|\/)\s*(transaction|transactie|calendar month|month|maandelijkse|maandelijks|maand|week|weekly|year|yearly|jaar)/i;

/** Is er überhaupt sprake van een plafond? Alleen woorden die een plafond
 *  BENOEMEN, niet elk bedrag dat toevallig een periode draagt. */
const CAP_AANWEZIG =
  /\bcap\b|\bcapped\b|spending cap|\bplafond\b|\blimiet\b|maximum[^.]{0,25}\bspend\b/i;

/** Uitgesproken géén plafond. De keerzijde van regel 1 — maar alleen als de bron
 *  het zelf zegt, en niet als ze zegt dat ze het NIET weet. */
const GEEN_CAP = /\b(unlimited|no limit|onbeperkt|geen plafond|geen limiet)\b/i;

/** De bron zegt zelf dat er geen plafond in staat en dat dat geen bevestigde
 *  afwezigheid is. Precies het onderscheid uit regel 1, in de data zelf. */
const CAP_ONBEKEND = /\bno cap\b/i;
const CAP_ONBEKEND_TOELICHTING = /gap in the source|not a confirmed absence/i;

type GelezenCap = { capCents: number; basis: CapBasis } | null;

function zoekCap(tekst: string): GelezenCap {
  const m = CAP_MET_BEDRAG.exec(tekst);
  if (!m) return null;
  const cents = leesBedragCents(m[1]!);
  const basis = capBasisVan(m[2]!);
  if (cents === null || basis === null) return null;
  return { capCents: cents, basis };
}

/* ──────────── herkomstnotitie of beperking: de tekst per ZIN ──────────────── */

/* WAT DIT REPAREERT, en het is gemeten en niet bedacht.
 *
 * Elk cijfer in de catalogus draagt zijn HERKOMST mee in hetzelfde veld als zijn
 * VOORWAARDEN: welke rij in welk tarievenblad, welk versiestempel, welke
 * Wayback-kopie, wat een EXTRA kaart kost. Dat is proza over onze gegevens en
 * geen voorwaarde bij dit cijfer. De lezer hieronder kon dat verschil niet zien,
 * en las herkomstproza als een specifieke beperking. Drie gemeten gevolgen:
 *
 *   1. BLEAP. In "dit is geen eenmalige formulering van een marketingtekst"
 *      vuurde /\beenmalig/, en er kwam "Bij de kaartkosten hoort een voorwaarde:
 *      er komen eenmalige kosten bij" op het scherm — over een woord dat de
 *      FORMULERING van de bron beschrijft en dat daar ontkennend staat.
 *   2. WIREX. De herkomstnotitie bij de PRIJS citeert de merknaam van de
 *      cashback ("precies het niveau waar de 0,5% Cryptoback bij hoort"), en
 *      daaruit kwam "de uitkering is in crypto en niet in euro's" — over een
 *      prijs. Een prijs is geen uitkering; die zin was onzin.
 *   3. EN HET GEVOLG VOOR DE RANGSCHIKKING. Van de 38 fee-cijfers in de bundel
 *      hadden er 0 een lege voorwaardenlijst. bepaalClaim kon voor kaartkosten
 *      dus NOOIT "vast" teruggeven, en de netto-tak van buildRow was
 *      onbereikbaar — niet omdat de prijs onbekend was, maar omdat er een
 *      herkomstnotitie naast stond.
 *
 * DE REGEL, in één zin: lees de tekst ZIN VOOR ZIN, en laat een zin alleen weg
 * als hij POSITIEF als herkomst herkend wordt. Een zin die ook maar één
 * beperkingsvorm draagt, blijft staan — beperking wint van herkomst, binnen
 * dezelfde zin, voor elke beperkingsvorm die in de lijst hieronder staat. Een
 * zin die we in geen van beide lijsten terugvinden blijft óók staan, en dan is
 * de uitkomst "onbeoordeeld", precies als vandaag.
 *
 * EN DIT IS DE PLEK WAAR DE EERSTE VERSIE VAN DEZE ONTSNAPPING FOUT ZAT, gemeten
 * en niet bedacht. "Positief herkend" was PER WOORD: één herkomstwoord ergens in
 * de zin maakte de HELE zin herkomst, en de rest van de zin werd niet meer
 * gelezen. Elke beperking die de lijst hierboven nog niet kende, viel dus weg
 * zodra de zin ook een brondocument noemde. Zeven gemeten voorbeelden, allemaal
 * "herkomst/vindplaats" en allemaal een kale netto-uitspraak:
 *
 *   "De prijs staat in de tarieventabel van het Compleet Pakket."
 *   "Volgens de tarievenwijzer stijgt de jaarbijdrage volgend jaar."
 *   "De prijslijst vermeldt dit bedrag vanaf het tweede jaar."
 *   "Het informatieblad zet dit bedrag in de kolom voor studenten."
 *   "De tarieventabel hangt dit bedrag aan een spaartegoed boven de grens."
 *   "De prijslijst zet dit bedrag in de kolom van het instapniveau."
 *   "De productpagina neemt de kaart niet langer op in het aanbod."
 *
 * En één die niet bedacht is maar in de bundel staat, bij rabo-goldcard: "dit
 * document is het Informatiedocument van dat pakket en noemt de kaart bij naam."
 * Die zin haalde basis=netto op een prijs die alleen BOVENOP Rabo Standaard
 * bestaat; dat de rij vandaag toch behoudend uitkomt, hangt er alleen aan dat de
 * buurzin het woord "bovenop" gebruikt.
 *
 * DAAROM IS DE HERKENNING NU PER ZIN EN NIET PER WOORD, en dat is wat de
 * ontsnapping behoudend maakt. Een zin is herkomst als (a) er een herkomstvorm
 * in matcht ÉN (b) er na het wegstrepen van die vormen geen woord overblijft dat
 * niet in `HERKOMST_WOORDEN` staat — een GESLOTEN woordenboek van lidwoorden,
 * voorzetsels, neutrale meldwerkwoorden en de vindplaatswoorden zelf. "pakket",
 * "studenten", "instapniveau", "vanaf", "stijgt", "aanbod": geen daarvan staat
 * erin, dus geen van de acht zinnen hierboven komt nog door. Onbekende proza
 * valt naar de kant van de beperking en niet naar een netto-uitspraak, en dat
 * geldt nu voor elk woord dat we niet eerder hebben gezien.
 *
 * DE PRIJS DAARVAN, eerlijk: nieuwe herkomstproza van een bank die we nog niet
 * hebben gelezen valt naar "onbeoordeeld" tot iemand het woordenboek uitbreidt.
 * Dat is de goede kant om op te falen — het levert een voorbehoud op en geen
 * kaal bedrag — maar het betekent ook dat dit woordenboek onderhoud vraagt, en
 * dat elke toevoeging eraan velden van "geen uitspraak" naar "vaste uitspraak"
 * verplaatst. De teller in rank.test.ts maakt dat zichtbaar.
 *
 * EN NOG EEN SLOT OP DE DEUR: een zin met een BEDRAG erin is alleen herkomst als
 * uit dezelfde zin blijkt van WIE dat bedrag is — een extra kaart, een
 * jaartotaal van hetzelfde bedrag, of een bevestiging uit een tweede bron.
 * Bedragen zijn de gevaarlijke inhoud van dit veld: "Bij een SNS
 * Studentenrekening € 27,50 per jaar" staat vol herkomstwoorden en is toch een
 * ander tarief. Zonder die eigenaar valt de zin naar "onbekend".
 *
 * WAT DIT NIET IS. Het is regex-vormherkenning over proza — dezelfde soort
 * gereedschap, met dezelfde faalvormen, als de lezer die het repareert. Het
 * koopt correctheid door MOEILIJKER TE BEVREDIGEN te zijn, niet door iets te
 * begrijpen. Elke regel die aan de herkomstlijst wordt toegevoegd, verplaatst
 * velden van "geen uitspraak" naar "vaste uitspraak" en hoort dus gemeten te
 * worden, niet geraden. */

export type ZinSoort = "restrictie" | "herkomst" | "onbekend";

/** Eén zin met zijn oordeel en de naam van de vorm die dat oordeel gaf. De naam
 *  is er voor de test: "welke beperkingscategorie ving deze zin" is de vraag die
 *  rank.test.ts per categorie stelt. */
export type GelezenZin = { zin: string; soort: ZinSoort; vorm: string | null };

/* DE BEPERKINGSLIJST. Deze wordt EERST gelopen, want een zin die zowel een
 * herkomstwoord als een beperking draagt is een beperking. Dat is niet
 * theoretisch: "Bovenop de € 3,45 per maand van Rabo Standaard; dit document is
 * het Informatiedocument van dat pakket" is één zin met allebei erin. */
const RESTRICTIE_VORMEN: ReadonlyArray<readonly [string, RegExp]> = [
  /* Voor wie het cijfer geldt. */
  ["geschiktheid", /\balleen\s+(?:voor|bij|binnen|met|aan te vragen|geldig|bestaande)/i],
  [
    "geschiktheid",
    /\buitsluitend\b|\binwoners van\b|\bgeselecteerde\b|\bresidents? of\b|\bavailable only\b/i,
  ],
  ["geschiktheid", /\bvanaf \d{1,2} jaar\b|\bleeftijd\b|\btot en met \d{1,2} jaar\b/i],
  /* Het cijfer hangt aan een ander product dat óók geld kost. Regel 2 van de
   * opdracht woont hier: "inbegrepen in het pakket" is geen nul. */
  ["pakketkoppeling", /\b(?:daar)?bovenop\b|\bexclusief de kosten\b|\bgekoppelde dienst\b/i],
  ["pakketkoppeling", /\bbinnen\s+(?:het|de|dat|die|een)\b|\bbinnen\s+[A-Z]/],
  ["pakketkoppeling", /\bin de pakketprijs\b|\bpakketprijs\b|\binbegrepen\b|\bbankpakket\b/i],
  ["pakketkoppeling", /\bverplicht\b|\bvereist\b|\bis nodig\b|\bkorting\b/i],
  /* Een tarief dat bij een ander segment of pakket hoort dan dit cijfer. */
  ["ander-tarief", /\b(?:tarief|prijs)\s+bij\b/i],
  /* Hoofdletterongevoelig op "bij", want zo'n zin staat ook aan het BEGIN van
   * een tekst ("Bij een SNS Studentenrekening € 27,50 per jaar"), en dan is de
   * b een hoofdletter. De eigennaam erachter blijft wel een hoofdletter: "bij
   * betalen in vreemde valuta" is geen ander tarief maar een omschrijving. */
  ["ander-tarief", /\b[Bb]ij\s+(?:een|het|de|uw|je)?\s*[A-Z][a-zA-Z]/],
  /* Iets wat de gebruiker eerst moet halen, houden of afsluiten. */
  ["drempel", /\bminimale?\s+(?:besteding|inleg|saldo)\b|\bminimaal\b|\bminimum\b/i],
  ["drempel", /\bat least\b|\bmust hold\b|\brequires?\b|\btier gate\b/i],
  ["drempel", /\bstak(?:e|ed|ing)\b|\block-?up\b|\b(?:X-tras-)?tiers?\b/i],
  ["drempel", /\babonnement|\bsubscription|\bvast blijven staan\b|\bWXT\b|\bCRO\b/i],
  /* Tijdelijk, en dus geen vaste prijs. */
  ["tijdelijk", /\beerste jaar (?:gratis|kosteloos)\b|\bkosteloos\b|\btijdelijk\b/i],
  ["tijdelijk", /\bactievoorwaarden?\b|\bactieaanbod\b|\bpromo\b|\buntil further notice\b/i],
  ["tijdelijk", /\bopgeschort\b|\bverlopen\b/i],
  /* Aangekondigd, tegengesproken of oud: het cijfer is dan een ondergrens en
   * geen actuele prijs. */
  ["aangekondigd", /\b(?:per|vanaf)\s+\d{1,2}\s+[a-zA-Z]+\s+\d{4}\b/i],
  [
    "aangekondigd",
    /\bwijzig|\bverhoog|\bverhoging|\bverhogen|\bverhoogd|\bverhoogt|\bprijsstijging\b/i,
  ],
  ["aangekondigd", /\bgaat\b[^.]{0,40}\bnaar\s*€|\bondergrens\b|\bgeen actuele prijs\b/i],
  ["aangekondigd", /\bhercontroleer\b|\bhoudbaarheid\b|\bveroudering\b|\bachterhaald\b/i],
  [
    "aangekondigd",
    /\bstaleness\b|re-check|\bspreekt[^.]{0,25}\btegen\b|\btegenspraak\b|\bnieuwer\b/i,
  ],
  /* Kosten die er nog bij komen: eenmalig, verzending, vervanging, "may apply". */
  [
    "extra-kosten",
    /\beenmalige?\s+(?:kosten|vergoeding|bijdrage|uitgiftevergoeding|fee|post|maandpost)\b/i,
  ],
  ["extra-kosten", /\bone-off\b|\bone-time\b|\bmay apply\b|\bkomen er\b|\bper keer\b/i],
  ["extra-kosten", /\bvervanging\b|\bvervangende?\b|\bverzendkosten\b|\bbezorging\b|\bissuance\b/i],
  ["extra-kosten", /\bwat wel geld kost\b|\bwat niet nul is\b/i],
  /* Niet meer te krijgen, of onder een andere naam. Een prijs die je niet meer
   * kunt afnemen is geen prijs waar een netto-uitkomst op mag leunen. */
  ["gesloten", /\bniet meer\b|\bniet beschikbaar\b|\bouder pakket\b/i],
  /* De catalogus zegt zelf dat hij niet zeker weet WELK product dit is. Bij ING
   * staat "LET OP DE NAAMOVERLAP: … kent deze naam niet meer" bij twee kaarten.
   * Een prijs waarvan het product wankelt, kan geen netto-uitkomst dragen. */
  ["onzeker-product", /\bnaamoverlap\b|\bvermoedelijk\b|\bopenstaande ?vra/i],
  /* De vormen die de detectoren hieronder zelf al kennen. Ze staan hier zodat
   * een zin die er een draagt NOOIT als herkomst wordt weggefilterd — anders
   * zou de detector zijn eigen bewijs niet meer zien. */
  ["plafond-of-uitsluiting", /\bcap\b|\bcapped\b|\bplafond\b|\blimiet\b|\blimit\b|\bdaglimiet\b/i],
  [
    "plafond-of-uitsluiting",
    /\bmaximum\b|\bmaximaal\b|\bexclusions?\b|\bineligible\b|\bexcluded\b/i,
  ],
  ["plafond-of-uitsluiting", /\buitgesloten\b|\buitsluiting|\bin crypto\b|\bniet in euro/i],
];

/* DE HERKOMSTLIJST, en dit is de gevaarlijke helft. Alles wat hier binnen valt,
 * mag uit de tekst worden weggelaten, en een tekst die daarna leeg is levert een
 * KALE prijs op. Daarom staat er niets in dat ook maar iets over de PRIJS zelf
 * zegt, en daarom is de lijst kort. */
const HERKOMST_VORMEN: ReadonlyArray<readonly [string, RegExp]> = [
  /* Waar het cijfer staat. */
  [
    "vindplaats",
    /\b(?:tabelrij|rij|tabel|kolom(?:men)?|opschrift|voetnoot|noot \d|artikel \d|clausule \d)\b/i,
  ],
  [
    "vindplaats",
    /\b(?:het|dit|hetzelfde) document\b|\binformatiedocument\b|\binformatieblad\b|\btarievenwijzer\b/i,
  ],
  [
    "vindplaats",
    /\btarievenstuk\b|\btarieventabel\b|\bkostenoverzicht\b|\bkostenpagina\b|\bprijslijst\b|\boverzicht\b/i,
  ],
  [
    "vindplaats",
    /\bproductpagina\b|\blandingspagina\b|\blegal-pagina\b|\baanvraagbrochure\b|\bde bron\b|\bpayload\b/i,
  ],
  /* Wanneer het gelezen is, en waaraan die datum hangt. */
  ["datering", /\bversiestempel\b|\bFEE_[A-Z0-9_]+\b|\bde datum is\b|\bdateert\b|\bgedateerd\b/i],
  ["datering", /\bgepubliceerd op\b|\blaatst bijgewerkt\b|\bbijwerkdatum\b|\bingangsdatum\b/i],
  [
    "datering",
    /\blastUpdatedDate\b|\bupdatedAt\b|\bpageUpdateDate\b|\baanmaakdatum\b|\bvolgnummer\b/i,
  ],
  ["datering", /\bdraagt geen datum\b|\bzonder datum\b/i],
  /* Hoe we eraan zijn gekomen toen de bron verdween. */
  ["archief", /\bwayback\b|\bsnapshot\b|\b404\b|\bHTTP \d{3}\b|\bgelezen is de\b|\blive URL\b/i],
  /* Een tweede bron die hetzelfde zegt. Dit is de enige vorm die een BEDRAG mag
   * dragen zonder van een ander product te zijn: hij zegt dat het bedrag
   * hetzelfde is, niet dat het iets anders is. */
  [
    "bevestiging",
    /\bhetzelfde bedrag\b|\bwoordelijk gelijk\b|\bhetzelfde stempel\b|\bstaat ook op\b/i,
  ],
  ["bevestiging", /\bzegt hetzelfde\b|\bnog steeds zo\b|\bbevestigt\b|\bnoemt ook\b/i],
  /* Het jaartotaal van dít bedrag. MET OPZET HERKOMST: zo kan het nooit als
   * waarde worden gebruikt, en blijft regel 3 (de bron bepaalt de eenheid)
   * overeind. Er wordt hier niets omgerekend en er mag hier niets omgerekend. */
  ["jaartotaal", /\bhet jaartotaal\b|\bjaarprijs\b|\bin jaarvorm\b|\bniet omgerekend\b/i],
  ["jaartotaal", /\bzowel de maand- als de jaar/i],
  /* Het bedrag van een ANDER product uit dezelfde tabel. */
  [
    "ander-product",
    /\b(?:extra|additionele|tweede)\s+(?:kaart|kaarten|card|betaalpas|kaarthouder)\b/i,
  ],
  /* "extra Green Cards", "extra Platinum Card": het woord "extra" met een
   * EIGENNAAM erachter. Drie van de vier Flying Blue-teksten zeggen dit met een
   * kleine letter en één met een hoofdletter; dat is spelling en geen betekenis,
   * en de vorm mocht daar niet van afhangen. */
  /* De eigennaam wordt HELEMAAL meegenomen — `[A-Z][a-zA-Z]*` en niet `[A-Z]` —
   * omdat deze vormen straks ook worden weggestreept om te kijken wat er van de
   * zin overblijft. Met één hoofdletter bleef er "reen" van "Green" staan, en dan
   * zou dat brokstuk in het woordenboek moeten. Aan WAT er matcht verandert het
   * niets: een hoofdletter met letters erachter is nog steeds een hoofdletter. */
  [
    "ander-product",
    /\b(?:[Ee]xtra|[Aa]dditionele|[Tt]weede)\s+[A-Z][a-zA-Z]*|\bper extra kaart\b|\bkaarthouder\b/,
  ],
  /* Wie de rekening stuurt. */
  ["uitgever", /\buitgegeven door\b|\bis een product van\b|\bde uitgever\b|\bICS-product\b/i],
  /* Wat er in de prijs zit. Let op de buurman in de beperkingslijst:
   * "inbegrepen in het pakket" is een KOPPELING en geen inhoud, en die staat
   * daarom hierboven — beperking wint. */
  ["inhoud", /\binclusief\b|\bbestaat uit\b/i],
  /* De catalogus schrijft een uitgesproken nul met zoveel woorden uit. LET OP DE
   * ONTKENNING: die staat er in de catalogus even vaak, en dan betekent de zin
   * het tegenovergestelde — zie `UITGESPROKEN_NUL_ONTKEND` hieronder, dat zowel
   * deze vorm als stap 7 afdekt. */
  ["uitgesproken-nul", /\buitgesproken nul\b/i],
];

/* EEN ONTKENDE UITGESPROKEN NUL IS HET TEGENDEEL VAN EEN UITGESPROKEN NUL, en
 * dat is precies de fout die deze commit bij Bleap repareerde ("dit is geen
 * eenmalige formulering" → "er komen eenmalige kosten bij"), één veld verderop.
 *
 * Het is geen bedachte formulering. `grep -rn "geen uitgesproken nul"
 * docs/catalog/` geeft drie treffers in staging-kaartkosten.json: "dat is een
 * ontbrekende rij, geen uitgesproken nul", "De afwezigheid van een rij in een
 * tarievenoverzicht is geen uitgesproken nul", "Dus: geen uitgesproken nul voor
 * accountFee". Dat is deze catalogus die zijn eigen regel 2 uitschrijft, en het
 * is één merge van een accountFee-rij verwijderd.
 *
 * Op de substring toetsen laat zo'n zin twee keer verkeerd landen: stap 7 ziet
 * de woorden staan en houdt het voorbehoud "voorwaardelijke-nul" binnen, en de
 * herkomstvorm hierboven maakt van dezelfde zin een herkomstnotitie, zodat stap
 * 10 ook geen "onbeoordeeld" meer toevoegt. Wat er dan uitkomt is een kale
 * € 0,00 in de nettosom — precies de valse nul van RegioBank en Trade Republic.
 *
 * Daarom wordt de ontkenning apart gelezen, PER ZIN (de puntkomma-splitsing doet
 * hier het werk: "De tarievenwijzer noemt hier geen bedrag; dit is geen
 * uitgesproken nul" is één tekst met twee beweringen), en valt de zin bij een
 * ontkenning naar "onbekend" — niet naar herkomst, en niet naar een nul. */
const UITGESPROKEN_NUL = /\buitgesproken nul\b/i;
const UITGESPROKEN_NUL_ONTKEND =
  /\b(?:geen|niet|nooit|no|not)\b[^.;!?]{0,40}?\buitgesproken nul\b/i;

/** Zegt deze tekst ergens BEVESTIGEND dat de nul uitgesproken is? */
function bevestigtUitgesprokenNul(tekst: string): boolean {
  return splitsZinnen(tekst).some(
    (z) => UITGESPROKEN_NUL.test(z) && !UITGESPROKEN_NUL_ONTKEND.test(z),
  );
}

/* HET GESLOTEN WOORDENBOEK, en dit is de helft die de ontsnapping per ZIN maakt
 * in plaats van per woord. Zie de kop van dit blok voor de acht gemeten zinnen
 * die hier op stuklopen.
 *
 * WAT ER WEL IN MAG: lidwoorden, voornaamwoorden, voegwoorden, voorzetsels,
 * neutrale meldwerkwoorden ("staat", "noemt", "draagt"), de woorden waarmee een
 * vindplaats zichzelf beschrijft ("titel", "voettekst", "voorganger"), de
 * maandnamen, en de eigennamen van de kaarten waarvan we de herkomstproza al
 * gelezen hebben.
 *
 * WAT ER NIET IN MAG, en dit is de hele afweging: elk woord dat iets zegt over
 * WANNEER, VOOR WIE of WAARBINNEN de prijs geldt. Dus geen "pakket", geen
 * "vanaf", geen "tweede", geen "alleen", geen "boven een besteding", geen
 * "studenten", geen "niveau". Wie hier een woord bijzet, verplaatst velden van
 * "geen uitspraak" naar "vaste uitspraak", en dat hoort gemeten te worden.
 *
 * "daarna" staat er wél in, en dat is de enige twijfelgeval: het is temporeel.
 * Het komt uit "inclusief 2 extra kaarten; daarna € 30 per jaar per extra kaart"
 * bij Amex. Het slot op de deur eronder houdt dat geval vast: een zin met een
 * bedrag erin heeft een EIGENAAR nodig, en "per extra kaart" is die eigenaar.
 * Zonder eigenaar valt "daarna € 59,50" alsnog naar "onbekend". */
const HERKOMST_WOORDEN: ReadonlySet<string> = new Set<string>([
  /* Lidwoorden, voornaamwoorden, voegwoorden, voorzetsels. */
  "de",
  "het",
  "een",
  "dit",
  "dat",
  "die",
  "deze",
  "dezelfde",
  "zelf",
  "u",
  "en",
  "als",
  "maar",
  "daarna",
  "niet",
  "geen",
  "in",
  "op",
  "van",
  "voor",
  "uit",
  "boven",
  "per",
  /* Neutrale meldwerkwoorden: ze zeggen dat de bron iets STAAT, niet onder welke
   * voorwaarde het geldt. */
  "is",
  "was",
  "staat",
  "staan",
  "heeft",
  "hebben",
  "draagt",
  "dragen",
  "noemt",
  "noemen",
  "zegt",
  "zeggen",
  "blijkt",
  "betaalt",
  /* Hoe een vindplaats zichzelf beschrijft. */
  "titel",
  "voettekst",
  "datum",
  "voorganger",
  "toepassing",
  /* De eenheid en het voorwerp van de prijs. Regel 3 blijft overeind: er wordt
   * hier niets omgerekend, deze woorden mogen alleen MEEKOMEN in een zin. */
  "kaart",
  "kaarten",
  "kaarthouder",
  "card",
  "cards",
  "maand",
  "jaar",
  "jaarbijdrage",
  "kaartlidmaatschapsbijdragen",
  /* Eigennamen uit de herkomstproza die we hebben gelezen. */
  "abn",
  "amro",
  "american",
  "express",
  "flying",
  "blue",
  "the",
  "green",
  "gold",
  "silver",
  "platinum",
  "entry",
  /* Maandnamen, uit dezelfde tabellen als `leesDatum` — één bron van waarheid. */
  ...Object.keys(MAANDEN_NL),
  ...Object.keys(MAANDEN_EN),
]);

/* Dezelfde herkomstvormen, maar globaal, zodat ze uit een zin kunnen worden
 * weggestreept in plaats van alleen geteld. Afgeleid en niet apart onderhouden:
 * één lijst, twee toepassingen. */
const HERKOMST_GLOBAAL: readonly RegExp[] = HERKOMST_VORMEN.map(
  ([, re]) => new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`),
);

/** Wat er van een zin overblijft als je alles wegstreept wat we als herkomst
 *  herkennen. Getallen, bedragen, percentages en versienummers gaan er ook uit:
 *  die zeggen niets over de VORM van de zin, en van wie een bedrag is wordt
 *  apart afgedwongen door `BEDRAG_MET_EIGENAAR`. */
function restwoorden(zin: string): string[] {
  let s = zin;
  for (const re of HERKOMST_GLOBAAL) s = s.replace(re, " ");
  s = s
    .replace(/[€$]\s?\d[\d.,]*/g, " ")
    .replace(/\b[Vv]\d+\b/g, " ")
    .replace(/\d[\d.,]*\s*%?/g, " ");
  return s
    .split(/[^A-Za-zÀ-ÖØ-öø-ÿ]+/)
    .filter((w) => w !== "")
    .map((w) => w.toLowerCase());
}

/** Een bedrag in de zin. Percentages horen hier niet bij: die zeggen niets over
 *  wat de kaart kost om te hebben. */
const BEDRAG_IN_ZIN = /(?:€|EUR\b|USD\b|\$)\s?\d/i;

/** De enige drie vormen waaruit blijkt van WIE een bedrag in de zin is. */
const BEDRAG_MET_EIGENAAR: ReadonlySet<string> = new Set([
  "ander-product",
  "jaartotaal",
  "bevestiging",
]);

/** De tekst in zinnen. Splitst op punt, puntkomma, uitroep- en vraagteken, met
 *  een eventueel afsluitend aanhalingsteken erbij.
 *
 *  DE PUNTKOMMA DOET HIER HET WERK: de catalogus hangt losse feiten aan een
 *  puntkomma ("Uitgegeven door ICS; de voorwaarden zijn van toepassing"), en die
 *  twee halen apart een ander oordeel dan samen.
 *
 *  ER WORDT NIET OP DE DUBBELE PUNT GESPLITST, en dat is gemeten: bij Amex Gold
 *  staat "zegt hetzelfde in jaarvorm: '… € 240 per jaar (€ 20 per maand)'", en
 *  door die dubbele punt te splitsen raakt het bedrag los van de bevestiging die
 *  zegt dat het hetzelfde bedrag is. Dan valt de helft met het bedrag naar
 *  "onbekend" en verdwijnt de uitspraak — behoudend, maar zonder reden.
 *
 *  "€ 1.250" wordt niet gesplitst: het scheidingsteken heeft daar een cijfer
 *  achter zich en geen witruimte. Overhoudt een splitsing een fragment dat
 *  nergens op matcht, dan is dat "onbekend", en dat is de veilige kant. */
export function splitsZinnen(tekst: string): string[] {
  return tekst
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.;!?]["”')\]]?)\s+/)
    .map((z) => z.trim())
    .filter((z) => z !== "");
}

/** Eén zin wegen. Beperking eerst, dan herkomst, anders onbekend. */
export function leesZin(zin: string): GelezenZin {
  for (const [vorm, re] of RESTRICTIE_VORMEN) {
    if (re.test(zin)) return { zin, soort: "restrictie", vorm };
  }
  const gevonden: string[] = [];
  for (const [vorm, re] of HERKOMST_VORMEN) {
    if (re.test(zin) && !gevonden.includes(vorm)) gevonden.push(vorm);
  }
  if (gevonden.length === 0) return { zin, soort: "onbekend", vorm: null };
  /* Een ONTKENDE uitgesproken nul is geen herkomstnotitie maar de mededeling dat
   * er juist géén nul staat. Zo'n zin mag onder geen enkele vorm wegvallen. */
  if (gevonden.includes("uitgesproken-nul") && UITGESPROKEN_NUL_ONTKEND.test(zin)) {
    return { zin, soort: "onbekend", vorm: null };
  }
  /* Staat er een bedrag in, dan moet uit dezelfde zin blijken van wie het is. */
  if (BEDRAG_IN_ZIN.test(zin) && !gevonden.some((v) => BEDRAG_MET_EIGENAAR.has(v))) {
    return { zin, soort: "onbekend", vorm: null };
  }
  /* EN DE HELE ZIN MOET GELEZEN ZIJN, niet alleen het woord dat matchte. Blijft
   * er na het wegstrepen van de herkomstvormen een woord over dat niet in het
   * gesloten woordenboek staat, dan staat er in deze zin iets waarover we geen
   * uitspraak kunnen doen — en dan is hij onbekend en geen herkomst. */
  if (restwoorden(zin).some((w) => !HERKOMST_WOORDEN.has(w))) {
    return { zin, soort: "onbekend", vorm: null };
  }
  return { zin, soort: "herkomst", vorm: gevonden[0]! };
}

export function leesZinnen(tekst: string): GelezenZin[] {
  return splitsZinnen(tekst).map(leesZin);
}

/* WAAROM ALLEEN DE KAARTKOSTEN, en dit is een doseringsbeslissing en geen
 * principe — de opmerking hoort erbij, anders leest het als een principe.
 *
 * Een herkomstnotitie is een herkomstnotitie bij elk cijfer. De reden om de
 * lijn hier te houden is gemeten: bij `fxFeePct` zouden in één stap 29 velden
 * van "onbeoordeeld" naar "vast" schuiven, en dat zet via rank.ts (`fxOnzeker`)
 * de euro-bedragen aan bij ELKE aankoop in een vreemde munt. Die verbreding
 * verdient zijn eigen gemeten ronde. Bij `cashbackPct` valt er niets te
 * beslissen: alle 8 velden in de bundel dragen echte voorwaarden. */
const PER_ZIN_GELEZEN: ReadonlySet<Veld> = new Set<Veld>(["kaartkosten"]);

/** De vormherkenning zelf. Zie de kop: dit is geen begrip van de tekst, het is
 *  het herkennen van vormen die we hebben gezien, met de behoudende uitkomst
 *  eraan vast. */
export function leesVoorwaarden(
  tekst: string | null | undefined,
  veld: Veld,
  waarde: number,
  asOf: string,
): Caveat[] {
  const t = (tekst ?? "").trim();
  if (t === "") return [];

  /* DE TEKST ZOALS DE DETECTOREN HEM ZIEN. Zinnen die positief als herkomst zijn
   * herkend, worden eruit gelaten: die zeggen waar het cijfer STAAT en niet
   * onder welke voorwaarde het geldt. Alle andere zinnen — beperking én
   * onbekend — blijven staan, dus geen detector raakt zijn eigen bewijs kwijt.
   *
   * Draait de zinslezer niet op dit veld, dan is `tv` de hele tekst en gedraagt
   * deze functie zich precies als voorheen. Stap 7 leest met opzet `t` en niet
   * `tv`: een nul mag nooit langs een herkomstlezing glippen. */
  const perZin = PER_ZIN_GELEZEN.has(veld);
  const zinnen = perZin ? leesZinnen(t) : [];
  const tv = perZin
    ? zinnen
        .filter((z) => z.soort !== "herkomst")
        .map((z) => z.zin)
        .join(" ")
    : t;

  const uit: Caveat[] = [];

  /* 1. Uitkering in iets anders dan euro's. Eerst het woord "crypto" zelf, want
   *    "PAID IN CRYPTO" zou anders als het ticker-symbool CRYPT worden gelezen.
   *
   *    NIET BIJ DE KAARTKOSTEN, en dat is gemeten. Een uitkering is iets wat je
   *    KRIJGT; kaartkosten zijn iets wat je BETAALT. lines.ts zet deze bevinding
   *    om in "de uitkering is in crypto en niet in euro's", en die zin is over
   *    een prijs geen voorbehoud maar onzin. In de bundel vuurde hij precies één
   *    keer op dit veld — bij Wirex, omdat de herkomstnotitie bij de PRIJS de
   *    merknaam van de CASHBACK citeert ("het niveau waar de 0,5% Cryptoback bij
   *    hoort"). De zinslezer hierboven vangt dat geval nu ook al; deze grens
   *    zorgt ervoor dat de detector de fout niet meer KÁN maken. */
  if (veld !== "kaartkosten") {
    const inCrypto =
      /\bin\s+crypto\b/i.test(tv) || /cryptoback/i.test(tv) || /a digital currency/i.test(tv);
    const ticker =
      /\b(?:paid|PAID|Paid|credited|Credited)\b[^.]{0,60}?\b(?:in|IN|In)\s+(?!CRYPTO\b)([A-Z]{2,5})\b/.exec(
        tv,
      );
    if (ticker) uit.push({ soort: "in-token", veld, token: ticker[1]! });
    else if (inCrypto || /\bnot euro\b/i.test(tv) || /niet in euro/i.test(tv)) {
      uit.push({ soort: "in-token", veld, token: "crypto" });
    }
  }

  /* 2. Plafond. "No cap … is stated" is géén afwezigheid van een plafond — de
   *    bron zegt daar zelf bij dat het een gat in de bron is. Die volgorde is
   *    de volgorde van regel 1: eerst het bedrag als we het zeker weten, dan het
   *    uitgesproken ontbreken, dan het uitgesproken niet-weten, en pas daarna
   *    de kale vaststelling dat er íéts is. */
  const cap = zoekCap(tv);
  if (cap) {
    uit.push({ soort: "plafond", veld, capCents: cap.capCents, basis: cap.basis });
  } else if (CAP_ONBEKEND.test(tv) || CAP_ONBEKEND_TOELICHTING.test(tv)) {
    uit.push({ soort: "plafond-onbekend", veld });
  } else if (GEEN_CAP.test(tv)) {
    uit.push({ soort: "geen-plafond", veld });
  } else if (CAP_AANWEZIG.test(tv)) {
    uit.push({ soort: "plafond-zonder-bedrag", veld });
  }

  /* 3. Drempel: een voorwaarde waar de gebruiker zelf aan moet voldoen voordat
   *    het cijfer voor hem geldt. Alleen zinsvormen die een EIS uitdrukken.
   *
   *    Een eerdere versie zocht op het losse woord "subscription", en dat gaf
   *    bij Bleap een drempel die er niet is: die tekst noemt 20% cashback op
   *    "named subscriptions" — een categorie waar je mee betaalt, geen eis. Bij
   *    Wirex idem: daar hoort het abonnement bij de duurdere tiers, terwijl het
   *    cijfer in de catalogus juist het gratis instaptarief is, en de bron zegt
   *    dat er met zoveel woorden bij. Een drempel verzinnen bij een kaart die er
   *    geen heeft, is dezelfde fout als er een verzwijgen. */
  if (
    /tier gate/i.test(tv) ||
    /requires? an active[^.]{0,60}subscription/i.test(tv) ||
    /requires? (?:holding|at least)/i.test(tv) ||
    /must hold/i.test(tv) ||
    /\bstak(e|ed|ing)\b/i.test(tv) ||
    /entry tier (?:needs|requires)/i.test(tv) ||
    /minimale besteding/i.test(tv) ||
    /abonnement (?:is )?(?:vereist|verplicht|nodig)/i.test(tv) ||
    /verplicht/i.test(tv)
  ) {
    uit.push({ soort: "drempel", veld });
  }

  /* 4. Einddatum. Alleen als de tekst hem aan het PROGRAMMA hangt. Bij Bleap
   *    staat "promo until 31 May 2026" bij een tarief dat we niet serveren, en
   *    die datum aan het 1%-cijfer plakken zou een verzinsel zijn. */
  const eind =
    /\bactive until\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i.exec(tv) ??
    /\bgeldig tot\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i.exec(tv) ??
    /\bloopt tot\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i.exec(tv);
  if (eind) {
    const datum = leesDatum(eind[1]!, eind[2]!, eind[3]!);
    if (datum) uit.push({ soort: "einddatum", veld, datum, verlopen: datum < asOf });
  }

  /* 5. Uitsluitingen: categorieën of winkels waarop niets wordt uitgekeerd. Of
   *    DEZE aankoop eronder valt weten we niet — we kennen de winkelcategorie
   *    niet en gaan die ook niet raden.
   *
   *    "earn nothing" stond hier eerst bij en is eruit: bij Icy White slaat dat
   *    op oud-stakers en bij Plus op besteding boven het plafond, en allebei
   *    zijn dat geen uitsluiting van winkelcategorieën. Een voorwaarde met de
   *    verkeerde uitleg erbij is geen voorwaarde meer maar een verzinsel. */
  if (
    /exclusions/i.test(tv) ||
    /ineligible/i.test(tv) ||
    /\bexcluded\b/i.test(tv) ||
    /uitgesloten/i.test(tv) ||
    /uitsluiting/i.test(tv)
  ) {
    uit.push({ soort: "uitsluitingen", veld });
  }

  /* 6. De bron zegt zelf: opnieuw meten. */
  if (/re-check before serving/i.test(tv) || /staleness warning/i.test(tv)) {
    uit.push({ soort: "herzien", veld });
  }

  /* 7. Een nul die geen uitgesproken nul is. De catalogus schrijft die twee uit
   *    elkaar: waar de nul echt uitgesproken is, staat "Uitgesproken nul" in de
   *    voorwaarde. Staat dat er niet bij een waarde van nul, dan is het een nul
   *    onder voorwaarden — en dat is geen nul.
   *
   *    OP DE WOORDEN TOETSEN IS HIER NIET GENOEG, en dat is dezelfde fout als
   *    bij Bleap één stap verderop: "dat is een ontbrekende rij, geen
   *    uitgesproken nul" bevat de woorden en beweert het tegendeel. Er wordt
   *    daarom per zin gekeken of de nul BEVESTIGD wordt, over de VOLLEDIGE tekst
   *    `t` en niet over de ingekorte `tv`: een nul mag nooit langs een
   *    herkomstlezing glippen. */
  if (waarde === 0 && !bevestigtUitgesprokenNul(t)) {
    uit.push({ soort: "voorwaardelijke-nul", veld });
  }

  /* 8/9. Kosten die er nog bij komen.
   *
   *    HET LOSSE WOORD "EENMALIG" IS HIER TE WEINIG, en dat is gemeten: bij
   *    Bleap staat "dus dit is geen eenmalige formulering van een
   *    marketingtekst" — een uitspraak over de FORMULERING van de bron, en nog
   *    ontkennend ook — en daaruit kwam "er komen eenmalige kosten bij" op het
   *    scherm. Er moet dus een KOSTENWOORD achter staan. Deze verscherping mag
   *    niet los landen: zonder de zinslezer hierboven zou Bleap er een
   *    voorwaardeVRIJE netto-uitspraak aan overhouden, en dan is artikel 6.2
   *    ("other fees may apply") ongezien weg. Samen doen ze het werk. */
  if (
    /eenmalige?\s+(?:kosten|vergoeding|bijdrage|uitgiftevergoeding|fee|post|maandpost)\b/i.test(
      tv,
    ) ||
    /one-off fee/i.test(tv) ||
    /one-time fee/i.test(tv)
  ) {
    uit.push({ soort: "eenmalig", veld });
  }
  if (/\bbovenop\b/i.test(tv) || /komt.{0,40}lidmaatschap/i.test(tv))
    uit.push({ soort: "bovenop", veld });

  /* 10. Er staat iets, en we herkenden er niets in.
   *
   *     TWEE UITKOMSTEN, EN HET VERSCHIL IS DE HELE REPARATIE. Bestond de tekst
   *     UITSLUITEND uit zinnen die we positief als herkomst herkennen, dan staat
   *     er geen voorwaarde bij dit cijfer — alleen waar het cijfer vandaan komt.
   *     Dan is de lijst leeg, en bepaalClaim maakt daar "vast" van. Dat is de
   *     enige manier waarop de netto-tak van buildRow bereikbaar wordt.
   *
   *     In elk ander geval — één beperkingszin, of één zin die we niet konden
   *     plaatsen — blijft de uitkomst "onbeoordeeld", en onbeoordeeld is geen
   *     groen licht. De ontsnapping vraagt dus een positieve herkenning van
   *     ELKE zin. Onbekende proza valt naar de behoudende kant. */
  if (uit.length === 0) {
    const alleenHerkomst =
      perZin && zinnen.length > 0 && zinnen.every((z) => z.soort === "herkomst");
    if (!alleenHerkomst) uit.push({ soort: "onbeoordeeld", veld });
  }

  return uit;
}

/** Wat we over de OPBRENGST in euro's mogen zeggen.
 *
 *  "vast"        — geen voorwaarden bij de cijfers: het bedrag mag er kaal staan.
 *  "hooguit"     — er zijn voorwaarden, maar de opbrengst is wél in euro's: dan
 *                  is het bedrag een BOVENGRENS, met de voorwaarden erbij.
 *  "niet-in-euro"— de uitkering is in een token. Er komt geen euroteken bij.
 *  "vervallen"   — het cijfer gold tot een datum die op de peildatum voorbij is.
 *  "onbeoordeeld"— er staat een voorwaarde die we niet konden duiden. Geen bedrag. */
export type EuroClaim =
  | { soort: "vast" }
  | { soort: "hooguit"; capCents: number | null; capBasis: CapBasis | null }
  | { soort: "niet-in-euro"; token: string }
  | { soort: "vervallen"; datum: string }
  | { soort: "onbeoordeeld" };

/* PER VELD, en dat woordje is de hele reparatie.
 *
 * Hier stond een filter op cashback OF koersopslag samen, en dat leverde twee
 * gemeten onwaarheden op. Een plafond van 100 euro per transactie op de
 * KOERSOPSLAG werd toegepast op de CASHBACK ("kost minstens 19,00 euro aan
 * koersopslag" waar 10,00 het slechtste geval is), en een verlopen actie op de
 * koersopslag kwam eruit als "deze kaart noemt 1%, maar dat cijfer gold tot 1
 * januari 2026" over een cashback die helemaal niet verlopen is.
 *
 * Een voorwaarde hoort bij het cijfer waar hij in het document naast staat.
 * Hem op een ander cijfer plakken is precies de fout die deze hele catalogus
 * probeert te vermijden - een getal uit de rij ernaast. */
function bepaalClaim(caveats: readonly Caveat[], veld: Veld): EuroClaim {
  const opbrengst = caveats.filter((c) => c.veld === veld);
  if (opbrengst.length === 0) return { soort: "vast" };

  const verlopen = opbrengst.find((c) => c.soort === "einddatum" && c.verlopen);
  if (verlopen && verlopen.soort === "einddatum")
    return { soort: "vervallen", datum: verlopen.datum };

  const token = opbrengst.find((c) => c.soort === "in-token");
  if (token && token.soort === "in-token") return { soort: "niet-in-euro", token: token.token };

  if (opbrengst.some((c) => c.soort === "onbeoordeeld")) return { soort: "onbeoordeeld" };

  const plafond = opbrengst.find((c) => c.soort === "plafond");
  if (plafond && plafond.soort === "plafond") {
    /* Alleen een plafond PER TRANSACTIE bijt op deze ene aankoop. Een plafond
     * per maand hangt af van wat hij die maand verder uitgeeft, en dat weten we
     * niet — dus dat noemen we wel en rekenen we niet weg. */
    const bruikbaar = plafond.basis === "transactie" ? plafond.capCents : null;
    return { soort: "hooguit", capCents: bruikbaar, capBasis: plafond.basis };
  }
  return { soort: "hooguit", capCents: null, capBasis: null };
}

/** Waarom een kaart niet gerangschikt kon worden. Een echte oorzaak, geen
 *  categorie: dit is de tekst die de gebruiker te zien krijgt. */
export type UnknownReason = "geen-koersopslag-bekend" | "geen-cashback-bekend";

export type UnknownRow = {
  card: CheckoutCard;
  reason: UnknownReason;
};

/** `netto` = opbrengst min de kosten die dit advies veroorzaakt.
 *  `bruto` = opbrengst, kosten onbekend — het woord netto mag hier niet vallen.
 *  `opbrengst` = een kaart die hij al heeft; er is niets te verrekenen.
 *  `voorwaardelijk` = de opbrengst is niet in euro's uit te drukken, dus er valt
 *   niets af te trekken en niets te vergelijken. Alleen de voorwaarde. */
export type Basis = "netto" | "bruto" | "opbrengst" | "voorwaardelijk";

export type Row = {
  card: CheckoutCard;
  held: boolean;
  /** Koersopslag die op DEZE aankoop van toepassing is. Bij een aankoop in
   *  euro's is dat 0 en dat is geen aanname: er wordt niet omgerekend. */
  fxPct: number;
  /** Waarom fxPct is wat het is — "geen omrekening nodig" bij een euro-aankoop. */
  fxNote: string | null;
  cashbackPct: number;
  /** Opbrengst per bestede euro: cashback min koersopslag. Negatief = het kost
   *  je geld. Bedrag-onafhankelijk. */
  grossPct: number;
  /** Opbrengst in centen op dit bedrag, of null zonder bedrag. Ongeacht de
   *  voorwaarden: dit is de rekensom, niet de uitspraak. */
  grossCents: number | null;
  /** Het bedrag dat we in EURO'S durven te noemen. Null als de opbrengst niet in
   *  euro's is, vervallen is, of achter een voorwaarde zit die we niet konden
   *  beoordelen. Dit is het getal dat op het scherm mag, en het getal waarmee
   *  gerekend en gesorteerd wordt — grossCents is dat niet. */
  euroCents: number | null;
  /** Wat we over de CASHBACK mogen zeggen. */
  claim: EuroClaim;
  /** En wat we over de KOERSOPSLAG mogen zeggen. Apart, want een voorwaarde
   *  hoort bij het cijfer waar hij in het document naast staat; ze samenvoegen
   *  gaf een plafond op de opslag dat als plafond op de cashback werd gerekend,
   *  en een verlopen actie op de opslag die als verlopen cashback werd
   *  voorgelezen. Is dit niet "vast", dan is een van de twee termen van de som
   *  onzeker en noemt `euroCents` geen bedrag. */
  fxClaim: EuroClaim;
  /** Alles wat we in de voorwaardenteksten van deze kaart hebben herkend. */
  caveats: Caveat[];
  /** Punten op dit bedrag. Getoond, nooit meegerekend. */
  points: number | null;
  fee: CardFee | null;
  /** Wat hij minstens betaalt om deze kaart over de vergeleken periode te
   *  kunnen gebruiken — alleen bij een kaart die hij niet heeft en waarvan de
   *  kosten bekend zijn. */
  charge: MinimumCharge | null;
  basis: Basis;
  /** De uitkomst waar de basis bij hoort: bij "netto" de opbrengst min de
   *  kosten, bij "bruto" en "opbrengst" gelijk aan euroCents, bij
   *  "voorwaardelijk" null. Null zonder bedrag. */
  resultCents: number | null;
};

export type Ranking = {
  currency: Currency;
  amountCents: number | null;
  asOf: string;
  horizonMonths: number;
  /** Kaarten die hij heeft, beste eerst. */
  mine: Row[];
  /** Kaarten die hij niet heeft, kosten bekend, netto boven nul — beste eerst. */
  openWorthIt: Row[];
  /** Kaarten die hij niet heeft, kosten bekend, netto nul of minder. Wordt
   *  getoond, nooit als aanbeveling: hij moet kunnen zien staan dat het
   *  achteruit is. */
  openBackwards: Row[];
  /** Kaarten die hij niet heeft en waarvan we de som niet kunnen afmaken:
   *  kosten onbekend, óf een opbrengst die niet in euro's uit te drukken is. */
  openUnknownCost: Row[];
  unknowns: UnknownRow[];
};

const EUR = "EUR";

function buildRow(
  card: CheckoutCard,
  held: boolean,
  input: RankInput,
  horizonMonths: number,
): Row | UnknownRow {
  const euroPurchase = input.currency.trim().toUpperCase() === EUR;

  /* Een aankoop in euro's wordt niet omgerekend, dus er is geen koersopslag.
   * Dat is geen ontbrekend cijfer dat we op nul zetten — het is een nul omdat
   * de handeling niet plaatsvindt. ING zegt het zelf in zijn tarievenblad:
   * "betalingen in euro's € 0,00". Bij een niet-euro-aankoop is een ontbrekend
   * cijfer wél onbekend, en dan stopt de rij hier. */
  let fxPct: number;
  let fxNote: string | null = null;
  let fxBron: Sourced | null = null;
  if (euroPurchase) {
    fxPct = 0;
    fxNote = "geen omrekening nodig";
  } else if (card.fxFeePct) {
    fxPct = card.fxFeePct.value;
    fxBron = card.fxFeePct;
  } else {
    return { card, reason: "geen-koersopslag-bekend" };
  }

  if (!card.cashbackPct) return { card, reason: "geen-cashback-bekend" };
  const cashbackPct = card.cashbackPct.value;

  /* De voorwaarden van het KOERSOPSLAG-cijfer tellen alleen mee als er ook
   * werkelijk omgerekend wordt. Bij een aankoop in euro's is de nul uitgesproken
   * en doen de voorwaarden van dat cijfer niet ter zake. */
  const caveats: Caveat[] = [
    ...leesVoorwaarden(card.cashbackPct.conditions, "cashback", cashbackPct, input.asOf),
    ...(fxBron ? leesVoorwaarden(fxBron.conditions, "koersopslag", fxBron.value, input.asOf) : []),
    ...(card.fee
      ? leesVoorwaarden(card.fee.conditions, "kaartkosten", card.fee.value, input.asOf)
      : []),
  ];

  const claim = bepaalClaim(caveats, "cashback");
  /* De koersopslag heeft zijn EIGEN voorwaarden, en die tellen alleen mee als er
   * werkelijk wordt omgerekend. Doen ze dat wel, dan kunnen we het nettobedrag
   * niet als zeker presenteren: het aftrekgetal zelf staat dan ter discussie.
   * Zwijgen over het bedrag is hier goedkoper dan een som waarvan een van de
   * twee termen onzeker is. */
  const fxClaim = bepaalClaim(caveats, "koersopslag");
  /* NIET `fxPct !== 0`, en dat is precies de val waar ik zelf in liep. De
   * gevaarlijkste koersopslag is een VOORWAARDELIJKE NUL: ING Platinum staat op
   * 0% "voor transacties tot 1.000 euro per incassoperiode, daarna 2,00%". De
   * waarde is nul, dus een toets op de waarde zwijgt - terwijl juist boven die
   * grens het hele nettobedrag verschuift. De caveats van dit veld bestaan
   * alleen als er echt wordt omgerekend (fxBron is null bij een aankoop in
   * euro's), dus hun aanwezigheid IS het signaal. */
  const fxOnzeker = fxClaim.soort !== "vast";
  const grossPct = cashbackPct - fxPct;

  const grossCents = input.amountCents === null ? null : pctOfCents(input.amountCents, grossPct);

  /* Het bedrag dat we durven te noemen. Bij een plafond per transactie telt maar
   * een deel van de aankoop mee voor de cashback — de koersopslag geldt wél over
   * het hele bedrag, dus die twee worden dan apart gerekend en niet als één
   * samengesteld percentage. */
  let euroCents: number | null;
  if (input.amountCents === null) {
    euroCents = null;
  } else if (
    claim.soort === "niet-in-euro" ||
    claim.soort === "vervallen" ||
    claim.soort === "onbeoordeeld"
  ) {
    euroCents = null;
  } else if (fxOnzeker) {
    euroCents = null;
  } else if (
    claim.soort === "hooguit" &&
    claim.capCents !== null &&
    input.amountCents > claim.capCents
  ) {
    euroCents = pctOfCents(claim.capCents, cashbackPct) - pctOfCents(input.amountCents, fxPct);
  } else {
    euroCents = grossCents;
  }

  const points =
    input.amountCents === null || !card.pointsPerEuro
      ? null
      : pointsOn(input.amountCents, card.pointsPerEuro.value);

  const gedeeld = {
    card,
    held,
    fxPct,
    fxNote,
    cashbackPct,
    grossPct,
    grossCents,
    euroCents,
    claim,
    fxClaim,
    caveats,
    points,
  };

  /* Hier valt de beslissing uit de kop van dit bestand. */
  if (held) {
    return { ...gedeeld, fee: card.fee, charge: null, basis: "opbrengst", resultCents: euroCents };
  }

  /* Een opbrengst die niet in euro's is uit te drukken, kan niet van een bedrag
   * in euro's worden afgetrokken en kan ook niet tegen een andere kaart worden
   * afgezet. Dan is er geen som, alleen een voorwaarde. */
  const euroOnbekend =
    claim.soort === "niet-in-euro" || claim.soort === "vervallen" || claim.soort === "onbeoordeeld";
  if (euroOnbekend) {
    return { ...gedeeld, fee: card.fee, charge: null, basis: "voorwaardelijk", resultCents: null };
  }

  if (!card.fee) {
    return { ...gedeeld, fee: null, charge: null, basis: "bruto", resultCents: euroCents };
  }

  /* EEN VOORWAARDELIJKE NUL IN DE KAARTKOSTEN IS GEEN UITGESPROKEN NUL, en het
   * verschil is hier duur: "over 1 jaar kost dat minstens EUR 0,00" naast een
   * regel die zegt dat die nul alleen onder voorwaarden geldt, is precies de
   * tegenspraak die regel 1 verbiedt. Erger nog dan de zin is de SOM - een
   * onbekende kostenpost als nul aftrekken maakt van een onzeker nettobedrag
   * een zeker uitziend nettobedrag.
   *
   * Kunnen we de voorwaarden bij dit veld niet als "vast" lezen, dan is de prijs
   * onbekend, en dan is dit een BRUTO-regel met de kaart erbij - niet netto met
   * een nul erin. */
  const feeClaim = bepaalClaim(caveats, "kaartkosten");
  if (feeClaim.soort !== "vast") {
    return { ...gedeeld, fee: card.fee, charge: null, basis: "bruto", resultCents: euroCents };
  }

  const charge = minimumCharge(card.fee, horizonMonths);
  return {
    ...gedeeld,
    fee: card.fee,
    charge,
    basis: "netto",
    resultCents: euroCents === null ? null : euroCents - charge.cents,
  };
}

function isUnknown(r: Row | UnknownRow): r is UnknownRow {
  return (r as UnknownRow).reason !== undefined;
}

/** Kan van deze rij een bedrag in euro's op het scherm? */
function inEuros(r: Row): boolean {
  return r.claim.soort === "vast" || r.claim.soort === "hooguit";
}

/** Beste eerst, en eerst de kaarten waarover we in euro's iets kunnen zeggen.
 *
 *  DAT EERSTE IS GEEN OPMAAK. Een kaart die 5% in CRO uitkeert boven een kaart
 *  die 1,4% in euro's kost zetten, is dezelfde fout als een maandbedrag met een
 *  jaarbedrag vergelijken: twee eenheden in één volgorde, en een positie in een
 *  lijst is de uitspraak "deze is beter". Kaarten waarvan de opbrengst niet in
 *  euro's is, staan daarom onderaan met hun voorwaarde erbij, en niet bovenaan
 *  met een getal dat toevallig groter is.
 *
 *  Binnen elke groep: op het EURO-bedrag als dat er is, anders op percentage.
 *  Het percentage is bedrag-onafhankelijk en houdt de orde overeind zolang het
 *  bedrag nog niet bekend is — maar zodra er een plafond in het spel is, is het
 *  percentage niet meer wat de kaart oplevert, en dan is het bedrag de waarheid. */
function byEuroThenPct(a: Row, b: Row): number {
  if (inEuros(a) !== inEuros(b)) return inEuros(a) ? -1 : 1;
  if (a.euroCents !== null && b.euroCents !== null && a.euroCents !== b.euroCents) {
    return b.euroCents - a.euroCents;
  }
  return b.grossPct - a.grossPct || a.card.product.localeCompare(b.card.product, "nl");
}

/** Voor de netto-groep sorteren we op de uitkomst zodra die er is, want daar
 *  kunnen kaartkosten de orde omdraaien: een kaart met een hoger percentage en
 *  € 270 per jaar komt achter een kaart met een lager percentage en € 0.
 *
 *  DAT MAG ALLEEN OMDAT DE PERIODE NU BIJ ELKE RIJ DEZELFDE IS. Toen de horizon
 *  nog één maand was, stond hier netto-over-een-maand naast netto-over-een-jaar:
 *  een maandkaart van € 9 (dus € 108 per jaar) eindigde boven een jaarkaart van
 *  € 60, omdat de eerste maar één maand had hoeven meebetalen. horizon.ts rondt
 *  de vergeleken periode nu af op hele jaren, zodat `charge.spanMonths` bij elke
 *  rij gelijk is. Verschillen ze toch, dan is de aftreksom geen vergelijking
 *  meer en valt deze functie terug op het percentage. */
function byResult(a: Row, b: Row): number {
  const zelfdePeriode = (a.charge?.spanMonths ?? null) === (b.charge?.spanMonths ?? null);
  if (zelfdePeriode && a.resultCents !== null && b.resultCents !== null) {
    return b.resultCents - a.resultCents || a.card.product.localeCompare(b.card.product, "nl");
  }
  return byEuroThenPct(a, b);
}

export function rankCheckout(input: RankInput): Ranking {
  const horizonMonths = comparableHorizonMonths(input.horizonMonths ?? DEFAULT_HORIZON_MONTHS);
  const held = new Set(input.heldIds);

  const mine: Row[] = [];
  const others: Row[] = [];
  const unknowns: UnknownRow[] = [];

  for (const card of input.cards) {
    const isHeld = held.has(card.id);
    const row = buildRow(card, isHeld, input, horizonMonths);
    if (isUnknown(row)) {
      /* Alleen zijn EIGEN kaarten melden we als onbekend. Van de kaarten in de
       * bundel heeft hij er een paar; alle andere onbekenden opsommen maakt een
       * lijst van tientallen regels waar hij niets mee kan, en dat is geen
       * eerlijkheid maar ruis. Zwijgen over een kaart die hij niet heeft en
       * waarvan we niets weten, is geen bewering. */
      if (isHeld) unknowns.push(row);
      continue;
    }
    (isHeld ? mine : others).push(row);
  }

  mine.sort(byEuroThenPct);

  /* Een kaart die hij niet heeft is alleen het noemen waard als hij het beter
   * doet dan de beste kaart die hij WEL heeft. Anders is het advies "open een
   * kaart om er minder aan over te houden". Heeft hij niets aangevinkt, dan is
   * er geen drempel en zijn alle kaarten kandidaat.
   *
   * EN DIE VERGELIJKING MOET TE MAKEN ZIJN. Van een kaart die in CRO uitkeert of
   * waarvan we de voorwaarde niet konden duiden, kunnen we niet vaststellen dat
   * hij het beter doet dan een kaart die hij heeft. Hem tóch boven die drempel
   * plaatsen IS die uitspraak, dus zodra er een rangschikbare eigen kaart ligt,
   * valt hij af.
   *
   * Ligt die er NIET — hij heeft niets aangevinkt, of van al zijn kaarten
   * ontbreekt het cijfer — dan wordt er niets vergeleken en is er ook geen
   * uitspraak om te vermijden. Dan komt de kaart wél in beeld, zonder bedrag en
   * met zijn voorwaarde erbij. Dat is de opdracht: het cijfer niet als opbrengst
   * tonen, maar de voorwaarde noemen die we niet konden wegstrepen. */
  const bruikbaarVoorVergelijking = mine.filter(inEuros);
  const bestMine =
    bruikbaarVoorVergelijking.length > 0 ? bruikbaarVoorVergelijking[0]!.grossPct : null;
  const candidates =
    mine.length === 0
      ? others
      : others.filter((r) => inEuros(r) && (bestMine === null || r.grossPct > bestMine));

  const openWorthIt: Row[] = [];
  const openBackwards: Row[] = [];
  const openUnknownCost: Row[] = [];

  for (const row of candidates) {
    if (row.basis === "bruto" || row.basis === "voorwaardelijk") {
      openUnknownCost.push(row);
      continue;
    }
    /* Zonder bedrag is er geen uitkomst, en dus ook geen bewijs dat iets
     * achteruit is. Dan blijft de kaart in de gewone lijst staan met alleen zijn
     * percentage; "achteruit" is een bewering die een leeg bedrag niet draagt. */
    if (row.resultCents === null || row.resultCents > 0) openWorthIt.push(row);
    else openBackwards.push(row);
  }

  openWorthIt.sort(byResult);
  openBackwards.sort(byResult);
  openUnknownCost.sort(byEuroThenPct);

  return {
    currency: input.currency.trim().toUpperCase(),
    amountCents: input.amountCents,
    asOf: input.asOf,
    horizonMonths,
    mine,
    openWorthIt,
    openBackwards,
    openUnknownCost,
    unknowns,
  };
}
