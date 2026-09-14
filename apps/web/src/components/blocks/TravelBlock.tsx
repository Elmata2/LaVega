import { useEffect, useRef, useState } from "react";
import type {
  Account,
  Tx,
  LearnedFact,
  RateBenchmark,
  TravelPlan,
  Journey,
  JourneyWhy,
  SpendWhy,
  CatalogueEntryLike,
  WithdrawOption,
  CardOffer,
  WithdrawAdvice,
  FeeAmount,
  HoldingCost,
  NetBasis,
  NetBenefit,
} from "@lavega/core";
import {
  planTravel,
  makeFact,
  costOnReferenceSpend,
  netBenefit,
  payHeadline,
  TRAVEL_AGENT,
  TRAVEL_REFERENCE_SPEND,
  describeWithdrawalFee,
  TRAVEL_REFERENCE_WITHDRAWAL,
  TRAVEL_SMALL_WITHDRAWAL,
} from "@lavega/core";
import catalogueFile from "../../../../../docs/catalog/catalog.json";
import { formatEuroIn, formatDate } from "../../format.js";
import { useAppLocale, pick, readAppLocale } from "../../appLocale.js";
import { optimiseCopy, formatPercentIn, type TravelCopy } from "../../copy/optimise.js";
import type { Locale } from "../../locale.js";
import Module from "../Module.js";
import ToonMeer from "../ToonMeer.js";

/* A self-contained block: everything it needs arrives as props and it owns only
 * its own draft state. That made it the first MODULAR block, and it is now one
 * module among the rest on the homescreen grid.
 *
 * It leads with ONE answer — `plan.headline`, priced in euros — because three
 * sections (Bewaren / Wisselen / Betalen) were three answers the owner had to
 * reconcile himself. The ranked JOURNEYS and those three sections are still all
 * here; they just sit behind "waarom", as the reasoning under the answer.
 *
 * ── HET OVERZICHT IS EXACT EEN SAMENVATTING (app review 4, punten 12 t/m 16) ──
 *
 * Zijn woorden: "this overview should be exactly a summary." Wat vooraan staat is
 * daarmee een gesloten lijst van twee antwoorden — WAARMEE BETAAL JE en WAAR KUN
 * JE PINNEN — plus wat die twee kosten. Al het andere staat in één <ToonMeer>
 * eronder: de bronregel, de uitleg over de catalogus, "vandaag", de afgevallen
 * kaart, alle routes, de drie stappen, de opnamedetails en de knop
 * "voorwaarden verversen".
 *
 * Wat er NIET is opgevouwen, en waarom niet:
 *  · DE KAARTPRIJS (`Kaartkosten`). Een kaart die hij moet openen brengt zijn
 *    eigen maandnota mee; "Betaal met X" zonder die nota is geen samenvatting
 *    maar een half advies. De prijs hoort bij het antwoord, niet bij de
 *    onderbouwing.
 *  · DE VOORWAARDE BIJ HET TARIEF dat de kop noemt (`plan.pay.note`, een door
 *    `fxCaveat` HERKENDE limiet). Revolut is waarom: zijn 0% geldt alleen binnen
 *    € 1.000 per maand, en "dat kost je niets op € 1.000" is zonder die zin een
 *    voorwaardelijk tarief dat als absoluut op het scherm staat.
 *  · DE OORZAAK als er niets te vergelijken valt (`termsHeadline`). Die is één
 *    zin en hij begrenst het antwoord; de hele melding mét knop zit wel in de
 *    uitklap.
 * De vrije tekst van een geleerd feit (`bestJourney.note`) gaat WEL naar achteren,
 * en dat is precies het verschil: dat veld draagt de bronregel die hij aanwees
 * ("1,4% koersopslag Bron: bank.nl-vergelijking, laatst gecontroleerd …"). Er is
 * geen manier om daar met zekerheid een voorwaarde uit een citaat te vissen — dus
 * wordt er niet op de tekst gesplitst maar op het VELD: herkende limiet vooraan,
 * vrije brontekst in de uitklap. Zie ook de opmerking bij die regel. */

/* THE PRODUCT CATALOGUE, BUNDLED AT BUILD TIME.
 *
 * Same bargain as the savings rates in `catalogue-rates.ts`, and for the same
 * reason: nothing visual and nothing factual is ever fetched at runtime,
 * because a request tells the server on the other end who is asking. The
 * figures are as fresh as the last deploy, and every one carries the date its
 * own document states, so the screen can show how old a number is. */
const BUNDLED_CATALOGUE = (catalogueFile as { entries?: CatalogueEntryLike[] }).entries ?? [];

export type TravelBlockProps = {
  accounts: Account[];
  txs: Tx[];
  rates: readonly RateBenchmark[];
  facts: LearnedFact[];
  asOf: string;
  /** The product catalogue. Defaults to the bundled artifact; injectable so a
   *  test can pin behaviour without the whole 122-product file. */
  catalogue?: readonly CatalogueEntryLike[];
  homeCountry: string;
  busy: boolean;
  /** Whether the server has an API key — hides the refresh action when not. */
  aiAvailable: boolean;
  /** Providers the server said it is still looking up, from the last reply. */
  pendingTerms?: readonly string[];
  /** How many providers the ask covered, so progress can count UP. */
  termsAsked?: number;
  /** The lookups ran out of time. Better said than left spinning. */
  termsGaveUp?: boolean;
  onRecheckAi: () => void;
  /** Look up current terms for the providers with unknown terms. */
  onRefreshTerms: (destination: string) => void;
  /** Persist a corrected fact. The correction outlives every later refresh. */
  onCorrectFact: (fact: LearnedFact) => void;
};

/** Fills `{name}`-style placeholders in a copy template. The copy module holds
 *  words only, no interpolation logic — this is that logic, shared by every
 *  call site below instead of a `.replace()` chain repeated at each one. */
function fill(template: string, vals: Record<string, string | number>): string {
  return Object.entries(vals).reduce(
    (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
    template,
  );
}

/** Splits a filled template at its " — " boundary, for the copy entries that
 *  bundle a bold heading and its plain-text continuation into one string
 *  (because the heading itself carries an interpolated value). Everything
 *  before the dash is the fragment the original wrapped in `<strong>`. */
function splitBold(filled: string): [string, string] {
  const i = filled.indexOf(" — ");
  return i === -1 ? [filled, ""] : [filled.slice(0, i), filled.slice(i + 3)];
}

/** Inline correction of one learned number. Correcting is the whole point: it
 *  writes a `user` fact, which no later agent run may overwrite. The same
 *  component serves every learnable number — fxFeePct, convertFeePct — so a new
 *  leg is correctable the day it is priced, not a release later. */
function FactCorrection({
  provider,
  productLabel: displayLabel,
  factKey,
  label,
  value,
  busy,
  onCorrect,
}: {
  /** The identity `makeFact` writes under — never shown, must match what
   *  `factNumber` reads by, so it stays the Dutch string `rankSpendOptions`
   *  keys on. */
  provider: string;
  /** What the aria-label actually names, in the reader's language. */
  productLabel: string;
  factKey: string;
  label: string;
  value: number | null;
  busy: boolean;
  onCorrect: (fact: LearnedFact) => void;
}) {
  const [locale] = useAppLocale();
  const c = optimiseCopy[locale].travel;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value === null ? "" : String(value));

  if (!editing) {
    return (
      <button type="button" className="card-link" onClick={() => setEditing(true)} disabled={busy}>
        {fill(c.factCorrection.adjust, { label })}
      </button>
    );
  }
  return (
    <span className="confirm-inline">
      <input
        className="saldo-input"
        inputMode="decimal"
        aria-label={fill(c.factCorrection.fieldAriaLabel, { label, provider: displayLabel })}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={busy}
      />
      <button
        type="button"
        className="card-link"
        disabled={busy}
        onClick={() => {
          const trimmed = draft.trim().replace(",", ".").replace("%", "");
          if (trimmed !== "" && Number.isFinite(Number(trimmed))) {
            onCorrect(
              makeFact({
                agent: TRAVEL_AGENT,
                subject: provider,
                key: factKey,
                value: trimmed,
                source: "user",
                updatedAt: new Date().toISOString().slice(0, 10),
              }),
            );
          }
          setEditing(false);
        }}
      >
        {c.factCorrection.save}
      </button>
      <button type="button" className="card-link" onClick={() => setEditing(false)} disabled={busy}>
        {c.factCorrection.cancel}
      </button>
    </span>
  );
}

function pct(c: TravelCopy, n: number | null): string {
  return n === null ? c.common.unknown : `${n}%`;
}

/** "{bank} betaalpas"/"{bank} creditcard" as the reader's language, not core's
 *  identity string — that string (`Journey.provider`/`.via`) stays Dutch on
 *  purpose, it is what fact lookups and React keys match on. */
function productLabel(bank: string, productKind: "betaalpas" | "creditcard", c: TravelCopy): string {
  return `${bank} ${c.common.productKindWord[productKind]}`;
}

/** The one place a `SpendWhy` becomes a sentence. Exhaustive by switch, so a
 *  new kind in `rankSpendOptions` fails the build here instead of rendering
 *  nothing — same pattern as `holdSentence` in Facturen.tsx. */
function spendWhySentence(why: SpendWhy, c: TravelCopy): string {
  switch (why.kind) {
    case "known":
      return c.spendWhy.known(
        pct(c, why.fxFeePct),
        why.cashbackPct === null ? null : pct(c, why.cashbackPct),
        why.pointsPerEuro,
      );
    case "unknown":
      return c.spendWhy.unknown;
  }
}

