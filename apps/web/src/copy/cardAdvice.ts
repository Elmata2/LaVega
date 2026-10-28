import {
  CARD_ADVICE_MIN_MONTHS,
  type CardAdvice,
  type CardOption,
  type FeeNote,
  type InterestAdvice,
  type NotComparableReason,
  type PointsAdvice,
  type SourceRef,
} from "@lavega/core";
import type { Locale } from "../locale.js";
import type { PlanFmt } from "./plan/shared.js";

/* Card advice copy. It lives outside copy/plan on purpose: the plan copy suite
 * asserts "no advice language" over everything in that folder, and the owner has
 * decided (27 Oct 2026) that LaVega may recommend cards and ways to pay off card
 * credit, as long as every number is traceable. Investing stays out of it. */

export type CardAdviceCopy = {
  title: string;
  howTitle: string;
  perYear: string;
  /** The card the user holds, in a list. */
  yours: string;
  /** Headline when nothing can be computed (not enough history, no spend, nothing comparable). */
  noAdvice: (a: CardAdvice, fmt: PlanFmt) => string;
  verdict: (a: CardAdvice, fmt: PlanFmt) => string;
  rankedTitle: string;
  optionLine: (o: CardOption, a: CardAdvice, fmt: PlanFmt) => string;
  unvaluedPoints: string;
  optionCalc: (o: CardOption, a: CardAdvice, fmt: PlanFmt) => string[];
  spendCalc: (a: CardAdvice, fmt: PlanFmt) => string;
  sourceLine: (s: SourceRef, fmt: PlanFmt) => string;
  sourceLink: string;
  caveats: string[];
  notComparableTitle: (n: number) => string;
  notComparableLine: (o: CardOption) => string;
  reasons: Record<NotComparableReason, string>;
  /** The comparison leaves out card interest while a balance is carried. */
  interestIgnored: string;
  feeNoteLine: (n: FeeNote, annualCents: number, f: PlanFmt) => string;
  conditionsTitle: string;
  interestTitle: (i: InterestAdvice) => string;
  interestLines: (i: InterestAdvice, fmt: PlanFmt) => string[];
  interestCalc: (i: InterestAdvice, fmt: PlanFmt) => string[];
  pointsTitle: string;
  pointsLines: (p: PointsAdvice, fmt: PlanFmt) => string[];
  pointsCalc: (p: PointsAdvice, fmt: PlanFmt) => string[];
  pointsLinkNote: string;
  editTitle: string;
  editNote: string;
  editSave: string;
  editSaved: string;
  editFailed: string;
  noCardsToEdit: string;
  otherCardName: string;
  yourCard: string;
};

const cents = (v: number, f: PlanFmt) => f.eur(v);
const distinct = (
  cards: readonly CardOption[],
  reasons: Record<NotComparableReason, string>,
): string => [...new Set(cards.flatMap((c) => c.reasons.map((r) => reasons[r])))].join("; ");
/** "X cannot be compared (reason)" for each card of the user that blocks the comparison. */
const blockerText = (a: CardAdvice, c: { reasons: Record<NotComparableReason, string>; otherCardName: string }): string =>
  a.baseline.kind !== "unknown"
    ? ""
    : a.baseline.blockers
        .map((b) => `${b.name ?? c.otherCardName} (${b.reasons.map((r) => c.reasons[r]).join("; ")})`)
        .join(", ");
const signed = (v: number, f: PlanFmt) => `${v >= 0 ? "+" : ""}${f.eur(v)}`;
const pct = (n: number, f: PlanFmt) => f.points(n);

