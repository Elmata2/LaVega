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
import type { CheckoutCard } from "./types.js";
import { reasonText } from "./read.js";
import {
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

export type PanelInput = {
  reading: Reading;
  ranking: Ranking | null;
  /** De gebundelde kaarten, voor de spreiding van de controledatums onderaan. */
  cards: readonly CheckoutCard[];
  /** Zijn puntensaldi, al uitgerekend door points.ts. Leeg is een geldige
   *  waarde en betekent dat hij er nog geen heeft ingevoerd. */
  punten: readonly PuntenRij[];
  caps?: Caps;
};

export function buildPanel(input: PanelInput): PaneelAntwoord {
  const voet = footer(input.cards);
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
    regels: panelRows(input.ranking, input.caps ?? PANEEL_CAPS),
    voet,
  };
}
