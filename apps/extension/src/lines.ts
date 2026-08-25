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
import type { PuntenRij } from "./points.js";
import {
  AANBOD_OUD_NA_DAGEN,
  AANBOD_TE_OUD_NA_DAGEN,
  dagenTussen,
  type Aanbieding,
  type AanbodUitkomst,
  type Bron,
  type Lezing,
} from "./aanbod-kern.js";
import type { CheckoutCard } from "./types.js";
import { euro, pct, dateNL, eurosToCents, getal } from "./money.js";

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

/* ──────────────────── hoe oud de kaartgegevens zijn ──────────────────────── */

/** De vroegste en de laatste controledatum in de bundel.
 *
 *  ── WAAROM HIER ÉÉN DATUM NIET KAN ─────────────────────────────────────────
 *
 *  De voettekst zei "Kaartgegevens van 19 augustus 2026", en dat was de datum
 *  waarop de CATALOGUS is gebouwd. In diezelfde bundel staan zesenveertig
 *  cijfers met een controledatum van 20 augustus — nieuwer dan de datum die het
 *  scherm noemde — en tegelijk een ING-cijfer van 1 oktober 2022, bijna vier
 *  jaar ouder. Eén datum boven zo'n verzameling is dus altijd fout, en het maakt
 *  niet uit welke je kiest: de bouwdatum verzwijgt hoe oud het oudste cijfer is,
 *  de nieuwste controledatum verklaart alles vers, en de oudste maakt verse
 *  cijfers verdacht.
 *
 *  Wat wél waar is, is de SPREIDING. Die staat er nu, en per regel staat de
 *  datum van dat ene cijfer er al (zie `sourceLine`). Dan kan de gebruiker zien
 *  waarop hij afgaat zonder dat de voetregel iets belooft.
 *
 *  Afgeleid uit de bundel zelf en niet uit een gegenereerde constante, zodat het
 *  meeverandert zodra de catalogus verandert — dat is precies de fout die hier
 *  zat: de constante was blijven staan terwijl de inhoud bijgewerkt was. */
export function catalogPeriode(cards: readonly CheckoutCard[]): { eerste: string; laatste: string } | null {
  const datums: string[] = [];
  for (const c of cards) {
    for (const veld of [c.fxFeePct, c.cashbackPct, c.pointsPerEuro, c.fee]) {
      const d = veld?.checkedAt?.trim();
      /* Alleen volledige ISO-datums. "2026-08" sorteert als string prima maar
       * leest als een maand, en een halve datum in een spreiding maakt de
       * spreiding onwaar. */
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) datums.push(d);
    }
  }
  if (datums.length === 0) return null;
  datums.sort();
  return { eerste: datums[0]!, laatste: datums[datums.length - 1]! };
}

/* ────────────────────────────── de punten ────────────────────────────────── */

/** De host uit een bron-URL, voor in een zin. Geen pad en geen querystring: aan
 *  een kassa is "americanexpress.com" wat je wilt weten en de rest is ruis.
 *  Lukt het ontleden niet, dan komt er niets — een half adres in een zin is
 *  slechter dan geen adres. */
function bronHost(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return null;
  }
}

/** Een letterlijk citaat, met een sluitend leesteken.
 *
 *  Zonder dit liep de volgende zin het citaat in: er stond «"… niet overdragen
 *  aan anderen" Voor inwisselen voor geld is dat een uitgesproken nul» en dan is
 *  niet meer te zien waar de uitgever ophoudt en wij beginnen. Bij een citaat is
 *  dat precies de grens die moet blijken. Het leesteken komt BUITEN de
 *  aanhalingstekens als de bron er zelf geen had: een punt binnen het citaat
 *  zetten die er niet stond, is het citaat veranderen. */
export function citaat(tekst: string): string {
  const t = tekst.trim();
  if (t === "") return "";
  return /[.!?]$/.test(t) ? `"${t}"` : `"${t}".`;
}

/** Het saldo zelf, in woorden. Altijd met het aantal, want dát is de
 *  herinnering: hij weet niet dat ze er liggen. */
function saldoZin(rij: PuntenRij): string {
  return `Je hebt hier ${getal(rij.points, 0)} punten liggen.`;
}

