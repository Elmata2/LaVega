import {
  FEE_PERIOD_MONTHS,
  readAccountFee,
  type AccountFeeEntryLike,
} from "../accountCosts.js";
import { isIsoDate, daysBetween } from "../advisor/months.js";
import type { CardBalance } from "../advisor/profile.js";
import { isCovered, type CatalogValue } from "../catalog.js";
import type { CatalogueEntryLike } from "../catalogRates.js";
import { norm } from "../hash.js";
import { bestRate, keptRate, type RateBenchmark } from "../interest.js";
import { isStale, type RewardsBalance } from "../rewards.js";
import type { PlanPreferences } from "./preferences.js";
import { pointsValueRange } from "./pointsValue.js";
import { PLAN_THRESHOLDS } from "./thresholds.js";

/* Card advice: pure maths over the user's own spend, his stated balances and the
 * product catalogue. Nothing here is guessed: a catalogue value that is not
 * covered (value, source, date and conditions) makes a card "not comparable", it
 * never becomes a zero. Every figure that is used keeps the source and date it
 * came with, so the screen can show "Zo is het berekend". */

/** Fewer full months than this and a yearly figure would be a guess. */
export const CARD_ADVICE_MIN_MONTHS = 3;
/** A better card is only worth recommending above this yearly gain (cents)... */
export const CARD_ADVICE_MIN_GAIN_CENTS = 2_000;
/** ...or this share of the current card's net, whichever is larger. */
export const CARD_ADVICE_MIN_GAIN_SHARE = PLAN_THRESHOLDS.cards.betterCardMargin;
const FULL_YEAR_MONTHS = 12;
/** Expiry within this many days must be mentioned. */
const EXPIRY_WARN_DAYS = 90;

/** The one points programme whose value per point the issuer publishes.
 *  Membership Rewards: "1.000 Membership Rewards punten zijn gelijk aan EUR 3"
 *  (Amex NL, read 21 Aug 2026, valid for "Betalen met Punten" only; transfers
 *  to partners are worth something else that nobody publishes). Keyed by the
 *  normalised programme name, which is also the rewards balance id. */
export const POINT_REFERENCE_VALUES: Readonly<
  Record<
    string,
    {
      centsPerPoint: number;
      asOf: string;
      sourceUrl: string;
      conditions: string;
    }
  >
> = {
  [norm("American Express Membership Rewards")]: {
    centsPerPoint: 0.3,
    asOf: "2026-08-21",
    sourceUrl: "https://www.americanexpress.com/nl-nl/rewards/membership-rewards/",
    conditions:
      "alleen bij Betalen met Punten via de Amex App of het online account; Amex mag de verhouding zonder aankondiging wijzigen",
  },
};

/** The rewards programme a catalogue card earns into (the name the Punten tab
 *  lists), or null when we do not know one. Consumer American Express only. */
export function programForCard(cardId: string): string | null {
  if (/business|corporate/.test(cardId)) return null;
  if (cardId.startsWith("flying-blue-american-express-")) return "Flying Blue (KLM/Air France)";
  if (cardId.startsWith("american-express-")) return "American Express Membership Rewards";
  return null;
}

/** Business and corporate cards are not offered to a consumer. */
const isConsumerCard = (e: CatalogueEntryLike): boolean => !/business|corporate/.test(e.id);

export type SourceRef = {
  field: "fee" | "fx" | "points" | "cashback" | "pointValue";
  asOf: string | null;
  sourceUrl: string | null;
};

export type NotComparableReason =
  | "fee-unknown"
  | "fee-condition-unknown"
  | "fx-unknown"
  | "points-unknown"
  | "points-unvalued"
  /** Blockers of the baseline only: the card is not a consumer card in the catalogue. */
  | "not-in-catalogue";

/** A condition on the catalogue's fee that changes what the card costs the user.
 *  The catalogue states these in prose only; this table is the reviewed,
 *  structured reading of that prose (see cardAdvice.test.ts, which fails when a
 *  catalogue fee carries such a clause and the card is not listed here). */
export type FeeCondition =
  | {
      kind: "min-spend";
      /** The catalogue fee holds from this yearly spend on the card... */
      thresholdCents: number;
      /** ...and this is the yearly fee below it. */
      otherwiseCents: number;
    }
  | {
      /** The card is sold with a bank package whose price is not in the card fee. */
      kind: "package";
      name: string;
      yearlyCents: number;
    }
  | {
      /** The fee depends on something the catalogue does not price. */
      kind: "unknown";
      why: "anwb-membership" | "package-price-unknown";
    };