/** Same pattern for `Journey.why`. The "direct" case wraps `spendWhySentence`
 *  rather than duplicating it — a direct journey's reasoning IS its spend
 *  option's reasoning, said with "pay directly" in front. */
function journeyWhySentence(why: JourneyWhy, c: TravelCopy): string {
  switch (why.kind) {
    case "direct":
      return c.journeyWhy.direct(spendWhySentence(why.spend, c));
    case "direct-unknown":
      return c.journeyWhy.directUnknown;
    case "via":
      return c.journeyWhy.via(
        why.free,
        pct(c, why.convertPct),
        why.cashbackPct === null ? null : pct(c, why.cashbackPct),
      );
    case "via-unknown-convert":
      return c.journeyWhy.viaUnknownConvert;
    case "via-unknown-transfer":
      return c.journeyWhy.viaUnknownTransfer;
  }
}

/** THE ONE MARK THAT KEEPS THE TWO QUESTIONS APART.
 *
 *  Since the recommendation may now be a card from the catalogue rather than one
 *  of his (review 3, item 2), every place a product is named has to say which of
 *  the two it is — otherwise the block advises a payment he cannot make until he
 *  has opened an account, which is the exact mistake this review is about. A
 *  word alone is not enough: it has to be visibly different, so it is the app's
 *  existing `.badge` chip and not another sentence. */
function NotYours() {
  const [locale] = useAppLocale();
  return <span className="badge">{optimiseCopy[locale].travel.badge.notYours}</span>;
}

/* ══════════════════════ WAT DE KAART ZELF KOST, als eigen velden ══════════════
 *
 * De core-laag rekent de kaartprijs sinds deze ronde mee: `CardOffer.holdingCost`
 * draagt hem in de drie toestanden die er echt zijn en `netBenefit` verrekent hem
 * over de reisduur. Op DIT scherm kwam dat bedrag alleen mee binnen één zin —
 * `plan.headline` — en die zin haalde het juist niet in het geval waarvoor de
 * core-laag hem schreef: `termsHeadline` hieronder VERVANGT de hele kop zodra er
 * geen enkele beprijsde eigen route is, en dat is de begintoestand van iedere
 * nieuwe gebruiker. De kop las dan "De voorwaarden van je kaarten zijn nog niet
 * opgezocht" en de € 16,90 per maand van de aangeraden kaart stond nergens meer
 * op het scherm. Precies de misleiding die de kostenlane moest wegnemen, één
 * laag hoger teruggekomen.
 *
 * Daarom staan prijs, periode en uitkomst hier als EIGEN velden onder de
 * aanbeveling, en niet als drie getallen om uit een zin te vissen. De drie
 * toestanden komen uit het TYPE en niet uit een boolean van ons:
 *
 *   kosten bekend, netto positief  → het nettobedrag, met de aftrek erbij
 *   kosten bekend, netto nul of −  → geen aanbeveling, met de reden in euro's
 *   kosten onbekend                → alleen het brutobedrag; het woord "netto"
 *                                    komt in die tak niet voor
 *
 * Een kaart die hij AL HEEFT rendert niets. Die maandprijs loopt door of hij hem
 * meeneemt of niet, dus hij hoort niet bij DEZE keuze; core maakt daar met
 * `marginalHoldingCost` een BEKENDE nul van. Hier wordt geen tweede regel naast
 * gezet — er wordt alleen niets over gezegd, want "kaartkosten € 0,00" zou
 * suggereren dat de kaart gratis is in plaats van al betaald.
 *
 * EN SINDSDIEN ZEI HET SCHERM HET TWEE KEER: core's kopzin hield zijn eigen
 * kostenstaart en deze velden zetten dezelfde bedragen er nog eens onder. Waar
 * die staart nu wegvalt en waarom juist daar en niet in core, staat bij `answer`
 * onderin dit bestand.
 */

/** Het bedrag in de eenheid van zijn eigen document. NOOIT omgerekend: een
 *  jaarprijs die als maandprijs op het scherm komt scheelt een factor twaalf, en
 *  "€ 42,95 per jaar" is ook wat hij op zijn afschrift terugvindt. */
function feeLabel(locale: Locale, a: FeeAmount): string {
  return `${formatEuroIn(locale, a.cents / 100)} per ${a.period}`;
}

/** De opslag op de referentiebesteding in CENTEN. Langs core's eigen
 *  `costOnReferenceSpend`, zodat er hier geen tweede rekenpad naar hetzelfde
 *  bedrag ontstaat: twee paden verschillen op de cent, en dan komt er een
 *  "voordeel" van één cent uit een vergelijking die gelijkspel hoort te zijn. */
function surchargeCents(pctValue: number): number {
  return Math.round((costOnReferenceSpend(pctValue) ?? 0) * 100);
}

/** OVER WELKE PERIODE ER GEREKEND IS, in woorden. Een eenmalig voordeel krijgt de
 *  horizon in hele factureringsperiodes ("over 1 maand", "over 1 jaar"); een
 *  terugkerend voordeel staat al in dezelfde eenheid als de kosten en heeft er
 *  geen nodig. Dit getal hoort op het scherm en niet in een tooltip: zonder de
 *  periode is een nettobedrag niet na te rekenen, en dan kan hij ons niet
 *  nakijken. */
function spanWords(basis: NetBasis, c: TravelCopy): string {
  if (basis.kind !== "one-off") return fill(c.cardCost.spanRecurring, { period: basis.period });
  const n = basis.periodsCharged;
  return basis.costPeriod === "jaar"
    ? n === 1
      ? c.cardCost.spanOneOffYearOne
      : fill(c.cardCost.spanOneOffYearMany, { n })
    : n === 1
      ? c.cardCost.spanOneOffMonthOne
      : fill(c.cardCost.spanOneOffMonthMany, { n });
}

/** DE ONDERGRENS, HARDOP, en als eigen zin in plaats van een bijzin. Een reis van
 *  een week kost toch een hele maand kaart; zonder deze zin lijkt dat bedrag uit
 *  de lucht te komen. Bij een jaarproduct is het bovendien het antwoord op de
 *  vraag die hij anders stelt — "maar ik ga maar één maand". Dezelfde woorden als
 *  core's eigen `floorNote`, zodat de zin die in de kop staat en de zin die hier
 *  staat niet twee verschillende dingen beweren. */
function floorNote(basis: NetBasis, c: TravelCopy): string {
  if (basis.kind !== "one-off" || !basis.flooredToMinimum) return "";
  return basis.costPeriod === "jaar" ? c.cardCost.floorYear : c.cardCost.floorMonth;
}

/** OF DEZE VELDEN IETS AFDRUKKEN — en dus of de kop het rekenwerk mag laten vallen.
 *
 *  Twee plekken moeten het over precies dezelfde vraag eens zijn: `Kaartkosten`
 *  hieronder, dat niets rendert als er niets te melden is, en de kopzin, die zijn
 *  kostenstaart alleen mag laten vallen als deze velden hem overnemen. Stond die
 *  voorwaarde twee keer uitgeschreven, dan zou één van de twee ooit meebewegen
 *  zonder de ander — en dan staat het bedrag nul keer op het scherm, wat erger is
 *  dan twee keer.
 *
 *  Een kaart die hij AL HEEFT valt hier af: die maandprijs loopt door of hij hem
 *  meeneemt of niet, dus ze is geen gevolg van deze keuze. Core doet aan zijn kant
 *  hetzelfde — `bareHoldingCostClause` zwijgt bij `already-held` — dus in die tak
 *  is er ook geen staart om te laten vallen. */
export function hasVisibleHoldingCost(cost: HoldingCost | null): cost is HoldingCost {
  if (!cost) return false;
  return !(cost.kind === "known" && cost.why === "already-held");
}

