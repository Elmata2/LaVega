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
 * ── WAAROM DE VERGELEKEN PERIODE EEN HEEL AANTAL JAREN IS ───────────────────
 *
 * Die ondergrens per kaart was nog niet genoeg, en dat is gebleken. Met een
 * horizon van één maand kostte een maandkaart van € 9 één maand (€ 9) en een
 * jaarkaart van € 60 een heel jaar (€ 60). Allebei waar, allebei "het minimum",
 * maar ze meten niet hetzelfde: de eerste koopt één maand kaart, de tweede een
 * jaar. rank.ts zette die twee uitkomsten daarna in ÉÉN gesorteerde lijst, en
 * een positie in zo'n lijst is de uitspraak "deze is beter". € 91 over een maand
 * boven € 40 over een jaar zetten is precies de fout uit de kop hierboven, één
 * laag hoger: niet in de som, maar in de volgorde. Over een heel jaar kost die
 * maandkaart € 108 en de jaarkaart € 60, en dan draait de orde om.
 *
 * De vergeleken periode wordt daarom naar boven afgerond op HELE JAREN. Twaalf
 * maanden is het kleinste bestek waarin allebei de tariefvormen exact passen —
 * twaalf maandtermijnen, één jaartermijn — zonder dat er ergens een jaarprijs
 * door twaalf wordt gedeeld. De richting van die afronding is met opzet de dure
 * kant: liever een kaart te duur inschatten en een aanbeveling missen, dan een
 * verlies als aanbeveling afdrukken.
 *
 * En "minstens" blijft waar. `cents` is wat je minstens betaalt om deze kaart
 * de VERGELEKEN PERIODE te kunnen gebruiken, niet om hem één dag te hebben. Het
 * scherm noemt die periode erbij (`spanLabel`) én de termijnen waarin je hem
 * betaalt (`label`), zodat er geen bedrag op het scherm staat waar geen periode
 * bij hoort. Dat is de hele reden dat deze functie meer teruggeeft dan een
 * getal. */

import type { CardFee } from "./types.js";
import { eurosToCents } from "./money.js";

export type MinimumCharge = {
  /** Wat je minstens betaalt om deze kaart de vergeleken periode te kunnen
   *  gebruiken, in centen. */
  cents: number;
  /** Hoeveel hele termijnen dat zijn. */
  periods: number;
  /** De termijnen zelf: "12 maanden", "1 jaar". Dat is HOE je betaalt. */
  label: string;
  /** De vergeleken periode in maanden. Voor elke kaart in dezelfde
   *  rangschikking hetzelfde getal — daar staat of valt de vergelijking mee. */
  spanMonths: number;
  /** Diezelfde periode in woorden: "1 jaar", "2 jaar". Dat is WAAROVER
   *  gerekend is, en dat is bij elke kaart dezelfde eenheid. */
  spanLabel: string;
};

/** De ondergrens uit de opdracht, hier expliciet: minstens één periode. Staat
 *  als losse constante zodat de test hem kan aanwijzen in plaats van hem te
 *  hoeven vermoeden uit een uitkomst. */
export const MINIMUM_PERIODS = 1;

const MONTHS_PER_YEAR = 12;

/** De standaardhorizon: één heel jaar. Niet één maand — zie de kop. Wie verder
 *  vooruit wil kijken geeft een grotere `horizonMonths` mee; die wordt naar
 *  boven afgerond op hele jaren, zodat een maandkaart en een jaarkaart altijd
 *  over exact dezelfde periode worden gemeten. */
export const DEFAULT_HORIZON_MONTHS = MONTHS_PER_YEAR;

/** De gevraagde horizon naar de eerstvolgende hele jaren. Dit is de functie die
 *  garandeert dat `spanMonths` bij elke kaart gelijk is: zonder deze afronding
 *  krijgt een maandkaart bij een horizon van zes maanden een half jaar en een
 *  jaarkaart een heel jaar, en dan vergelijkt de sortering weer twee eenheden. */
export function comparableHorizonMonths(horizonMonths = DEFAULT_HORIZON_MONTHS): number {
  const gevraagd = Math.max(1, Math.ceil(horizonMonths));
  return Math.ceil(gevraagd / MONTHS_PER_YEAR) * MONTHS_PER_YEAR;
}

function jaarLabel(jaren: number): string {
  return jaren === 1 ? "1 jaar" : `${jaren} jaar`;
}

export function minimumCharge(fee: CardFee, horizonMonths = DEFAULT_HORIZON_MONTHS): MinimumCharge {
  const spanMonths = comparableHorizonMonths(horizonMonths);
  const spanLabel = jaarLabel(spanMonths / MONTHS_PER_YEAR);

  if (fee.period === "maand") {
    const periods = Math.max(MINIMUM_PERIODS, spanMonths);
    return {
      cents: eurosToCents(fee.value) * periods,
      periods,
      label: periods === 1 ? "1 maand" : `${periods} maanden`,
      spanMonths,
      spanLabel,
    };
  }

  /* Naar boven afronden, niet delen. Elf maanden op een jaarkaart is één keer
   * de jaarprijs; dertien maanden is twee keer. Er bestaat geen tarief voor een
   * deel van een jaar, dus we doen niet alsof. */
  const periods = Math.max(MINIMUM_PERIODS, Math.ceil(spanMonths / MONTHS_PER_YEAR));
  return {
    cents: eurosToCents(fee.value) * periods,
    periods,
    label: jaarLabel(periods),
    spanMonths,
    spanLabel,
  };
}
