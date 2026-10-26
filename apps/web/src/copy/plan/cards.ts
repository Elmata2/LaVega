import type { CardNet, CardTier, CardsCalcId, CardsFigures } from "@lavega/core";
import type { Locale } from "../../locale.js";
import {
  DASH,
  PLAN_NUMBERS,
  type CardsMissingKind,
  type CardsReasonKey,
  type FactSlot,
  type PlanFmt,
  type SectionCopy,
} from "./shared.js";

/** Section 6: Cards and points. Net value at the user's own spend. Default
 *  order is by name; no row is highlighted, ranked or labelled. */
export type CardsCopy = SectionCopy<CardsFigures, CardsReasonKey, CardsMissingKind, CardsCalcId> & {
  labels: {
    card: string;
    annualFee: string;
    cashback: string;
    fxFee: string;
    pointsPerEuro: string;
    pointsExpiry: string;
    transferRatio: string;
    insurance: string;
    netValue: string;
  };
  sortNote: string;
  tier: Record<CardTier, string>;
  /** A criteria value the catalogue has no figure for. */
  unknownValue: string;
  netLine: (net: CardNet, fmt: PlanFmt) => string;
  /** Plain statement that a fee share under twelve months covers only those months. */
  feeShareNote: (months: number) => string;
  pointsLine: (name: string, net: CardNet, fmt: PlanFmt) => string | null;
  balanceLine: (points: number, expiresOn: string | null, stale: boolean, fmt: PlanFmt) => string;
  breakEvenLine: (name: string, annualSpendCents: number | null, fmt: PlanFmt) => string;
  /** No market value is assumed for a point. */
  noMarketValue: string;
  /** Filled only from a verified card-terms fact. */
  facts: { cardTerms: FactSlot };
};

/** The reason line never compares the cards: it names what the rows below
 *  show. Which card nets more is for the reader to see in the figures. */
const NET_PER_CARD_NL = "Nettowaarde per kaart bij dezelfde uitgaven:";
const NET_PER_CARD_EN = "Net value per card for the same spending:";

