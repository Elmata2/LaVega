/* Van een lezing plus een rangschikking naar de tekst die op het scherm komt.
 * Puur: geen DOM, geen chrome.*, geen datum van de klok. Daardoor kan het hele
 * paneel in een test worden nagelezen zonder dat er een browser aan te pas komt,
 * en dat is waar panel.test.ts op staat.
 *
 * ── DE MUNT, en waarom een niet-euro-bedrag hier WEIGERT ────────────────────
 *
 * In dit project betekent `amountCents` altijd EURO-centen, en zegt `currency`
 * iets anders: in welke munt de WINKEL afrekent, en dus of er koersopslag over
 * je aankoop gaat. Dat zie je terug in rank.test.ts, waar een aankoop van
 * 30.000 centen in "USD" een opbrengst van € 7,50 geeft — euro's, met een
 * koersopslag erin verrekend.
 *
 * Dat model is bruikbaar zolang het bedrag in euro's binnenkomt. Maar de LEZER
 * geeft het bedrag terug zoals het op de pagina staat, in de munt van die
 * pagina. Staat daar "USD 300", dan is 30000 geen eurocenten en zou het paneel
 * "€ 300,00" tonen voor iets van ongeveer € 275. Niemand zou dat merken, want
 * het getal klopt en alleen het teken ervoor is gelogen.
 *
 * Omrekenen kan niet: daar is een koers voor nodig en die zouden we moeten
 * ophalen, wat deze extensie niet doet. Dus weigert het paneel bij een andere
 * munt dan de euro, met die reden erbij, en wijst het naar het handmatige veld
 * waar de gebruiker zelf een euro-bedrag kan invullen. Onbekend blijft onbekend.
 *
 * ── WAAROM HET PANEEL KORTER IS DAN DE POPUP ───────────────────────────────
 *
 * Hetzelfde materiaal, twee plekken, twee lengtes. Het paneel staat over de
 * winkel heen terwijl iemand aan het afrekenen is: daar hoort een antwoord, geen
 * lijst. De popup opent hij zelf en daar mag alles staan. Dezelfde functie levert
 * beide, met een andere `caps` mee — zodat de twee schermen niet uit elkaar
 * kunnen lopen in wat ze BEWEREN, alleen in hoeveel ze tonen. */

import type { Ranking, Row } from "./rank.js";
import type { Reading } from "./read.js";
import type { PuntenRij } from "./points.js";
import { AMEX_MATCH, type AanbodToestand, type AanbodUitkomst, type Aanbieding } from "./amex.js";
import type { CheckoutCard } from "./types.js";
import { reasonText } from "./read.js";
import {
  aanbodRegel,
  aanbodBron,
  aanbodToestandRegel,
  AANBOD_KOP_WINKEL,
  AANBOD_KOP_LIJST,
  rowLine,
  sourceLine,
  unknownLine,
  headline,
  puntenRegel,
  puntenBron,
  puntenVoetnoot,
  puntenLeegRegel,
  catalogPeriode,
} from "./lines.js";
import { euro, dateNL } from "./money.js";

export type Caps = {
  mijn: number;
  openen: number;
  achteruit: number;
  onbekendeKosten: number;
};

/** Het paneel over de winkel heen: kort. */
export const PANEEL_CAPS: Caps = { mijn: 3, openen: 1, achteruit: 1, onbekendeKosten: 1 };

/** De popup: alles, want die heeft hij zelf opengeklikt. */
export const POPUP_CAPS: Caps = {
  mijn: Infinity,
  openen: Infinity,
  achteruit: Infinity,
  onbekendeKosten: Infinity,
};

function regel(row: Row, groep: PaneelGroep): PaneelRegel {
  return { titel: row.card.product, regel: rowLine(row), bron: sourceLine(row), groep };
}

/** De rijen in de volgorde waarin ze op het scherm horen te staan.
 *
 *  DE VOLGORDE IS EEN UITSPRAAK. Eerst wat hij al heeft, want dat is wat hij nu
 *  kan doen. Daarna wat hij zou kunnen openen. "Achteruit" staat ONDER "openen"
 *  maar staat er wél: die rij bestaat alleen om zichtbaar te maken dat een kaart
 *  die op papier meer teruggeeft, na kosten minder oplevert. Hem weglaten omdat
 *  hij geen aanbeveling is, zou de vergelijking juist verbergen.
 *
 *  De onbekenden staan onderaan en niet bovenaan, maar ze staan er altijd en
 *  worden nooit afgekapt: dat zijn zijn EIGEN kaarten waarvan we het antwoord
 *  niet weten, en dat is precies het soort ding dat een lijst stil weglaat. */