const nl: CardAdviceCopy = {
  title: "Aanbeveling voor je kaarten",
  howTitle: "Zo is het berekend",
  perYear: "per jaar",
  yours: "jouw kaart",
  yourCard: "je creditcard",
  otherCardName: "een andere creditcard",
  noAdvice: (a) =>
    a.state === "short-history"
      ? `Er zijn minder dan ${CARD_ADVICE_MIN_MONTHS} volle maanden aan uitgaven. Voor een jaarcijfer is dat te weinig. Er is niets geschat.`
      : a.state === "no-spend"
        ? "Er zijn geen uitgaven gevonden die met een kaart te betalen zijn. Zonder uitgaven valt er niets te vergelijken."
        : `Geen enkele kaart in de catalogus is volledig te vergelijken (${distinct(a.notComparable, nl.reasons)}). Er is niets geschat.`,
  verdict: (a, f) => {
    const v = a.verdict;
    const best = a.options[0];
    if (v.kind === "switch") {
      const base = a.baseline;
      if (base.kind === "best-held")
        return `Aanbeveling: ${v.best.name}. Bij jouw uitgaven is de nettowaarde ${cents(v.best.netCents!, f)} per jaar, ${cents(v.gainCents, f)} meer dan ${base.name} (${cents(base.netCents, f)}).`;
      return `Aanbeveling: ${v.best.name}. Bij jouw uitgaven is de nettowaarde ${cents(v.best.netCents!, f)} per jaar. Zonder creditcard is dat ${cents(0, f)}.`;
    }
    if (v.kind === "keep" && best !== undefined)
      return best.held
        ? `Je kaart ${best.name} is bij jouw uitgaven de beste van de kaarten die we kunnen vergelijken (${cents(best.netCents!, f)} per jaar).`
        : `Je huidige kaart is al dichtbij de beste: ${best.name} zou ${cents(v.gainCents, f)} per jaar meer opleveren. Dat is te weinig om over te stappen.`;
    if (v.kind === "no-card-worth-it")
      return "Zonder creditcard betaal je niets. Geen kaart in de catalogus levert bij jouw uitgaven genoeg op om dat te veranderen.";
    if (v.kind === "unknown-baseline")
      return `Je huidige ${a.baseline.kind === "unknown" && a.baseline.blockers.length === 1 ? "kaart" : "kaarten"} is niet te vergelijken: ${blockerText(a, nl)}. Er is dus geen aanbeveling om over te stappen. Dit zijn de kaarten met de hoogste nettowaarde bij jouw uitgaven.`;
    return "";
  },
  rankedTitle: "Kaarten naast elkaar, bij jouw uitgaven",
  interestIgnored:
    "Let op: de rente van kaarten zit niet in deze vergelijking, want de catalogus heeft geen kaartrentes. Bij een openstaand saldo kan de rente zwaarder wegen dan dit verschil.",
  conditionsTitle: "voorwaarden van de bron",
  feeNoteLine: (n, annual, f) =>
    n.kind === "min-spend"
      ? `De jaarkosten hangen af van je uitgaven op de kaart: vanaf ${cents(n.thresholdCents, f)} per jaar gelden de kosten van de catalogus, eronder ${f.eurExact(n.otherwiseCents)} per jaar. Jouw uitgaven: ${cents(annual, f)} per jaar, dus ${n.met ? "de lage kosten gelden" : "de hogere kosten gelden"}.`
      : n.kind === "package"
        ? n.applied
          ? `Deze kaart hoort bij het pakket ${n.name}; de ${f.eurExact(n.yearlyCents)} per jaar voor dat pakket zijn erbij opgeteld. Heb je het pakket al, dan vervalt dat bedrag.`
          : `Deze kaart hoort bij het pakket ${n.name} (${f.eurExact(n.yearlyCents)} per jaar). Dat pakket heb je al, dus het is niet bijgeteld.`
        : n.why === "anwb-membership"
          ? "Bij deze kaart hoort een ANWB-lidmaatschap. De prijs daarvan staat niet in de catalogus."
          : "De prijs van het bankpakket waar deze kaart bij hoort staat niet in de catalogus.",
  optionLine: (o, a, f) => {
    const base = a.baseline.kind === "unknown" ? null : a.baseline.netCents;
    const isBaseline = a.baseline.kind === "best-held" && a.baseline.cardId === o.cardId;
    const diff =
      base === null || o.netCents === null || isBaseline
        ? ""
        : `; verschil met ${a.baseline.kind === "best-held" ? "jouw beste kaart" : "geen kaart"}: ${signed(o.netCents - base, f)}`;
    return `${o.name}${o.held ? ` (${nl.yours})` : ""}: nettowaarde ${cents(o.netCents!, f)} ${nl.perYear}${diff}`;
  },
  unvaluedPoints: "puntenwaarde niet meegeteld: geen waarde per punt bekend",
  spendCalc: (a, f) =>
    `Uitgaven die met een kaart te betalen zijn: ${cents(a.spend.windowCents, f)} over ${a.spend.months} volle maanden, dat is ${cents(a.spend.annualCents, f)} per jaar (maal 12, gedeeld door ${a.spend.months}). Huur, hypotheek, belasting, verzekeringen, aflossingen, contant geld en eigen overboekingen zijn niet meegeteld. Alle overige uitgaven staan in deze som op de kaart; of elke winkel de kaart accepteert is niet gecontroleerd. Daarvan in een andere valuta: ${cents(a.spend.annualForeignCents, f)} per jaar.${a.spend.excludedForeignCount > 0 ? ` ${a.spend.excludedForeignCount} regels in een andere valuta zijn niet meegeteld; de opslag daarover is dus niet vergeleken.` : ""}`,
  optionCalc: (o, a, f) => {
    const out: string[] = [];
    out.push(
      o.feeCents === null ? "Jaarkosten: onbekend." : `Jaarkosten: ${f.eurExact(o.feeCents)}.`,
    );
    if (o.feeNote !== null) out.push(nl.feeNoteLine(o.feeNote, a.spend.annualCents, f));
    if (o.fxFeePct !== null && o.fxCostCents !== null)
      out.push(
        `Opslag buitenlandse valuta: ${cents(a.spend.annualForeignCents, f)} maal ${pct(o.fxFeePct, f)} = ${f.eurExact(o.fxCostCents)}.`,
      );
    if (o.cashbackPct !== null && o.cashbackCents !== null)
      out.push(
        `Cashback: ${cents(a.spend.annualCents, f)} maal ${pct(o.cashbackPct, f)} = ${f.eurExact(o.cashbackCents)}.`,
      );
    if (o.pointsPerEuro !== null && o.pointsEarned !== null) {
      if (o.pointsValueCents !== null && o.centsPerPoint !== null)
        out.push(
          `Punten: ${cents(a.spend.annualCents, f)} maal ${f.plain(o.pointsPerEuro)} punt per euro = ${f.count(o.pointsEarned)} punten, maal ${f.plain(o.centsPerPoint)} cent per punt = ${f.eurExact(o.pointsValueCents)}.`,
        );
      else if (o.pointsEarned > 0)
        out.push(
          `Punten: ${f.count(o.pointsEarned)} punten per jaar, zonder bekende waarde per punt. Niet in de nettowaarde.`,
        );
      else out.push("Punten: deze kaart levert geen punten op.");
    }
    out.push(
      `Nettowaarde = punten${o.cashbackCents === null ? "" : " + cashback"} - jaarkosten - opslag = ${f.eurExact(o.netCents ?? 0)}.`,
    );
    return out;
  },
  sourceLine: (s, f) => {
    const what = {
      fee: "Jaarkosten",
      fx: "Opslag buitenlandse valuta",
      points: "Punten per euro",
      cashback: "Cashback",
      pointValue: "Waarde per punt",
    }[s.field];
    return `${what}: ${s.asOf === null ? "datum onbekend" : `gecontroleerd op ${f.date(s.asOf)}`}`;
  },
  sourceLink: "bron",
  caveats: [
    "Alle uitgaven staan in deze berekening op de kaart. Niet gecontroleerd: of je als klant wordt geaccepteerd, welke bank of welk pakket de kaart vraagt en of de voorwaarden voor jou gelden.",
    "Zakelijke kaarten zijn niet meegenomen. Cashback die de catalogus niet kent is niet meegerekend.",
  ],
  notComparableTitle: (n) => `Niet te vergelijken (${n})`,
  notComparableLine: (o) => `${o.name}: ${o.reasons.map((r) => nl.reasons[r]).join("; ")}`,
  reasons: {
    "fee-unknown": "jaarkosten niet in de catalogus",
    "fx-unknown": "opslag buitenlandse valuta niet in de catalogus",
    "points-unknown": "punten per euro niet in de catalogus",
    "fee-condition-unknown": "de jaarkosten hangen af van iets waarvan de prijs niet in de catalogus staat",
    "points-unvalued": "de waarde van de punten of miles is onbekend; vul een inwisselvoorbeeld in",
    "not-in-catalogue": "niet in de catalogus",
  },
  interestTitle: (i) => `Rente op ${i.name ?? nl.otherCardName}`,
  interestLines: (i, f) => {
    const out: string[] = [];
    out.push(
      i.ratePct === null || i.yearlyInterestCents === null
        ? `Je laat ${cents(i.balanceCents, f)} staan. Elke 1% rente kost daarover ${cents(i.perPointCents, f)} per jaar. De rente is niet ingevuld, dus er is niets geschat.`
        : `Je laat ${cents(i.balanceCents, f)} staan tegen ${pct(i.ratePct, f)}. Dat kost ${cents(i.yearlyInterestCents, f)} rente per jaar, zolang het saldo gelijk blijft.`,
    );
    const rate = i.ratePct === null ? "" : pct(i.ratePct, f);
    switch (i.recommendation) {
      case "enter-rate":
        out.push("Vul de rente van je kaart in (bij de kaartgegevens hieronder) voor een aanbeveling.");
        break;
      case "keep-balance":
        out.push(
          `Je creditcardrente (${rate}) is niet hoger dan de beste spaarrente${i.savingsRate === null ? "" : ` (${pct(i.savingsRate.ratePct, f)} bij ${i.savingsRate.bank})`}. Aflossen met spaargeld levert dan geen voordeel op.`,
        );
        break;
      case "payoff-all":
      case "payoff-partial": {
        const saved = i.interestSavedCents ?? 0;
        const tail =
          i.forgoneSavingsCents === null || i.savingsRate === null || i.netSavingCents === null
            ? `Dat scheelt ${cents(saved, f)} rente per jaar. De spaarrente die je dan misloopt is niet vast te stellen.`
            : `Dat scheelt ${cents(saved, f)} rente per jaar. Je loopt ${cents(i.forgoneSavingsCents, f)} spaarrente mis (${pct(i.savingsRate.ratePct, f)} bij ${i.savingsRate.bank}). Netto ${cents(i.netSavingCents, f)} per jaar.`;
        const share =
          i.availableCents !== null && i.surplusCents !== null && i.availableCents < i.surplusCents
            ? `, waarvan ${cents(i.availableCents, f)} voor deze kaart overblijft na kaarten met een hogere rente`
            : "";
        out.push(
          i.recommendation === "payoff-all"
            ? `Aanbeveling: los het hele saldo af met spaargeld. Je hebt ${cents(i.surplusCents ?? 0, f)} boven je buffer${share}. ${tail}`
            : `Aanbeveling: los ${cents(i.payoffCents, f)} af met het spaargeld boven je buffer (${cents(i.surplusCents ?? 0, f)}${share}). ${tail} Er blijft ${cents(i.remainingCents, f)} openstaan op deze kaart: kies daarvoor goedkoper krediet. Alles onder ${rate} kost minder; elke procent lager scheelt ${cents(Math.round(i.remainingCents / 100), f)} per jaar.`,
        );
        break;
      }
      case "move-credit":
        out.push(
          `${i.surplusCents !== null && i.surplusCents > 0 ? "Het spaargeld boven je buffer gaat al naar kaarten met een hogere rente, dus" : "Je hebt geen spaargeld boven je buffer, dus"} aflossen met spaargeld is hier niet aan te raden. Aanbeveling: vervang dit krediet door goedkoper krediet. Alles onder ${rate} kost minder; elke procent lager scheelt ${cents(i.perPointCents, f)} per jaar. We noemen geen product: er is geen bron voor actuele kredietrentes.`,
        );
        break;
      case "unknown-buffer":
        out.push(
          `Of je spaargeld kunt gebruiken is niet te bepalen: je buffer of je vaste lasten ontbreken. Vul die in voor een aanbeveling over aflossen. Wil je het saldo goedkoper financieren? Alles onder ${rate} kost minder; elke procent lager scheelt ${cents(i.perPointCents, f)} per jaar. We noemen geen product: er is geen bron voor actuele kredietrentes.`,
        );
        break;
    }
    return out;
  },
  interestCalc: (i, f) => {
    const out: string[] = [];
    if (i.ratePct !== null && i.yearlyInterestCents !== null)
      out.push(
        `Rente per jaar = saldo ${f.eurExact(i.balanceCents)} maal ${pct(i.ratePct, f)} = ${f.eurExact(i.yearlyInterestCents)}. Het saldo blijft in deze som gelijk en er is niet samengesteld.`,
      );
    out.push(`Elke 1% = ${f.eurExact(i.perPointCents)} per jaar over dit saldo.`);
    if (i.surplusCents !== null)
      out.push(
        `Spaargeld boven je buffer = spaargeld - vaste lasten maal de gewenste maanden buffer = ${f.eurExact(i.surplusCents)}. Dat bedrag wordt één keer verdeeld, de hoogste rente eerst; voor deze kaart was ${f.eurExact(i.availableCents ?? 0)} beschikbaar.`,
      );
    if (i.interestSavedCents !== null && i.payoffCents > 0)
      out.push(
        `Af te lossen ${f.eurExact(i.payoffCents)} maal ${pct(i.ratePct ?? 0, f)} = ${f.eurExact(i.interestSavedCents)} minder rente.`,
      );
    if (i.savingsRate !== null && i.forgoneSavingsCents !== null && i.payoffCents > 0)
      out.push(
        `Gemiste spaarrente = ${f.eurExact(i.payoffCents)} maal ${pct(i.savingsRate.ratePct, f)} (beste vrij opneembare rente die we kennen: ${i.savingsRate.bank}, ${i.savingsRate.product}${i.savingsRate.asOf === null ? "" : `, van ${f.date(i.savingsRate.asOf)}`}) = ${f.eurExact(i.forgoneSavingsCents)}.`,
      );
    return out;
  },
  pointsTitle: "Je punten",
  pointsLines: (p, f) => {
    const out = [`${p.program}: ${f.count(p.points)} punten.`];
    if (p.valueCents === null || p.valuation === null)
      out.push(
        "Waarde: niet vast te stellen. Er is geen gepubliceerde waarde per punt. Voeg hieronder een eigen inwisselvoorbeeld toe.",
      );
    else if (p.valuation.basis === "own-examples")
      out.push(
        `Waarde: ${f.eurRange(p.valueCents.lowCents, p.valueCents.highCents)} (midden ${f.eur(p.valueCents.medianCents)}), volgens je ${p.valuation.examples} eigen inwisselvoorbeelden.`,
      );
    else
      out.push(
        `Indicatieve waarde: ${f.eur(p.valueCents.medianCents)} bij betalen met punten.`,
      );
    out.push(
      p.expiresOn === null
        ? "Verloopt: niet bekend. De catalogus kent geen vervaltermijn; vul je eigen datum in."
        : p.expiresSoon
          ? `Let op: deze punten verlopen op ${f.date(p.expiresOn)}.`
          : `Verloopt op ${f.date(p.expiresOn)}.`,
    );
    if (p.stale) out.push("Het saldo is al een tijd niet bijgewerkt.");
    return out;
  },
  pointsCalc: (p, f) => {
    if (p.valuation === null || p.valueCents === null)
      return ["Zonder bekende waarde per punt rekenen we niet met een waarde."];
    const v = p.valuation;
    const rate = `${f.plain(v.medianCentsPerPoint)} cent per punt`;
    return v.basis === "own-examples"
      ? [
          `Waarde = punten maal laagste, middelste en hoogste waarde per punt uit je ${v.examples} eigen voorbeelden: ${f.count(p.points)} maal ${f.plain(v.lowCentsPerPoint)} tot ${f.plain(v.highCentsPerPoint)} cent.`,
        ]
      : [
          `Waarde = ${f.count(p.points)} punten maal ${rate}${v.asOf === null ? "" : ` (gecontroleerd op ${f.date(v.asOf)})`}.`,
          ...(v.conditions === null ? [] : [`Voorwaarde: ${v.conditions}.`]),
        ];
  },
  pointsLinkNote: "Bron",
  editTitle: "Saldo's en punten van je creditcards",
  editNote:
    "Een saldo en puntenstand zorgen voor een betere aanbeveling. Laat een kaart leeg om hem over te slaan.",
  editSave: "Opslaan",
  editSaved: "Opgeslagen.",
  editFailed: "Opslaan lukte niet. Probeer het nog eens.",
  noCardsToEdit: "Geef bij de intake eerst aan welke creditcards je hebt.",
};