export function Kaartkosten({
  product,
  cost,
  benefit,
  testId,
}: {
  product: string;
  /** Null bij zijn eigen kaart: die kosten zijn geen gevolg van deze keuze. */
  cost: HoldingCost | null;
  /** De uitkomst met de kosten erin verrekend, of null als er geen voordeel is om
   *  ze tegen af te zetten. Dan blijft alleen de prijs staan — en dat is geen
   *  randgeval maar de begintoestand: zolang van geen enkele eigen kaart de opslag
   *  bekend is, is er niets om tegen te meten. */
  benefit: NetBenefit | null;
  testId: string;
}) {
  const [locale] = useAppLocale();
  const c = optimiseCopy[locale].travel;
  if (!hasVisibleHoldingCost(cost)) return null;

  if (cost.kind === "unknown") {
    const why =
      cost.reason === "needs-another-product"
        ? fill(c.cardCost.unknownReasonBundled, { product })
        : fill(c.cardCost.unknownReasonNoSource, { product });
    // Het woord "netto" komt hier NIET voor, en dat is de hele reden dat deze tak
    // apart staat: er is geen netto zolang de ene helft ontbreekt. Wel gezegd dat
    // het bedrag hierboven bruto is — anders leest een onbekende prijs als nul.
    return (
      <p className="cell-sub travel-note" data-testid={testId}>
        <strong>{c.cardCost.unknownHeading}</strong> — {why}. {c.cardCost.unknownNotZero}
        {benefit !== null && c.cardCost.unknownGrossHint}
      </p>
    );
  }

  const price = feeLabel(locale, cost.amount);
  // EEN UITGESPROKEN NUL IS EEN BEKENDE NUL — de keerzijde van "onbekend is geen
  // nul". Zegt een bron letterlijk dat de kaart niets kost, dan is dat een
  // gemeten feit en scheelt het hem de vraag of we het gewoon niet weten. Zonder
  // rekensom: er is niets om over een periode uit te smeren, en "€ 0,00 per maand
  // en dat betaal je minstens één maand" is waar en onleesbaar.
  if (cost.amount.cents === 0) {
    const [heading, rest] = splitBold(fill(c.cardCost.free, { price, product }));
    return (
      <p className="cell-sub travel-note" data-testid={testId}>
        <strong>{heading}</strong> — {rest}
      </p>
    );
  }

  // Geen voordeel om de prijs tegen af te zetten — de begintoestand van een nieuwe
  // gebruiker, zolang van geen enkele eigen kaart de opslag bekend is. Dan staat de
  // prijs er kaal, en het woord "netto" valt niet: er is niets netto te maken.
  // Kort, want core's kopzin zegt hetzelfde er al in proza bij; twee bijna
  // identieke zinnen naast elkaar lezen als een fout in de app.
  if (benefit === null || benefit.kind === "gross-cost-unknown") {
    return (
      <p className="cell-sub travel-note" data-testid={testId}>
        <strong>{fill(c.cardCost.priceOnly, { price })}</strong>
      </p>
    );
  }

  const [calculatedHeading, calculatedRest] = splitBold(
    fill(c.cardCost.calculated, { price, span: spanWords(benefit.basis, c) }),
  );
  return (
    <>
      <p className="cell-sub travel-note" data-testid={testId}>
        {/* Het TOTAAL staat er alleen als het van de prijs afwijkt. Bij een reis
            van één maand en een maandprijs zijn ze gelijk, en "€ 1,00 per maand,
            over 1 maand is dat € 1,00" is waar en leest als een rekenfout. Bij
            een langere reis (meer dan één factureringsperiode) verschillen ze wel,
            en dan is het totaal juist het getal dat de aftrek verklaart. */}
        <strong>{calculatedHeading}</strong> — {calculatedRest}
        {benefit.costCents !== cost.amount.cents && (
          <>{fill(c.cardCost.calculatedTotalSuffix, { total: formatEuroIn(locale, benefit.costCents / 100) })}</>
        )}
        .{floorNote(benefit.basis, c)}
      </p>
      {benefit.kind === "net" ? (
        <p className="cell-sub travel-note" data-testid={`${testId}-netto`}>
          <strong>{c.cardCost.netLabel}</strong>{" "}
          <span className="text-pos">{formatEuroIn(locale, benefit.netCents / 100)}</span> —{" "}
          {fill(c.cardCost.netBreakdown, {
            gross: formatEuroIn(locale, benefit.grossCents / 100),
            cost: formatEuroIn(locale, benefit.costCents / 100),
          })}
        </p>
      ) : (
        /* GEEN AANBEVELING, en het bedrag staat er zodat hij het niet zelf hoeft
           uit te rekenen. Zijn woorden: een kaart die € 5 per maand kost en € 3
           oplevert is achteruit, en dat moet hij kunnen zien staan. */
        <p className="cell-sub travel-note text-warn" data-testid={`${testId}-geen`}>
          <strong>{c.cardCost.noRecommendationLabel}</strong>{" "}
          {fill(c.cardCost.noRecommendationBody, {
            gross: formatEuroIn(locale, benefit.grossCents / 100),
            cost: formatEuroIn(locale, benefit.costCents / 100),
          })}{" "}
          {benefit.netCents === 0
            ? c.cardCost.noGain
            : fill(c.cardCost.worseOff, { amount: formatEuroIn(locale, -benefit.netCents / 100) })}
        </p>
      )}
    </>
  );
}

/** Wat overstappen naar DEZE kaart oplevert, met de kaartprijs erin verrekend.
 *
 *  Dezelfde rekensom als core's `offerSwitchGain`, maar per rij in plaats van
 *  alleen voor de winnaar — zodat bij elke kaart staat wat ze oplevert, en bij
 *  welke kaart de prijs het voordeel opeet. `netBenefit` doet het rekenwerk met de
 *  horizon van de offer zelf, zodat de ondergrens van één factureringsperiode
 *  meekomt en er niet ergens een tweede horizonregel ontstaat. */
function offerNet(offer: CardOffer, ownPct: number): NetBenefit {
  return netBenefit({
    benefit: { kind: "one-off", cents: surchargeCents(ownPct) - surchargeCents(offer.netCostPct) },
    cost: offer.holdingCost,
    horizonMonths: offer.tripMonths,
  });
}

/** DE KAART DIE AFVIEL OMDAT HIJ TE DUUR IS.
 *
 *  `bestPayAdvice` kiest zijn eigen route zodra die over de hele reis niet duurder
 *  is dan de goedkoopste kaart uit de catalogus, en de kaartprijs zit sinds deze
 *  ronde in die vergelijking. De uitkomst klopt, maar op het scherm was ze
 *  onzichtbaar: de kaart met 0% opslag verdween zonder een woord uit de
 *  aanbeveling, en de lezer moest zelf uitrekenen waarom een lagere opslag niet de
 *  tip werd. Zijn eis is het omgekeerde — hij moet kunnen ZIEN dat een kaart
 *  afvalt omdat hij te duur is.
 *
 *  Gekozen wordt de kaart met de LAAGSTE OPSLAG, niet die met de laagste
 *  reiskosten: dat is de kaart die er in de oude rangschikking als winnaar uitkwam
 *  en dus degene waarover hij de vraag stelt. Kaarten met ONBEKENDE kosten komen
 *  hier nooit in voor — die vallen niet af omdat ze te duur zijn, we kennen hun
 *  prijs niet, en dat is een ander verhaal met een andere zin (zie `Kaartkosten`). */
function rejectedByPrice(
  offers: readonly CardOffer[],
  ownPct: number,
): { offer: CardOffer; net: Extract<NetBenefit, { kind: "no-recommendation" }> } | null {
  const ownCents = surchargeCents(ownPct);
  let pick: CardOffer | null = null;
  for (const o of offers) {
    if (o.holdingCost.kind !== "known") continue;
    // Zonder lagere opslag valt er niets uit te leggen: zo'n kaart is niet
    // afgevallen op haar prijs maar op haar tarief, en dat staat al in de lijst.
    if (surchargeCents(o.netCostPct) >= ownCents) continue;
    if (pick === null || o.netCostPct < pick.netCostPct) pick = o;
  }
  if (pick === null) return null;
  const net = offerNet(pick, ownPct);
  return net.kind === "no-recommendation" ? { offer: pick, net } : null;
}

/** A leg's price on the reference spend. `null` is UNKNOWN and must never read
 *  as free — that rule is why the ranking can be trusted at all. A leg that does
 *  not exist on this route (no transfer when you pay directly) is not a price,
 *  so it renders as "n.v.t." rather than as a zero. */
function legCost(locale: Locale, c: TravelCopy, costPct: number | null): string {
  if (costPct === null) return c.common.unknown;
  const euros = costOnReferenceSpend(costPct);
  if (euros === null) return c.common.unknown;
  // `-0` is a real outcome here (a leg with no cashback prices at minus nothing)
  // and formats as "€ -0,00", which reads like a rounding error. It is zero.
  if (euros === 0) return formatEuroIn(locale, 0);
  if (euros < 0) return fill(c.legs.cashback, { amount: formatEuroIn(locale, Math.abs(euros)) });
  return formatEuroIn(locale, euros);
}

type Leg = { name: string; detail: string; cost: string };

/** The three legs of a route, in the order the money travels: overzetten →
 *  wisselen → betalen. Named after the sections they replace, so the detail the
 *  owner already knows how to read is still there — now inside one route
 *  instead of standing next to it as a rival answer. */
function legsOf(j: Journey, locale: Locale, c: TravelCopy): Leg[] {
  const product = productLabel(j.bank, j.productKind, c);
  if (j.via === null) {
    return [
      { name: c.legs.transfer, detail: c.legs.directTransferDetail, cost: c.common.notApplicable },
      { name: c.legs.exchange, detail: c.legs.directExchangeDetail, cost: c.common.notApplicable },
      { name: c.legs.pay, detail: product, cost: legCost(locale, c, j.spendPct) },
    ];
  }
  return [
    {
      name: c.legs.transfer,
      detail: `${j.fundedFrom ?? c.legs.defaultFundingSource} → ${product}${j.method ? fill(c.legs.viaMethodSuffix, { method: j.method }) : ""}`,
      cost: legCost(locale, c, j.transferPct),
    },
    {
      name: c.legs.exchange,
      detail: fill(c.legs.atProvider, { via: product }),
      cost: legCost(locale, c, j.convertPct),
    },
    { name: c.legs.pay, detail: product, cost: legCost(locale, c, j.spendPct) },
  ];
}

function journeyTitle(j: Journey, c: TravelCopy): string {
  const product = productLabel(j.bank, j.productKind, c);
  return j.via === null
    ? fill(c.journeys.directTitle, { provider: product })
    : fill(c.journeys.viaTitle, { via: product }) +
        (j.fundedFrom ? fill(c.journeys.fundedFromSuffix, { source: j.fundedFrom }) : "");
}

function journeyKey(j: Journey): string {
  return `${j.provider}|${j.via ?? "direct"}`;
}

