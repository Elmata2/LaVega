/* Wat zijn punten aan deze kassa dekken. Puur: geen DOM, geen chrome.*, geen
 * klok — `asOf` komt van de aanroeper.
 *
 * ── WAAROM DIT DE KOP VAN DE EXTENSIE IS EN CASHBACK NIET ───────────────────
 *
 * Omdat het cijfer bestaat. De cashbackkant hangt aan getallen die niemand
 * publiceert: van de 77 gebundelde kaarten heeft er GEEN ENKELE zowel een
 * cashbackcijfer als een prijs, en alle acht met cashback zijn cryptokaarten.
 * De netto-tak van rank.ts wordt door die data nooit bereikt. Een puntensaldo
 * heeft dat probleem niet: hij voert het zelf in, dus het staat er of het staat
 * er niet, en als het er niet staat zegt de extensie dat.
 *
 * ── HET GAT DAT NIET DICHTGEPRAAT MAG WORDEN ────────────────────────────────
 *
 * WIJ KENNEN ZIJN SALDO. WIJ KENNEN NIET WAT EEN WINKEL ACCEPTEERT.
 *
 * "Deze webshop zegt dat ik er 35% mee kan betalen" is een uitspraak van de
 * WINKEL, en die kunnen we op een afrekenpagina niet zien — er is geen veld,
 * geen opmaak en geen lijst waaruit dat blijkt. Wat we wél hebben is een koers
 * die Amex zelf publiceert (1.000 punten = € 3), en die is NIET winkelspecifiek.
 *
 * Daaruit volgen twee dingen, en ze staan allebei in de uitkomst van dit
 * bestand in plaats van in een opmerking:
 *
 *   1. het BEDRAG mag er staan, want dat is zijn saldo maal een gepubliceerd
 *      getal. Het percentage ook, want dat is dat bedrag gedeeld door deze
 *      aankoop. Allebei met bron, datum en de reikwijdte van de koers erbij.
 *   2. de ROUTE mag niet worden weggelaten. Amex' koers geldt voor Betalen met
 *      Punten via de app of het online account: hij betaalt hier met de kaart en
 *      boekt de punten daarna af. Een percentage zonder die zin leest als een
 *      knop in de kassa, en die knop bestaat niet.
 *
 * En het ongemakkelijke derde, dat de verkoopkant van dit idee tegenspreekt en
 * er daarom in hoort: punten gaan niet verloren door hier met een andere kaart
 * te betalen. Er is aan deze kassa geen voordeel te halen dat er morgen niet ook
 * is. Dit is een HERINNERING met een bedrag, geen winst die hij hier moet
 * pakken — en die zin staat in lines.ts onder het blok, niet weggelaten omdat
 * hij de kop zwakker maakt.
 *
 * ── VIER SOORTEN ONBEKEND, EN WAAROM HET ER VIER ZIJN ───────────────────────
 *
 * "Er staat geen bedrag bij" is geen reden. De reden verschilt per programma en
 * bepaalt letterlijk welke zin er mag komen:
 *
 *   ING       — de uitgever zegt ZELF dat punten geen geldwaarde hebben. Dat is
 *               een uitgesproken nul, de keerzijde van "onbekend is nooit nul",
 *               en dus een feit dat we mogen noemen. Maar alleen binnen zijn
 *               reikwijdte: ING's nul gaat over geld, niet over korting in de
 *               ING Winkel, en dat tweede cijfer is onbekend.
 *   Revolut   — de uitgever zegt zelf dat er GEEN VASTE waarde is. Er is dus wel
 *               waarde; ze staat alleen niet vast. Nul zou hier onwaar zijn.
 *   Flying Blue — wij hebben het niet kunnen lezen (404 op het inwisselpad). Dat
 *               is een gat in ONZE meting en geen uitspraak van de uitgever.
 *   een programma dat we helemaal niet kennen — hij heeft een naam ingetypt die
 *               in onze koerslijst niet voorkomt. Dan hebben we het niet eens
 *               geprobeerd, en dat is weer iets anders dan een mislukte poging.
 *
 * Die vier hebben vier verschillende `waarom`-waarden, en lines.ts heeft er vier
 * verschillende zinnen bij. Ze samenvoegen tot één "onbekend" zou van vier
 * verschillende feiten één vage mededeling maken. */

import type { PointsRate } from "./generated/points-rates.generated.js";

/** Een saldo zoals hij het zelf heeft ingevoerd. Meer velden zijn er niet, en
 *  dat is de hele redactiegrens van dit oppervlak: geen rekeningnummer, geen
 *  kaartnummer, geen euro's. Alleen een naam, een aantal en de dag waarop hij
 *  het opschreef. */
export type PointsBalance = {
  program: string;
  points: number;
  /** ISO-datum. Staat ALTIJD op het scherm: een saldo van vier maanden oud dat
   *  als nu wordt gepresenteerd, is een stille onwaarheid. */
  updatedAt: string;
};

