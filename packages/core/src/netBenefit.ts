/* WAT ER OVERBLIJFT ALS DE KAART ZELF OOK GELD KOST.
 *
 * Zijn woorden, 21 augustus: "als een kaart 5 euro per maand kost en ons 3
 * oplevert gaan we er op achteruit." Elke rangschikking in deze app rekende tot
 * nu toe aan de OPBRENGST — een lagere wisselopslag, een hogere rente, een
 * gratis opname — en niet aan wat het product kost om te hebben. Dat is precies
 * de helft van de rekening, en de helft die je niet ziet is degene die je pakt.
 *
 * DRIE DINGEN LIGGEN HIER VAST, en alle drie omdat ze elders al fout zijn gegaan:
 *
 *  1. DE DRIE TOESTANDEN STAAN IN HET TYPE, niet in een comment en niet in een
 *     boolean ernaast. Netto (kosten bekend), bruto (kosten onbekend) en
 *     netto-niet-positief (geen aanbeveling) zijn drie ANDERE dingen om op een
 *     scherm te zetten, en de variant met onbekende kosten heeft daarom geen
 *     veld dat `netCents` heet. Zo kan een aanroeper een brutobedrag niet per
 *     ongeluk als netto presenteren — dat is de fout die dit bestand bestaat om
 *     onmogelijk te maken, niet om te ontmoedigen.
 *
 *  2. DE HORIZON IS EEN PARAMETER, want zonder horizon is 14 − 16,99 een getal
 *     dat niets betekent. Een voordeel van € 14 op een overboeking van € 1.000
 *     is EENMALIG; € 16,99 per maand is TERUGKEREND. Die twee mag je niet van
 *     elkaar aftrekken zonder te zeggen over welke periode. Bij een eenmalig
 *     voordeel is de ondergrens één hele factureringsperiode
 *     (`MIN_HORIZON_MONTHS`, en de rekensom staat in `feeCostOverMonths`): wie
 *     een kaart opent voor één reis betaalt die maand volledig. Bij een
 *     terugkerend voordeel is er niets te overbruggen — dan staan opbrengst en
 *     kosten al in dezelfde eenheid en wordt er schoon afgetrokken.
 *
 *  3. ONBEKEND IS GEEN NUL. Een kaart waarvan geen bron de prijs noemt wordt
 *     niet stilzwijgend als gratis behandeld (dan zou hij elke rangschikking
 *     winnen) en ook niet verzwegen (dan zie je hem nooit). Hij komt door met
 *     zijn brutobedrag en met de reden waarom er geen netto bij staat. Het woord
 *     "netto" komt in die tekst niet voor; de renderer die er een zin van maakt
 *     (`netBenefitDescriptionSentence` in TravelBlock.tsx) heeft daar een test
 *     op staan.
 *
 * Puur, zoals alles in packages/core: geen I/O, geen klok. De periode komt als
 * parameter binnen, niet uit een `new Date()`.
 */
import type { FeeAmount, FeePeriod, ProductFee } from "./accountCosts.js";
import { FEE_PERIOD_MONTHS, feeCostOverMonths } from "./accountCosts.js";

/** Minder dan één factureringsperiode kun je niet kopen. Wie een kaart opent voor
 *  een reis van een week betaalt de hele maand — of het hele jaar, als het
 *  product per jaar wordt afgerekend. Zie `feeCostOverMonths`, dat is waar dit
 *  getal in de rekensom terechtkomt. */
export const MIN_HORIZON_MONTHS = 1;

/* ─────────────────────────────────────────────────── wat een product kost */

/** Waarom er geen prijs is. De reden hoort erbij: "geen bron noemt hem" en "de
 *  genoemde prijs geldt bovenop een ander product" zijn twee verschillende
 *  problemen met twee verschillende oplossingen, en een melding die de echte
 *  oorzaak niet noemt kan de lezer niet verder helpen. */
export type HoldingCostUnknownReason =
  /** Geen enkele bron in de catalogus prijst dit product. */
  | "no-source"
  /** De bron noemt wél een bedrag, maar het is de prijs van dit product BINNEN
   *  een ander product ("bovenop de € 3,45 per maand van Rabo Standaard"). Wat
   *  het kost om dit te openen is dus HOGER dan het genoemde bedrag, en hoeveel
   *  hoger staat er niet. Het genoemde bedrag doorgeven zou een te lage prijs
   *  zijn, wat erger is dan geen prijs. */
  | "needs-another-product";

