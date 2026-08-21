/* De zinnen. Apart van de UI omdat een zin een uitspraak is, en een uitspraak
 * hoort getest te worden.
 *
 * WAT HIER GETEST WORDT is niet de spelling maar de belofte: bij onbekende
 * kaartkosten mag het woord "netto" niet in de regel staan. Dat is geen
 * stijlregel — "netto € 7,50" bij een kaart waarvan we de prijs niet weten, is
 * de bewering dat hij € 7,50 overhoudt, en die bewering kan een ontbrekend
 * cijfer niet dragen. De test in lines.test.ts leest de uitkomst en valt over
 * dat woord. Dat is de goedkoopste plek om die fout te vangen, want zodra de
 * regel in de popup staat, ziet niemand hem meer.
 *
 * Toon: zoals de rest van de views. Rustig, concreet, geen uitroeptekens. */

import type { Row, Ranking, UnknownRow } from "./rank.js";
import { euro, pct, dateNL, eurosToCents } from "./money.js";

/** Wat deze aankoop op deze kaart doet, in euro's, zonder over kosten te
 *  spreken. Los gehouden omdat alle drie de soorten rijen ermee beginnen. */
export function grossLine(row: Row): string {
  if (row.grossCents === null) {
    return row.grossPct === 0
      ? "Kost je niets extra."
      : row.grossPct > 0
        ? `Levert ${pct(row.grossPct)} op.`
        : `Kost ${pct(-row.grossPct)} aan koersopslag.`;
  }
  if (row.grossCents === 0) return "Kost je niets extra.";
  return row.grossCents > 0
    ? `Levert ${euro(row.grossCents)} op.`
    : `Kost ${euro(-row.grossCents)} aan koersopslag.`;
}

/** De regel onder een kaart die hij AL heeft. De kaartkosten staan erbij als
 *  feit in hun eigen periode en worden niet afgetrokken — het waarom staat in
 *  de kop van rank.ts en, korter, hier op het scherm. */
export function heldLine(row: Row): string {
  const parts = [grossLine(row)];
  if (row.fee) {
    parts.push(
      `Deze kaart kost je ${euro(eurosToCents(row.fee.value))} per ${row.fee.period}. ` +
        `Die kosten lopen door of je hier nu mee betaalt of niet, dus ze staan hier naast de aankoop en niet in de aftreksom.`,
    );
  }
  return parts.join(" ");
}

/** De regel onder een kaart die hij NIET heeft en waarvan de kosten bekend zijn.
 *  Hier mag en moet het woord netto vallen, met de periode erbij waarover
 *  gerekend is. */
export function netLine(row: Row): string {
  if (!row.charge) return grossLine(row);
  const opening =
    `Om hiermee te betalen moet je deze kaart openen. Dat kost minstens ${row.charge.label}: ` +
    `${euro(row.charge.cents)}.`;
  if (row.resultCents === null) {
    return `${grossLine(row)} ${opening} Vul het bedrag in om te zien wat er netto overblijft.`;
  }
  if (row.resultCents > 0) {
    return `${grossLine(row)} ${opening} Netto over ${row.charge.label}: ${euro(row.resultCents)}.`;
  }
  return (
    `${grossLine(row)} ${opening} Netto over ${row.charge.label}: ${euro(row.resultCents)} — ` +
    `dat is achteruit, dus dit is geen aanbeveling.`
  );
}

/** De regel onder een kaart die hij niet heeft en waarvan we de kosten NIET
 *  weten. Bruto, met de onbekendheid erbij. Het woord netto komt hier niet in
 *  voor, en lines.test.ts houdt dat tegen. */
export function grossUnknownCostLine(row: Row): string {
  return (
    `${grossLine(row)} Dat is het brutobedrag: wat deze kaart kost om te hebben, ` +
    `staat niet in onze gegevens. Zoek dat op bij ${row.card.issuer} voordat je hem opent — ` +
    `wat je overhoudt, hangt daarvan af.`
  );
}

/** De juiste regel bij de juiste soort rij. Één deur, zodat er niet per ongeluk
 *  een netto-regel onder een bruto-rij belandt. */
export function rowLine(row: Row): string {
  switch (row.basis) {
    case "opbrengst":
      return heldLine(row);
    case "netto":
      return netLine(row);
    case "bruto":
      return grossUnknownCostLine(row);
  }
}

/** Waar het cijfer vandaan komt en van wanneer. Aan een kassa is de datum het
 *  enige waarop hij de betrouwbaarheid kan afmeten, dus die staat er altijd. */
export function sourceLine(row: Row): string {
  const bits: string[] = [];
  if (row.card.cashbackPct) bits.push(`cashback ${pct(row.cashbackPct)}, gecontroleerd ${dateNL(row.card.cashbackPct.checkedAt)}`);
  if (row.fxNote) bits.push(`koersopslag ${pct(0)} — ${row.fxNote}`);
  else if (row.card.fxFeePct) bits.push(`koersopslag ${pct(row.fxPct)}, gecontroleerd ${dateNL(row.card.fxFeePct.checkedAt)}`);
  return bits.join(" · ");
}

export function unknownLine(u: UnknownRow): string {
  switch (u.reason) {
    case "geen-koersopslag-bekend":
      return `${u.card.product}: we weten niet wat ${u.card.issuer} bij een betaling in vreemde valuta rekent. Onbekend is niet nul, dus deze kaart staat niet in de ranglijst.`;
    case "geen-cashback-bekend":
      return `${u.card.product}: we weten niet of deze kaart iets teruggeeft. Onbekend is niet nul, dus deze kaart staat niet in de ranglijst.`;
  }
}

/** De kop boven de lijst. Ook — en vooral — voor de gevallen waarin er niets te
 *  zeggen is. Een leeg scherm dat "je saldi staan al op de beste plek" beweert,
 *  is de fout die deze functie moet voorkomen. */
export function headline(r: Ranking): string {
  const noAmount = r.amountCents === null;

  if (r.mine.length === 0 && r.unknowns.length === 0 && r.openWorthIt.length === 0 && r.openUnknownCost.length === 0) {
    return "Er staat geen kaart aangevinkt en er is niets bekend om te vergelijken.";
  }
  if (r.mine.length === 0) {
    if (r.unknowns.length > 0) {
      return "Van de kaarten die je hebt aangevinkt, weten we bij geen enkele wat deze aankoop oplevert.";
    }
    return "Je hebt nog geen kaart aangevinkt. Hieronder staat wat er te halen valt, en wat het kost om zo'n kaart te openen.";
  }

  const best = r.mine[0]!;
  const name = best.card.product;
  if (noAmount) {
    return best.grossPct > 0
      ? `Van jouw kaarten levert ${name} hier het meeste op: ${pct(best.grossPct)}. Vul het bedrag in voor de euro's.`
      : best.grossPct === 0
        ? `Van jouw kaarten is ${name} hier de goedkoopste: die kost je niets extra.`
        : `Van jouw kaarten is ${name} hier de goedkoopste, en ook die kost je ${pct(-best.grossPct)}.`;
  }
  const cents = best.grossCents!;
  return cents > 0
    ? `Betaal met ${name}. Dat levert ${euro(cents)} op.`
    : cents === 0
      ? `Betaal met ${name}. Die kost je hier niets extra.`
      : `Van jouw kaarten is ${name} de goedkoopste, en ook die kost je ${euro(-cents)}.`;
}