/* ---------- Why there is no priced route, and what actually unlocks one ----------
 *
 * Core's own fallback sentence is "ververs eerst de voorwaarden". On a server
 * with no MISTRAL_API_KEY that is advice that cannot work: /api/agent/status
 * answers `{"configured":false}` and the lookup answers 503, so the refresh the
 * sentence asks for is a no-op. It cost Alexander an afternoon hunting a bug
 * that did not exist.
 *
 * So the block never prints that sentence. It works out WHICH of four different
 * situations it is in and names that one — the block already receives
 * `aiAvailable`, it simply was not used for anything but hiding a button:
 *
 *   no-products     nothing to compare: no card or payment account with a bank
 *   no-key          this server cannot look anything up — refreshing is futile
 *   never-searched  it has simply never been asked; the ask is one click away
 *   searching       the server is still looking; asking again shortly will help
 *   searched-empty  it WAS asked in this session and nothing usable came back
 *
 * The last two are the split core cannot make for us: a lookup that finds
 * nothing writes no fact, so after a reload "asked and nothing found" and
 * "never asked" are byte-identical in the vault. We can only tell them apart by
 * having watched the request go out, so `searched` is session state and the
 * copy claims no more than that. */
export type TermsState =
  | { kind: "euro" }
  | { kind: "no-products" }
  /** `unknown` = cards with no exchange fee at all. `unpriced` = cards whose
   *  DIRECT leg is priced but whose move-it-first route still is not, because
   *  its conversion fee was never learned. Two different gaps: core's
   *  `unknownProviders` only reports the first, and calling the second "bekend"
   *  would claim a route is priced when the block prints "onbekend" next to it. */
  | {
      kind: "known";
      unknown: string[];
      unpriced: { bank: string; productKind: "betaalpas" | "creditcard"; why: JourneyWhy }[];
      lastUpdated: string | null;
    }
  | { kind: "no-key"; unknown: string[] }
  | { kind: "never-searched"; unknown: string[] }
  /** The server accepted the ask and is looking in the background. This is NOT
   *  "nothing came back": conflating the two told the owner his search had
   *  failed while a banner two lines up said it was still running, and the fee
   *  he was told did not exist appeared moments later. A lookup takes 40s to a
   *  few minutes; saying so is the whole difference between patience and a bug
   *  report. */
  | { kind: "searching"; pending: string[] }
  | { kind: "searched-empty"; unknown: string[] };

export function termsState(
  plan: TravelPlan,
  aiAvailable: boolean,
  searched: boolean,
  pending: readonly string[] = [],
): TermsState {
  if (plan.currency === "EUR") return { kind: "euro" };
  if (plan.spend.length === 0) return { kind: "no-products" };
  const unknown = plan.unknownProviders;
  if (plan.journeys.some((j) => j.known)) {
    // Newest agent lookup we have any evidence of, so "laatst opgezocht" is a
    // date we actually hold rather than a reassuring guess.
    const dates = plan.spend
      .map((s) => (s.feeSource === "agent" ? s.feeUpdatedAt : null))
      .filter((d): d is string => d !== null)
      .sort();
    // Which leg is missing is core's own answer (`journey.why`'s
    // "via-unknown-convert" vs "via-unknown-transfer"), so the notice repeats
    // it instead of guessing which of the two it was.
    const unpriced = plan.journeys
      .filter((j) => !j.known && !unknown.includes(j.provider))
      .map((j) => ({ bank: j.bank, productKind: j.productKind, why: j.why }));
    return {
      kind: "known",
      unknown,
      unpriced,
      lastUpdated: dates.length > 0 ? dates[dates.length - 1] : null,
    };
  }
  if (!aiAvailable) return { kind: "no-key", unknown };
  // Still running beats "found nothing". The server told us which providers it
  // is working on; repeating that is honest, and it is also the answer.
  const stillGoing = unknown.filter((p) => pending.includes(p));
  if (stillGoing.length > 0) return { kind: "searching", pending: stillGoing };
  return searched ? { kind: "searched-empty", unknown } : { kind: "never-searched", unknown };
}

/** The one line that replaces core's headline when there is no priced route.
 *  Core's version advises a refresh; these name the cause instead. */
function termsHeadline(state: TermsState, c: TravelCopy): string | null {
  switch (state.kind) {
    case "no-products":
      return c.terms.causeNoProducts;
    case "searching":
      return c.terms.causeSearching;
    case "no-key":
      return c.terms.causeNoKey;
    case "never-searched":
      return c.terms.causeNeverSearched;
    case "searched-empty":
      return c.terms.causeSearchedEmpty;
    default:
      return null; // "known" and "euro" keep core's own answer
  }
}

function nameList(providers: string[]): string {
  return providers.join(", ");
}

/** The block's one visible control for the terms, sitting directly under the
 *  answer it explains.
 *
 *  It used to live in the module's "…" slot, where Alexander could not find it
 *  (B3) — a card-link in a header corner, next to nothing that said why you
 *  would press it. Here it sits inside the sentence that states the problem, so
 *  the explanation and the fix are one thing. Where nothing a click can fix
 *  (no cards) there is deliberately NO button: an action that cannot work is
 *  worse than none. The no-key state is the exception, and it took a real
 *  report to see why: LaVega asks the server about its key only at page load,
 *  so a tab that opened first keeps saying "no key" after one is set. Without a
 *  control there, the only cure was knowing to reload — so it gets one. */
export function TermsNotice({
  state,
  busy,
  aiAvailable,
  termsAsked,
  termsGaveUp,
  onSearch,
  onRecheckAi,
}: {
  state: TermsState;
  busy: boolean;
  aiAvailable: boolean;
  termsAsked: number;
  termsGaveUp: boolean;
  onSearch: () => void;
  onRecheckAi: () => void;
}) {
  const [locale] = useAppLocale();
  const c = optimiseCopy[locale].travel;
  if (state.kind === "euro") return null;

  /* WAAR "VUL HET ZELF IN" NAAR WIJST, en waarom het niet meer "Waarom?" is.
   *
   * Drie meldingen hieronder eindigen met dezelfde uitweg: typ het percentage
   * zelf, want wat jij invult overschrijft geen enkele agent. Die zin noemde de
   * knop "Waarom?" — en die knop bestaat niet meer sinds het blok op de gedeelde
   * <ToonMeer> staat. Daarmee was het een advies dat in de toestand waarin het
   * verschijnt niet uit te voeren is — dezelfde fout als core's "ververs eerst
   * de voorwaarden" op een server zonder sleutel, en die kostte een middag. Het invulveld zelf is niet weg — het
   * staat per route onder "Alle routes", in ditzelfde uitgeklapte deel, direct
   * onder deze melding. Dus wijst de zin daarheen.
   *
   * Eén kopje, drie keer genoemd, dus de naam komt uit de copy en niet uit drie
   * overgetikte strings: een verwijzing die naar een kop wijst die anders heet
   * is dezelfde dode aanwijzing, alleen moeilijker te vinden. */
  const zelfInvullen = fill(c.terms.fillInHint, { heading: c.terms.routesHeading });

  const searchButton = (primary: boolean, label: string) => (
    <button
      type="button"
      className={primary ? "btn btn-primary travel-terms-action" : "btn travel-terms-action"}
      onClick={onSearch}
      disabled={busy}
    >
      {busy ? c.terms.searchingButton : label}
    </button>
  );

  // A control, not only a sentence. LaVega asks the server whether it has a key
  // ONCE, when the page loads, so a tab opened before the key was set repeats
  // "no key" for the rest of its life — a true sentence about a stale fact, and
  // from the outside indistinguishable from a broken feature. Without this
  // button there is nothing to press in exactly the state that needs pressing,
  // and the only cure is knowing to reload.
  const [noKeyBefore, noKeyAfter] = fill(c.terms.noKeyBody, { hint: zelfInvullen }).split(
    "MISTRAL_API_KEY",
  );
  const noKeyLine = (
    <>
      <p className="cell-sub">
        {noKeyBefore}
        <code>MISTRAL_API_KEY</code>
        {noKeyAfter}
      </p>
      <button type="button" className="card-link" onClick={onRecheckAi} disabled={busy}>
        {c.terms.noKeyRecheck}
      </button>
    </>
  );

  if (state.kind === "no-products") {
    return (
      <div className="travel-terms" role="status">
        <p className="cell-sub">{c.terms.noProductsBody}</p>
      </div>
    );
  }

  if (state.kind === "known") {
    const gaps = state.unknown.length + state.unpriced.length;
    return (
      <div className="travel-terms" role="status">
        {state.unknown.length > 0 && (
          <p className="cell-sub">
            {fill(state.unknown.length === 1 ? c.terms.unknownCardsOne : c.terms.unknownCardsMany, {
              count: state.unknown.length,
              names: nameList(state.unknown),
            })}
          </p>
        )}
        {state.unpriced.length > 0 && (
          <p className="cell-sub">
            {fill(c.terms.unpriced, {
              list: state.unpriced
                .map((u) => `${productLabel(u.bank, u.productKind, c)} — ${journeyWhySentence(u.why, c)}`)
                .join("; "),
            })}
          </p>
        )}
        {gaps === 0 && <p className="cell-sub">{c.terms.allPriced}</p>}
        {/* Only ever a date we actually hold: a fee the owner typed himself
            carries no lookup date, and no date is printed for it.
            "Opgezocht" used to claim LaVega did the looking on that date — but
            a bank.nl figure was checked by bank.nl and merely fetched by us. A
            neutral verb is true of both sources. */}
        {state.lastUpdated && (
          <p className="cell-sub">
            {fill(c.terms.lastChecked, { date: formatDate(locale, state.lastUpdated) })}
          </p>
        )}
        {aiAvailable
          ? searchButton(false, gaps > 0 ? fill(c.terms.searchWithCount, { count: gaps }) : c.terms.refresh)
          : noKeyLine}
      </div>
    );
  }

  if (state.kind === "no-key") {
    return (
      <div className="travel-terms travel-terms-blocked" role="status">
        <p className="cell-sub">{fill(c.terms.unknownList, { names: nameList(state.unknown) })}</p>
        {noKeyLine}
      </div>
    );
  }

  if (state.kind === "searching") {
    // The HTTP call finished in a fraction of a second; the LOOKUP has not.
    // Showing the request's progress left the screen still while the work ran,
    // so this shows the work: a count that moves as each one lands.
    const found = Math.max(0, termsAsked - state.pending.length);
    return (
      <div className="travel-terms" role="status" aria-live="polite">
        <p className="cell-sub travel-searching">
          <span className="spinner" aria-hidden="true" />
          <span>
            {fill(c.terms.searchingBody, { names: nameList(state.pending) })}
            {termsAsked > 0 && fill(c.terms.searchingFoundSuffix, { found, total: termsAsked })}
            {c.terms.searchingTail}
          </span>
        </p>
        {termsGaveUp && (
          <p className="cell-sub text-warn">{fill(c.terms.gaveUp, { hint: zelfInvullen })}</p>
        )}
        {searchButton(false, c.terms.searchAgain)}
      </div>
    );
  }

  if (state.kind === "never-searched") {
    return (
      <div className="travel-terms" role="status">
        <p className="cell-sub">
          {fill(c.terms.neverSearchedBody, { names: nameList(state.unknown) })}
        </p>
        {searchButton(true, fill(c.terms.searchWithCount, { count: state.unknown.length }))}
      </div>
    );
  }

  return (
    <div className="travel-terms travel-terms-blocked" role="status">
      <p className="cell-sub">
        {fill(c.terms.searchedEmptyBody, { names: nameList(state.unknown), hint: zelfInvullen })}
      </p>
      {searchButton(false, c.terms.searchAgainPlain)}
    </div>
  );
}