export type KnownHoldingCost = {
  kind: "known";
  amount: FeeAmount;
  /** "stated" = een document noemt dit bedrag. "already-held" = hij heeft het
   *  product al, dus de MARGINALE kosten zijn nul. Zie `marginalHoldingCost`:
   *  het is dezelfde nul in de rekensom en een heel ander verhaal op het scherm. */
  why: "stated" | "already-held";
  sourceUrl: string | null;
  /** De datum die het brondocument noemt. Null bij "already-held": daar komt de
   *  nul niet uit een document maar uit zijn eigen situatie. */
  asOf: string | null;
};

export type UnknownHoldingCost = {
  kind: "unknown";
  reason: HoldingCostUnknownReason;
};

export type HoldingCost = KnownHoldingCost | UnknownHoldingCost;

/** Een bedrag van nul in de eenheid waarin het niets kost. Per maand, want dat is
 *  de kortste periode die we kennen: nul keer wat dan ook blijft nul, maar de
 *  eenheid moet ergens staan omdat `FeeAmount` er zonder niet bestaat — en dat is
 *  bewust zo (zie accountCosts.ts). */
const NOTHING_PER_MONTH: FeeAmount = {
  cents: 0,
  period: "maand",
  perYearCents: 0,
  perYearDerived: false,
};

/** DE VALSTRIK, en dit is het verschil tussen goed en fout advies.
 *
 *  Een kaart die hij AL HEEFT heeft zijn maandprijs al betaald. Voor de vraag
 *  "waarmee betaal ik op deze reis" zijn die kosten voor hem nul: ze lopen door
 *  of hij de kaart meeneemt of niet. Voor een kaart die hij moet OPENEN zijn ze
 *  dat niet — daar komt de prijs er echt bij.
 *
 *  Zonder dit onderscheid gebeurt er precies één van twee dingen, en beide zijn
 *  fout. Reken je de maandprijs ook bij zijn eigen kaart, dan verliest zijn eigen
 *  ABN-creditcard (€ 2,55 per maand) van elke kaart waarvan we de prijs niet
 *  kennen, en stuurt de app hem een nieuwe kaart openen in om kosten te
 *  vermijden die hij toch al maakt. Reken je hem bij geen van beide, dan is de
 *  hele opdracht weg.
 *
 *  Het draagt bovendien zijn gelijkspelregel: omdat een kaart die hij heeft
 *  altijd een BEKENDE nul is, kan de regel "bij gelijke kosten wint wat we kunnen
 *  aantonen" zijn eigen kaart nooit naar beneden duwen. Die twee regels vechten
 *  dus niet, en dat is geen toeval maar het gevolg van deze functie. */
export function marginalHoldingCost(cost: HoldingCost, held: boolean): HoldingCost {
  if (!held) return cost;
  return {
    kind: "known",
    amount: NOTHING_PER_MONTH,
    why: "already-held",
    sourceUrl: null,
    asOf: null,
  };
}

/** De kosten van één catalogusproduct, uit de rij die `accountFees` ervan maakte.
 *
 *  `null` is "de catalogus prijst dit product niet" en wordt `no-source` — niet
 *  nul. Een rij die niet op zichzelf geprijsd is wordt `needs-another-product`
 *  om de reden die in `HoldingCostUnknownReason` staat: een te laag bedrag is
 *  erger dan geen bedrag, want een te laag bedrag rekent door. */
export function holdingCostOfProduct(fee: ProductFee | null | undefined): HoldingCost {
  if (!fee) return { kind: "unknown", reason: "no-source" };
  if (!fee.pricedOnItsOwn) return { kind: "unknown", reason: "needs-another-product" };
  return {
    kind: "known",
    amount: fee.amount,
    why: "stated",
    sourceUrl: fee.sourceUrl,
    asOf: fee.asOf,
  };
}

/* ─────────────────────────────────────────────────── wat een product oplevert */

/** DE OPBRENGST, en de vorm ervan is geen decoratie maar bepaalt de rekensom.
 *
 *  · `one-off`: één keer geld. Een goedkopere overboeking, een goedkopere opname,
 *    een reis. Hier moet de horizon bij, want de kosten lopen door en de
 *    opbrengst niet.
 *  · `recurring`: elke periode geld. Cashback per maand, rente per jaar. Hier
 *    hoeft niets overbrugd te worden: opbrengst en kosten staan in dezelfde
 *    eenheid en gaan schoon van elkaar af — zolang je ze niet per ongeluk in
 *    twee verschillende eenheden zet, en dat is wat `commonPeriod` voorkomt. */