export type PuntenWaarom =
  /** Er is een koers en er is een bedrag: dekking uitgerekend. */
  | "koers-bekend"
  /** Er is een koers, maar geen aankoopbedrag om hem op los te laten. */
  | "geen-bedrag"
  /** De uitgever zegt zelf: geen geldwaarde. */
  | "uitgesproken-geen-geldwaarde"
  /** De uitgever zegt zelf: geen VASTE waarde. */
  | "geen-vaste-waarde"
  /** Wij hebben de koers niet kunnen lezen. */
  | "koers-niet-gelezen"
  /** Dit programma staat niet in onze koerslijst. */
  | "programma-onbekend";

export type PuntenRij = {
  /** De naam zoals hij hem heeft ingevoerd — niet die uit onze lijst. Wat hij
   *  intypte hoort hij terug te lezen, anders lijkt het of er een ander saldo
   *  wordt getoond. */
  program: string;
  points: number;
  updatedAt: string;
  /** Hoeveel dagen tussen `updatedAt` en de peildatum. Negatief als hij een
   *  datum in de toekomst heeft staan; dat is geen fout van hem maar van een
   *  klok, en het blijft zichtbaar in plaats van dat we het gladstrijken. */
  dagenOud: number;
  verouderd: boolean;
  /** De koersregel die bij dit programma hoort, of null als we hem niet kennen. */
  rate: PointsRate | null;
  waarom: PuntenWaarom;
  /** Wat dit saldo van deze aankoop dekt, in eurocenten. null zodra er geen
   *  koers of geen bedrag is — NOOIT 0 om "onbekend" mee te bedoelen. 0 komt
   *  hier alleen voor als de uitgever de nul zelf heeft uitgesproken. */
  coverageCents: number | null;
  /** Dat bedrag als percentage van de aankoop, afgerond op hele procenten.
   *  null onder dezelfde voorwaarden als coverageCents. */
  pct: number | null;
  /** Dekt het saldo meer dan deze aankoop? Dan is het percentage 100 en niet
   *  meer, en dat verschil hoort te blijken: 200.000 punten op een aankoop van
   *  € 30 is 100%, niet 2000%. */
  afgetopt: boolean;
  /** Wat het HELE saldo bij de gepubliceerde koers waard is, los van deze
   *  aankoop. Staat er apart van `coverageCents`, want de twee beantwoorden
   *  verschillende vragen en de tweede heeft een aankoopbedrag nodig terwijl de
   *  eerste dat niet heeft. Juist dat verschil maakt de herinnering bruikbaar op
   *  een pagina waar het bedrag níét te lezen was: "je hebt hier € 126 aan
   *  punten liggen" kan dan nog steeds. */
  saldoWaardeCents: number | null;
};

/** De standaard uit packages/core (`isStale`): een saldo ouder dan 90 dagen
 *  vraagt om een verversing. Hier herhaald en niet geïmporteerd, want de
 *  extensie is een losse bundel zonder toegang tot core — maar bewust hetzelfde
 *  getal, zodat de twee schermen niet een ander antwoord geven op de vraag of
 *  een saldo oud is. */
export const VEROUDERD_NA_DAGEN = 90;

/** Alles wat geen letter of cijfer is eruit, kleine letters. Zo komen "Amex",
 *  "AMEX " en "American Express" bij dezelfde koersregel uit. Diakrieten worden
 *  ontleed en weggehaald: iemand die "Aéroplan" typt hoort niet op de spelling
 *  van zijn accent te stranden. */