export function panelRows(r: Ranking, caps: Caps): PaneelRegel[] {
  const uit: PaneelRegel[] = [];
  for (const row of r.mine.slice(0, caps.mijn)) uit.push(regel(row, "mijn"));
  for (const row of r.openWorthIt.slice(0, caps.openen)) uit.push(regel(row, "openen"));
  for (const row of r.openBackwards.slice(0, caps.achteruit)) uit.push(regel(row, "achteruit"));
  /* TWEE SOORTEN ONBEKEND, TWEE KOPPEN. `openUnknownCost` draagt allebei: de
   * kaarten waarvan we de PRIJS niet kennen (basis "bruto") en de kaarten
   * waarvan de OPBRENGST niet in euro's is uit te drukken (basis
   * "voorwaardelijk"). Ze stonden onder één kop, "Kaartkosten onbekend", en bij
   * die tweede groep was dat onwaar: bij Crypto.com Obsidian staan de kosten
   * gewoon in de voorwaarde ("€450,000 12-month CRO staking"). De rij zei het al
   * goed; de kop erboven sprak hem tegen, en de kop is wat er het eerst gelezen
   * wordt. */
  for (const row of r.openUnknownCost.slice(0, caps.onbekendeKosten)) {
    uit.push(regel(row, row.basis === "voorwaardelijk" ? "geen-euro-uitkomst" : "onbekende-kosten"));
  }
  for (const u of r.unknowns) {
    uit.push({ titel: u.card.product, regel: unknownLine(u), bron: "", groep: "onbekend" });
  }
  return uit;
}

/** Wat een gelezen bedrag WEL en NIET is. Een artikelprijs als ordertotaal
 *  presenteren is de stilste manier om er naast te zitten: het getal klopt, het
 *  antwoord niet. */
export function amountNote(reading: Extract<Reading, { ok: true }>): string {
  return reading.basis === "bestelling"
    ? `Van deze pagina gelezen als totaal van je bestelling (${reading.via}).`
    : `Van deze pagina gelezen als prijs van één artikel (${reading.via}). ` +
        `Aantal, bezorgkosten en korting zitten er niet in.`;
}

/** De regel onderaan. Twee dingen, allebei nodig: hoe oud de kaartgegevens zijn,
 *  en wat er met deze pagina gebeurt. Het tweede staat er omdat een paneel dat
 *  ineens over je winkelwagen heen staat, die vraag oproept.
 *
 *  DE DATUM IS EEN SPREIDING EN GEEN PUNT. Hier stond de bouwdatum van de
 *  catalogus, en die was aantoonbaar onjuist: zesenveertig cijfers in dezelfde
 *  bundel dragen een controledatum die NA die dag ligt, en het oudste cijfer is
 *  van bijna vier jaar eerder. Zie `catalogPeriode` in lines.ts voor waarom geen
 *  enkele losse datum hier waar kan zijn. Levert de bundel geen enkele leesbare
 *  datum, dan zegt de voetregel dát — en niet een datum die dan uit de lucht
 *  komt. */
export function footer(cards: readonly CheckoutCard[]): string {
  const periode = catalogPeriode(cards);
  const kop =
    periode === null
      ? "Bij deze kaartgegevens staat geen controledatum."
      : periode.eerste === periode.laatste
        ? `Kaartgegevens gecontroleerd op ${dateNL(periode.eerste)}.`
        : `Kaartgegevens gecontroleerd tussen ${dateNL(periode.eerste)} en ${dateNL(periode.laatste)}; ` +
          `bij elke regel staat de datum van dat ene cijfer.`;
  return (
    `${kop} LaVega leest deze pagina alleen om het bedrag te ` +
    `vinden, bewaart er niets van en stuurt niets naar buiten.`
  );
}

/** Het puntenblok voor het paneel en de popup.
 *
 *  Dit is de enige plek waar de puntenrijen zinnen worden, zodat de twee
 *  schermen niet uit elkaar kunnen lopen in wat ze BEWEREN. */
export function puntenBlok(rijen: readonly PuntenRij[], amountCents: number | null, currency: string): PaneelPunten {
  return {
    regels: rijen.map((rij) => ({
      /* ZIJN EIGEN NAAM ALS TITEL, en niet de naam uit onze koerslijst. Wie
       * "Amex" invoert en "Membership Rewards" terugleest, weet niet zeker of
       * dit over zijn saldo gaat. De naam uit de koerslijst staat in de zin
       * eronder, waar hij hoort: bij de koers. */
      titel: rij.program,
      regel: puntenRegel(rij, amountCents),
      bron: puntenBron(rij),
    })),
    voetnoot: rijen.length === 0 ? "" : puntenVoetnoot(currency),
    /* Alleen als er ECHT niets is ingevoerd. Rijen die wegvallen omdat het saldo
     * nul is, tellen als ingevoerd: dan weet hij al waar het veld staat en zou
     * deze zin hem naar een scherm sturen waar hij net vandaan komt. */
    leeg: rijen.length === 0 ? puntenLeegRegel() : "",
  };
}