export type Benefit =
  | { kind: "one-off"; cents: number }
  | { kind: "recurring"; cents: number; period: FeePeriod };

/* ─────────────────────────────────────────────────── het antwoord */

/** Over welke periode er gerekend is. Hoort bij het antwoord en niet in de
 *  toelichting, want zonder deze periode is het netto­bedrag niet te controleren
 *  en dus niet te vertrouwen. */
export type NetBasis =
  /** Een eenmalige opbrengst tegen de kosten van `months` maanden aanhouden. */
  | {
      kind: "one-off";
      months: number;
      /** Hoeveel hele factureringsperiodes daarvoor betaald worden. */
      periodsCharged: number;
      /** true als de horizon korter was dan één periode en er dus toch een hele
       *  is gerekend. Het scherm hoort dit te noemen — de gebruiker moet kunnen
       *  zien over welke periode we rekenen. */
      flooredToMinimum: boolean;
      costPeriod: FeePeriod;
    }
  /** Een terugkerende opbrengst tegen terugkerende kosten, beide per `period`. */
  | {
      kind: "recurring";
      period: FeePeriod;
      /** true als het bedrag voor deze periode door ons is omgerekend (× 12) en
       *  niet zo in een document staat. Nooit gedeeld — zie `commonPeriod`. */
      benefitDerived: boolean;
      costDerived: boolean;
    };

type Priced = {
  grossCents: number;
  costCents: number;
  basis: NetBasis;
  benefit: Benefit;
  cost: KnownHoldingCost;
};

/** DE DRIE TOESTANDEN. Zie punt 1 in de kop van dit bestand: het verschil zit in
 *  het type, en `gross-cost-unknown` heeft geen `netCents` omdat er geen netto
 *  IS. Een aanroeper die netto wil tonen moet dus eerst op `kind` kijken, en dat
 *  is de bedoeling. */
export type NetBenefit =
  /** Kosten bekend en er blijft iets over. Dit is het enige geval waarin het
   *  woord "netto" op het scherm mag staan. */
  | ({ kind: "net"; netCents: number } & Priced)
  /** Kosten bekend en er blijft niets over. GEEN AANBEVELING — zijn beslissing:
   *  een kaart die € 5 per maand kost en € 3 oplevert is achteruit, en dat moet
   *  hij kunnen zien staan in plaats van zelf te moeten uitrekenen. Daarom
   *  draagt deze variant het negatieve bedrag mee in plaats van weg te vallen. */
  | ({ kind: "no-recommendation"; netCents: number } & Priced)
  /** Kosten onbekend. Alleen het brutobedrag, met de reden erbij. Geen
   *  `netCents`, geen `costCents`: er is niets om ze uit te rekenen, en een veld
   *  dat er niet is kan niet per ongeluk als nul worden gelezen. */
  | { kind: "gross-cost-unknown"; grossCents: number; benefit: Benefit; cost: UnknownHoldingCost };

/** De grofste van twee eenheden. NOOIT de fijnste: van een jaarprijs van € 270
 *  een maandprijs van € 22,50 maken is een bedrag verzinnen dat in geen enkel
 *  document staat, en het maakt een jaarkaart twaalf keer zo goedkoop als hij is.
 *  Omhoog rekenen (× 12) is wél te verdedigen en is wat accountCosts.ts met
 *  `perYearCents` al doet — met `perYearDerived` erbij, zodat het scherm kan
 *  zeggen dat het onze rekensom is. */
function commonPeriod(a: FeePeriod, b: FeePeriod): FeePeriod {
  return a === "jaar" || b === "jaar" ? "jaar" : "maand";
}

/** Een terugkerend bedrag in een andere eenheid. Alleen omhoog; zie hierboven. */
function inPeriod(cents: number, from: FeePeriod, to: FeePeriod): number {
  if (from === to) return cents;
  return cents * (FEE_PERIOD_MONTHS[to] / FEE_PERIOD_MONTHS[from]);
}

/** WAT ER OVERBLIJFT, in de toestand die erbij hoort.
 *
 *  `horizonMonths` geldt alleen voor een eenmalige opbrengst — daar moet de
 *  periode van buiten komen omdat er in de opbrengst zelf geen periode zit. Bij
 *  een terugkerende opbrengst is de periode al bekend en wordt de horizon niet
 *  gebruikt: hem daar toch in verwerken zou een maandelijkse cashback met een
 *  aantal maanden vermenigvuldigen én de kosten, wat hetzelfde antwoord oplevert
 *  en alleen de kans op een factorfout toevoegt. */
