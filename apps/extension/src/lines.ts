/* De zinnen. Apart van de UI omdat een zin een uitspraak is, en een uitspraak
 * hoort getest te worden.
 *
 * WAT HIER GETEST WORDT is niet de spelling maar de belofte. Er zijn er drie:
 *
 *   1. Bij onbekende kaartkosten mag het woord "netto" niet in de regel staan.
 *      "netto € 7,50" bij een kaart waarvan we de prijs niet weten, is de
 *      bewering dat hij € 7,50 overhoudt, en die bewering kan een ontbrekend
 *      cijfer niet dragen.
 *   2. Bij een cijfer met een voorwaarde eronder mag er geen KAAL bedrag staan.
 *      Gemeten voorbeeld uit de review: "Betaal met Crypto.com Plus. Dat levert
 *      € 80,00 op" bij een aankoop van € 4.000 — terwijl in dezelfde record
 *      staat dat er $ 1.250 per maand meetelt, dat de uitkering in CRO is en dat
 *      er een abonnement voor nodig is. Het bedrag was niet te hoog, het was de
 *      verkeerde eenheid, en er stond geen voorbehoud bij.
 *   3. Een euroteken staat alleen voor een bedrag dat ook echt in euro's komt.
 *      Een uitkering in CRO is geen euro-opbrengst, hoe groot het getal ook is.
 *
 * lines.test.ts leest de uitkomsten en valt over die drie. Dat is de goedkoopste
 * plek om ze te vangen, want zodra de regel in het paneel staat, ziet niemand
 * hem meer.
 *
 * Toon: zoals de rest van de views. Rustig, concreet, geen uitroeptekens. */

import type { Row, Ranking, UnknownRow, Caveat, Veld } from "./rank.js";
import { euro, pct, dateNL, eurosToCents } from "./money.js";

/* ─────────────────────────── de uitgeversnaam ────────────────────────────── */

/** De uitgever zoals hij in een Nederlandse zin past.
 *
 *  In de catalogus staat bij Wirex letterlijk "Wirex; card issuer previously UAB
 *  PayrNet, current EEA issuer not stated on any readable page", en dat werd
 *  onbewerkt midden in "Zoek dat op bij … voordat je hem opent" geplakt. Het
 *  veld is rommelig — dat is een datakwestie — maar de zin die het rauw in een
 *  hoofdzin zet, staat hier, en dus wordt hij hier afgekapt.
 *
 *  Alles vanaf het eerste haakje, puntkomma, komma of gedachtestreepje valt weg:
 *  daarachter staat in dit veld altijd een toelichting en nooit de naam. Blijft
 *  er iets over dat nog steeds te lang is voor een zin, dan is er geen goede
 *  korte naam en geven we null terug — dan noemt de zin de uitgever niet, in
 *  plaats van hem te verminken. */
const MAX_UITGEVER = 40;

