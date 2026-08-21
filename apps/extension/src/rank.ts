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
 * gevolg van dit advies. Daar wordt netto gerekend, met de ondergrens uit
 * horizon.ts, en komt daar nul of minder uit dan is het GEEN aanbeveling — dat
 * staat er dan met zoveel woorden bij in plaats van dat hij het moet uitrekenen.
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
 * vergelijking waarvan één kant een onbekende bevat. Daarom twee lijsten. */

import type { CheckoutCard, CardFee } from "./types.js";
import { pctOfCents, points as pointsOn } from "./money.js";
import { minimumCharge, DEFAULT_HORIZON_MONTHS, type MinimumCharge } from "./horizon.js";

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
  /** Over hoeveel maanden gerekend wordt bij een kaart die hij zou openen. */
  horizonMonths?: number;
  /** De peildatum, van de aanroeper. Hier staat geen Date.now(). */
  asOf: string;
};

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
 *  `opbrengst` = een kaart die hij al heeft; er is niets te verrekenen. */
export type Basis = "netto" | "bruto" | "opbrengst";

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
   *  je geld. Bedrag-onafhankelijk, dus dit is de sorteersleutel. */
  grossPct: number;
  /** Opbrengst in centen op dit bedrag, of null zonder bedrag. */
  grossCents: number | null;
  /** Punten op dit bedrag. Getoond, nooit meegerekend. */
  points: number | null;
  fee: CardFee | null;
  /** Wat hij minstens betaalt om deze kaart te kunnen gebruiken — alleen bij een
   *  kaart die hij niet heeft en waarvan de kosten bekend zijn. */
  charge: MinimumCharge | null;
  basis: Basis;
  /** De uitkomst waar de basis bij hoort: bij "netto" de opbrengst min de
   *  kosten, bij "bruto" en "opbrengst" gelijk aan grossCents. Null zonder
   *  bedrag. */
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
  /** Kaarten die hij niet heeft en waarvan we de kosten niet weten. Bruto. */
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
  if (euroPurchase) {
    fxPct = 0;
    fxNote = "geen omrekening nodig";
  } else if (card.fxFeePct) {
    fxPct = card.fxFeePct.value;
  } else {
    return { card, reason: "geen-koersopslag-bekend" };
  }

  if (!card.cashbackPct) return { card, reason: "geen-cashback-bekend" };
  const cashbackPct = card.cashbackPct.value;

  const grossPct = cashbackPct - fxPct;
  const grossCents = input.amountCents === null ? null : pctOfCents(input.amountCents, grossPct);
  const points =
    input.amountCents === null || !card.pointsPerEuro
      ? null
      : pointsOn(input.amountCents, card.pointsPerEuro.value);

  /* Hier valt de beslissing uit de kop van dit bestand. */
  if (held) {
    return {
      card, held, fxPct, fxNote, cashbackPct, grossPct, grossCents, points,
      fee: card.fee, charge: null, basis: "opbrengst", resultCents: grossCents,
    };
  }

  if (!card.fee) {
    return {
      card, held, fxPct, fxNote, cashbackPct, grossPct, grossCents, points,
      fee: null, charge: null, basis: "bruto", resultCents: grossCents,
    };
  }

  const charge = minimumCharge(card.fee, horizonMonths);
  return {
    card, held, fxPct, fxNote, cashbackPct, grossPct, grossCents, points,
    fee: card.fee, charge, basis: "netto",
    resultCents: grossCents === null ? null : grossCents - charge.cents,
  };
}

function isUnknown(r: Row | UnknownRow): r is UnknownRow {
  return (r as UnknownRow).reason !== undefined;
}

/** Beste eerst. Op percentage, niet op euro's: het percentage is
 *  bedrag-onafhankelijk, dus deze orde staat ook overeind zolang het bedrag nog
 *  niet bekend is. Gelijk percentage → op productnaam, zodat de lijst niet van
 *  volgorde wisselt tussen twee identieke rijen. */
function byGrossPct(a: Row, b: Row): number {
  return b.grossPct - a.grossPct || a.card.product.localeCompare(b.card.product, "nl");
}

/** Voor de netto-groep sorteren we op de uitkomst zodra die er is, want daar
 *  kunnen kaartkosten de orde omdraaien: een kaart met een hoger percentage en
 *  € 270 per jaar komt achter een kaart met een lager percentage en € 0. Zonder
 *  bedrag is er geen uitkomst en valt hij terug op het percentage. */
function byResult(a: Row, b: Row): number {
  if (a.resultCents !== null && b.resultCents !== null) {
    return b.resultCents - a.resultCents || a.card.product.localeCompare(b.card.product, "nl");
  }
  return byGrossPct(a, b);
}

export function rankCheckout(input: RankInput): Ranking {
  const horizonMonths = Math.max(1, Math.ceil(input.horizonMonths ?? DEFAULT_HORIZON_MONTHS));
  const held = new Set(input.heldIds);

  const mine: Row[] = [];
  const others: Row[] = [];
  const unknowns: UnknownRow[] = [];

  for (const card of input.cards) {
    const isHeld = held.has(card.id);
    const row = buildRow(card, isHeld, input, horizonMonths);
    if (isUnknown(row)) {
      /* Alleen zijn EIGEN kaarten melden we als onbekend. Van de 77 kaarten in
       * de bundel heeft hij er een paar; alle andere onbekenden opsommen maakt
       * een lijst van zeventig regels waar hij niets mee kan, en dat is geen
       * eerlijkheid maar ruis. Zwijgen over een kaart die hij niet heeft en
       * waarvan we niets weten, is geen bewering. */
      if (isHeld) unknowns.push(row);
      continue;
    }
    (isHeld ? mine : others).push(row);
  }

  mine.sort(byGrossPct);

  /* Een kaart die hij niet heeft is alleen het noemen waard als hij het beter
   * doet dan de beste kaart die hij WEL heeft. Anders is het advies "open een
   * kaart om er minder aan over te houden". Heeft hij niets aangevinkt, dan is
   * er geen drempel en zijn alle kaarten kandidaat. */
  const bestMine = mine.length > 0 ? mine[0]!.grossPct : null;
  const candidates =
    bestMine === null ? others : others.filter((r) => r.grossPct > bestMine);

  const openWorthIt: Row[] = [];
  const openBackwards: Row[] = [];
  const openUnknownCost: Row[] = [];

  for (const row of candidates) {
    if (row.basis === "bruto") {
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
  openUnknownCost.sort(byGrossPct);

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