export function netBenefit(input: {
  benefit: Benefit;
  cost: HoldingCost;
  /** Alleen bij een eenmalige opbrengst. Ondergrens `MIN_HORIZON_MONTHS`. */
  horizonMonths?: number;
}): NetBenefit {
  const { benefit, cost } = input;
  if (cost.kind === "unknown") {
    // Geen kosten om mee te rekenen, dus ook geen netto. Het brutobedrag gaat
    // door met de reden erbij; onbekend is geen nul, maar ook geen reden om de
    // kaart te verzwijgen.
    return { kind: "gross-cost-unknown", grossCents: benefit.cents, benefit, cost };
  }

  if (benefit.kind === "recurring") {
    const period = commonPeriod(benefit.period, cost.amount.period);
    const grossCents = inPeriod(benefit.cents, benefit.period, period);
    const costCents = inPeriod(cost.amount.cents, cost.amount.period, period);
    return decide({
      grossCents,
      costCents,
      benefit,
      cost,
      basis: {
        kind: "recurring",
        period,
        benefitDerived: benefit.period !== period,
        costDerived: cost.amount.period !== period,
      },
    });
  }

  // Een ontbrekende of onzinnige horizon valt op de ondergrens terug in plaats van
  // op nul: nul maanden kaartkosten is de fout die dit bestand voorkomt.
  //
  // De GEVRAAGDE horizon gaat naar `feeCostOverMonths` en niet de al opgehoogde,
  // want die functie is degene die de ondergrens toepast én rapporteert. Toen hier
  // eerst naar één maand werd afgerond en dat getal doorgegeven, kwam
  // `flooredToOnePeriod` als false terug voor een reis van een week — de rekensom
  // was goed, maar het scherm kon niet meer zeggen dat er een hele maand gerekend
  // was, en dat is precies het stuk dat de gebruiker nodig heeft.
  const asked = Number.isFinite(input.horizonMonths)
    ? (input.horizonMonths as number)
    : MIN_HORIZON_MONTHS;
  const months = Math.max(MIN_HORIZON_MONTHS, asked);
  const over = feeCostOverMonths(cost.amount, asked);
  return decide({
    grossCents: benefit.cents,
    costCents: over.cents,
    benefit,
    cost,
    basis: {
      kind: "one-off",
      months,
      periodsCharged: over.periodsCharged,
      flooredToMinimum: over.flooredToOnePeriod,
      costPeriod: cost.amount.period,
    },
  });
}

/** Netto nul is net zo goed geen aanbeveling als netto negatief. Zijn beslissing,
 *  en de reden is dat het werk kost: een rekening openen om precies uit te komen
 *  is een stap zonder uitkomst. */
function decide(p: Priced): NetBenefit {
  const netCents = p.grossCents - p.costCents;
  return netCents > 0
    ? { kind: "net", netCents, ...p }
    : { kind: "no-recommendation", netCents, ...p };
}

/** Mag dit als aanbeveling op het scherm? Netto positief mag; netto nul of
 *  negatief niet. Een brutobedrag mag alleen als er überhaupt iets te winnen
 *  valt: een "voordeel" van nul met onbekende kosten is geen aanbeveling maar
 *  ruis, en de onbekende kosten kunnen er alleen maar van af. */
export function isRecommendation(b: NetBenefit): boolean {
  if (b.kind === "net") return true;
  if (b.kind === "gross-cost-unknown") return b.grossCents > 0;
  return false;
}

/** Waarop gerangschikt wordt. NIET geëxporteerd, en dat is de bedoeling: dit is
 *  het ene getal waarin netto en bruto door elkaar lopen, en dat mag alleen in
 *  een vergelijking bestaan en nooit op een scherm. Wie wil sorteren gebruikt
 *  `compareNetBenefit`; wie wil tonen gebruikt `kind`. */
function rankValue(b: NetBenefit): number {
  return b.kind === "gross-cost-unknown" ? b.grossCents : b.netCents;
}