export const FEE_CONDITIONS: Readonly<Record<string, FeeCondition>> = {
  // "Bij een minimale besteding van EUR 3.000 per jaar. Anders kost de kaart EUR 35 per jaar."
  "american-express-blue-card": { kind: "min-spend", thresholdCents: 300_000, otherwiseCents: 3_500 },
  // "Bovenop de EUR 3,45 per maand van Rabo Standaard."
  "rabobank-creditcard": { kind: "package", name: "Rabo Standaard", yearlyCents: 4_140 },
  "rabo-goldcard": { kind: "package", name: "Rabo Standaard", yearlyCents: 4_140 },
  // "Bovenop de EUR 4,00 per maand van het ING OranjePakket."
  "ing-creditcard": { kind: "package", name: "ING OranjePakket", yearlyCents: 4_800 },
  "ing-platinumcard": { kind: "package", name: "ING OranjePakket", yearlyCents: 4_800 },
  // "dus bovenop de EUR 6,00 per maand van de Knab Priverekening"
  "knab-creditcard": { kind: "package", name: "Knab Privérekening", yearlyCents: 7_200 },
  // "Alleen binnen het ING Max-pakket (EUR 44,99 per maand)"
  "ing-creditcard-max": { kind: "package", name: "ING Max", yearlyCents: 53_988 },
  // "Prijs geldt bij ING Go" (the package price is not in the catalogue)
  "ing-creditcard-more": { kind: "unknown", why: "package-price-unknown" },
  "ing-creditcard-extra": { kind: "unknown", why: "package-price-unknown" },
  // "Tarief bij Betaalrekening Plus Betalen"
  "regiobank-creditcard": { kind: "unknown", why: "package-price-unknown" },
  // "exclusief de kosten van een ANWB lidmaatschap" (price in neither document)
  "anwb-visa-classic-card": { kind: "unknown", why: "anwb-membership" },
  "anwb-visa-silver-card": { kind: "unknown", why: "anwb-membership" },
  "anwb-visa-gold-card": { kind: "unknown", why: "anwb-membership" },
};

/** What the fee condition did to this card's yearly fee, for the screen. */
export type FeeNote =
  | { kind: "min-spend"; thresholdCents: number; otherwiseCents: number; met: boolean }
  | { kind: "package"; name: string; yearlyCents: number; applied: boolean }
  | { kind: "unknown"; why: "anwb-membership" | "package-price-unknown" };

export type CardOption = {
  cardId: string;
  name: string;
  held: boolean;
  /** The rewards programme the card earns into, when known. */
  programId: string | null;
  comparable: boolean;
  reasons: NotComparableReason[];
  feeCents: number | null;
  feeNote: FeeNote | null;
  /** The catalogue's own words about the fee (Dutch), when it has any. */
  feeConditions: string | null;
  /** The catalogue percentages the cents above were computed from (percentage points). */
  fxFeePct: number | null;
  fxCostCents: number | null;
  /** null: the catalogue has no covered cashback figure (not counted, not zero). */
  cashbackPct: number | null;
  cashbackCents: number | null;
  pointsPerEuro: number | null;
  pointsEarned: number | null;
  /** Median value of one point (cents) used for pointsValueCents. */
  centsPerPoint: number | null;
  /** Median value of the points earned; null when no value per point is known. */
  pointsValueCents: number | null;
  pointsValueRange: { lowCents: number; highCents: number } | null;
  /** The card earns points but no value per point is known: points are not in the net. */
  pointsUnvalued: boolean;
  netCents: number | null;
  sources: SourceRef[];
};

export type PointValuation = {
  lowCentsPerPoint: number;
  medianCentsPerPoint: number;
  highCentsPerPoint: number;
  basis: "own-examples" | "reference";
  examples: number;
  asOf: string | null;
  sourceUrl: string | null;
  conditions: string | null;
} | null;

export type CardAdviceSpend = {
  /** Cardable spend over the window, cents. */
  windowCents: number;
  months: number;
  /** Of windowCents: the foreign-currency part (already in euro). */
  foreignCents: number;
  excludedForeignCount: number;
};