export function korteUitgever(issuer: string): string | null {
  const kop = issuer.split(/[(;,]|\s—\s|\s-\s/)[0] ?? "";
  /* Alleen witruimte en scheidingstekens eraf, geen punt: "ING Bank N.V." is
   * mét die punt de naam, en "ING Bank N.V" is een tikfout op het scherm. */
  const naam = kop.trim().replace(/[\s;,]+$/, "");
  if (naam === "" || naam.length > MAX_UITGEVER) return null;
  return naam;
}

/* ───────────────────────────── de voorwaarden ────────────────────────────── */

const VELD_NAAM: Record<Veld, string> = {
  cashback: "dit cijfer",
  koersopslag: "de koersopslag",
  kaartkosten: "de kaartkosten",
};

/** Eén voorwaarde in gewone taal.
 *
 *  DE FORMULERING IS MET OPZET EEN UITSPRAAK OVER ONZE GEGEVENS en niet over de
 *  kaart. rank.ts herkent vormen in een lap proza; hij begrijpt de tekst niet.
 *  "De voorwaarden noemen een drempel" is waar zodra die woorden er staan, ook
 *  als de drempel bij een andere tier hoort. "Je moet een abonnement nemen" zou
 *  een bewering zijn die we niet kunnen waarmaken. */
export function caveatTekst(c: Caveat): string {
  switch (c.soort) {
    case "in-token":
      return `de uitkering is in ${c.token} en niet in euro's`;
    case "plafond":
      return `er telt hooguit ${euro(c.capCents)} per ${c.basis} mee`;
    case "plafond-zonder-bedrag":
      return "er geldt een plafond op wat meetelt, en hoeveel dat is konden we niet eenduidig uit de bron lezen";
    case "plafond-onbekend":
      return "de bron noemt geen plafond en zegt er zelf bij dat dat geen bevestigde afwezigheid is";
    case "geen-plafond":
      return "de bron noemt uitdrukkelijk geen plafond";
    case "drempel":
      return "de voorwaarden noemen een drempel: een abonnement, een inleg of een tier die je moet halen";
    case "einddatum":
      return c.verlopen
        ? `het programma liep tot ${dateNL(c.datum)}, en die datum is voorbij`
        : `het programma loopt tot ${dateNL(c.datum)}`;
    case "uitsluitingen":
      return "een deel van de winkels en categorieën is uitgesloten, en of deze aankoop daaronder valt weten we niet";
    case "herzien":
      return "de bron zegt zelf dat dit cijfer opnieuw gecontroleerd moet worden";
    case "voorwaardelijke-nul":
      return "deze nul geldt alleen onder voorwaarden, dus het is geen uitgesproken nul";
    case "eenmalig":
      return "er komen eenmalige kosten bij";
    case "bovenop":
      return "dit bedrag komt bovenop een ander product dat je verplicht moet afnemen";
    case "onbeoordeeld":
      return "er staat een voorwaarde bij die we niet machinaal konden beoordelen";
  }
}

function zinVoorVeld(caveats: readonly Caveat[], veld: Veld): string | null {
  const eigen = caveats.filter((c) => c.veld === veld);
  if (eigen.length === 0) return null;
  const lijst = eigen.map(caveatTekst).join("; ");
  return eigen.length === 1
    ? `Bij ${VELD_NAAM[veld]} hoort een voorwaarde: ${lijst}.`
    : `Bij ${VELD_NAAM[veld]} horen voorwaarden: ${lijst}.`;
}

/** Is er met het plafond gerekend? Dan noemt grossLine het al met zoveel
 *  woorden, en hoeft het niet nog een keer in de opsomming. */
function capAlVerwerkt(row: Row): boolean {
  return (
    row.claim.soort === "hooguit" &&
    row.claim.capCents !== null &&
    row.euroCents !== null &&
    row.grossCents !== null &&
    row.euroCents < row.grossCents
  );
}

/** Alle voorwaarden onder een rij, per cijfer gegroepeerd. Leeg als er niets te
 *  melden is — een lege plek is hier goed nieuws en hoeft geen zin. */
export function voorwaardenZin(row: Row): string {
  const zichtbaar = capAlVerwerkt(row)
    ? row.caveats.filter((c) => c.soort !== "plafond")
    : row.caveats;
  const delen: string[] = [];
  for (const veld of ["cashback", "koersopslag", "kaartkosten"] as const) {
    const zin = zinVoorVeld(zichtbaar, veld);
    if (zin) delen.push(zin);
  }
  return delen.join(" ");
}

/** Staat er in de voorwaarden al iets over wat de kaart kost om te HEBBEN? Dan
 *  is "dat staat niet in onze gegevens" onwaar, en de zin die dat beweert mag
 *  niet worden afgedrukt. Bij Obsidian staat er "€450,000 12-month CRO staking",
 *  en de oude regel stuurde de gebruiker daarvoor naar de website van de
 *  uitgever. */
function kostenStaanInVoorwaarden(row: Row): boolean {
  return row.caveats.some(
    (c) => c.soort === "drempel" || c.soort === "bovenop" || c.soort === "eenmalig",
  );
}

/* ─────────────────────────────── de regels ───────────────────────────────── */

/** Wat deze aankoop op deze kaart doet, zonder over kaartkosten te spreken.
 *  Los gehouden omdat alle soorten rijen ermee beginnen.
 *
 *  Dit is de functie waar regel 3 uit de opdracht zit: een euroteken komt hier
 *  alleen op het scherm als er ook werkelijk euro's komen. */
export function grossLine(row: Row): string {
  const claim = row.claim;

  if (claim.soort === "niet-in-euro") {
    const kern =
      `Deze kaart geeft ${pct(row.cashbackPct)} terug, maar in ${claim.token} en niet in euro's, ` +
      `dus wat het in euro's waard is staat hier niet.`;
    /* De koersopslag is wél in euro's, en die kant mag hij weten: die kant kost
     * hem geld, ongeacht waarin de beloning wordt uitgekeerd. Het BEDRAG staat
     * er niet bij, want dat zou naast een opbrengst komen te staan die geen
     * euro's is, en dan lijkt het alsof de twee tegen elkaar wegvallen. */
    if (row.fxPct > 0) return `${kern} De koersopslag van ${pct(row.fxPct)} kost je hier wél euro's.`;
    return kern;
  }

  if (claim.soort === "vervallen") {
    return (
      `Deze kaart noemt ${pct(row.cashbackPct)}, maar dat cijfer gold tot ${dateNL(claim.datum)} ` +
      `en die datum is voorbij, dus we rekenen er niets mee.`
    );
  }

  if (claim.soort === "onbeoordeeld") {
    return (
      `Deze kaart noemt ${pct(row.cashbackPct)}, maar bij dat cijfer staat een voorwaarde die we niet ` +
      `konden beoordelen, dus er staat hier geen bedrag.`
    );
  }

  const hooguit = claim.soort === "hooguit";

  if (row.euroCents === null) {
    if (row.grossPct === 0) return "Kost je niets extra.";
    if (row.grossPct > 0) return hooguit ? `Levert hooguit ${pct(row.grossPct)} op.` : `Levert ${pct(row.grossPct)} op.`;
    return `Kost ${pct(-row.grossPct)} aan koersopslag.`;
  }
  if (row.euroCents === 0) return "Kost je niets extra.";
  if (row.euroCents > 0) {
    const kern = hooguit ? `Levert hooguit ${euro(row.euroCents)} op.` : `Levert ${euro(row.euroCents)} op.`;
    if (hooguit && claim.capCents !== null && row.grossCents !== null && row.euroCents < row.grossCents) {
      return (
        `${kern} Gerekend met het plafond van ${euro(claim.capCents)} per ${claim.capBasis}, ` +
        `niet met het hele aankoopbedrag.`
      );
    }
    return kern;
  }
  /* Onder nul draait "hooguit" om. De opbrengst is een BOVENgrens, dus wat het
   * per saldo kost is een ONDERgrens: het kan slechter uitpakken, niet beter. */
  return hooguit
    ? `Kost minstens ${euro(-row.euroCents)} aan koersopslag.`
    : `Kost ${euro(-row.euroCents)} aan koersopslag.`;
}

function metVoorwaarden(row: Row, ...delen: string[]): string {
  const zin = voorwaardenZin(row);
  return [...delen, zin].filter((d) => d !== "").join(" ");
}

/** De regel onder een kaart die hij AL heeft. De kaartkosten staan erbij als
 *  feit in hun eigen periode en worden niet afgetrokken — het waarom staat in
 *  de kop van rank.ts en, korter, hier op het scherm. */
export function heldLine(row: Row): string {
  const delen = [grossLine(row)];
  if (row.fee) {
    delen.push(
      `Deze kaart kost je ${euro(eurosToCents(row.fee.value))} per ${row.fee.period}. ` +
        `Die kosten lopen door of je hier nu mee betaalt of niet, dus ze staan hier naast de aankoop en niet in de aftreksom.`,
    );
  }
  return metVoorwaarden(row, ...delen);
}

/** De regel onder een kaart die hij NIET heeft en waarvan de kosten bekend zijn.
 *  Hier mag en moet het woord netto vallen, met de periode erbij waarover
 *  gerekend is — en die periode is bij elke kaart dezelfde, anders is de
 *  vergelijking geen vergelijking. Zie de kop van horizon.ts. */
export function netLine(row: Row): string {
  if (!row.charge) return metVoorwaarden(row, grossLine(row));
  const termijnen = row.charge.label === row.charge.spanLabel ? "" : ` (${row.charge.label})`;
  const opening =
    `Om hiermee te betalen moet je deze kaart openen. Over ${row.charge.spanLabel} kost dat ` +
    `minstens ${euro(row.charge.cents)}${termijnen}.`;

  if (row.resultCents === null) {
    return metVoorwaarden(row, grossLine(row), opening, "Vul het bedrag in om te zien wat er netto overblijft.");
  }
  /* Is de opbrengst een bovengrens, dan is de netto-uitkomst dat ook. Boven nul
   * schrijven we dat als "hooguit"; onder nul draait het om — dan is het verlies
   * een ONDERgrens en staat er "of minder", want slechter kan wel en beter niet. */
  const bovengrens = row.claim.soort === "hooguit";
  if (row.resultCents > 0) {
    return metVoorwaarden(
      row,
      grossLine(row),
      opening,
      `Netto over ${row.charge.spanLabel}: ${bovengrens ? "hooguit " : ""}${euro(row.resultCents)}.`,
    );
  }
  return metVoorwaarden(
    row,
    grossLine(row),
    opening,
    `Netto over ${row.charge.spanLabel}: ${euro(row.resultCents)}${bovengrens ? " of minder" : ""} — dat is achteruit, dus dit is geen aanbeveling.`,
  );
}

/** De regel onder een kaart die hij niet heeft en waarvan we de kosten NIET
 *  weten. Bruto, met de onbekendheid erbij. Het woord netto komt hier niet in
 *  voor, en lines.test.ts houdt dat tegen. */
export function grossUnknownCostLine(row: Row): string {
  if (kostenStaanInVoorwaarden(row)) {
    /* Hier stond eerst "wat deze kaart kost om te hebben, staat niet in onze
     * gegevens", met een verwijzing naar de website van de uitgever. Dat was bij
     * elke kaart waar het kon worden afgedrukt onwaar: het stond in de
     * voorwaarden van dezelfde record. */
    return metVoorwaarden(
      row,
      grossLine(row),
      "Dat is het brutobedrag: er staat geen bedrag-met-periode bij deze kaart, wel een voorwaarde.",
    );
  }
  const uitgever = korteUitgever(row.card.issuer);
  const zoek = uitgever
    ? ` Zoek dat op bij ${uitgever} voordat je hem opent — wat je overhoudt, hangt daarvan af.`
    : " Zoek dat op bij de uitgever voordat je hem opent — wat je overhoudt, hangt daarvan af.";
  return metVoorwaarden(
    row,
    `${grossLine(row)} Dat is het brutobedrag: wat deze kaart kost om te hebben, staat niet in onze gegevens.${zoek}`,
  );
}

/** De regel onder een kaart waarvan de opbrengst niet in euro's is uit te
 *  drukken. Er valt hier niets te verrekenen en niets te vergelijken: alleen de
 *  voorwaarde is nieuws. */
export function conditionalLine(row: Row): string {
  return metVoorwaarden(row, grossLine(row));
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
    case "voorwaardelijk":
      return conditionalLine(row);
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
  const uitgever = korteUitgever(u.card.issuer);
  switch (u.reason) {
    case "geen-koersopslag-bekend":
      return uitgever
        ? `${u.card.product}: we weten niet wat ${uitgever} bij een betaling in vreemde valuta rekent. Onbekend is niet nul, dus deze kaart staat niet in de ranglijst.`
        : `${u.card.product}: we weten niet wat de uitgever bij een betaling in vreemde valuta rekent. Onbekend is niet nul, dus deze kaart staat niet in de ranglijst.`;
    case "geen-cashback-bekend":
      return `${u.card.product}: we weten niet of deze kaart iets teruggeeft. Onbekend is niet nul, dus deze kaart staat niet in de ranglijst.`;
  }
}

/* ──────────────────────────────── de kop ─────────────────────────────────── */

function inEuros(row: Row): boolean {
  return row.claim.soort === "vast" || row.claim.soort === "hooguit";
}

/** Waarom de bovenste kaart geen euro-uitspraak kan dragen. */
function redenGeenEuros(row: Row): string {
  switch (row.claim.soort) {
    case "niet-in-euro":
      return `die opbrengst komt in ${row.claim.token} en niet in euro's`;
    case "vervallen":
      return `dat cijfer gold tot ${dateNL(row.claim.datum)} en die datum is voorbij`;
    default:
      return "bij dat cijfer staat een voorwaarde die we niet konden beoordelen";
  }
}

/** De kop boven de lijst. Ook — en vooral — voor de gevallen waarin er niets te
 *  zeggen is. Een leeg scherm dat "je saldi staan al op de beste plek" beweert,
 *  is de fout die deze functie moet voorkomen. */
export function headline(r: Ranking): string {
  const noAmount = r.amountCents === null;

  /* De leegtest telt ALLE vier de lijsten. openBackwards ontbrak hier, en toen
   * stond er "er is niets bekend om te vergelijken" boven een regel die
   * "Netto over 1 jaar: -€ 269,50" volledig had uitgerekend. */
  if (
    r.mine.length === 0 &&
    r.unknowns.length === 0 &&
    r.openWorthIt.length === 0 &&
    r.openBackwards.length === 0 &&
    r.openUnknownCost.length === 0
  ) {
    return "Er staat geen kaart aangevinkt en er is niets bekend om te vergelijken.";
  }

  if (r.mine.length === 0) {
    if (r.unknowns.length > 0) {
      return "Van de kaarten die je hebt aangevinkt, weten we bij geen enkele wat deze aankoop oplevert.";
    }
    /* DE BELOFTE MOET WAAR ZIJN. Hier stond onvoorwaardelijk "Hieronder staat
     * wat er te halen valt, en wat het kost om zo'n kaart te openen." Bij de
     * kaarten die de bundel vandaag draagt gebeurt dat tweede nul keer: geen
     * enkele kaart heeft én een cashbackcijfer én een prijs met een periode. De
     * kop belooft nu alleen wat de lijst eronder ook echt kan leveren. */
    const kostenBekend = r.openWorthIt.length > 0 || r.openBackwards.length > 0;
    return kostenBekend
      ? "Je hebt nog geen kaart aangevinkt. Hieronder staat wat er te halen valt, en bij de kaarten waarvan we de prijs kennen ook wat het openen kost."
      : "Je hebt nog geen kaart aangevinkt. Hieronder staat wat er te halen valt; bij geen van deze kaarten kennen we een prijs die we daarvan kunnen aftrekken.";
  }

  const best = r.mine[0]!;
  const name = best.card.product;

  /* mine is zo gesorteerd dat de kaarten waarover we in euro's iets kunnen
   * zeggen bovenaan staan. Staat er tóch een kaart bovenaan die dat niet kan,
   * dan geldt dat voor al zijn kaarten. */
  if (!inEuros(best)) {
    return `Van jouw kaarten staat ${name} met ${pct(best.cashbackPct)} het hoogst, maar ${redenGeenEuros(best)}.`;
  }

  const gemengd = r.mine.some((x) => !inEuros(x));
  const hooguit = best.claim.soort === "hooguit";

  if (noAmount) {
    const meeste = gemengd ? "het meeste op van je kaarten die in euro's uitkeren" : "hier het meeste op";
    return best.grossPct > 0
      ? `Van jouw kaarten levert ${name} ${meeste}: ${hooguit ? "hooguit " : ""}${pct(best.grossPct)}. Vul het bedrag in voor de euro's.`
      : best.grossPct === 0
        ? `Van jouw kaarten is ${name} hier de goedkoopste: die kost je niets extra.`
        : `Van jouw kaarten is ${name} hier de goedkoopste, en ook die kost je ${pct(-best.grossPct)}.`;
  }

  const cents = best.euroCents!;
  const staart = gemengd ? " Dat is het meeste van je kaarten die in euro's uitkeren." : "";
  if (cents > 0) {
    return `Betaal met ${name}. Dat levert ${hooguit ? "hooguit " : ""}${euro(cents)} op.${staart}`;
  }
  if (cents === 0) return `Betaal met ${name}. Die kost je hier niets extra.${staart}`;
  return `Van jouw kaarten is ${name} de goedkoopste, en ook die kost je ${euro(-cents)}.`;
}