/** De zin onder één puntenprogramma.
 *
 *  ── WAT HIER NOOIT MAG STAAN, en waarom het per geval een andere fout is ───
 *
 *   1. een PERCENTAGE bij een programma zonder gepubliceerde koers. Dat getal
 *      zou verzonnen zijn, en er is niets om het aan af te meten.
 *   2. "deze winkel accepteert je punten". Dat kunnen we op een afrekenpagina
 *      niet zien — er is geen veld, geen opmaak en geen lijst waaruit het
 *      blijkt. De koers die we wél hebben is niet winkelspecifiek.
 *   3. een saldo zonder de datum waarop hij het invoerde. Die staat in `bron`
 *      hieronder en niet in deze zin, maar hij staat er.
 *   4. "gebruik je punten hier en bespaar X". Inwisselen gebeurt bij Amex
 *      achteraf in de app; hier is geen knop. Advies dat in de toestand waarin
 *      het verschijnt niet kan werken, is precies wat huisregel 3 verbiedt.
 *
 *  Wat er wél mag, en wat vandaag niemand hem vertelt: dát ze er liggen, wat ze
 *  bij een GEPUBLICEERDE koers waard zijn, en langs welke weg dat dan gaat. */
export function puntenRegel(rij: PuntenRij, amountCents: number | null): string {
  const delen: string[] = [saldoZin(rij)];

  switch (rij.waarom) {
    case "koers-bekend": {
      const koers = rij.rate!;
      const waarde = rij.saldoWaardeCents!;
      if (rij.afgetopt) {
        delen.push(
          `Bij de gepubliceerde koers van ${koers.program} is dat ${euro(waarde)} — meer dan deze ` +
            `aankoop kost, dus je saldo dekt hem helemaal.`,
        );
      } else {
        delen.push(
          `Bij de gepubliceerde koers van ${koers.program} is dat ${euro(waarde)} — ` +
            `${pct(rij.pct ?? 0)} van deze ${euro(amountCents ?? 0)}.`,
        );
      }
      delen.push(inwisselZin(koers.scope));
      if (koers.nuance) delen.push(koers.nuance);
      break;
    }
    case "geen-bedrag": {
      const koers = rij.rate!;
      /* Zonder aankoopbedrag is er geen percentage, maar de WAARDE van het saldo
       * hangt niet van deze pagina af. Die mag dus wel, en juist hier is hij het
       * nuttigst: dit is de toestand waarin het paneel voorheen helemaal niets
       * zei. */
      delen.push(
        `Bij de gepubliceerde koers van ${koers.program} is dat ${euro(rij.saldoWaardeCents!)}. ` +
          `Wat dat van deze aankoop dekt staat er niet bij, want het bedrag op deze pagina is niet gelezen.`,
      );
      delen.push(inwisselZin(koers.scope));
      if (koers.nuance) delen.push(koers.nuance);
      break;
    }
    case "uitgesproken-geen-geldwaarde": {
      const koers = rij.rate!;
      delen.push(
        `De uitgever zegt er zelf over: ${citaat(koers.quote)} Voor ${koers.scope} is dat een ` +
          `uitgesproken nul, dus hier dekken ze niets.`,
      );
      if (koers.nuance) delen.push(koers.nuance);
      delen.push("Er staat hier daarom geen percentage.");
      break;
    }
    case "geen-vaste-waarde": {
      const koers = rij.rate!;
      delen.push(
        `De uitgever zegt er zelf over: ${citaat(koers.quote)} Er is dus geen koers om mee te ` +
          `rekenen — en dat is iets anders dan nul.`,
      );
      if (koers.nuance) delen.push(koers.nuance);
      break;
    }
    case "koers-niet-gelezen": {
      const koers = rij.rate!;
      const host = bronHost(koers.sourceUrl);
      delen.push(
        `Wat ze waard zijn hebben WIJ niet kunnen lezen${host ? ` op ${host}` : ""}. Dat is een gat in ` +
          `onze meting en geen uitspraak van de uitgever, dus er staat hier geen bedrag.`,
      );
      if (koers.nuance) delen.push(koers.nuance);
      break;
    }
    case "programma-onbekend":
      delen.push(
        "Dit programma staat niet in onze koerslijst, dus we weten niet wat een punt hier waard is. " +
          "Onbekend is niet nul.",
      );
      break;
  }

  return delen.join(" ");
}

/** De route, en die mag nooit weg. Zonder deze zin leest een percentage als een
 *  knop in de kassa van de winkel, en die knop bestaat niet: Amex' koers geldt
 *  voor inwisselen achteraf via de app of het online account. */