/** A card of the user that cannot be put on the comparison, and why. */
export type BaselineBlocker = { name: string | null; reasons: NotComparableReason[] };

export type Baseline =
  | { kind: "best-held"; cardId: string; name: string; netCents: number }
  | { kind: "no-card"; netCents: 0 }
  | { kind: "unknown"; blockers: BaselineBlocker[] };

export type Verdict =
  | { kind: "switch"; best: CardOption; gainCents: number }
  | { kind: "keep"; gainCents: number }
  | { kind: "no-card-worth-it" }
  | { kind: "unknown-baseline" }
  | { kind: "no-options" };

export type InterestAdvice = {
  cardId: string;
  name: string | null;
  balanceCents: number;
  ratePct: number | null;
  yearlyInterestCents: number | null;
  /** What one percentage point of interest costs a year on this balance. */
  perPointCents: number;
  /** Savings above the buffer in total (null: buffer or fixed costs unknown). */
  surplusCents: number | null;
  /** What was still left of it when this card's turn came (highest rate first). */
  availableCents: number | null;
  payoffCents: number;
  remainingCents: number;
  savingsRate: {
    ratePct: number;
    bank: string;
    product: string;
    asOf: string | null;
    sourceUrl: string | null;
  } | null;
  interestSavedCents: number | null;
  forgoneSavingsCents: number | null;
  netSavingCents: number | null;
  recommendation:
    | "payoff-all"
    | "payoff-partial"
    | "move-credit"
    | "keep-balance"
    | "enter-rate"
    | "unknown-buffer";
};

export type PointsAdvice = {
  programId: string;
  program: string;
  points: number;
  stale: boolean;
  valuation: PointValuation;
  valueCents: { lowCents: number; medianCents: number; highCents: number } | null;
  /** The user's own date, when he gave one; the catalogue holds no expiry. */
  expiresOn: string | null;
  expiresSoon: boolean;
};

export type CardAdvice = {
  state: "ok" | "no-spend" | "short-history";
  spend: CardAdviceSpend & { annualCents: number; annualForeignCents: number };
  baseline: Baseline;
  verdict: Verdict;
  /** Comparable cards, best net first. */
  options: CardOption[];
  /** Cards left out of the ranking, with the reason, by name. */
  notComparable: CardOption[];
  interest: InterestAdvice[];
  /** A balance is carried: the card comparison does not include any card's credit
   *  interest (the catalogue holds no card rates). */
  ignoresInterest: boolean;
  points: PointsAdvice[];
};

export type BufferInput = {
  liquidSavingsCents: number | null;
  fixedCostsMonthlyCents: number | null;
  targetMonths: number | null;
} | null;

export type CardAdviceInput = {
  spend: CardAdviceSpend;
  catalogue: readonly CatalogueEntryLike[];
  /** Catalogue ids of the credit cards the user holds (stated plus bank data). */
  heldIds: readonly string[];
  /** The user also stated a card that is not in the catalogue. */
  hasOtherCard: boolean;
  cardBalances: readonly CardBalance[];
  rewards: readonly RewardsBalance[];
  preferences: PlanPreferences;
  rates: readonly RateBenchmark[];
  buffer: BufferInput;
  asOf: string;
};

const coveredNumber = (e: CatalogueEntryLike, key: string): CatalogValue | null => {
  const v = e.fields?.[key];
  return v !== undefined && isCovered(v) && typeof v.value === "number" && v.value >= 0 ? v : null;
};

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

/** The value of one point for a programme: the user's own examples first, else
 *  the issuer's published rate, else nothing. */
export function pointValuation(
  programId: string,
  preferences: PlanPreferences,
): PointValuation {
  const own = pointsValueRange(preferences.redemptionExamples, programId);
  if (own !== null)
    return {
      lowCentsPerPoint: own.lowCentsPerPoint,
      medianCentsPerPoint: own.medianCentsPerPoint,
      highCentsPerPoint: own.highCentsPerPoint,
      basis: "own-examples",
      examples: own.examples,
      asOf: null,
      sourceUrl: null,
      conditions: null,
    };
  const ref = POINT_REFERENCE_VALUES[programId];
  if (ref === undefined) return null;
  return {
    lowCentsPerPoint: ref.centsPerPoint,
    medianCentsPerPoint: ref.centsPerPoint,
    highCentsPerPoint: ref.centsPerPoint,
    basis: "reference",
    examples: 0,
    asOf: ref.asOf,
    sourceUrl: ref.sourceUrl,
    conditions: ref.conditions,
  };
}