/** Het aanbiedingenblok voor het paneel en het werkbalkvenster.
 *
 *  ── WAAROM EEN LEGE KOP HIER "NIETS TONEN" BETEKENT ────────────────────────
 *
 *  Bij elke andere onbekende in deze extensie geldt: noem hem. Hier is één
 *  uitzondering, en die gaat niet over een onbekende maar over een KEUZE die hij
 *  heeft gemaakt. Staat de schakelaar uit, dan heeft hij gezegd dat LaVega zijn
 *  Amex-account niet leest. Daar bij elke kassa aan herinneren is geen eerlijke
 *  melding maar een aansporing, en dan is het antwoord op "nee" een vraag die
 *  elke keer terugkomt. De vraag staat één keer, in het optiescherm.
 *
 *  In alle ANDERE gevallen staat er wél iets, ook als er niets te tonen valt:
 *  "voor deze winkel staat er geen aanbieding in wat we op 12 augustus lazen" is
 *  een antwoord, en een leeg blok is dat niet. */
export function aanbodBlok(uitkomst: AanbodUitkomst, asOf: string): PaneelAanbod {
  if (uitkomst.soort === "uit") return { kop: "", regels: [], toestand: "" };

  if (uitkomst.soort === "gevonden") {
    /* De geldige eerst, de verlopen eronder. Ze door elkaar zetten zou een
     * verlopen aanbieding de plek geven van een bruikbare. */
    const regels = [...uitkomst.geldig, ...uitkomst.verlopen].map((a) => ({
      titel: a.winkel,
      regel: aanbodRegel(a, asOf),
      bron: aanbodBron(a, asOf),
    }));
    return { kop: AANBOD_KOP_WINKEL, regels, toestand: "" };
  }

  return {
    kop: AANBOD_KOP_WINKEL,
    regels: [],
    toestand: aanbodToestandRegel(uitkomst, AMEX_MATCH),
  };
}

/** DE HELE LIJST, voor het werkbalkvenster en het optiescherm.
 *
 *  ── WAAROM HIER GEEN KOPPELING AAN EEN WINKEL GEBEURT ──────────────────────
 *
 *  In het paneel bij een winkel wordt streng gekoppeld op domein, en wat geen
 *  domein draagt verschijnt daar niet. Hier gebeurt het omgekeerde: alles staat
 *  er, ongesorteerd op winkel, en HIJ leest de naam. Dat is geen inconsistentie
 *  maar hetzelfde principe in twee situaties.
 *
 *  Bij een winkel is een regel een BEWERING over de pagina waar hij op staat
 *  ("hier ligt een aanbieding voor je"), en die bewering moet kloppen. In dit
 *  venster is dezelfde regel een LIJST van wat er in zijn Amex-account stond, en
 *  daar is geen bewering over een winkel bij — hij kijkt zelf of Nike erbij
 *  staat. Zo komt een aanbieding zonder leesbaar webadres toch ergens terecht in
 *  plaats van te verdwijnen, zonder dat er ooit een verkeerde koppeling aan een
 *  kassa staat.
 *
 *  De volgorde: geldig boven verlopen, en binnen de geldige de vroegste
 *  einddatum eerst — een deadline is wat een aanbieding dringend maakt. Wat geen
 *  einddatum draagt komt onderaan die groep; dat is geen "onbeperkt geldig",
 *  alleen "we weten het niet", en dat staat ook in de regel zelf. */
