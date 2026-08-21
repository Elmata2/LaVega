/* DE HORIZONREGEL. Dit bestand bestaat omdat 14 min 16,99 een getal is dat
 * niets betekent.
 *
 * Een afrekening is EENMALIG. Kaartkosten zijn TERUGKEREND. Je mag die twee
 * niet van elkaar aftrekken zonder te zeggen over welke periode je rekent,
 * anders is de uitkomst een verschil tussen twee verschillende soorten getal.
 *
 * WAT ER MISGING TOEN HET ANDERS WAS. De eerste opzet trok gewoon de maandprijs
 * van de winst af: € 7,50 opbrengst op een aankoop, min € 2,55 per maand, "netto
 * € 4,95". Dat leest goed en het is fout, twee keer:
 *
 *   1. Bij een kaart met een JAARPRIJS gaf dezelfde som € 7,50 min € 270 = een
 *      verlies van € 262,50 — terwijl bij een andere kaart de maandprijs werd
 *      gebruikt. Dezelfde som, twee eenheden, een factor twaalf verschil in hoe
 *      hard hij aankomt. Onvergelijkbaar zonder het te zeggen.
 *   2. Er stond nergens over welke periode het ging. "Netto € 4,95" — per
 *      aankoop? per maand? Wie het scherm leest kan het niet nagaan, en dat is
 *      exact wat een melding niet mag doen.
 *
 * DE KEUZE DIE HIER IS GEMAAKT, en het is een keuze:
 *
 * Wie een kaart OPENT voor deze aankoop betaalt MINSTENS EEN PERIODE. Bij een
 * maandkaart is dat één maand. Bij een jaarkaart is dat een heel JAAR, en
 * expliciet NIET de jaarprijs gedeeld door twaalf. Je kunt een kaart die per
 * jaar afrekent niet voor één maand openen; € 270 door 12 is € 22,50 en dat
 * bedrag betaal je nergens. Een kost te laag inschatten maakt van een verlies
 * een aanbeveling, en dat is de enige fout in dit bestand die echt geld kost.
 *
 * De ondergrens staat daarom niet alleen in de code maar ook in `label`, zodat
 * het scherm de periode kan noemen waarover gerekend is. Dat is de hele reden
 * dat deze functie een label teruggeeft en niet alleen een getal. */

import type { CardFee } from "./types.js";
import { eurosToCents } from "./money.js";

export type MinimumCharge = {
  /** Wat je minstens betaalt om deze kaart voor deze aankoop te kunnen
   *  gebruiken, in centen. */
  cents: number;
  /** Hoeveel hele periodes dat zijn. */
  periods: number;
  /** De periode zelf, zodat de UI hem kan noemen: "1 maand", "2 jaar". */
  label: string;
};

/** De ondergrens uit de opdracht, hier expliciet: minstens één periode. Staat
 *  als losse constante zodat de test hem kan aanwijzen in plaats van hem te
 *  hoeven vermoeden uit een uitkomst. */
export const MINIMUM_PERIODS = 1;

/** De standaardhorizon van een afrekening: hij koopt nu, één keer. Wie langer
 *  vooruit wil kijken geeft een grotere `horizonMonths` mee — de functie rekent
 *  dan met meer periodes, niet met een ander soort getal. */
export const DEFAULT_HORIZON_MONTHS = 1;

const MONTHS_PER_YEAR = 12;

export function minimumCharge(fee: CardFee, horizonMonths = DEFAULT_HORIZON_MONTHS): MinimumCharge {
  const months = Math.max(MINIMUM_PERIODS, Math.ceil(horizonMonths));

  if (fee.period === "maand") {
    const periods = months;
    return {
      cents: eurosToCents(fee.value) * periods,
      periods,
      label: periods === 1 ? "1 maand" : `${periods} maanden`,
    };
  }

  /* Naar boven afronden, niet delen. Elf maanden op een jaarkaart is één keer
   * de jaarprijs; dertien maanden is twee keer. Er bestaat geen tarief voor een
   * deel van een jaar, dus we doen niet alsof. */
  const periods = Math.max(MINIMUM_PERIODS, Math.ceil(months / MONTHS_PER_YEAR));
  return {
    cents: eurosToCents(fee.value) * periods,
    periods,
    label: periods === 1 ? "1 jaar" : `${periods} jaar`,
  };
}