function optionFor(
  e: CatalogueEntryLike,
  held: boolean,
  annualCents: number,
  annualForeignCents: number,
  preferences: PlanPreferences,
): CardOption {
  const reasons: NotComparableReason[] = [];
  const sources: SourceRef[] = [];

  const fee = readAccountFee(e as AccountFeeEntryLike);
  let feeCents: number | null = null;
  let feeNote: FeeNote | null = null;
  if (fee === null) reasons.push("fee-unknown");
  else {
    const base = Math.round(
      (Math.round(fee.value * 100) * FULL_YEAR_MONTHS) / FEE_PERIOD_MONTHS[fee.period],
    );
    feeCents = base;
    const cond = FEE_CONDITIONS[e.id];
    if (cond?.kind === "min-spend") {
      const met = annualCents >= cond.thresholdCents;
      feeCents = met ? base : cond.otherwiseCents;
      feeNote = {
        kind: "min-spend",
        thresholdCents: cond.thresholdCents,
        otherwiseCents: cond.otherwiseCents,
        met,
      };
    } else if (cond?.kind === "package") {
      // A package the user already has is a cost he pays anyway: only a card he
      // does not hold brings it along.
      feeCents = held ? base : base + cond.yearlyCents;
      feeNote = { kind: "package", name: cond.name, yearlyCents: cond.yearlyCents, applied: !held };
    } else if (cond?.kind === "unknown") {
      feeNote = { kind: "unknown", why: cond.why };
      reasons.push("fee-condition-unknown");
    }
    sources.push({ field: "fee", asOf: fee.checkedAt, sourceUrl: fee.sourceUrl });
  }

  const fx = coveredNumber(e, "fxFeePct");
  let fxCostCents: number | null = null;
  if (fx !== null) {
    fxCostCents = Math.round((annualForeignCents * fx.value) / 100);
    sources.push({ field: "fx", asOf: fx.checkedAt, sourceUrl: fx.sourceUrl });
  } else if (annualForeignCents > 0) reasons.push("fx-unknown");

  const cb = coveredNumber(e, "cashbackPct");
  let cashbackCents: number | null = null;
  if (cb !== null) {
    cashbackCents = Math.round((annualCents * cb.value) / 100);
    sources.push({ field: "cashback", asOf: cb.checkedAt, sourceUrl: cb.sourceUrl });
  }

  const ppe = coveredNumber(e, "pointsPerEuro");
  const programName = programForCard(e.id);
  const programId = programName === null ? null : norm(programName);
  let pointsEarned: number | null = null;
  let pointsValueCents: number | null = null;
  let centsPerPoint: number | null = null;
  let pointsValueRangeOut: CardOption["pointsValueRange"] = null;
  let pointsUnvalued = false;
  if (ppe === null) reasons.push("points-unknown");
  else {
    sources.push({ field: "points", asOf: ppe.checkedAt, sourceUrl: ppe.sourceUrl });
    pointsEarned = Math.round((annualCents / 100) * ppe.value);
    if (pointsEarned > 0) {
      const v = programId === null ? null : pointValuation(programId, preferences);
      if (v === null) pointsUnvalued = true;
      else {
        centsPerPoint = v.medianCentsPerPoint;
        pointsValueCents = Math.round(pointsEarned * v.medianCentsPerPoint);
        pointsValueRangeOut = {
          lowCents: Math.round(pointsEarned * v.lowCentsPerPoint),
          highCents: Math.round(pointsEarned * v.highCentsPerPoint),
        };
        if (v.sourceUrl !== null)
          sources.push({ field: "pointValue", asOf: v.asOf, sourceUrl: v.sourceUrl });
      }
    }
  }

  // A card he holds whose points cannot be valued would count as 0 points: that
  // is a guessed zero, so it is left out of the comparison instead.
  if (held && pointsUnvalued) reasons.push("points-unvalued");
  const comparable = reasons.length === 0;
  const netCents = comparable
    ? (pointsValueCents ?? 0) + (cashbackCents ?? 0) - (feeCents ?? 0) - (fxCostCents ?? 0)
    : null;
  return {
    cardId: e.id,
    name: e.product,
    held,
    programId,
    comparable,
    reasons,
    feeCents,
    feeNote,
    feeConditions: fee?.conditions ?? null,
    fxFeePct: fx?.value ?? null,
    fxCostCents,
    cashbackPct: cb?.value ?? null,
    cashbackCents,
    pointsPerEuro: ppe?.value ?? null,
    pointsEarned,
    centsPerPoint,
    pointsValueCents,
    pointsValueRange: pointsValueRangeOut,
    pointsUnvalued,
    netCents,
    sources,
  };
}

