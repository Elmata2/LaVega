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
import { reasonText } from "./read.js";
import { rowLine, sourceLine, unknownLine, headline } from "./lines.js";
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
  for (const row of r.openUnknownCost.slice(0, caps.onbekendeKosten)) {
    uit.push(regel(row, "onbekende-kosten"));
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
 *  ineens over je winkelwagen heen staat, die vraag oproept. */
export function footer(catalogAt: string): string {
  return (
    `Kaartgegevens van ${dateNL(catalogAt)}. LaVega leest deze pagina alleen om het bedrag te ` +
    `vinden, bewaart er niets van en stuurt niets naar buiten.`
  );
}

export type PanelInput = {
  reading: Reading;
  ranking: Ranking | null;
  catalogAt: string;
  caps?: Caps;
};

export function buildPanel(input: PanelInput): PaneelAntwoord {
  const voet = footer(input.catalogAt);

  if (!input.reading.ok) {
    /* reasonText noemt al de echte oorzaak en eindigt met "vul het bedrag zelf
     * in". In het paneel is dat onaf: daar ZIT geen veld. De verwijzing naar de
     * plek waar het veld wél staat hoort erbij, anders is het advies dat in deze
     * toestand niet kan werken. */
    return {
      soort: "geen-bedrag",
      kop: "Het bedrag is hier niet te lezen.",
      uitleg: `${reasonText(input.reading.reason)} Dat doe je in het LaVega-venster: klik op het icoon in je werkbalk.`,
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
    regels: panelRows(input.ranking, input.caps ?? PANEEL_CAPS),
    voet,
  };
}