/* ---------- CASH, and the rest of the market ----------
 *
 * Two questions the block used to leave out, both answerable from data already
 * on disk (app review, 20 August, items 6/7/8).
 *
 * TAKING MONEY OUT is a different price from paying, and almost always worse:
 * every tariff document we hold prices it on its own row, usually as a
 * percentage PLUS a flat fee. The flat fee is the part that matters and the
 * part a percentage cannot express — ING's € 3,50 is 1,75% on € 200 and 7% on
 * € 50 — so the euros are quoted on one realistic withdrawal and the small one
 * is quoted beside it.
 *
 * WHAT HE COULD SWITCH TO is a separate question from what he can pay with
 * today, and the block used to answer only the second: `rankSpendOptions`
 * iterates his own accounts, so a cheaper card he does not hold could not
 * appear however cheap. That is why Revolut looked like the best shot for the
 * US while the 212 Card sat in the catalogue at a provable 0%. Both questions
 * are on screen now, and they are kept apart by construction: `plan.offers`
 * contains only cards he does NOT hold, and every place it renders says so.
 *
 * REVIEW 3, ITEM 2 went one step further: the cheaper card is now the HEADLINE,
 * not a footnote under it. "I don't want 'pay today you're paying with what you
 * have'. Say pay with Revolut, which would save you € 14 on a thousand compared
 * to ING." So `plan.pay` may name a card he does not carry — and the moment it
 * does, `NotYours` marks it and a "Vandaag" line keeps what he CAN pay with on
 * screen. Without both, the block would be recommending a payment he cannot
 * make until he has opened an account. */

/** What one withdrawal costs, or "onbekend"/"unknown". Never a zero — a
 *  missing price is not a free one, and abroad that difference is real money. */
function cashCost(locale: Locale, c: TravelCopy, euros: number | null): string {
  return euros === null ? c.common.unknown : formatEuroIn(locale, euros);
}

/** His own cards, priced for pulling out cash. The reason a row has no price is
 *  printed with the row: "the document points at article 13.3" and "we do not
 *  know which ING creditcard you have" need different things from him, and one
 *  of them he can fix in a click. */
export function CashSection({
  options,
  asOf,
  advice = null,
}: {
  options: readonly WithdrawOption[];
  asOf: string;
  /** The cheapest PROVEN withdrawal across the catalogue, when it is not one of
   *  his. Named here too, because the list below is his cards only and the
   *  cheapest one of those is not the answer to "which card should I use". */
  advice?: WithdrawAdvice | null;
}) {
  const [locale] = useAppLocale();
  const c = optimiseCopy[locale].travel;
  return (
    <div className="travel-step travel-cash">
      <h3 className="travel-step-title">{c.cash.title}</h3>
      <p className="cell-sub">
        {fill(c.cash.intro, { amount: formatEuroIn(locale, TRAVEL_REFERENCE_WITHDRAWAL) })}
      </p>
      {advice && !advice.held && (
        <p className="cell-sub travel-note">
          <NotYours />{" "}
          {fill(c.cash.advice, {
            product: advice.product,
            cost: cashCost(locale, c, advice.costOnReference),
            amount: formatEuroIn(locale, TRAVEL_REFERENCE_WITHDRAWAL),
          })}
          {advice.asOf && <> · {figureAge(advice.asOf, asOf)}</>}.
        </p>
      )}
      {/* Een opnametarief van nul is nog geen gratis kaart: het gaat om een kaart
          die hij moet OPENEN, en die brengt zijn eigen maandnota mee. */}
      {advice && !advice.held && (
        <Kaartkosten
          product={advice.product}
          cost={advice.holdingCost}
          benefit={advice.benefit}
          testId="travel-cash-kosten"
        />
      )}
      {options.length === 0 ? (
        <p className="cell-sub">{c.common.noAccountsKnown}</p>
      ) : (
        <ul className="travel-legs">
          {options.map((o) => (
            <li key={o.provider} className="travel-leg">
              <span className="travel-leg-name">
                {productLabel(o.bank, o.productKind, c)}
                {o.fee.known && <span className="eyebrow"> · {describeWithdrawalFee(o.fee)}</span>}
                {o.asOf && <span className="eyebrow"> · {figureAge(o.asOf, asOf)}</span>}
              </span>
              <span className="travel-leg-cost">{cashCost(locale, c, o.costOnReference)}</span>
            </li>
          ))}
        </ul>
      )}
      {options.map((o) =>
        o.fee.known ? (
          <div key={`why-${o.provider}`}>
            {o.penalisesSmall && o.smallEffectivePct !== null && (
              <p className="cell-sub travel-note">
                {fill(c.cash.smallWithdrawalNote, {
                  provider: productLabel(o.bank, o.productKind, c),
                  amount: formatEuroIn(locale, TRAVEL_SMALL_WITHDRAWAL),
                  pctSmall: formatPercentIn(locale, o.smallEffectivePct),
                  pctNormal: formatPercentIn(locale, o.effectivePct ?? 0),
                })}
              </p>
            )}
            {o.fee.caveat && (
              <p className="cell-sub travel-note">
                <strong>{c.common.caveatLabel}</strong>{" "}
                {fill(c.cash.caveat, { provider: productLabel(o.bank, o.productKind, c), caveat: o.fee.caveat })}
              </p>
            )}
          </div>
        ) : (
          <p key={`why-${o.provider}`} className="cell-sub travel-note">
            {fill(c.cash.feeUnknownReason, {
              provider: productLabel(o.bank, o.productKind, c),
              reason: o.fee.why ?? "",
            })}
          </p>
        ),
      )}
    </div>
  );
}

/** The catalogue's cheapest cards that he does NOT hold.
 *
 *  Everything here is phrased as something to open, never as something to pay
 *  with, because that is the whole risk of putting it on this screen. Cashback
 *  is shown and never subtracted: every cashback figure the catalogue holds
 *  today is paid in a token behind a stake or a subscription, so pricing it in
 *  euros would be the same fake precision that keeps reward points out of the
 *  ranking. */