const nl: CardsCopy = {
  reasons: {
    "no-better-card": NET_PER_CARD_NL,
    "in-use-card-unknown":
      "Welke kaart je gebruikt is niet bekend, dus er is niets om mee te vergelijken.",
    "other-card-nets-more": NET_PER_CARD_NL,
    "no-card-data": "Er zijn geen kaartgegevens.",
    "no-cardable-spend": "Er zijn geen uitgaven gevonden die met een kaart kunnen.",
  },
  labels: {
    card: "Kaart",
    annualFee: "Jaarkosten",
    cashback: "Cashback",
    fxFee: "Opslag bij andere valuta",
    pointsPerEuro: "Punten per euro",
    pointsExpiry: "Punten verlopen",
    transferRatio: "Overdrachtsverhouding",
    insurance: "Verzekering",
    netValue: "Nettowaarde",
  },
  sortNote: "De volgorde is op naam. Elke kolom is te sorteren; geen rij staat voorop.",
  tier: {
    measured: "uit een bron met datum",
    assumed: "aangenomen: een gewone kaart zonder cashback",
    unknown: "onbekend",
  },
  unknownValue: "onbekend",
  netLine: (net, fmt) => {
    if (net.netCents === null || net.earnedCents === null)
      return `${net.name}: de cashback is onbekend, dus er is geen nettowaarde berekend.`;
    const fee =
      net.feeShareCents === null
        ? "de kosten zijn onbekend"
        : `na ${fmt.eurExact(net.feeShareCents)} kosten`;
    const tier = net.cashbackTier === "assumed" ? " (cashback aangenomen)" : "";
    return `Bij jouw eigen uitgaven van ${fmt.eur(net.spendCents)} levert ${net.name} ${fmt.eur(net.earnedCents)} op${tier}; ${fee} is de nettowaarde ${fmt.eur(net.netCents)}.`;
  },
  feeShareNote: (months) =>
    months >= PLAN_NUMBERS.cardHorizonMonths
      ? "De kosten zijn die van een heel jaar."
      : `Het aandeel in de jaarkosten telt alleen de ${months} maanden waarover gegevens zijn. Er is niets doorgetrokken naar een heel jaar.`,
  pointsLine: (name, net, fmt) =>
    net.pointsEarned === null
      ? null
      : net.pointsValueRange === null
        ? `Bij jouw eigen uitgaven levert ${name} ${fmt.count(net.pointsEarned)} punten op. Zonder eigen inwisselvoorbeelden is er geen waarde in euro berekend.`
        : `Bij jouw eigen uitgaven levert ${name} ${fmt.count(net.pointsEarned)} punten op, met een waarde van ${fmt.eurRange(net.pointsValueRange.lowCents, net.pointsValueRange.highCents)} volgens je eigen inwisselvoorbeelden.`,
  balanceLine: (points, expiresOn, stale, fmt) =>
    `${fmt.count(points)} punten${expiresOn === null ? "" : `; deze verlopen op ${fmt.date(expiresOn)}`}${stale ? "; het saldo is al een tijd niet bijgewerkt" : ""}.`,
  breakEvenLine: (name, annualSpendCents, fmt) =>
    annualSpendCents === null
      ? `${name}: het bedrag waarbij de jaarkosten zijn terugverdiend is niet te berekenen.`
      : `${name}: de jaarkosten zijn terugverdiend bij ${fmt.eur(annualSpendCents)} uitgaven per jaar.`,
  noMarketValue:
    "LaVega neemt geen marktwaarde per punt aan. Een waarde komt alleen uit voorbeelden die jij invult.",
  facts: { cardTerms: (value, source) => `${value} (${source})` },
  headline: (f, fmt) =>
    f.cardableSpendCents <= 0
      ? DASH
      : `${fmt.eur(f.cardableSpendCents)} aan uitgaven die met een kaart te betalen zijn`,
  explain: {
    simple: (f, fmt) => {
      const out: string[] = [];
      if (f.cardableSpendCents > 0)
        out.push(
          `Over ${f.months} maanden was ${fmt.eur(f.cardableSpendCents)} aan uitgaven met een kaart te betalen.`,
        );
      for (const n of f.nets) out.push(nl.netLine(n, fmt));
      return out;
    },
    detailed: (f, fmt) => {
      const out: string[] = [];
      if (f.cardableSpendCents > 0) {
        out.push(
          `Over ${f.months} maanden was ${fmt.eur(f.cardableSpendCents)} aan uitgaven met een kaart te betalen.`,
        );
        out.push(nl.feeShareNote(f.months));
      }
      for (const n of f.nets) {
        out.push(nl.netLine(n, fmt));
        const p = nl.pointsLine(n.name, n, fmt);
        if (p !== null) out.push(p);
      }
      for (const b of f.breakEven) {
        const name = f.nets.find((n) => n.cardKey === b.cardKey)?.name ?? b.cardKey;
        out.push(nl.breakEvenLine(name, b.annualSpendCents, fmt));
      }
      for (const b of f.balances) out.push(nl.balanceLine(b.points, b.expiresOn, b.stale, fmt));
      if (f.balances.length > 0) out.push(nl.noMarketValue);
      if (f.notCardableSpendCents > 0)
        out.push(
          `${fmt.eur(f.notCardableSpendCents)} aan uitgaven die niet met een kaart te betalen zijn, zoals huur, hypotheek, belasting, verzekeringen, aflossingen en eigen overboekingen, is niet meegeteld.`,
        );
      if (f.excludedForeignCount > 0)
        out.push(`${f.excludedForeignCount} uitgaven in een andere valuta zijn niet meegeteld.`);
      return out;
    },
  },
  empty: {
    cards:
      "Er is geen kaart ingevuld, of de kaart die je gebruikt is niet aangegeven. Zonder kaart is er geen nettowaarde te berekenen. De tabel met kenmerken staat hieronder zonder jouw uitgaven. Er is niets geschat.",
    "cardable-spend":
      "Er zijn geen uitgaven gevonden die met een kaart te betalen zijn. Zonder die uitgaven is geen opbrengst te berekenen. Er is niets geschat.",
  },
  howCalculated: {
    "cardable-spend": `Het totaal van je uitgaven van de laatste volle maanden (hooguit ${PLAN_NUMBERS.cardHorizonMonths}) die met een kaart te betalen zijn, in euro, zonder huur, hypotheek, belasting, verzekeringen, aflossingen en eigen overboekingen en zonder regels in een andere valuta. Er is niets doorgetrokken naar een heel jaar.`,
    "card-earned":
      "De opbrengst is het cashbackpercentage van de kaart over die uitgaven, alsof alles op die kaart ging.",
    "card-fee":
      "Het aandeel in de jaarkosten is de jaarkosten maal het aantal maanden met gegevens, gedeeld door twaalf.",
    "card-net":
      "De nettowaarde is de opbrengst min het aandeel in de jaarkosten. Is een deel onbekend, dan is er geen nettowaarde.",
    "break-even":
      "Het bedrag aan uitgaven per jaar waarbij de opbrengst gelijk is aan de jaarkosten.",
    "points-value":
      "Het aantal punten maal de laagste, middelste en hoogste waarde per punt uit de inwisselvoorbeelden die jij hebt ingevuld.",
  },
  education: [
    {
      conceptId: "net-value",
      title: "Wat is de nettowaarde van een kaart?",
      body: "De nettowaarde is wat een kaart oplevert bij je eigen uitgaven, min wat ze kost. Het is een rekensom op jouw cijfers, geen oordeel over de kaart.",
    },
    {
      conceptId: "points-value",
      title: "Wat is een punt waard?",
      body: "Een punt heeft geen vaste prijs. De waarde hangt af van waarvoor je de punten inwisselt, en dat verschilt per inwisseling.",
    },
  ],
};