function inwisselZin(scope: string): string {
  return (
    `Inwisselen gaat via ${scope} — niet in de kassa van deze winkel. Of deze winkel dit programma ` +
    `accepteert, kunnen we hier niet zien.`
  );
}

/** Waar de koers vandaan komt, van wanneer, en wanneer HIJ het saldo invoerde.
 *  Die twee datums zijn allebei nodig en ze zijn niet uitwisselbaar: de eerste
 *  zegt hoe oud ons cijfer is, de tweede hoe oud zijn eigen opgave is. */
export function puntenBron(rij: PuntenRij): string {
  const bits: string[] = [];

  if (rij.rate && rij.rate.soort === "koers") {
    const host = bronHost(rij.rate.sourceUrl);
    /* Het citaat als eigen zin, en de herkomst als tweede. Alles in één zin
     * proppen gaf «Koers: "…". americanexpress.com, gelezen 21 augustus 2026» —
     * een losse hostnaam die aan niets vastzit. */
    bits.push(`Koers: ${citaat(rij.rate.quote)}`);
    bits.push(`Bron${host ? `: ${host}` : ""}, gelezen ${dateNL(rij.rate.gelezenOp)}.`);
  } else if (rij.rate) {
    const host = bronHost(rij.rate.sourceUrl);
    bits.push(
      `Bron${host ? `: ${host}` : ""}${rij.rate.bronDatum ? ` (${rij.rate.bronDatum})` : ""}, ` +
        `gelezen ${dateNL(rij.rate.gelezenOp)}.`,
    );
  }
  if (rij.rate?.hercontrole) bits.push(rij.rate.hercontrole);

  /* Een saldo zonder datum is niet vers. Dat er geen datum bij staat is zelf de
   * mededeling; er stilletjes vandaag van maken zou een saldo van vier maanden
   * oud vers verklaren. */
  if (rij.updatedAt === "") {
    bits.push("Bij dit saldo staat geen datum, dus we weten niet hoe oud het is.");
  } else {
    bits.push(`Saldo door jou ingevoerd op ${dateNL(rij.updatedAt)}.`);
    if (rij.verouderd) {
      bits.push(
        `Dat is meer dan ${VEROUDERD_TEKST} geleden — kijk even na of het nog klopt voordat je erop afgaat.`,
      );
    }
  }
  return bits.join(" ");
}

const VEROUDERD_TEKST = "negentig dagen";

/** De regel onder het hele puntenblok.
 *
 *  DEZE ZIN SPREEKT DE VERKOOPKANT VAN DIT IDEE TEGEN EN STAAT ER DAAROM. Punten
 *  inwisselen levert overal dezelfde koers op, dus er is aan deze kassa geen
 *  voordeel te halen dat er morgen niet ook is: door hier met een andere kaart
 *  te betalen gaat er niets verloren. Dit blok is een herinnering, en het als
 *  arbitrage verkopen zou een winst beloven die er niet is.
 *
 *  Bij een aankoop in vreemde valuta is het sterker dan dat: dan KOST het geld.
 *  Met de kaart van het programma betalen om hier punten te kunnen inwisselen
 *  brengt koersopslag mee over het hele bedrag, terwijl diezelfde punten
 *  volgende week op een euro-aankoop precies evenveel waard zijn. */
export function puntenVoetnoot(currency: string): string {
  const basis =
    "Deze punten gaan niet verloren door hier met een andere kaart te betalen — ze blijven staan. " +
    "Dit is een herinnering, geen voordeel dat je hier moet pakken.";
  const munt = currency.trim().toUpperCase();
  if (munt === "" || munt === "EUR") return basis;
  return (
    `${basis} Deze winkel rekent af in ${munt}: met de kaart van een puntenprogramma betalen om hier ` +
    `punten te kunnen inwisselen kost koersopslag over het hele bedrag, en dezelfde punten zijn ` +
    `volgende week op een euro-aankoop even veel waard.`
  );
}

/** Wat er staat als hij nog geen enkel saldo heeft ingevoerd.
 *
 *  Geen verwijt en geen aansporing: één zin die zegt waar het veld staat. Op een
 *  winkelpagina is dit het enige wat over punten gezegd kan worden zonder een
 *  saldo, en het is meer dan zwijgen — hij weet anders niet dat de extensie dit
 *  kan. */