/** Savings above the buffer, or null when the buffer cannot be worked out. Fixed
 *  costs of zero count as missing, as in the buffer section. */
function surplusOf(buffer: BufferInput): number | null {
  if (
    buffer === null ||
    buffer.liquidSavingsCents === null ||
    buffer.fixedCostsMonthlyCents === null ||
    buffer.fixedCostsMonthlyCents <= 0 ||
    buffer.targetMonths === null
  )
    return null;
  return buffer.liquidSavingsCents - Math.round(buffer.fixedCostsMonthlyCents * buffer.targetMonths);
}

/** Advice per revolving card. The savings above the buffer are one pot: they go
 *  to the card with the highest known rate first, and each card sees only what
 *  is left when its turn comes. Cards without a known rate take nothing. */
function interestAdvice(
  balances: readonly CardBalance[],
  names: ReadonlyMap<string, string>,
  buffer: BufferInput,
  rates: readonly RateBenchmark[],
): InterestAdvice[] {
  const revolving = balances.filter((b) => !b.paysInFull && b.balanceCents > 0);
  const surplusCents = surplusOf(buffer);
  const best = bestRate(rates, true);
  const kept = best === null ? null : keptRate(best);
  const savingsRate =
    best === null || kept === null
      ? null
      : {
          ratePct: kept,
          bank: best.bank,
          product: best.product,
          asOf: best.asOf ?? null,
          sourceUrl: best.sourceUrl ?? null,
        };
  const order = [...revolving].sort(
    (x, y) =>
      (y.ratePct ?? -1) - (x.ratePct ?? -1) ||
      y.balanceCents - x.balanceCents ||
      x.cardId.localeCompare(y.cardId),
  );
  let left = surplusCents === null ? 0 : Math.max(surplusCents, 0);
  const out: InterestAdvice[] = [];
  for (const b of order) {
    const ratePct = b.ratePct ?? null;
    const worthIt = ratePct !== null && (savingsRate === null || ratePct > savingsRate.ratePct);
    const availableCents = surplusCents === null ? null : left;
    const payoffCents =
      surplusCents === null || !worthIt ? 0 : Math.min(b.balanceCents, left);
    if (worthIt) left -= payoffCents;
    const interestSavedCents = ratePct === null ? null : Math.round((payoffCents * ratePct) / 100);
    const forgoneSavingsCents =
      savingsRate === null ? null : Math.round((payoffCents * savingsRate.ratePct) / 100);
    let recommendation: InterestAdvice["recommendation"];
    if (ratePct === null) recommendation = "enter-rate";
    else if (!worthIt) recommendation = "keep-balance";
    else if (surplusCents === null) recommendation = "unknown-buffer";
    else if (payoffCents >= b.balanceCents) recommendation = "payoff-all";
    else if (payoffCents > 0) recommendation = "payoff-partial";
    else recommendation = "move-credit";
    out.push({
      cardId: b.cardId,
      name: names.get(b.cardId) ?? null,
      balanceCents: b.balanceCents,
      ratePct,
      yearlyInterestCents: ratePct === null ? null : Math.round((b.balanceCents * ratePct) / 100),
      perPointCents: Math.round(b.balanceCents / 100),
      surplusCents,
      availableCents,
      payoffCents,
      remainingCents: b.balanceCents - payoffCents,
      savingsRate,
      interestSavedCents,
      forgoneSavingsCents,
      netSavingCents:
        interestSavedCents === null || forgoneSavingsCents === null
          ? null
          : interestSavedCents - forgoneSavingsCents,
      recommendation,
    });
  }
  return out;
}