export function normaliseerProgramma(naam: string): string {
  return naam
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Welke koersregel hoort bij deze programmanaam?
 *
 *  ALLEEN EEN VOLLEDIGE TREFFER OP EEN ALIAS. Geen "bevat" en geen beste-gok:
 *  "Air Miles" bevat "miles" en zou dan bij Flying Blue uitkomen, waarna er een
 *  KLM-uitspraak onder een Air Miles-saldo staat. Geen match is hier het goede
 *  antwoord — dan zegt de extensie dat ze het programma niet kent, en dat is
 *  waar. */
export function zoekKoers(program: string, rates: readonly PointsRate[]): PointsRate | null {
  const n = normaliseerProgramma(program);
  if (n === "") return null;
  for (const r of rates) {
    if (normaliseerProgramma(r.program) === n) return r;
    for (const a of r.aliases) if (normaliseerProgramma(a) === n) return r;
  }
  return null;
}

/** Dagen tussen twee ISO-datums. Geen Date-constructor op een losse string:
 *  die accepteert van alles en maakt er stilletjes een datum van. Onleesbare
 *  invoer geeft NaN, en de aanroeper behandelt dat als "leeftijd onbekend" in
 *  plaats van als nul dagen oud. */
function dagenTussen(vanISO: string, totISO: string): number {
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

export type CoverageInput = {
  balances: readonly PointsBalance[];
  rates: readonly PointsRate[];
  /** Het aankoopbedrag in eurocenten, of null zolang dat niet gelezen én niet
   *  ingevuld is. Zonder bedrag blijft het saldo staan — dat is juist de
   *  herinnering — maar zonder dekking en zonder percentage. */
  amountCents: number | null;
  asOf: string;
  verouderdNaDagen?: number;
};

/** Rangorde in het paneel. De rijen waar iets te halen valt eerst, daarna wat
 *  we niet weten, en als laatste de programma's waarvan de uitgever zelf zegt
 *  dat er geen geldwaarde is. Die laatste staan er wél — hij heeft ze
 *  ingevoerd, ze weglaten zou een saldo laten verdwijnen — maar bovenaan zouden
 *  ze de plek innemen van de regel die wel iets doet. */
function rang(r: PuntenRij): number {
  if (r.coverageCents !== null && r.coverageCents > 0) return 0;
  if (r.waarom === "geen-bedrag") return 1;
  if (r.waarom === "uitgesproken-geen-geldwaarde") return 3;
  return 2;
}

/**
 * Eén rij per programma waarvoor hij een saldo heeft ingevoerd.
 *
 * WAT ER GEEN RIJ OPLEVERT, en waarom dat geen stille weglating is:
 *
 *   - een saldo van 0 of minder. Nul punten is hier een UITGESPROKEN nul — hij
 *     heeft het zelf ingevoerd — en dus een feit. Maar een herinnering aan nul
 *     punten is geen herinnering; er ligt niets. Het saldo blijft in het
 *     optiescherm staan waar hij het invoerde, het haalt alleen het paneel niet.
 *   - een lege programmanaam. Die kan nergens bij horen en zegt niets.
 *
 * Wat er WEL een rij oplevert en misschien niet zou moeten: een programma dat we
 * niet kennen. Dat is met opzet. "Je hebt hier 12.000 Marriott-punten liggen" is
 * de herinnering, ook zonder dat we weten wat ze waard zijn — en de zin erbij
 * zegt dat we de koers niet kennen in plaats van er een te verzinnen.
 */
export function pointsCoverage(input: CoverageInput): PuntenRij[] {
  const grens = input.verouderdNaDagen ?? VEROUDERD_NA_DAGEN;
  const uit: PuntenRij[] = [];

  for (const b of input.balances) {
    if (b.program.trim() === "") continue;
    if (!Number.isFinite(b.points) || b.points <= 0) continue;

    const rate = zoekKoers(b.program, input.rates);
    const dagenOud = dagenTussen(b.updatedAt, input.asOf);

    let waarom: PuntenWaarom;
    let coverageCents: number | null = null;
    let pct: number | null = null;
    let afgetopt = false;
    const saldoWaardeCents =
      rate && rate.soort === "koers" && rate.eurPerPoint !== null
        ? Math.round(b.points * rate.eurPerPoint * 100)
        : null;

    if (rate === null) {
      waarom = "programma-onbekend";
    } else if (rate.soort === "niet-gepubliceerd") {
      waarom = "koers-niet-gelezen";
    } else if (rate.soort === "geen-vaste-waarde") {
      waarom = "geen-vaste-waarde";
    } else if (rate.soort === "uitgesproken-nul") {
      /* De enige plek in dit bestand waar een 0 mag ontstaan, en hij ontstaat
       * niet uit een ontbrekend cijfer maar uit een zin van de uitgever zelf.
       * Zonder aankoopbedrag is er geen percentage, want dan is er niets om het
       * van te nemen; het bedrag blijft wel nul. */
      waarom = "uitgesproken-geen-geldwaarde";
      coverageCents = 0;
      pct = input.amountCents !== null && input.amountCents > 0 ? 0 : null;
    } else if (input.amountCents === null || input.amountCents <= 0) {
      waarom = "geen-bedrag";
    } else {
      waarom = "koers-bekend";
      const ruw = saldoWaardeCents ?? 0;
      afgetopt = ruw > input.amountCents;
      coverageCents = afgetopt ? input.amountCents : ruw;
      pct = Math.round((coverageCents / input.amountCents) * 100);
    }

    uit.push({
      program: b.program,
      points: b.points,
      updatedAt: b.updatedAt,
      dagenOud,
      /* NaN is niet "vers". Een onleesbare datum betekent dat we de leeftijd
       * niet weten, en niet dat het saldo van vandaag is. */
      verouderd: Number.isNaN(dagenOud) ? true : dagenOud > grens,
      rate,
      waarom,
      coverageCents,
      pct,
      afgetopt,
      saldoWaardeCents,
    });
  }

  uit.sort((a, b) => {
    const ra = rang(a);
    const rb = rang(b);
    if (ra !== rb) return ra - rb;
    if (
      a.coverageCents !== null &&
      b.coverageCents !== null &&
      a.coverageCents !== b.coverageCents
    ) {
      return b.coverageCents - a.coverageCents;
    }
    if (a.points !== b.points) return b.points - a.points;
    return a.program.localeCompare(b.program, "nl");
  });

  return uit;
}