export function OffersSection({
  offers,
  asOf,
  shown = 6,
  ownPct = null,
}: {
  offers: readonly CardOffer[];
  asOf: string;
  shown?: number;
  /** De opslag van zijn eigen beste beprijsde route, in procenten. Daarmee kan per
   *  kaart staan wat overstappen NETTO oplevert. Zonder dat getal blijft het bij de
   *  prijzen: een netto met één helft ontbrekend is een verzonnen bedrag. */
  ownPct?: number | null;
}) {
  const [locale] = useAppLocale();
  const c = optimiseCopy[locale].travel;
  if (offers.length === 0) return null;
  const top = offers.slice(0, shown);
  // Alle offers zijn met dezelfde horizon doorgerekend (`planTravel` geeft er één
  // door aan `marketCardOffers`), dus de eerste rij mag hem voor de hele lijst
  // noemen.
  const tripMonths = offers[0].tripMonths;
  return (
    <div className="travel-step travel-offers">
      <h3 className="travel-step-title">{c.offers.title}</h3>
      <p className="cell-sub">{c.offers.intro1}</p>
      {/* WAAROM DE VOLGORDE IS WAT ZE IS. De lijst wordt gerangschikt op wat een
          kaart deze reis KOST — opslag plus kaartprijs — en toonde alleen de
          opslag. Een kaart met 0% opslag en € 16,90 per maand stond dan onder een
          kaart met 1% en geen kosten, met een lager bedrag ernaast: een volgorde
          die willekeurig leest omdat de helft van het criterium niet op het scherm
          stond. Nu staat die helft er, per rij. */}
      <p className="cell-sub">
        {fill(tripMonths === 1 ? c.offers.intro2One : c.offers.intro2Many, {
          reference: formatEuroIn(locale, TRAVEL_REFERENCE_SPEND),
          months: tripMonths,
        })}
      </p>
      <ul className="travel-journeys">
        {top.map((o) => (
          <li key={o.productId} className="travel-journey">
            <div className="travel-journey-head">
              <span className="travel-journey-name">{o.product}</span>
              <NotYours />
              <span className="travel-journey-cost">
                {fill(c.offers.amountOnReference, {
                  amount: formatEuroIn(locale, costOnReferenceSpend(o.netCostPct) ?? 0),
                  reference: formatEuroIn(locale, TRAVEL_REFERENCE_SPEND),
                })}
              </span>
            </div>
            <p className="cell-sub travel-note">
              {fill(c.offers.feeLine, { pct: formatPercentIn(locale, o.fxFeePct) })}
              {o.cashbackPct !== null &&
                ` · ${fill(c.offers.cashbackSuffix, { pct: formatPercentIn(locale, o.cashbackPct) })}`}
              {o.withdrawalOnReference !== null
                ? ` · ${fill(c.offers.withdrawalSuffix, {
                    amount: formatEuroIn(locale, o.withdrawalOnReference),
                    reference: formatEuroIn(locale, TRAVEL_REFERENCE_WITHDRAWAL),
                  })}`
                : ` · ${c.offers.withdrawalUnknown}`}
              {" · "}
              {figureAge(o.asOf, asOf)}
            </p>
            {o.capNote && (
              <p className="cell-sub travel-note">
                <strong>{c.common.caveatLabel}</strong> {o.capNote}
              </p>
            )}
            {o.cashbackNote && (
              <p className="cell-sub travel-note">
                {o.cashbackNote}
                {c.offers.cashbackNoteSuffix}
              </p>
            )}
            {/* De prijs van de kaart, en — als we zijn eigen opslag kennen — wat
                overstappen er netto van overhoudt. Alleen bij een LAGERE opslag
                wordt er een voordeel berekend: bij een hogere is er geen voordeel
                om kosten van af te trekken, en "€ −5,00 voordeel" is geen zin. */}
            <Kaartkosten
              product={o.product}
              cost={o.holdingCost}
              benefit={
                ownPct !== null && surchargeCents(o.netCostPct) < surchargeCents(ownPct)
                  ? offerNet(o, ownPct)
                  : null
              }
              testId={`travel-offer-kosten-${o.productId}`}
            />
          </li>
        ))}
      </ul>
      {offers.length > top.length && (
        <p className="cell-sub">
          {fill(c.offers.remainingCount, { count: offers.length - top.length })}
        </p>
      )}
    </div>
  );
}

/** How old a figure is, in words, because a bare date does not tell you whether
 *  to trust it. "vandaag opgezocht" and "gecontroleerd 15 jan" are different
 *  claims, and a koersopslag from seven months ago should look seven months old
 *  on screen rather than hide behind a formatted date.
 *
 *  Not a React component, so it cannot read `useAppLocale()` — it is called
 *  directly from tests as a plain function too. `readAppLocale()` is the same
 *  read the hook seeds its first render with, so this stays in step with
 *  whatever locale the surrounding block is rendering in. */
export function figureAge(updatedAt: string, asOf: string): string {
  const locale = readAppLocale();
  const c = optimiseCopy[locale].travel.figureAge;
  const days = Math.round((Date.parse(asOf) - Date.parse(updatedAt)) / 86_400_000);
  if (!Number.isFinite(days)) return fill(c.fallback, { date: updatedAt });
  if (days <= 0) return c.today;
  if (days === 1) return c.yesterday;
  if (days < 14) return fill(c.daysAgo, { n: days });
  if (days < 60) return fill(c.weeksAgo, { n: Math.round(days / 7) });
  return fill(c.monthsAgo, { n: Math.round(days / 30) });
}