const en: CardsCopy = {
  reasons: {
    "no-better-card": NET_PER_CARD_EN,
    "in-use-card-unknown": "Which card you use is not known, so there is nothing to compare with.",
    "other-card-nets-more": NET_PER_CARD_EN,
    "no-card-data": "There is no card data.",
    "no-cardable-spend": "No spending was found that fits on a card.",
  },
  labels: {
    card: "Card",
    annualFee: "Annual fee",
    cashback: "Cashback",
    fxFee: "Foreign currency markup",
    pointsPerEuro: "Points per euro",
    pointsExpiry: "Points expire",
    transferRatio: "Transfer ratio",
    insurance: "Insurance",
    netValue: "Net value",
  },
  sortNote: "The order is by name. Every column can be sorted; no row is placed first.",
  tier: {
    measured: "from a dated source",
    assumed: "assumed: an ordinary card with no cashback",
    unknown: "unknown",
  },
  unknownValue: "unknown",
  netLine: (net, fmt) => {
    if (net.netCents === null || net.earnedCents === null)
      return `${net.name}: the cashback is unknown, so no net value has been calculated.`;
    const fee =
      net.feeShareCents === null
        ? "the fee is unknown"
        : `after ${fmt.eurExact(net.feeShareCents)} in fees`;
    const tier = net.cashbackTier === "assumed" ? " (cashback assumed)" : "";
    return `At your own spend of ${fmt.eur(net.spendCents)}, ${net.name} earns ${fmt.eur(net.earnedCents)}${tier}; ${fee}, the net value is ${fmt.eur(net.netCents)}.`;
  },
  feeShareNote: (months) =>
    months >= PLAN_NUMBERS.cardHorizonMonths
      ? "The fee is that of a full year."
      : `The share of the annual fee covers only the ${months} months of data. Nothing was extended to a full year.`,
  pointsLine: (name, net, fmt) =>
    net.pointsEarned === null
      ? null
      : net.pointsValueRange === null
        ? `At your own spend, ${name} earns ${fmt.count(net.pointsEarned)} points. Without redemption examples of your own, no euro value has been calculated.`
        : `At your own spend, ${name} earns ${fmt.count(net.pointsEarned)} points, worth ${fmt.eurRange(net.pointsValueRange.lowCents, net.pointsValueRange.highCents)} by your own redemption examples.`,
  balanceLine: (points, expiresOn, stale, fmt) =>
    `${fmt.count(points)} points${expiresOn === null ? "" : `; these expire on ${fmt.date(expiresOn)}`}${stale ? "; the balance has not been updated for a while" : ""}.`,
  breakEvenLine: (name, annualSpendCents, fmt) =>
    annualSpendCents === null
      ? `${name}: the break-even amount cannot be calculated.`
      : `${name}: the annual fee is earned back at ${fmt.eur(annualSpendCents)} of spending a year.`,
  noMarketValue:
    "LaVega assumes no market value per point. A value only comes from examples you enter.",
  facts: { cardTerms: (value, source) => `${value} (${source})` },
  headline: (f, fmt) =>
    f.cardableSpendCents <= 0
      ? DASH
      : `${fmt.eur(f.cardableSpendCents)} of spending that fits on a card`,
  explain: {
    simple: (f, fmt) => {
      const out: string[] = [];
      if (f.cardableSpendCents > 0)
        out.push(
          `Over ${f.months} months, ${fmt.eur(f.cardableSpendCents)} of spending fit on a card.`,
        );
      for (const n of f.nets) out.push(en.netLine(n, fmt));
      return out;
    },
    detailed: (f, fmt) => {
      const out: string[] = [];
      if (f.cardableSpendCents > 0) {
        out.push(
          `Over ${f.months} months, ${fmt.eur(f.cardableSpendCents)} of spending fit on a card.`,
        );
        out.push(en.feeShareNote(f.months));
      }
      for (const n of f.nets) {
        out.push(en.netLine(n, fmt));
        const p = en.pointsLine(n.name, n, fmt);
        if (p !== null) out.push(p);
      }
      for (const b of f.breakEven) {
        const name = f.nets.find((n) => n.cardKey === b.cardKey)?.name ?? b.cardKey;
        out.push(en.breakEvenLine(name, b.annualSpendCents, fmt));
      }
      for (const b of f.balances) out.push(en.balanceLine(b.points, b.expiresOn, b.stale, fmt));
      if (f.balances.length > 0) out.push(en.noMarketValue);
      if (f.notCardableSpendCents > 0)
        out.push(
          `${fmt.eur(f.notCardableSpendCents)} of spending that cannot be paid by card, such as rent, mortgage, tax, insurance, loan repayments and transfers between your own accounts, is not counted.`,
        );
      if (f.excludedForeignCount > 0)
        out.push(`${f.excludedForeignCount} payments in another currency are not counted.`);
      return out;
    },
  },
  empty: {
    cards:
      "No card has been entered, or the card you use has not been marked. Without a card, no net value can be calculated. The table of features is below, without your spending. Nothing has been estimated.",
    "cardable-spend":
      "No spending was found that fits on a card. Without it, no earnings can be calculated. Nothing has been estimated.",
  },
  howCalculated: {
    "cardable-spend": `The total of your spending over the latest full months (at most ${PLAN_NUMBERS.cardHorizonMonths}) that fit on a card, in euros, leaving out rent, mortgage, tax, insurance, loan repayments, transfers between your own accounts and lines in another currency. Nothing was extended to a full year.`,
    "card-earned":
      "Earnings are the card's cashback rate on that spending, as if all of it went on that card.",
    "card-fee":
      "The share of the annual fee is the annual fee times the months with data, divided by twelve.",
    "card-net":
      "Net value is the earnings minus the share of the annual fee. If a part is unknown, there is no net value.",
    "break-even": "The yearly spending at which the earnings equal the annual fee.",
    "points-value":
      "The number of points times the lowest, middle and highest value per point from the redemption examples you entered.",
  },
  education: [
    {
      conceptId: "net-value",
      title: "What is the net value of a card?",
      body: "Net value is what a card earns at your own spending, minus what it costs. It is a calculation on your numbers, not a judgement about the card.",
    },
    {
      conceptId: "points-value",
      title: "What is a point worth?",
      body: "A point has no fixed price. Its value depends on what the points are redeemed for, and that differs per redemption.",
    },
  ],
};

export const cardsCopy: Record<Locale, CardsCopy> = { nl, en };