export function computeCardAdvice(i: CardAdviceInput): CardAdvice {
  const { spend } = i;
  const annualCents =
    spend.months >= CARD_ADVICE_MIN_MONTHS
      ? Math.round((spend.windowCents * FULL_YEAR_MONTHS) / spend.months)
      : 0;
  const annualForeignCents =
    spend.months >= CARD_ADVICE_MIN_MONTHS
      ? Math.round((spend.foreignCents * FULL_YEAR_MONTHS) / spend.months)
      : 0;
  const state: CardAdvice["state"] =
    spend.months < CARD_ADVICE_MIN_MONTHS
      ? "short-history"
      : annualCents <= 0
        ? "no-spend"
        : "ok";

  // Debit cards found in the bank data are not part of a credit-card comparison.
  const heldIds = i.heldIds.filter((id) => {
    const kind = i.catalogue.find((e) => e.id === id)?.kind;
    return kind === undefined || kind === "creditcard";
  });
  const held = new Set(heldIds);
  const universe = i.catalogue.filter((e) => e.kind === "creditcard" && isConsumerCard(e));
  const names = new Map(i.catalogue.map((e) => [e.id, e.product]));

  const all =
    state === "ok"
      ? universe.map((e) =>
          optionFor(e, held.has(e.id), annualCents, annualForeignCents, i.preferences),
        )
      : [];
  const options = all
    .filter((o) => o.comparable)
    .sort((a, b) => b.netCents! - a.netCents! || byName(a, b));
  const notComparable = all.filter((o) => !o.comparable).sort(byName);

  // Every card he holds must be on the comparison, else the best of the others
  // is only a lower bound and a switch against it would be a guess.
  const blockers: BaselineBlocker[] = [];
  for (const id of heldIds) {
    const o = all.find((x) => x.cardId === id);
    if (o === undefined) blockers.push({ name: names.get(id) ?? null, reasons: ["not-in-catalogue"] });
    else if (!o.comparable) blockers.push({ name: o.name, reasons: o.reasons });
  }
  if (i.hasOtherCard) blockers.push({ name: null, reasons: ["not-in-catalogue"] });
  const heldOptions = options.filter((o) => o.held);
  let baseline: Baseline;
  if (heldIds.length === 0 && !i.hasOtherCard) baseline = { kind: "no-card", netCents: 0 };
  else if (blockers.length > 0 || heldOptions.length === 0) baseline = { kind: "unknown", blockers };
  else {
    const top = heldOptions[0]!;
    baseline = { kind: "best-held", cardId: top.cardId, name: top.name, netCents: top.netCents! };
  }

  let verdict: Verdict;
  const best = options[0];
  if (state !== "ok" || best === undefined) verdict = { kind: "no-options" };
  else if (baseline.kind === "unknown") verdict = { kind: "unknown-baseline" };
  else {
    const gainCents = best.netCents! - baseline.netCents;
    const need = Math.max(
      CARD_ADVICE_MIN_GAIN_CENTS,
      Math.round(CARD_ADVICE_MIN_GAIN_SHARE * Math.abs(baseline.netCents)),
    );
    if (baseline.kind === "no-card")
      verdict = gainCents >= need ? { kind: "switch", best, gainCents } : { kind: "no-card-worth-it" };
    else if (!best.held && gainCents >= need) verdict = { kind: "switch", best, gainCents };
    else verdict = { kind: "keep", gainCents };
  }

  const interest = interestAdvice(i.cardBalances, names, i.buffer, i.rates);

  const points: PointsAdvice[] = i.rewards
    .map((r) => {
      const valuation = pointValuation(r.id, i.preferences);
      const expiresOn = i.preferences.pointsExpiry[r.id] ?? null;
      return {
        programId: r.id,
        program: r.program,
        points: r.points,
        stale: isStale(r, i.asOf),
        valuation,
        valueCents:
          valuation === null
            ? null
            : {
                lowCents: Math.round(r.points * valuation.lowCentsPerPoint),
                medianCents: Math.round(r.points * valuation.medianCentsPerPoint),
                highCents: Math.round(r.points * valuation.highCentsPerPoint),
              },
        expiresOn,
        expiresSoon:
          expiresOn !== null && isIsoDate(expiresOn) && daysBetween(i.asOf, expiresOn) <= EXPIRY_WARN_DAYS,
      };
    })
    .sort((a, b) => a.programId.localeCompare(b.programId));

  return {
    state,
    spend: { ...spend, annualCents, annualForeignCents },
    baseline,
    verdict,
    options,
    notComparable,
    interest,
    /** True when a balance is carried: the ranking compares fees and points only. */
    ignoresInterest: interest.length > 0,
    points,
  };
}