export default function TravelBlock({
  accounts,
  txs,
  rates,
  facts,
  asOf,
  homeCountry,
  busy,
  aiAvailable,
  pendingTerms = [],
  termsAsked = 0,
  termsGaveUp = false,
  onRefreshTerms,
  onRecheckAi,
  onCorrectFact,
  catalogue = BUNDLED_CATALOGUE,
}: TravelBlockProps) {
  const [locale] = useAppLocale();
  const c = optimiseCopy[locale].travel;
  const [destination, setDestination] = useState("");
  /* Eén uitklap voor het hele blok, en die staat in `ToonMeer` — geen `useState`
   * meer hier. Dat is niet alleen minder code: de stand zat in React en dus
   * NERGENS anders, waardoor de opmaak niets van open of dicht wist en elk blok
   * dat hetzelfde wilde zijn eigen knop met eigen `aria-expanded` naschreef. Een
   * <details> levert Tab-focus, Enter/Space en het uitspreken van de stand van de
   * browser zelf. Zie components/ToonMeer.tsx; bouw hier geen tweede variant. */

  // Destinations a lookup actually WENT OUT for in this session. The only way
  // to tell "asked and found nothing" from "never asked": a fruitless lookup
  // stores no fact, so the vault records the two identically. Session-scoped on
  // purpose — after a reload we no longer know, and the copy falls back to the
  // weaker, true claim ("nog niet opgezocht").
  const [searched, setSearched] = useState<string[]>([]);
  const pending = useRef<string | null>(null);
  const sawBusy = useRef(false);
  useEffect(() => {
    if (busy) {
      sawBusy.current = true;
      return;
    }
    if (!sawBusy.current || pending.current === null) return;
    const done = pending.current;
    pending.current = null;
    sawBusy.current = false;
    setSearched((prev) => (prev.includes(done) ? prev : [...prev, done]));
  }, [busy]);

  function search() {
    pending.current = destination;
    onRefreshTerms(destination);
  }

  const plan: TravelPlan | null = destination
    ? planTravel({ accounts, txs, rates, facts, destination, asOf, catalogue })
    : null;

  const bestJourney = plan?.journeys.find((j) => j.known) ?? null;
  /* Zijn beste BEPRIJSDE route, met dezelfde test als core's `bestPayAdvice`
     gebruikt om de winnaar te kiezen — `bestJourney` hierboven laat `costOnReference`
     vrij en zou dus een andere route kunnen aanwijzen dan degene waartegen de
     kaarten zijn afgewogen. Zijn opslag is de tweede helft van elk nettobedrag op
     dit scherm: zonder die helft wordt er niets netto genoemd. */
  const ownRoute = plan?.journeys.find((j) => j.known && j.costOnReference !== null) ?? null;
  const ownPct = ownRoute?.totalCostPct ?? null;
  const rejected =
    plan && plan.pay?.held && ownPct !== null ? rejectedByPrice(plan.offers, ownPct) : null;
  const terms = plan
    ? termsState(plan, aiAvailable, searched.includes(destination), pendingTerms)
    : null;

  /* HET BEDRAG STOND ER TWEE KEER, en hier valt de ene weg.
   *
   * Core's `payHeadline` sluit af met de kostenstaart: "… Testkaart Licht kost
   * zelf € 1,00 per maand en dat betaal je minstens één maand, dus je houdt
   * € 9,00 over." Direct daaronder staan diezelfde € 1,00, dezelfde ondergrens en
   * dezelfde € 9,00 nog een keer, uit elkaar getrokken in de velden van
   * `Kaartkosten`. Twee formuleringen van één bedrag lezen als twee bedragen, en
   * dan gaat de lezer het verschil zoeken dat er niet is.
   *
   * DE VELDEN WINNEN, NIET DE KOP, en niet omdat ze mooier zijn. De kop is de
   * zwakkere drager: `termsHeadline` hierboven VERVANGT hem volledig zodra er geen
   * beprijsde eigen route is, en dat is de begintoestand van iedere nieuwe
   * gebruiker. Precies daar viel die staart al een keer weg en stond er "dat kost
   * je niets op € 1.000" boven een kaart van € 16,90 per maand. Wie andersom kiest
   * — staart houden, velden schrappen — bouwt die fout opnieuw. Dat de kop zegt
   * wát je moet doen en de velden laten zien hoe het bedrag is opgebouwd, is de
   * tweede reden; de eerste is dat de velden er altijd staan en de kop niet.
   *
   * DE STAART WORDT NIET UIT CORE GESLOOPT. Daar is `payHeadline` de enige plek
   * waar die zin bestaat, en core weet niet of zijn lezer velden heeft — de
   * core-tests lezen `plan.headline` kaal. Dus wordt dezelfde functie om dezelfde
   * zin gevraagd zonder het stuk dat hieronder al staat: een advies zonder
   * `holdingCost` en zonder `benefit` heeft geen kosten om over te praten en core
   * laat de staart dan zelf weg. Eén bron voor de kop, minus één stuk — geen
   * tweede zinsbouw hier, en geen knipwerk op een string dat bij de volgende
   * formulering stilletjes de verkeerde helft pakt. De test pint het als PREFIX:
   * wat op het scherm staat moet het begin van core's eigen zin zijn.
   *
   * Alleen als die velden ook echt renderen (`hasVisibleHoldingCost`). Bij zijn
   * eigen kaart staat er geen veld en heeft core ook geen staart, en dan is er
   * niets te kiezen. */
  const answer =
    plan === null
      ? ""
      : plan.pay && !plan.pay.held && hasVisibleHoldingCost(plan.pay.holdingCost)
        ? payHeadline(
            { ...plan.pay, holdingCost: null, benefit: null },
            plan.journeys,
            plan.currency,
          )
        : plan.headline;

  /* DE AANBEVELING WINT VAN DE OORZAAK, en dat is een omkering van hoe het stond.
   *
   * `termsHeadline` VERVING de kop volledig zodra er geen beprijsde eigen route
   * was. Dat is de begintoestand van iedere nieuwe gebruiker, en daar viel de
   * kaartprijs al een keer door weg; de vorige ronde heeft die prijs gered door
   * hem in `Kaartkosten` te zetten. Nu de uitleg naar de uitklap gaat, valt langs
   * dezelfde weg iets ergers weg: de naam van de kaart stond in die toestand
   * ALLEEN nog in de catalogusregel ("… staat in de catalogus, niet bij je
   * rekeningen"), en die vouwt op. Dan blijft er "Kaartkosten: € 1,00 per maand"
   * over onder een kop over ontbrekende voorwaarden — een prijs zonder product.
   *
   * Dus wordt de swallow bij de wortel aangepakt in plaats van er een tweede
   * pleister op te plakken: is er een aanbeveling, dan staat DIE in de kop, in
   * elke toestand, en de oorzaak eronder als eigen zin. Is er geen aanbeveling
   * (geen kaart in de catalogus die past, geen beprijsde route), dan is de
   * oorzaak het enige wat er te zeggen valt en neemt zij de kop — nooit core's
   * eigen "ververs eerst de voorwaarden", want die opdracht kan op een server
   * zonder sleutel niet worden uitgevoerd.
   *
   * De oorzaak staat daarmee precies één keer: als kop óf als regel eronder. */
  const cause = (terms && termsHeadline(terms, c)) ?? null;
  const headline = plan?.pay ? answer : (cause ?? answer);
  const causeLine = plan?.pay ? cause : null;

  /* Het label van de uitklap is een BELOFTE en geen "meer informatie", anders
   * klikt niemand en is de onderbouwing niet opgevouwen maar zoek. Twee vormen,
   * omdat er twee soorten inhoud achter zitten: normaal de onderbouwing van een
   * bedrag, en in een toestand met een gat de reden plus de knop die hem dicht. */
  const foldLabel = cause ? c.winner.foldLabelGap : c.winner.foldLabelFull;

  return (
    <Module title="Travel" span={3} height="tall">
      <div className="travel-controls">
        <label>
          <span className="eyebrow">{fill(c.controls.from, { country: homeCountry })}</span>
          <select
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            disabled={busy}
          >
            <option value="">{c.controls.countryPlaceholder}</option>
            {c.countries.map((country) => (
              <option key={country.code} value={country.code}>
                {pick(locale, country.nl, country.en)}
              </option>
            ))}
          </select>
        </label>
        {plan?.currency && (
          <span className="eyebrow">{fill(c.controls.payingIn, { currency: plan.currency })}</span>
        )}
      </div>

      {!plan ? (
        <p className="block-empty">{c.empty}</p>
      ) : (
        <>
          {/* DE SAMENVATTING. Twee antwoorden — waarmee betaal je, waar kun je
              pinnen — en wat die twee kosten. Verder niets: alles wat een van die
              twee onderbouwt staat in de <ToonMeer> hieronder. */}
          <div className={`travel-winner${bestJourney ? "" : " travel-winner-unpriced"}`}>
            <div className="travel-winner-name">
              {/* HET MERKTEKEN BLIJFT VOORAAN, de uitleg erachter niet. De kop
                  zegt zelf al "die heb je nog niet", maar een woord alleen is niet
                  genoeg gebleken: de aanbeveling mag een kaart uit de catalogus
                  zijn (review 3, punt 2) en dan moet zichtbaar anders zijn dat je
                  hem morgenochtend niet kunt pinnen. Vóór de zin, zodat je het
                  advies niet kunt lezen zonder het merkteken. */}
              {plan.pay && !plan.pay.held && (
                <>
                  <NotYours />{" "}
                </>
              )}
              {/* De zin in een eigen span, want de kop moet los te lezen zijn: een
                  test pint dat wat hier staat het BEGIN van core's eigen zin is,
                  en met het merkteken erin gemengd zou die vergelijking op de
                  chip stuklopen in plaats van op een gewijzigde formulering. */}
              <span className="travel-winner-headline">{headline}</span>
            </div>
            {/* DE VOORWAARDE BIJ HET TARIEF DAT DE KOP NOEMT. Dit is `capNote`,
                door `fxCaveat` HERKEND uit de voorwaarden — geen vrije tekst. Een
                gedekte 0% kaal tonen is de Revolut-fout: "dat kost je niets op
                € 1.000" terwijl die 0% alleen binnen € 1.000 per maand geldt.
                Daarom staat deze wél vooraan en de brontekst van een geleerd feit
                niet: die twee zijn niet dezelfde soort zin. */}
            {plan.pay && !plan.pay.held && plan.pay.note && (
              <p className="cell-sub travel-winner-caveat">
                <strong>{c.common.caveatLabel}</strong> {plan.pay.note}
              </p>
            )}
            {/* WAT ER ONTBREEKT, in één zin. De hele melding met de knop staat in
                de uitklap (punt 16), maar een aanbeveling die is gedaan zonder dat
                we zijn eigen kaarten konden beprijzen mag dat niet verzwijgen —
                anders draagt een afwezigheid een conclusie die ze niet kan dragen. */}
            {causeLine && <p className="cell-sub travel-winner-cause">{causeLine}</p>}
            {/* WAT DIE KAART ZELF KOST. Een kaart die hij moet openen brengt zijn
                eigen maandnota mee, en die hoort naast het voordeel te staan en
                niet in een voetnoot: € 14 winst op € 1.000 tegen € 16,90 per maand
                is achteruit. Dat maakt de prijs deel van het antwoord en niet van
                de onderbouwing — vandaar dat dit blok níét opvouwt. Bij zijn EIGEN
                kaart is `holdingCost` null en rendert dit niets: die prijs loopt
                toch al door. */}
            {plan.pay && !plan.pay.held && (
              <Kaartkosten
                product={plan.pay.product}
                cost={plan.pay.holdingCost}
                benefit={plan.pay.benefit}
                testId="travel-pay-kosten"
              />
            )}
            {/* CASH. He asked for it in so many words — "also include taking
                money, physical cash. Which card can you take out money?" — and
                it is a different, worse price than paying, so it gets its own
                sentence rather than a footnote under the card advice. Het is ook
                de tweede helft van wat vooraan mag blijven staan: waarmee betaal
                je, en waar kun je pinnen. */}
            <p className="cell-sub travel-winner-cash">
              <strong>{c.winner.pinnenLabel}</strong>{" "}
              {plan.withdrawAdvice && !plan.withdrawAdvice.held && (
                <>
                  <NotYours />{" "}
                </>
              )}
              {plan.withdrawHeadline}
            </p>
            {/* Pinnen is een aparte kaart en dus een aparte prijs. Dezelfde drie
                toestanden; bij zijn eigen kaart staat er niets. */}
            {plan.withdrawAdvice && !plan.withdrawAdvice.held && (
              <Kaartkosten
                product={plan.withdrawAdvice.product}
                cost={plan.withdrawAdvice.holdingCost}
                benefit={plan.withdrawAdvice.benefit}
                testId="travel-pin-kosten"
              />
            )}
          </div>

          <ToonMeer summary={foldLabel}>
            <div className="travel-why">
              {/* DE BRONREGEL. Dit is de vrije tekst van het geleerde feit, en bij
                  bank.nl is dat "1,4% koersopslag Bron: bank.nl-vergelijking,
                  laatst gecontroleerd 15-1-2026" — een citaat, met "Let op:" ervoor
                  omdat hetzelfde veld soms een voorwaarde draagt. Precies deze
                  regel wees hij aan (punt 12). Hij verdwijnt niet: een cijfer
                  zonder herkomst is in deze app een gerucht, dus hij staat hier,
                  bovenaan de onderbouwing.
                  DE PRIJS VAN DIT VELD, eerlijk: draagt het bij een kaart die hij
                  AL heeft een limiet in plaats van een citaat, dan vouwt die limiet
                  mee op. Uit de tekst is dat niet betrouwbaar te scheiden, en gokken
                  op woorden is hoe je de ene keer een bron verstopt en de andere
                  keer een voorwaarde. De herkende limiet van een catalogus­kaart
                  loopt daarom langs `plan.pay.note` en staat wél vooraan. */}
              {bestJourney?.note && (
                <p className="cell-sub travel-winner-caveat">
                  <strong>{c.common.caveatLabel}</strong> {bestJourney.note}
                </p>
              )}
              {/* Waar de aanbevolen kaart vandaan komt en hoe oud dat tarief is.
                  De kop zegt al dát hij hem nog niet heeft; dit zegt waar hij dan
                  wél staat, en dat is onderbouwing (punt 13). */}
              {plan.pay && !plan.pay.held && (
                <p className="cell-sub travel-winner-switch">
                  <NotYours /> {fill(c.detail.switchSource, { product: plan.pay.product })}
                  {plan.pay.asOf && (
                    <>{fill(c.detail.switchAgeSuffix, { age: figureAge(plan.pay.asOf, asOf) })}</>
                  )}
                  .
                </p>
              )}
              {/* ...and what he can pay with TODAY. He still has to be able to pay
                  for lunch tomorrow, so de regel blijft bestaan — maar het woord
                  "vandaag" hoefde van hem weg van de voorgrond (punt 14), en dit is
                  ook letterlijk niet de aanbeveling maar het alternatief. */}
              {plan.pay && !plan.pay.held && plan.pay.ownProduct && (
                <p className="cell-sub travel-winner-today">
                  <strong>{c.detail.todayLabel}</strong>{" "}
                  {fill(c.detail.todayBody, {
                    product: plan.pay.ownProduct,
                    cost: formatEuroIn(locale, plan.pay.ownCostOnReference ?? 0),
                    reference: formatEuroIn(locale, TRAVEL_REFERENCE_SPEND),
                  })}
                </p>
              )}
              {/* WAAROM DE GOEDKOPERE KAART HET NIET WERD. Zijn eigen route wint
                  hier op de HELE reis, en soms alleen omdat de andere kaart geld
                  kost. Zonder deze regel verdwijnt die kaart zonder uitleg en moet
                  hij de aftrek zelf maken; dat is precies wat hij niet wil. Het is
                  wel uitleg over een kaart die NIET de aanbeveling is, dus ze hoort
                  hier en niet vooraan: vooraan beweert niets dat deze regel moet
                  rechtzetten. */}
              {plan.pay?.held && rejected && ownPct !== null && (
                <p className="cell-sub travel-note" data-testid="travel-pay-afgevallen">
                  <strong>{c.detail.notRecommendedLabel}</strong>{" "}
                  {fill(c.detail.notRecommendedBody, {
                    product: rejected.offer.product,
                    offerPct: formatPercentIn(locale, rejected.offer.netCostPct),
                    ownPct: formatPercentIn(locale, ownPct),
                    fee: feeLabel(locale, rejected.net.cost.amount),
                    gross: formatEuroIn(locale, rejected.net.grossCents / 100),
                    cost: formatEuroIn(locale, rejected.net.costCents / 100),
                    span: spanWords(rejected.net.basis, c),
                    comparison:
                      rejected.net.netCents === 0
                        ? c.detail.evenAsExpensive
                        : fill(c.detail.moreExpensiveThan, {
                            amount: formatEuroIn(locale, -rejected.net.netCents / 100),
                          }),
                    ownProduct: plan.pay.product,
                  })}
                  {floorNote(rejected.net.basis, c)}
                </p>
              )}
              {/* De maatstaf onder alle bedragen. Vooraan noemt de kop zijn eigen
                  referentie al ("op € 1.000"); hier staat hij één keer voor de hele
                  lijst, met de zin die zegt dat LaVega zelf niets verplaatst. */}
              {bestJourney && (
                <div className="cell-sub">
                  {fill(c.detail.referenceNote, { reference: formatEuroIn(locale, TRAVEL_REFERENCE_SPEND) })}
                </div>
              )}

              {/* De melding met de echte oorzaak, en de knop die eraan te doen is
                  — inclusief "Ververs voorwaarden", die van hem in dit uitgeklapte
                  deel hoort (punt 16). De zin die de oorzaak NOEMT staat vooraan;
                  wat je eraan kunt doen staat hier, bij de rest van de details. */}
              {terms && (
                <TermsNotice
                  state={terms}
                  busy={busy}
                  aiAvailable={aiAvailable}
                  termsAsked={termsAsked}
                  termsGaveUp={termsGaveUp}
                  onSearch={search}
                  onRecheckAi={onRecheckAi}
                />
              )}

              <h3 className="travel-step-title">{c.terms.routesHeading}</h3>
              {plan.journeys.length === 0 ? (
                <p className="cell-sub">
                  {plan.currency === "EUR" ? c.journeys.noRouteEuro : c.common.noAccountsKnown}
                </p>
              ) : (
                <ul className="travel-journeys">
                  {plan.journeys.map((j) => (
                    <li
                      key={journeyKey(j)}
                      className={`travel-journey${j === bestJourney ? " travel-journey-best" : ""}${j.known ? "" : " travel-journey-unknown"}`}
                    >
                      <div className="travel-journey-head">
                        <span className="travel-journey-name">{journeyTitle(j, c)}</span>
                        <span className="travel-journey-cost">
                          {j.known ? legCost(locale, c, j.totalCostPct) : c.common.unknown}
                        </span>
                      </div>

                      <ul className="travel-legs">
                        {legsOf(j, locale, c).map((leg) => (
                          <li key={leg.name} className="travel-leg">
                            <span className="travel-leg-name">
                              {leg.name} · {leg.detail}
                            </span>
                            <span className="travel-leg-cost">{leg.cost}</span>
                          </li>
                        ))}
                      </ul>

                      <p className="cell-sub travel-note">
                        {j.known
                          ? journeyWhySentence(j.why, c)
                          : fill(c.journeys.unknownReason, { why: journeyWhySentence(j.why, c) })}
                      </p>

                      {j.via === null ? (
                        <FactCorrection
                          provider={j.provider}
                          productLabel={productLabel(j.bank, j.productKind, c)}
                          factKey="fxFeePct"
                          label={fill(c.factCorrection.fxFeeLabel, {
                            pct: pct(c, plan.spend.find((s) => s.provider === j.provider)?.fxFeePct ?? null),
                          })}
                          value={
                            plan.spend.find((s) => s.provider === j.provider)?.fxFeePct ?? null
                          }
                          busy={busy}
                          onCorrect={onCorrectFact}
                        />
                      ) : (
                        <FactCorrection
                          provider={j.provider}
                          productLabel={productLabel(j.bank, j.productKind, c)}
                          factKey="convertFeePct"
                          label={fill(c.factCorrection.convertFeeLabel, { pct: pct(c, j.convertPct) })}
                          value={j.convertPct}
                          busy={busy}
                          onCorrect={onCorrectFact}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* The three original sections, kept — as the detail under the
                  answer rather than three answers standing beside it. */}
              <div className="travel-plan">
                <div className="travel-step">
                  <h3 className="travel-step-title">{c.steps.store}</h3>
                  <p className="travel-step-line">{plan.store.note}</p>
                  {plan.store.suggestion && (
                    <p className="cell-sub">
                      {fill(c.steps.storeSavings, {
                        amount: formatEuroIn(locale, plan.store.suggestion.extraPerYearCents / 100),
                      })}
                    </p>
                  )}
                </div>

                <div className="travel-step">
                  <h3 className="travel-step-title">{c.steps.exchange}</h3>
                  {/* Core's convert note carries the same "ververs eerst de
                      voorwaarden" advice as its headline, and it is wrong for
                      the same reason. When no card is priced, point at the
                      notice that names the real cause instead of repeating an
                      instruction that may be impossible to follow. */}
                  <p className="travel-step-line">
                    {bestJourney ? plan.convert.note : c.steps.exchangeNoCard}
                  </p>
                </div>

                <div className="travel-step">
                  <h3 className="travel-step-title">{c.steps.pay}</h3>
                  {plan.spend.length === 0 ? (
                    <p className="cell-sub">{c.common.noAccountsKnown}</p>
                  ) : (
                    <ul className="travel-legs">
                      {plan.spend.map((option) => {
                        const cost = costOnReferenceSpend(option.netCostPct);
                        return (
                          <li key={option.provider} className="travel-leg">
                            <span className="travel-leg-name">
                              {productLabel(option.bank, option.productKind, c)}
                              {(option.pointsPerEuro ?? 0) > 0 && (
                                <span className="eyebrow">
                                  {" "}
                                  · {fill(c.steps.pointsPerEuro, { n: option.pointsPerEuro ?? 0 })}
                                </span>
                              )}
                              {option.feeSource === "user" && (
                                <span className="eyebrow"> · {c.steps.userSetFee}</span>
                              )}
                              {option.feeSource === "agent" && option.feeUpdatedAt && (
                                <span className="eyebrow">
                                  {" "}
                                  · {figureAge(option.feeUpdatedAt, asOf)}
                                </span>
                              )}
                            </span>
                            <span className="travel-leg-cost">
                              {cost === null ? c.common.unknown : legCost(locale, c, option.netCostPct)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {plan.spendNote && <p className="cell-sub travel-note">{plan.spendNote}</p>}
                </div>
              </div>

              {/* Full width, outside the three-column grid: both are lists, and
                  a list of thirteen tariffs does not belong in a 240px column. */}
              <CashSection options={plan.withdraw} asOf={asOf} advice={plan.withdrawAdvice} />

              <OffersSection offers={plan.offers} asOf={asOf} ownPct={ownPct} />

              {plan.unidentifiedCount > 0 && (
                <p className="cell-sub">
                  {fill(
                    plan.unidentifiedCount === 1 ? c.detail.unidentifiedOne : c.detail.unidentifiedMany,
                    { count: plan.unidentifiedCount },
                  )}
                </p>
              )}
            </div>
          </ToonMeer>
        </>
      )}
    </Module>
  );
}