export function puntenLeegRegel(): string {
  return (
    "Je hebt nog geen puntensaldo ingevoerd. Zet je saldi in de instellingen van LaVega neer, dan " +
    "zie je bij het afrekenen staan wat je hebt liggen."
  );
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
/** Alleen nog gelezen als `row.fee` LEEG is: staat de prijs er wel, dan noemt
 *  grossUnknownCostLine hem zelf en komt deze tak er niet aan te pas. */
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
  /* DE PRIJS STAAT ER WEL, we mogen er alleen niet MEE REKENEN — en die twee
   * dingen liepen hier door elkaar.
   *
   * Een bruto-rij ontstaat op twee manieren: er is geen prijs in de catalogus,
   * óf er is er wel een maar bij dat cijfer staat een voorwaarde die we niet als
   * "vast" kunnen lezen (zie de kaartkosten-tak van buildRow in rank.ts).
   * Alleen de eerste manier rechtvaardigt "dat staat niet in onze gegevens".
   * In de tweede stond dat er tot nu toe ook, en dan sprak de regel zichzelf
   * twee bijzinnen later tegen: gemeten stond er "wat deze kaart kost om te
   * hebben, staat niet in onze gegevens ... Bij de kaartkosten hoort een
   * voorwaarde: dit bedrag komt bovenop een ander product" onder een rij waarvan
   * `row.fee` € 2,00 per maand was.
   *
   * Dus: is de prijs er, dan wordt hij GENOEMD, met erbij waarom hij niet van de
   * opbrengst af gaat. De voorwaarde zelf komt er via metVoorwaarden achteraan
   * en zegt WELKE voorwaarde het is. Het woord netto valt hier nog steeds niet. */
  if (row.fee) {
    return metVoorwaarden(
      row,
      grossLine(row),
      `Dat is het brutobedrag: deze kaart staat bij ons op ${euro(eurosToCents(row.fee.value))} per ` +
        `${row.fee.period}, maar bij dat bedrag hoort een voorwaarde, dus het gaat hier niet van de opbrengst af.`,
    );
  }

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

/* ──────────────────── de aanbiedingen, per bron ───────────────────────────── */

/* WAT HIER NOOIT MAG STAAN, en per geval de fout die eronder ligt:
 *
 *  1. "Je hebt hier 30% korting." Dat is een belofte over de kassa waar hij
 *     staat, en wij hebben alleen gelezen dat de aanbieding op zijn lijst STOND,
 *     op een dag in het verleden. Tussen die dag en nu kan hij verlopen zijn,
 *     opgezegd zijn, of al gebruikt.
 *  2. "Gebruik hem hier." Een Amex-aanbieding moet eerst aan de kaart worden
 *     TOEGEVOEGD, en dat gebeurt bij American Express en niet in deze kassa. Of
 *     hij al toegevoegd is, kunnen we niet zien. Advies dat in de toestand
 *     waarin het verschijnt niet kan werken, is precies wat huisregel 3
 *     verbiedt — dus staat er waar het wél kan.
 *  3. Een lijst zonder de dag waarop hij gelezen is. Die dag is het enige waarop
 *     hij de betrouwbaarheid kan afmeten, net als bij de kaartcijfers en de
 *     puntensaldi.
 *  4. Een lege plek als er niets voor deze winkel is. "Geen aanbieding
 *     gevonden" is een uitspraak die alleen mag als we ook echt gekeken hebben,
 *     en dan hoort erbij WANNEER en in HOEVEEL aanbiedingen.
 *  5. EN, SINDS DE ING WINKEL ERBIJ IS: een regel uit de ING Winkel die klinkt
 *     als een korting bij de winkel waar hij staat. "1.250 punten voor een
 *     JBL-speaker" is een AANKOOP BIJ ING, geen aanbieding bij JBL. Dat is geen
 *     woordkeuze maar een ander soort ding, en daarom heeft `prijsSoort` hier
 *     eigen zinnen in plaats van een ander zelfstandig naamwoord. */

/** De prijs zoals hij op het scherm komt.
 *
 *  BIJ EEN KORTINGBRON STAAT HIJ ER ZOALS DE AANBIEDER HEM SCHRIJFT. Niet
 *  omgerekend, niet samengevat, niet naar euro's vertaald: "30% korting met 500
 *  punten" blijft die zin. Zodra we er een bedrag van maken, staat er een getal
 *  op het scherm dat op die pagina nergens vandaan komt.
 *
 *  BIJ EEN PUNTENBRON WORDT DE ONTBREKENDE BIJBETALING GENOEMD. Dat is de hele
 *  reden dat deze tak bestaat. ING zegt zelf: "Je betaalt de meeste producten
 *  met Punten, plus een bij te betalen bedrag. Soms wissel je alleen Punten in".
 *  Lazen wij geen bedrag, dan weten we niet welke van die twee het is — en het
 *  weglaten van die zin zou het artikel laten lezen als "alleen deze punten",
 *  wat het goedkoper voorstelt dan het misschien is. Onbekend is niet nul. */
function prijsRegel(a: Aanbieding, bron: Bron): string {
  if (bron.prijsSoort !== "punten") return a.prijsTekst;
  const p = a.prijs ?? null;
  if (p === null) {
    /* Komt via de zeef niet voor bij een puntenbron; staat er voor het geval de
     * code verandert, en dan hoort er geen prijs te worden gesuggereerd. */
    return `${a.prijsTekst} (het aantal punten is hier niet uit te lezen).`;
  }
  const punten = `${getal(p.punten)} punten`;
  return p.bij === null
    ? `${punten}. Of je er nog een bedrag bij betaalt, stond er niet bij — dat is niet hetzelfde als niets.`
    : `${punten} plus ${p.bij} bijbetalen.`;
}

/** Waar hij deze aanbieding kan gebruiken, en waar juist niet.
 *
 *  Punt 2 en punt 5 uit de kop hierboven, en ze mogen nooit weg. De tweede helft
 *  van de Amex-zin staat er omdat de lezer met PATRONEN werkt: hij knipt de
 *  kortingsvorm en de einddatum uit de kaart en laat de rest staan. Wat er aan
 *  voorwaarden op die kaart stond in een vorm die wij niet herkennen, staat hier
 *  dus niet — en een korting zonder haar voorwaarden is precies de bewering die
 *  een onvolledige lezing niet kan dragen.
 *
 *  Bij ING is het een ander voorbehoud en het komt uit hun eigen voorwaarden:
 *  bestellen kan alleen via Mijn ING, het aanbod is tijdelijk met op=op, en het
 *  aantal punten per artikel mag ING wijzigen. Die drie staan er omdat ze alle
 *  drie betekenen dat wat wij gelezen hebben vandaag anders kan zijn — en dat is
 *  niet aan de kaart te zien. */
function gebruikRegel(bron: Bron): string {
  if (bron.prijsSoort === "punten") {
    return (
      `Dit bestel je in de ING Winkel via Mijn ING, niet in deze kassa. ING zegt er zelf bij dat het ` +
      `aanbod tijdelijk is en op=op, en dat het aantal punten per artikel kan veranderen.`
    );
  }
  return (
    `Toevoegen aan je kaart en de volledige voorwaarden staan bij ${bron.merk}, niet in deze ` +
    `kassa; of je hem al hebt toegevoegd, kan LaVega niet zien.`
  );
}

/** Wat er van een aanbiedingskaart op het scherm komt. */
export function aanbodRegel(a: Aanbieding, asOf: string, bron: Bron): string {
  const delen: string[] = [prijsRegel(a, bron)];

  if (a.tot !== null && a.tot < asOf) {
    delen.push(`Liep tot ${dateNL(a.tot)}, en die datum is voorbij.`);
  } else if (a.tot !== null) {
    delen.push(`Loopt tot ${dateNL(a.tot)}.`);
  } else if (a.totRuw !== "") {
    /* Een cijferdatum als 05/03/2026 is twee datums tegelijk zolang niet
     * vaststaat of de pagina dd/mm of mm/dd schrijft, en twee maanden verschil
     * in een einddatum is het verschil tussen geldig en verlopen. Dan liever de
     * tekst laten zien en er niet mee rekenen. */
    delen.push(
      `Er stond "${a.totRuw}" bij en dat is niet eenduidig te lezen — ` +
        `LaVega rekent er daarom niet mee.`,
    );
  } else {
    delen.push("Er stond geen einddatum bij. Dat is niet hetzelfde als onbeperkt geldig; we weten het niet.");
  }

  delen.push(gebruikRegel(bron));
  return delen.join(" ");
}

/** Waar deze regel vandaan komt en van wanneer. */
export function aanbodBron(a: Aanbieding, asOf: string, bron: Bron): string {
  const dagen = dagenTussen(a.gelezenOp, asOf);
  const bits = [`Gelezen van ${bron.paginaNaam} op ${dateNL(a.gelezenOp)}.`];
  if (Number.isNaN(dagen)) {
    bits.push("Hoe lang geleden dat is, is hier niet uit te rekenen.");
  } else if (dagen > AANBOD_OUD_NA_DAGEN) {
    bits.push(
      `Dat is ${dagen} dagen geleden — open die pagina nog eens als je erop wilt afgaan, ` +
        `want een aanbieding kan intussen weg zijn.`,
    );
  }
  return bits.join(" ");
}

/** De regel die er staat in plaats van een lijst, met de echte oorzaak.
 *
 *  Zeven toestanden, zeven zinnen, en geen daarvan is "er zijn geen
 *  aanbiedingen". Dat is namelijk in zes van de zeven gevallen onwaar. */
export function aanbodToestandRegel(u: AanbodUitkomst, bron: Bron): string {
  const adres = bron.match;
  switch (u.soort) {
    case "uit":
      return "";
    case "nooit-gelezen":
      return (
        `LaVega heeft ${bron.paginaNaam} nog niet gelezen. Dat gebeurt zodra je die zelf opent bij ` +
        `${bron.merk}; er wordt niets opgehaald.`
      );
    case "lezing-mislukt":
      switch (u.lezing.uitkomst) {
        case "niet-ingelogd":
          return (
            `Op ${dateNL(u.lezing.op)} was je op ${bron.paginaNaam} niet ingelogd — er stond een ` +
            `inlogscherm. Er is niets gelezen en LaVega verzint geen aanbiedingen.`
          );
        case "afgeschermd":
          return (
            `Op ${dateNL(u.lezing.op)} bouwde die pagina een deel van zichzelf op in onderdelen ` +
            `waar LaVega niet in kan kijken. Er is dus niets gelezen — niet omdat er niets stond, ` +
            `maar omdat het achter een afscherming stond die alleen de pagina zelf kan openen. Wat ` +
            `er eerder is gelezen staat er nog, met zijn eigen datum.`
          );
        case "geen-aanbiedingenblok":
          return (
            `Op ${dateNL(u.lezing.op)} heeft LaVega op dat adres geen aanbiedingenblok gevonden. ` +
            `Dat is iets anders dan dat er niets stond: het kan het adres zijn (LaVega leest ` +
            `${adres}) of de pagina was nog aan het opbouwen. Welke van de twee, weet LaVega niet.`
          );
        case "uitgesproken-geen-aanbiedingen":
          return (
            `Op ${dateNL(u.lezing.op)} zei ${bron.paginaNaam} zelf ${citaat(u.lezing.citaat)} ` +
            `Er stond dus niets klaar — dat is een uitgesproken nul en geen gat in onze meting.`
          );
        case "blok-zonder-kaarten":
          return (
            `Op ${dateNL(u.lezing.op)} stond het blok er wel, maar LaVega heeft er geen enkele regel ` +
            `uit kunnen lezen. De pagina ziet er anders uit dan de lezer verwacht. Wat er eerder is ` +
            `gelezen staat er nog, met zijn eigen datum — het is niet bijgewerkt.`
          );
        /* "gelezen" komt hier niet: aanbodVoorWinkel stuurt die tak niet deze
         * kant op. Staat er toch, dan is de code veranderd en hoort er geen
         * geruststellende zin te staan. */
        default:
          return `De laatste lezing van ${dateNL(u.lezing.op)} is niet te duiden.`;
      }
    case "te-oud":
      return Number.isNaN(u.dagen)
        ? `De laatste lezing van ${bron.paginaNaam} draagt geen leesbare datum, dus hoe oud die is weten we niet. LaVega zet hem hier daarom niet neer.`
        : `${hoofdletter(bron.paginaNaam)} is voor het laatst gelezen op ${dateNL(u.op)}, ${u.dagen} dagen geleden. ` +
            `Na ${AANBOD_TE_OUD_NA_DAGEN} dagen zet LaVega dat aan een kassa niet meer neer: er kan intussen ` +
            `iets weg zijn en dat zouden we hier niet zien. Open die pagina om te verversen.`;
    case "winkel-zonder-domein":
      return (
        `Van "${u.host}" kan LaVega geen webadres afleiden om op te vergelijken, dus er wordt hier ` +
        `niets aan gekoppeld. In het LaVega-venster staat je hele lijst.`
      );
    case "geen-voor-deze-winkel":
      if (u.totaal === 0) {
        return `In wat LaVega op ${dateNL(u.op)} van ${bron.paginaNaam} las, stond geen enkele regel.`;
      }
      /* BIJ EEN PUNTENBRON IS DIT DE NORMALE UITKOMST EN NIET EEN TEKORT, en dat
       * hoort er te staan. Een productkaart in de winkel van ING wijst naar ING
       * en niet naar de fabrikant, dus er is bijna nooit een webadres om op te
       * koppelen. Zonder deze zin zou hij denken dat de lezer iets mist; met
       * deze zin weet hij waar zijn lijst dan wél staat. */
      return bron.prijsSoort === "punten"
        ? `LaVega las op ${dateNL(u.op)} ${u.totaal} regel(s) in de ING Winkel, en geen daarvan hoort ` +
            `bij deze winkel. Dat is ook niet te verwachten: wat in de ING Winkel staat, koop je bij ING ` +
            `en niet hier. Je hele lijst staat in het LaVega-venster.`
        : `In de ${u.totaal} aanbiedingen die LaVega op ${dateNL(u.op)} van ${bron.paginaNaam} las, ` +
            `staat er geen voor deze winkel. De koppeling gaat op het webadres van de winkel en niet op de ` +
            `naam — een aanbieding zonder webadres blijft hier dus weg, en staat wel in het LaVega-venster.`;
    case "gevonden":
      return "";
  }
}

function hoofdletter(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** De kop boven het blok bij een winkel. */
export function aanbodKopWinkel(bron: Bron): string {
  return bron.prijsSoort === "punten" ? "In de ING Winkel" : `${bron.merk}-aanbiedingen`;
}

/** En in het werkbalkvenster, waar de hele lijst staat en niet de selectie. */
export function aanbodKopLijst(bron: Bron): string {
  return bron.prijsSoort === "punten" ? "Jouw ING Winkel" : `Jouw ${bron.merk}-aanbiedingen`;
}

/** De zin onder de lijst in het werkbalkvenster en in het optiescherm: wat er
 *  van die pagina meekomt en wat niet. Staat NIET in het paneel op de
 *  winkelpagina — daar hoort een antwoord en geen verantwoording, en de plek
 *  waar hij die vraag stelt is het scherm waar hij de schakelaar omzet. */
export function aanbodGrensRegel(bron: Bron): string {
  return (
    `Van ${bron.paginaNaam} komt alleen ${bron.watWel.join(", ")} mee. ` +
    `Niet ${bron.watNiet.join(", niet ")}. Er gaat niets naar een server.`
  );
}

/** De twee regels in de strook op zijn eigen pagina.
 *
 *  ELKE UITKOMST KRIJGT EEN ZIN, ook de geslaagde. Dit is het moment waarop de
 *  extensie zijn ingelogde accountpagina leest; dat hoort zichtbaar te zijn, en
 *  wat er NIET gelezen is hoort er in dezelfde adem bij te staan.
 *
 *  Bij "niet ingelogd" staat er een advies dat op DEZE pagina uit te voeren is —
 *  inloggen en herladen. Dat is de enige toestand waarin een advies hier kan
 *  werken; bij de andere zou "probeer het opnieuw" een lus zijn. */
export function aanbodStrook(
  lezing: Lezing,
  namen: readonly string[],
  bron: Bron,
): { regel: string; noot: string } {
  const noot = aanbodGrensRegel(bron);
  /* Bij een puntenbron zijn dit ARTIKELnamen en geen winkelnamen. De zin noemt
   * ze daarom anders; hetzelfde woord zou hier van een productlijst een lijst
   * winkels maken. */
  const wat = bron.prijsSoort === "punten" ? "artikel" : "aanbieding";
  const watMv = bron.prijsSoort === "punten" ? "artikelen" : "aanbiedingen";

  switch (lezing.uitkomst) {
    case "gelezen": {
      const lijst = namen.slice(0, 6).join(", ");
      const rest = namen.length > 6 ? ` en ${namen.length - 6} andere` : "";
      return {
        regel:
          lezing.aantal === 1
            ? `LaVega heeft één ${wat} van deze pagina gelezen: ${lijst}.`
            : `LaVega heeft ${lezing.aantal} ${watMv} van deze pagina gelezen: ${lijst}${rest}.`,
        noot,
      };
    }
    case "niet-ingelogd":
      return {
        regel:
          `Je bent hier niet ingelogd — LaVega ziet een inlogscherm. Er is niets gelezen en niets ` +
          `opgeslagen. Log in en herlaad de pagina.`,
        noot,
      };
    case "uitgesproken-geen-aanbiedingen":
      /* Dit is de keerzijde van "onbekend is nooit nul". De pagina zegt het
       * zélf, dus dit is een bekende nul en geen mislukte lezing — en dan hoort
       * er niet te staan dat LaVega niets kon lezen, want dat zou een antwoord
       * van de aanbieder tot een fout van ons maken. Het citaat staat erbij
       * zodat te zien is waar de nul vandaan komt. */
      return {
        regel:
          `Deze pagina zegt zelf ${citaat(lezing.citaat)} Er staat dus niets voor je klaar; ` +
          `dat is een antwoord en geen mislukte lezing. Er is niets opgeslagen.`,
        noot,
      };
    /* DEZE ZIN IS OP 24 AUGUSTUS 2026 HERSCHREVEN, en waarom staat hier omdat de
     * oude versie de eigenaar een ronde gekost heeft.
     *
     * Er stond: "LaVega vindt op deze pagina geen artikelen en heeft dus niets
     * gelezen. Het adres dat LaVega leest is https://mijn.ing.nl/punten*." Hij
     * stond op zijn eigen ingelogde winkelpagina, mét artikelen. Twee dingen
     * waren mis. Het eerste is een BEWERING OVER ZIJN PAGINA die wij niet kunnen
     * doen: dat wij niets vinden zegt iets over onze lezer, niet over de winkel
     * van ING. Het tweede is de wijzende vinger: door alleen het adres te noemen
     * kreeg hij de ene oorzaak aangeboden die er die dag NIET was — en dat was
     * uitgerekend de oorzaak van de rónde ervoor, dus hij klonk plausibel.
     *
     * Wat er nu staat is wat er vaststaat (wij hebben niets gevonden) plus de
     * twee oorzaken die daar even goed op passen, met erbij dat we niet weten
     * welke. Een derde — de catalogus in een iframe — staat er niet: die is
     * gemeten als mogelijk maar niet als waarschijnlijk, en drie oorzaken in een
     * strook van 340 pixels leest niemand meer. */
    case "geen-aanbiedingenblok":
      return {
        regel:
          `LaVega heeft hier geen blok met ${watMv} gevonden — ook niet in de onderdelen die deze ` +
          `pagina zelf opbouwt. Dat betekent niet dat er niets staat. Het kan het adres zijn ` +
          `(LaVega leest ${bron.match}) of de pagina was nog aan het opbouwen; welke van de twee, ` +
          `weet LaVega niet. Er is niets gelezen en niets opgeslagen.`,
        noot,
      };
    /* De tegenhanger, en het verschil met de zin hierboven is een MEETBAAR
     * verschil en geen nuance: daar paste geen enkele knoop op de lijst, hier
     * pasten er wel. Dat is precies wat er staat. */
    case "afgeschermd":
      return {
        regel:
          `Deze pagina bouwt een deel van zichzelf op in onderdelen waar LaVega niet in kan ` +
          `kijken — dicht, of nog niet gebouwd toen LaVega keek. Er is dus niets gelezen en niets ` +
          `opgeslagen; niet omdat er niets staat, maar omdat het daar niet te lezen valt.`,
        noot,
      };
    case "blok-zonder-kaarten":
      return {
        regel:
          `Het blok staat er wel — LaVega vond hier knopen die erop lijken — maar er kwam geen ` +
          `enkel ${wat} uit. De pagina ziet er anders uit dan de lezer verwacht` +
          /* BIJ EEN PUNTENBRON IS ER EEN TWEEDE OORZAAK, en die verzwijgen zou
           * hier het duurste zijn: LaVega laat een kaart in zijn geheel vallen
           * zodra er iets in staat dat op zijn puntensaldo lijkt. Dat is de
           * grens die onder het vinkje beloofd is, dus als hij hier bijt hoort
           * hij genoemd te worden en niet weggemoffeld als "de pagina is
           * veranderd". Welke van de twee het was, weten we niet — dat staat er
           * dan ook zo. Bij Amex bestaat die zeef niet en staat deze zin er
           * daarom niet. */
          (bron.prijsSoort === "punten"
            ? `, of LaVega heeft de kaart laten vallen omdat er iets in stond dat op je ` +
              `puntensaldo leek; welke van de twee, weet LaVega niet`
            : "") +
          `. Er is niets opgeslagen en een eerdere lijst is niet bijgewerkt.`,
        noot,
      };
  }
}