const en: CardAdviceCopy = {
  title: "Recommendation for your cards",
  howTitle: "How this is calculated",
  perYear: "a year",
  yours: "your card",
  yourCard: "your credit card",
  otherCardName: "another credit card",
  noAdvice: (a) =>
    a.state === "short-history"
      ? `There are fewer than ${CARD_ADVICE_MIN_MONTHS} full months of spending. That is too little for a yearly figure. Nothing has been estimated.`
      : a.state === "no-spend"
        ? "No spending was found that can be paid by card. Without spending there is nothing to compare."
        : `No card in the catalogue can be compared in full (${distinct(a.notComparable, en.reasons)}). Nothing has been estimated.`,
  verdict: (a, f) => {
    const v = a.verdict;
    const best = a.options[0];
    if (v.kind === "switch") {
      const base = a.baseline;
      if (base.kind === "best-held")
        return `Recommendation: ${v.best.name}. At your spending its net value is ${cents(v.best.netCents!, f)} a year, ${cents(v.gainCents, f)} more than ${base.name} (${cents(base.netCents, f)}).`;
      return `Recommendation: ${v.best.name}. At your spending its net value is ${cents(v.best.netCents!, f)} a year. Without a credit card that is ${cents(0, f)}.`;
    }
    if (v.kind === "keep" && best !== undefined)
      return best.held
        ? `Your card ${best.name} is the best of the cards we can compare at your spending (${cents(best.netCents!, f)} a year).`
        : `Your current card is already close to the best: ${best.name} would earn ${cents(v.gainCents, f)} a year more. That is too little to switch for.`;
    if (v.kind === "no-card-worth-it")
      return "Without a credit card you pay nothing. No card in the catalogue earns enough at your spending to change that.";
    if (v.kind === "unknown-baseline")
      return `Your current ${a.baseline.kind === "unknown" && a.baseline.blockers.length === 1 ? "card" : "cards"} cannot be compared: ${blockerText(a, en)}. So there is no recommendation to switch. These are the cards with the highest net value at your spending.`;
    return "";
  },
  rankedTitle: "Cards side by side, at your spending",
  interestIgnored:
    "Note: card interest is not part of this comparison, because the catalogue has no card rates. With a balance carried over, interest can weigh more than this difference.",
  conditionsTitle: "the source's terms",
  feeNoteLine: (n, annual, f) =>
    n.kind === "min-spend"
      ? `The annual fee depends on your spending on the card: from ${cents(n.thresholdCents, f)} a year the catalogue fee applies, below it ${f.eurExact(n.otherwiseCents)} a year. Your spending: ${cents(annual, f)} a year, so ${n.met ? "the low fee applies" : "the higher fee applies"}.`
      : n.kind === "package"
        ? n.applied
          ? `This card comes with the ${n.name} package; its ${f.eurExact(n.yearlyCents)} a year has been added. If you already have the package, that amount drops.`
          : `This card comes with the ${n.name} package (${f.eurExact(n.yearlyCents)} a year). You already have it, so it is not added.`
        : n.why === "anwb-membership"
          ? "This card requires an ANWB membership. Its price is not in the catalogue."
          : "The price of the bank package this card comes with is not in the catalogue.",
  optionLine: (o, a, f) => {
    const base = a.baseline.kind === "unknown" ? null : a.baseline.netCents;
    const isBaseline = a.baseline.kind === "best-held" && a.baseline.cardId === o.cardId;
    const diff =
      base === null || o.netCents === null || isBaseline
        ? ""
        : `; difference with ${a.baseline.kind === "best-held" ? "your best card" : "no card"}: ${signed(o.netCents - base, f)}`;
    return `${o.name}${o.held ? ` (${en.yours})` : ""}: net value ${cents(o.netCents!, f)} ${en.perYear}${diff}`;
  },
  unvaluedPoints: "points value not counted: no value per point known",
  spendCalc: (a, f) =>
    `Spending that can be paid by card: ${cents(a.spend.windowCents, f)} over ${a.spend.months} full months, which is ${cents(a.spend.annualCents, f)} a year (times 12, divided by ${a.spend.months}). Rent, mortgage, tax, insurance, loan repayments, cash and transfers between your own accounts are left out. All other spending is counted as on the card; whether every shop accepts the card is not checked. Of this in another currency: ${cents(a.spend.annualForeignCents, f)} a year.${a.spend.excludedForeignCount > 0 ? ` ${a.spend.excludedForeignCount} lines in another currency are not counted, so the markup on them is not compared.` : ""}`,
  optionCalc: (o, a, f) => {
    const out: string[] = [];
    out.push(o.feeCents === null ? "Annual fee: unknown." : `Annual fee: ${f.eurExact(o.feeCents)}.`);
    if (o.feeNote !== null) out.push(en.feeNoteLine(o.feeNote, a.spend.annualCents, f));
    if (o.fxFeePct !== null && o.fxCostCents !== null)
      out.push(
        `Foreign currency markup: ${cents(a.spend.annualForeignCents, f)} times ${pct(o.fxFeePct, f)} = ${f.eurExact(o.fxCostCents)}.`,
      );
    if (o.cashbackPct !== null && o.cashbackCents !== null)
      out.push(
        `Cashback: ${cents(a.spend.annualCents, f)} times ${pct(o.cashbackPct, f)} = ${f.eurExact(o.cashbackCents)}.`,
      );
    if (o.pointsPerEuro !== null && o.pointsEarned !== null) {
      if (o.pointsValueCents !== null && o.centsPerPoint !== null)
        out.push(
          `Points: ${cents(a.spend.annualCents, f)} times ${f.plain(o.pointsPerEuro)} point per euro = ${f.count(o.pointsEarned)} points, times ${f.plain(o.centsPerPoint)} cent per point = ${f.eurExact(o.pointsValueCents)}.`,
        );
      else if (o.pointsEarned > 0)
        out.push(
          `Points: ${f.count(o.pointsEarned)} points a year, with no known value per point. Not in the net value.`,
        );
      else out.push("Points: this card earns no points.");
    }
    out.push(
      `Net value = points${o.cashbackCents === null ? "" : " + cashback"} - annual fee - markup = ${f.eurExact(o.netCents ?? 0)}.`,
    );
    return out;
  },
  sourceLine: (s, f) => {
    const what = {
      fee: "Annual fee",
      fx: "Foreign currency markup",
      points: "Points per euro",
      cashback: "Cashback",
      pointValue: "Value per point",
    }[s.field];
    return `${what}: ${s.asOf === null ? "date unknown" : `checked on ${f.date(s.asOf)}`}`;
  },
  sourceLink: "source",
  caveats: [
    "All spending counts as on the card in this calculation. Not checked: whether you would be accepted as a customer, which bank or package the card requires, and whether its terms apply to you.",
    "Business cards are left out. Cashback the catalogue does not know is not counted.",
  ],
  notComparableTitle: (n) => `Cannot be compared (${n})`,
  notComparableLine: (o) => `${o.name}: ${o.reasons.map((r) => en.reasons[r]).join("; ")}`,
  reasons: {
    "fee-unknown": "annual fee not in the catalogue",
    "fx-unknown": "foreign currency markup not in the catalogue",
    "points-unknown": "points per euro not in the catalogue",
    "fee-condition-unknown": "the annual fee depends on something whose price is not in the catalogue",
    "points-unvalued": "the value of the points or miles is unknown; add a redemption example",
    "not-in-catalogue": "not in the catalogue",
  },
  interestTitle: (i) => `Interest on ${i.name ?? en.otherCardName}`,
  interestLines: (i, f) => {
    const out: string[] = [];
    out.push(
      i.ratePct === null || i.yearlyInterestCents === null
        ? `You leave ${cents(i.balanceCents, f)} outstanding. Every 1% of interest costs ${cents(i.perPointCents, f)} a year on that. The rate is not filled in, so nothing has been estimated.`
        : `You leave ${cents(i.balanceCents, f)} outstanding at ${pct(i.ratePct, f)}. That costs ${cents(i.yearlyInterestCents, f)} in interest a year, as long as the balance stays the same.`,
    );
    const rate = i.ratePct === null ? "" : pct(i.ratePct, f);
    switch (i.recommendation) {
      case "enter-rate":
        out.push("Fill in your card's interest rate (in the card details below) for a recommendation.");
        break;
      case "keep-balance":
        out.push(
          `Your credit card rate (${rate}) is not higher than the best savings rate${i.savingsRate === null ? "" : ` (${pct(i.savingsRate.ratePct, f)} at ${i.savingsRate.bank})`}. Paying off from savings then gains nothing.`,
        );
        break;
      case "payoff-all":
      case "payoff-partial": {
        const saved = i.interestSavedCents ?? 0;
        const tail =
          i.forgoneSavingsCents === null || i.savingsRate === null || i.netSavingCents === null
            ? `That saves ${cents(saved, f)} in interest a year. The savings interest you would give up cannot be determined.`
            : `That saves ${cents(saved, f)} in interest a year. You give up ${cents(i.forgoneSavingsCents, f)} in savings interest (${pct(i.savingsRate.ratePct, f)} at ${i.savingsRate.bank}). Net ${cents(i.netSavingCents, f)} a year.`;
        const share =
          i.availableCents !== null && i.surplusCents !== null && i.availableCents < i.surplusCents
            ? `, of which ${cents(i.availableCents, f)} is left for this card after cards with a higher rate`
            : "";
        out.push(
          i.recommendation === "payoff-all"
            ? `Recommendation: pay off the whole balance from savings. You have ${cents(i.surplusCents ?? 0, f)} above your buffer${share}. ${tail}`
            : `Recommendation: pay off ${cents(i.payoffCents, f)} from the savings above your buffer (${cents(i.surplusCents ?? 0, f)}${share}). ${tail} ${cents(i.remainingCents, f)} stays outstanding on this card: choose cheaper credit for that. Anything under ${rate} costs less; each percentage point lower saves ${cents(Math.round(i.remainingCents / 100), f)} a year.`,
        );
        break;
      }
      case "move-credit":
        out.push(
          `${i.surplusCents !== null && i.surplusCents > 0 ? "The savings above your buffer already go to cards with a higher rate, so" : "You have no savings above your buffer, so"} paying off from savings is not advisable here. Recommendation: replace this credit with cheaper credit. Anything under ${rate} costs less; each percentage point lower saves ${cents(i.perPointCents, f)} a year. We name no product: there is no source for current credit rates.`,
        );
        break;
      case "unknown-buffer":
        out.push(
          `Whether you can use savings cannot be determined: your buffer or fixed costs are missing. Fill them in for a pay-off recommendation. Want to finance the balance more cheaply? Anything under ${rate} costs less; each percentage point lower saves ${cents(i.perPointCents, f)} a year. We name no product: there is no source for current credit rates.`,
        );
        break;
    }
    return out;
  },
  interestCalc: (i, f) => {
    const out: string[] = [];
    if (i.ratePct !== null && i.yearlyInterestCents !== null)
      out.push(
        `Interest a year = balance ${f.eurExact(i.balanceCents)} times ${pct(i.ratePct, f)} = ${f.eurExact(i.yearlyInterestCents)}. The balance stays the same in this sum and nothing is compounded.`,
      );
    out.push(`Every 1% = ${f.eurExact(i.perPointCents)} a year on this balance.`);
    if (i.surplusCents !== null)
      out.push(
        `Savings above your buffer = savings - fixed costs times the wanted months of buffer = ${f.eurExact(i.surplusCents)}. That amount is divided once, highest rate first; ${f.eurExact(i.availableCents ?? 0)} was available for this card.`,
      );
    if (i.interestSavedCents !== null && i.payoffCents > 0)
      out.push(
        `To pay off ${f.eurExact(i.payoffCents)} times ${pct(i.ratePct ?? 0, f)} = ${f.eurExact(i.interestSavedCents)} less interest.`,
      );
    if (i.savingsRate !== null && i.forgoneSavingsCents !== null && i.payoffCents > 0)
      out.push(
        `Savings interest given up = ${f.eurExact(i.payoffCents)} times ${pct(i.savingsRate.ratePct, f)} (best freely withdrawable rate we know: ${i.savingsRate.bank}, ${i.savingsRate.product}${i.savingsRate.asOf === null ? "" : `, dated ${f.date(i.savingsRate.asOf)}`}) = ${f.eurExact(i.forgoneSavingsCents)}.`,
      );
    return out;
  },
  pointsTitle: "Your points",
  pointsLines: (p, f) => {
    const out = [`${p.program}: ${f.count(p.points)} points.`];
    if (p.valueCents === null || p.valuation === null)
      out.push(
        "Value: cannot be determined. There is no published value per point. Add a redemption example of your own below.",
      );
    else if (p.valuation.basis === "own-examples")
      out.push(
        `Value: ${f.eurRange(p.valueCents.lowCents, p.valueCents.highCents)} (middle ${f.eur(p.valueCents.medianCents)}), by your ${p.valuation.examples} own redemption examples.`,
      );
    else out.push(`Indicative value: ${f.eur(p.valueCents.medianCents)} when paying with points.`);
    out.push(
      p.expiresOn === null
        ? "Expiry: not known. The catalogue holds no expiry term; enter your own date."
        : p.expiresSoon
          ? `Note: these points expire on ${f.date(p.expiresOn)}.`
          : `Expires on ${f.date(p.expiresOn)}.`,
    );
    if (p.stale) out.push("The balance has not been updated for a while.");
    return out;
  },
  pointsCalc: (p, f) => {
    if (p.valuation === null || p.valueCents === null)
      return ["Without a known value per point, no value is calculated."];
    const v = p.valuation;
    const rate = `${f.plain(v.medianCentsPerPoint)} cent per point`;
    return v.basis === "own-examples"
      ? [
          `Value = points times the lowest, middle and highest value per point from your ${v.examples} own examples: ${f.count(p.points)} times ${f.plain(v.lowCentsPerPoint)} to ${f.plain(v.highCentsPerPoint)} cent.`,
        ]
      : [
          `Value = ${f.count(p.points)} points times ${rate}${v.asOf === null ? "" : ` (checked on ${f.date(v.asOf)})`}.`,
          ...(v.conditions === null ? [] : [`Condition: ${v.conditions}.`]),
        ];
  },
  pointsLinkNote: "Source",
  editTitle: "Balances and points of your credit cards",
  editNote:
    "A balance and a points balance make the recommendation better. Leave a card empty to skip it.",
  editSave: "Save",
  editSaved: "Saved.",
  editFailed: "Saving did not work. Please try again.",
  noCardsToEdit: "Say which credit cards you have in the intake first.",
};

export const cardAdviceCopy: Record<Locale, CardAdviceCopy> = { nl, en };
