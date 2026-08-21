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
import { minimumCharge, comparableHorizonMonths, DEFAULT_HORIZON_MONTHS, type MinimumCharge } from "./horizon.js";

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
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const MAANDEN_NL: Record<string, number> = {
  januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6,
  juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12,
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
const CAP_AANWEZIG = /\bcap\b|\bcapped\b|spending cap|\bplafond\b|\blimiet\b|maximum[^.]{0,25}\bspend\b/i;

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

  const uit: Caveat[] = [];

  /* 1. Uitkering in iets anders dan euro's. Eerst het woord "crypto" zelf, want
   *    "PAID IN CRYPTO" zou anders als het ticker-symbool CRYPT worden gelezen. */
  const inCrypto = /\bin\s+crypto\b/i.test(t) || /cryptoback/i.test(t) || /a digital currency/i.test(t);
  const ticker = /\b(?:paid|PAID|Paid|credited|Credited)\b[^.]{0,60}?\b(?:in|IN|In)\s+(?!CRYPTO\b)([A-Z]{2,5})\b/.exec(t);
  if (ticker) uit.push({ soort: "in-token", veld, token: ticker[1]! });
  else if (inCrypto || /\bnot euro\b/i.test(t) || /niet in euro/i.test(t)) {
    uit.push({ soort: "in-token", veld, token: "crypto" });
  }

  /* 2. Plafond. "No cap … is stated" is géén afwezigheid van een plafond — de
   *    bron zegt daar zelf bij dat het een gat in de bron is. Die volgorde is
   *    de volgorde van regel 1: eerst het bedrag als we het zeker weten, dan het
   *    uitgesproken ontbreken, dan het uitgesproken niet-weten, en pas daarna
   *    de kale vaststelling dat er íéts is. */
  const cap = zoekCap(t);
  if (cap) {
    uit.push({ soort: "plafond", veld, capCents: cap.capCents, basis: cap.basis });
  } else if (CAP_ONBEKEND.test(t) || CAP_ONBEKEND_TOELICHTING.test(t)) {
    uit.push({ soort: "plafond-onbekend", veld });
  } else if (GEEN_CAP.test(t)) {
    uit.push({ soort: "geen-plafond", veld });
  } else if (CAP_AANWEZIG.test(t)) {
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
    /tier gate/i.test(t) ||
    /requires? an active[^.]{0,60}subscription/i.test(t) ||
    /requires? (?:holding|at least)/i.test(t) ||
    /must hold/i.test(t) ||
    /\bstak(e|ed|ing)\b/i.test(t) ||
    /entry tier (?:needs|requires)/i.test(t) ||
    /minimale besteding/i.test(t) ||
    /abonnement (?:is )?(?:vereist|verplicht|nodig)/i.test(t) ||
    /verplicht/i.test(t)
  ) {
    uit.push({ soort: "drempel", veld });
  }

  /* 4. Einddatum. Alleen als de tekst hem aan het PROGRAMMA hangt. Bij Bleap
   *    staat "promo until 31 May 2026" bij een tarief dat we niet serveren, en
   *    die datum aan het 1%-cijfer plakken zou een verzinsel zijn. */
  const eind =
    /\bactive until\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i.exec(t) ??
    /\bgeldig tot\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i.exec(t) ??
    /\bloopt tot\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i.exec(t);
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
  if (/exclusions/i.test(t) || /ineligible/i.test(t) || /\bexcluded\b/i.test(t) || /uitgesloten/i.test(t) || /uitsluiting/i.test(t)) {
    uit.push({ soort: "uitsluitingen", veld });
  }

  /* 6. De bron zegt zelf: opnieuw meten. */
  if (/re-check before serving/i.test(t) || /staleness warning/i.test(t)) {
    uit.push({ soort: "herzien", veld });
  }

  /* 7. Een nul die geen uitgesproken nul is. De catalogus schrijft die twee uit
   *    elkaar: waar de nul echt uitgesproken is, staat "Uitgesproken nul" in de
   *    voorwaarde. Staat dat er niet bij een waarde van nul, dan is het een nul
   *    onder voorwaarden — en dat is geen nul. */
  if (waarde === 0 && !/uitgesproken nul/i.test(t)) {
    uit.push({ soort: "voorwaardelijke-nul", veld });
  }

  /* 8/9. Kosten die er nog bij komen. */
  if (/\beenmalig/i.test(t) || /one-off/i.test(t) || /one-time/i.test(t)) uit.push({ soort: "eenmalig", veld });
  if (/\bbovenop\b/i.test(t) || /komt.{0,40}lidmaatschap/i.test(t)) uit.push({ soort: "bovenop", veld });

  /* 10. Er staat iets, en we herkenden er niets in. Dat is onbekend, en onbekend
   *     is geen groen licht. */
  if (uit.length === 0) uit.push({ soort: "onbeoordeeld", veld });

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
  if (verlopen && verlopen.soort === "einddatum") return { soort: "vervallen", datum: verlopen.datum };

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
export type UnknownReason =
  | "geen-koersopslag-bekend"
  | "geen-cashback-bekend";

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
    ...(card.fee ? leesVoorwaarden(card.fee.conditions, "kaartkosten", card.fee.value, input.asOf) : []),
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
  } else if (claim.soort === "niet-in-euro" || claim.soort === "vervallen" || claim.soort === "onbeoordeeld") {
    euroCents = null;
  } else if (fxOnzeker) {
    euroCents = null;
  } else if (claim.soort === "hooguit" && claim.capCents !== null && input.amountCents > claim.capCents) {
    euroCents = pctOfCents(claim.capCents, cashbackPct) - pctOfCents(input.amountCents, fxPct);
  } else {
    euroCents = grossCents;
  }

  const points =
    input.amountCents === null || !card.pointsPerEuro
      ? null
      : pointsOn(input.amountCents, card.pointsPerEuro.value);

  const gedeeld = { card, held, fxPct, fxNote, cashbackPct, grossPct, grossCents, euroCents, claim, fxClaim, caveats, points };

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
  const bestMine = bruikbaarVoorVergelijking.length > 0 ? bruikbaarVoorVergelijking[0]!.grossPct : null;
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