/** DE RANGSCHIKKING, hoogste opbrengst eerst.
 *
 *  Drie regels, in deze volgorde:
 *   1. een aanbeveling gaat voor iets wat geen aanbeveling is. Een kaart waarop
 *      je achteruitgaat hoort niet bovenaan, ook niet als het bedrag er hoog
 *      uitziet;
 *   2. het hoogste bedrag eerst;
 *   3. bij GELIJKE waarde: netto-bekend boven bruto-onbekend. Van de eerste weten
 *      we dat het klopt; van de tweede weten we dat er nog iets af kan gaan. Bij
 *      gelijke stand kiezen we dus wat we kunnen aantonen — dezelfde regel die
 *      `marketCardOffers` hanteert voor een onvoorwaardelijk tarief tegenover een
 *      tarief met een plafond, en om dezelfde reden.
 *
 *  Merk op dat een gelijke stand tussen netto en bruto GEEN echte gelijke stand
 *  is: het brutobedrag is een bovengrens. Dat is precies waarom regel 3 die kant
 *  op valt. */
export function compareNetBenefit(a: NetBenefit, b: NetBenefit): number {
  return (
    Number(isRecommendation(b)) - Number(isRecommendation(a)) ||
    rankValue(b) - rankValue(a) ||
    Number(a.kind === "gross-cost-unknown") - Number(b.kind === "gross-cost-unknown")
  );
}

/** Dezelfde rangschikking op een lijst van iets anders — een kaart, een route.
 *  Stabiel: gelijke rijen houden hun oorspronkelijke volgorde, zodat een lijst
 *  niet herschikt tussen twee renders. Dat leest als ruis, en het is precies wat
 *  `accountFees` en `marketCardOffers` om dezelfde reden ook doen. */
export function rankByNetBenefit<T>(items: readonly T[], of: (item: T) => NetBenefit): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((x, y) => compareNetBenefit(of(x.item), of(y.item)) || x.i - y.i)
    .map((x) => x.item);
}

/* ─────────────────────────────────────────────────── in kind vorm */

/** WAT ER TE ZEGGEN VALT, zonder het te zeggen. Core levert de feiten waaruit de
 *  ene zin wordt opgebouwd — geen Nederlands, geen locale — en de view rendert
 *  hem. Zie `holdSentence` (Facturen.tsx) en `fxWhySentence` (Valuta.tsx) voor
 *  hetzelfde patroon elders in de app.
 *
 *  DE DRIE VARIANTEN VOLGEN NetBenefit 1-op-1: `basis` en `benefit` reizen mee
 *  ongewijzigd zodat de renderer dezelfde periode- en ondergrensregels kan
 *  toepassen die hier vroeger stonden (`periodWord`, `horizonWords`,
 *  `floorNote`) zonder dat core ze zelf hoeft te kennen. `alreadyHeld` is het
 *  enige stuk classificatie dat de renderer nodig heeft en zelf niet kan
 *  herleiden: of "extra kosten" dan wel "kosten voor het product" moet staan. */
export type NetBenefitDescription =
  | {
      kind: "gross-cost-unknown";
      grossCents: number;
      benefit: Benefit;
      reason: HoldingCostUnknownReason;
    }
  | {
      kind: "net";
      grossCents: number;
      costCents: number;
      netCents: number;
      basis: NetBasis;
      alreadyHeld: boolean;
    }
  | {
      kind: "no-recommendation";
      grossCents: number;
      costCents: number;
      netCents: number;
      basis: NetBasis;
      alreadyHeld: boolean;
    };

/** HET ANTWOORD, GECLASSIFICEERD. Zie punt 1 in de kop van dit bestand: het
 *  verschil zit in het type. Voorheen bouwde deze functie de Nederlandse zin
 *  zelf; nu levert ze de feiten en bouwt de view (`netBenefitDescriptionSentence`
 *  in TravelBlock.tsx) de zin per taal. Het woord "netto" mag ALLEEN in de
 *  renderer voorkomen voor de twee varianten waarin de kosten bekend zijn — dat
 *  is nu een tekst-regel van de view, niet meer een test op deze functie. */
export function describeNetBenefit(b: NetBenefit): NetBenefitDescription {
  if (b.kind === "gross-cost-unknown") {
    return {
      kind: "gross-cost-unknown",
      grossCents: b.grossCents,
      benefit: b.benefit,
      reason: b.cost.reason,
    };
  }
  const alreadyHeld = b.cost.why === "already-held";
  return b.kind === "net"
    ? {
        kind: "net",
        grossCents: b.grossCents,
        costCents: b.costCents,
        netCents: b.netCents,
        basis: b.basis,
        alreadyHeld,
      }
    : {
        kind: "no-recommendation",
        grossCents: b.grossCents,
        costCents: b.costCents,
        netCents: b.netCents,
        basis: b.basis,
        alreadyHeld,
      };
}