export function aanbodLijst(toestand: AanbodToestand, asOf: string): PaneelAanbod {
  if (!toestand.aan) return { kop: "", regels: [], toestand: "" };

  if (toestand.aanbiedingen.length === 0) {
    const uitkomst: AanbodUitkomst = !toestand.lezing
      ? { soort: "nooit-gelezen" }
      : toestand.lezing.uitkomst === "gelezen"
        ? { soort: "geen-voor-deze-winkel", op: toestand.lezing.op, dagen: 0, totaal: 0 }
        : { soort: "lezing-mislukt", lezing: toestand.lezing };
    return { kop: AANBOD_KOP_LIJST, regels: [], toestand: aanbodToestandRegel(uitkomst, AMEX_MATCH) };
  }

  const verlopen = (a: Aanbieding): boolean => a.tot !== null && a.tot < asOf;
  const gesorteerd = [...toestand.aanbiedingen].sort((a, b) => {
    if (verlopen(a) !== verlopen(b)) return verlopen(a) ? 1 : -1;
    if ((a.tot === null) !== (b.tot === null)) return a.tot === null ? 1 : -1;
    if (a.tot !== null && b.tot !== null && a.tot !== b.tot) return a.tot < b.tot ? -1 : 1;
    return a.winkel.localeCompare(b.winkel, "nl");
  });

  return {
    kop: AANBOD_KOP_LIJST,
    regels: gesorteerd.map((a) => ({
      titel: a.winkel,
      regel: aanbodRegel(a, asOf),
      bron: aanbodBron(a, asOf),
    })),
    toestand: "",
  };
}

export type PanelInput = {
  reading: Reading;
  ranking: Ranking | null;
  /** De gebundelde kaarten, voor de spreiding van de controledatums onderaan. */
  cards: readonly CheckoutCard[];
  /** Zijn puntensaldi, al uitgerekend door points.ts. Leeg is een geldige
   *  waarde en betekent dat hij er nog geen heeft ingevoerd. */
  punten: readonly PuntenRij[];
  /** Wat er over zijn Amex-aanbiedingen gezegd mag worden, plus de peildatum
   *  waartegen de leeftijd van een lezing wordt afgemeten. De twee zitten in
   *  ÉÉN veld omdat ze niet los van elkaar bruikbaar zijn: een uitkomst zonder
   *  peildatum zou de leeftijd van een aanbieding niet kunnen noemen, en dat is
   *  het enige waarop hij haar kan beoordelen. Weglaten betekent: de schakelaar
   *  staat uit, en dan staat er niets over aanbiedingen op het scherm. */
  aanbod?: { uitkomst: AanbodUitkomst; asOf: string };
  caps?: Caps;
};

export function buildPanel(input: PanelInput): PaneelAntwoord {
  const voet = footer(input.cards);
  const aanbod = input.aanbod
    ? aanbodBlok(input.aanbod.uitkomst, input.aanbod.asOf)
    : aanbodBlok({ soort: "uit" }, "");
  /* De munt van de LEZING, niet die van de rangschikking: de voetnoot van het
   * puntenblok gaat over de winkel waar hij nu staat. Kon er niets gelezen
   * worden, dan weten we de munt niet en blijft die zin bij het algemene deel. */
  const muntVanPagina = input.reading.ok ? input.reading.currency : "";

  if (!input.reading.ok) {
    /* reasonText noemt al de echte oorzaak en eindigt met "vul het bedrag zelf
     * in". In het paneel is dat onaf: daar ZIT geen veld. De verwijzing naar de
     * plek waar het veld wél staat hoort erbij, anders is het advies dat in deze
     * toestand niet kan werken. */
    return {
      soort: "geen-bedrag",
      kop: "Het bedrag is hier niet te lezen.",
      uitleg: `${reasonText(input.reading.reason)} Dat doe je in het LaVega-venster: klik op het icoon in je werkbalk.`,
      /* Zonder bedrag geen dekking, maar het SALDO staat er los van. Dit is de
       * toestand waarin het paneel voorheen niets zei, en op een IKEA-pagina met
       * een actieprijs is dit de toestand die je krijgt. */
      punten: puntenBlok(input.punten, null, muntVanPagina),
      aanbod,
      voet,
    };
  }

  if (input.reading.currency !== "EUR") {
    return {
      soort: "geen-bedrag",
      kop: `Deze pagina rekent in ${input.reading.currency}.`,
      uitleg:
        `Om daar euro's van te maken is een wisselkoers nodig, en die haalt LaVega nergens op. ` +
        `Vul in het LaVega-venster zelf het bedrag in euro's in en zet de munt op ${input.reading.currency}; ` +
        `dan wordt de koersopslag wel verrekend.`,
      punten: puntenBlok(input.punten, null, muntVanPagina),
      aanbod,
      voet,
    };
  }

  if (!input.ranking) {
    return { soort: "zwijg", reden: "geen rangschikking meegegeven" };
  }

  return {
    soort: "toon",
    kop: headline(input.ranking),
    bedrag: euro(input.reading.amountCents),
    bedragNoot: amountNote(input.reading),
    punten: puntenBlok(input.punten, input.reading.amountCents, muntVanPagina),
    aanbod,
    regels: panelRows(input.ranking, input.caps ?? PANEEL_CAPS),
    voet,
  };
}
