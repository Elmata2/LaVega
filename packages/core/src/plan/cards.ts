import { looksLikeLender } from "../advisor/lenders.js";
import { daysBetween, isIsoDate } from "../advisor/months.js";
import { personalView } from "../advisor/scopePersonal.js";
import type { ProductFee } from "../accountCosts.js";
import { cashbackPctOf, type HeldCashback } from "../assumedCashback.js";
import { hash } from "../hash.js";
import {
  holdingCostOfProduct,
  netBenefit,
  type HoldingCost,
  type NetBenefit,
} from "../netBenefit.js";
import { isStale } from "../rewards.js";
import { computeCardAdvice, type BufferInput, type CardAdvice } from "./cardAdvice.js";
import type { Tx } from "../model.js";
import { fig } from "./internal.js";
import { spendHistory } from "./spending.js";
import { pointsValueRange, type PointsValueRange } from "./pointsValue.js";
import { PLAN_THRESHOLDS } from "./thresholds.js";
import type {
  CalcStep,
  FigureValue,
  HeldCardInput,
  Missing,
  PlanFact,
  PlanInput,
  SectionResult,
  StatusReason,
} from "./types.js";

/** Every key this section puts in `flat` (the change log labels each one). */
export const CARDS_FLAT_IDS = [
  "cards_held_count",
  "cards_cardable_spend",
  "cards_months",
  "cards_foreign_excluded",
  "cards_in_use_net",
] as const;
export type CardsFlatId = (typeof CARDS_FLAT_IDS)[number];

export const CARDS_CALC_IDS = [
  "cardable-spend",
  "card-earned",
  "card-fee",
  "card-net",
  "break-even",
  "points-value",
] as const;
export type CardsCalcId = (typeof CARDS_CALC_IDS)[number];

/** Spending that cannot be paid by card: housing (rent, mortgage, energy), taxes,
 *  insurance, payments to the user's own savings, accounts and cards, transfers
 *  between people, cash and bank fees. Moved categories (own transfers, savings,
 *  card settlement) are dropped by the caller as well; loan repayments are
 *  recognised by the lender's name. */
export const NOT_CARDABLE_CATEGORIES: ReadonlySet<string> = new Set([
  "Wonen & energie",
  "Belastingen & overheid",
  "Verzekeringen",
  "Sparen & beleggen",
  "Eigen overboeking",
  "Creditcard afbetaald",
  "Overboekingen",
  "Geldopname",
  "Bankkosten",
]);
/** The same idea for categories the user named himself ("Huur", "Hypotheek",
 *  "Belasting", "Lening aflossing"): matched on the start of the name. */
const NOT_CARDABLE_NAME =
  /^(wonen|huur|hypotheek|energie|belasting|verzeker|lening|aflossing|sparen|overboeking|eigen overboeking|geldopname|bankkosten|creditcard afbetaald)/i;
const notCardable = (t: Tx, category: string): boolean =>
  NOT_CARDABLE_CATEGORIES.has(category) ||
  NOT_CARDABLE_NAME.test(category.trim()) ||
  looksLikeLender(`${t.counterparty} ${t.description}`);

/** Expiry within this many days (or already past) must be mentioned. */
const EXPIRY_WARN_DAYS = 90;
/** Beyond this float noise a net counts as larger. */
const EPS = 1e-9;

/** Where a figure sits: a number the user or a source stated (`measured`), our
 *  zero for an ordinary NL card (`assumed`), or nothing (`unknown`, never 0). */
export type CardTier = "measured" | "assumed" | "unknown";

export type CriteriaValue = {
  value: number | null;
  tier: CardTier;
  asOf: string | null;
  sourceUrl: string | null;
};

export type CardCriteriaRow = {
  cardKey: string;
  name: string;
  held: boolean;
  annualFee: {
    cents: number | null;
    known: boolean;
    asOf: string | null;
    sourceUrl: string | null;
  };
  /** Percentage points (1 = 1%), like the catalogue. */
  cashbackPct: CriteriaValue;
  /** Percentage points (2 = 2%), like the catalogue. */
  fxFeePct: CriteriaValue;
  pointsPerEuro: CriteriaValue;
  /** Typed placeholders: the catalogue has no such fields and no verified source (spec 15.4). */
  earnByCategory: "unknown";
  pointsExpiry: string | null;
  transferRatio: "unknown";
  insurance: "unknown";
};

export type CardNet = {
  cardKey: string;
  name: string;
  programId: string | null;
  /** Spend the comparison runs on: the whole cardable spend, as if on this card. */
  spendCents: number;
  earnedCents: number | null;
  /** The fee over the same horizon; null when the fee is unknown. */
  feeShareCents: number | null;
  cashbackTier: CardTier;
  /** null when the cashback is unknown. */
  net: NetBenefit | null;
  /** From kinds net / no-recommendation only; null otherwise. Never 0 for unknown. */
  netCents: number | null;
  pointsEarned: number | null;
  pointsValueRange: {
    lowCents: number;
    medianCents: number;
    highCents: number;
  } | null;
};

export type CardsFigures = {
  criteria: CardCriteriaRow[];
  nets: CardNet[];
  cardInUseKey: string | null;
  cardableSpendCents: number;
  /** Outgoing spend in the same window that cannot be paid by card (rent, tax,
   *  insurance, own transfers, loan repayments, cash): left out of the above. */
  notCardableSpendCents: number;
  /** Full months the cardable spend covers (at most 12); nothing is extrapolated. */
  months: number;
  breakEven: { cardKey: string; annualSpendCents: number | null }[];
  balances: {
    programId: string;
    points: number;
    stale: boolean;
    expiresOn: string | null;
    valueRange: PointsValueRange;
  }[];
  /** Foreign-currency card spend left out (no conversion). */
  excludedForeignCount: number;
  /** Recommendations over the whole catalogue, the stated balances and points. */
  advice: CardAdvice;
  sharedCases: true;
};

const tierOf = (k: HeldCashback): CardTier =>
  k.tier === "gemeten" ? "measured" : k.tier === "aangenomen" ? "assumed" : "unknown";

const FULL_YEAR_MONTHS = 12;

/** A cashback figure the maths may use: finite and not negative (a negative
 *  one is a data error, so it is unknown, never a loss or a zero). */
function validPct(k: HeldCashback): number | null {
  const pct = cashbackPctOf(k);
  return pct !== null && Number.isFinite(pct) && pct >= 0 ? pct : null;
}

/** Under a full year the fee is charged for the covered months only, at the
 *  yearly rate, whatever period the fee is billed in: round(perYear * months
 *  / 12). Spend is never extrapolated, so the cost is not either. A full year
 *  keeps the catalogue amount untouched. */
function proratedCost(cost: HoldingCost, months: number): HoldingCost {
  if (cost.kind !== "known" || months >= FULL_YEAR_MONTHS) return cost;
  const cents = Math.round((cost.amount.perYearCents * Math.max(months, 0)) / FULL_YEAR_MONTHS);
  return {
    ...cost,
    amount: {
      cents,
      period: "maand",
      perYearCents: cents,
      perYearDerived: true,
    },
  };
}

/** Net value of putting `spendCents` (spend over `horizonMonths`) on this card:
 *  cashback earned minus the fee over the same horizon. Pure; shared with the
 *  extension through cardCases.json. */
export function netForCard(
  card: HeldCardInput,
  spendCents: number,
  horizonMonths: number,
): CardNet {
  const pct = validPct(card.cashback); // percentage points
  const earnedCents = pct === null ? null : Math.round((spendCents * pct) / 100);
  const cost = proratedCost(holdingCostOfProduct(card.fee), horizonMonths);
  const net =
    earnedCents === null
      ? null
      : netBenefit({
          benefit: { kind: "one-off", cents: earnedCents },
          cost,
          // prorated cost is already the whole window's fee: one period
          horizonMonths: horizonMonths < FULL_YEAR_MONTHS ? 1 : horizonMonths,
        });
  const netCents = net !== null && net.kind !== "gross-cost-unknown" ? net.netCents : null;
  const feeShareCents = net !== null && net.kind !== "gross-cost-unknown" ? net.costCents : null;
  const pointsEarned =
    card.pointsPerEuro === null || card.provenance?.pointsPerEuro === undefined
      ? null
      : Math.round((spendCents / 100) * card.pointsPerEuro);
  return {
    cardKey: card.accountKey,
    name: card.label,
    programId: card.programId,
    spendCents,
    earnedCents,
    feeShareCents,
    cashbackTier: pct === null ? "unknown" : tierOf(card.cashback),
    net,
    netCents,
    pointsEarned,
    pointsValueRange: null,
  };
}

/** Ids carry no raw key: hash unless already a safe slug (ruling P5). */
const idPart = (s: string): string => (/^[a-z0-9_-]+$/.test(s) ? s : hash(s));

const criteriaValue = (
  value: number | null,
  tier: CardTier,
  asOf: string | null = null,
  sourceUrl: string | null = null,
): CriteriaValue => ({ value, tier, asOf, sourceUrl });

/** A number whose source we cannot name is not shown. */
const provenanced = (
  value: number | null,
  p: { asOf: string; sourceUrl: string | null } | undefined,
): CriteriaValue =>
  value === null || p === undefined
    ? criteriaValue(null, "unknown")
    : criteriaValue(value, "measured", p.asOf, p.sourceUrl);

const byName =
  <T extends { name: string }>(key: (x: T) => string) =>
  (a: T, b: T): number =>
    a.name.localeCompare(b.name) || key(a).localeCompare(key(b));

export function computeCards(
  i: PlanInput,
  buffer: BufferInput = null,
): SectionResult<CardsFigures> {
  const view = personalView(i.accounts, i.txs, i.entityProfiles);
  const personalKeys = new Set(view.accounts.map((a) => a.key));
  const seen = new Set<string>();
  const held = i.heldCards
    .filter((c) => {
      if (!personalKeys.has(c.accountKey) || seen.has(c.accountKey)) return false;
      seen.add(c.accountKey);
      return true;
    })
    .sort((a, b) => a.label.localeCompare(b.label) || a.accountKey.localeCompare(b.accountKey));

  const history = (keys?: ReadonlySet<string>) =>
    spendHistory({
      txs: i.txs,
      accounts: i.accounts,
      entityProfiles: i.entityProfiles,
      rules: i.rules,
      own: i.own,
      asOf: i.asOf,
      mode: i.mode,
      fxHistory: i.fxHistory,
      movedCategories: i.movedCategories,
      accountKeys: keys,
      windowMonths: PLAN_THRESHOLDS.cards.horizonMonths,
      skip: notCardable,
    });
  const totalOf = (h: ReturnType<typeof history>, only?: ReadonlySet<string>): number => {
    let n = 0;
    for (const per of h.byCategory.values())
      for (const [m, c] of per) if (only === undefined || only.has(m)) n += c;
    return n;
  };

  const all = history(new Set(held.map((c) => c.accountKey)));
  const cardableSpendCents = held.length === 0 ? 0 : totalOf(all);
  const notCardableSpendCents = held.length === 0 ? 0 : all.skippedCents;
  const months = held.length === 0 ? 0 : all.months.length;
  const excludedForeignCount = held.length === 0 ? 0 : all.excludedForeignCount;
  const horizon = Math.max(1, Math.min(months, PLAN_THRESHOLDS.cards.horizonMonths));

  // Card in use: largest actual spend on its own account; ties go to the lower key.
  const own = new Map(
    held.map((c) => [c.accountKey, totalOf(history(new Set([c.accountKey])), new Set(all.months))]),
  );
  let cardInUseKey: string | null = null;
  for (const c of [...held].sort((a, b) => a.accountKey.localeCompare(b.accountKey))) {
    const s = own.get(c.accountKey) ?? 0;
    if (s > 0 && (cardInUseKey === null || s > (own.get(cardInUseKey) ?? 0)))
      cardInUseKey = c.accountKey;
  }

  const examples = i.preferences.redemptionExamples;
  const nets: CardNet[] = held.map((c) => {
    const n = netForCard(c, cardableSpendCents, horizon);
    const range = c.programId === null ? null : pointsValueRange(examples, c.programId);
    return n.pointsEarned === null || range === null
      ? n
      : {
          ...n,
          pointsValueRange: {
            lowCents: Math.round(n.pointsEarned * range.lowCentsPerPoint),
            medianCents: Math.round(n.pointsEarned * range.medianCentsPerPoint),
            highCents: Math.round(n.pointsEarned * range.highCentsPerPoint),
          },
        };
  });
  nets.sort(byName<CardNet>((n) => n.cardKey));

  const yearlyFee = (c: HeldCardInput): number | null => {
    const cost = holdingCostOfProduct(c.fee);
    return cost.kind === "known" ? cost.amount.perYearCents : null;
  };
  const breakEven = held
    .map((c) => {
      const pct = validPct(c.cashback);
      const cost = holdingCostOfProduct(c.fee);
      const annual =
        pct === null || pct <= 0 || cost.kind !== "known"
          ? null
          : Math.round((cost.amount.perYearCents * 100) / pct);
      return { cardKey: c.accountKey, annualSpendCents: annual };
    })
    .sort((a, b) => a.cardKey.localeCompare(b.cardKey));

  // Criteria: the cards the user holds, in a neutral sort. Cards the user does
  // not hold are not listed (no catalogue of other products next to their numbers).
  const feeCriteria = (fee: ProductFee | null | undefined): CardCriteriaRow["annualFee"] => {
    const cost = holdingCostOfProduct(fee);
    return cost.kind === "known"
      ? {
          cents: cost.amount.perYearCents,
          known: true,
          asOf: cost.asOf,
          sourceUrl: cost.sourceUrl,
        }
      : { cents: null, known: false, asOf: null, sourceUrl: null };
  };
  const criteria: CardCriteriaRow[] = held.map((c) => {
    const cb = c.cashback;
    return {
      cardKey: c.accountKey,
      name: c.label,
      held: true,
      annualFee: feeCriteria(c.fee),
      cashbackPct:
        validPct(cb) === null
          ? criteriaValue(null, "unknown")
          : cb.tier === "gemeten"
            ? criteriaValue(cb.pct, "measured", cb.updatedAt)
            : cb.tier === "aangenomen"
              ? criteriaValue(0, "assumed")
              : criteriaValue(null, "unknown"),
      fxFeePct: provenanced(c.fxFeePct, c.provenance?.fxFeePct),
      pointsPerEuro: provenanced(c.pointsPerEuro, c.provenance?.pointsPerEuro),
      earnByCategory: "unknown",
      pointsExpiry: c.programId === null ? null : (i.preferences.pointsExpiry[c.programId] ?? null),
      transferRatio: "unknown",
      insurance: "unknown",
    };
  });
  criteria.sort(byName<CardCriteriaRow>((c) => c.cardKey));

  const balances = i.rewards
    .map((b) => ({
      programId: b.id,
      points: b.points,
      stale: isStale(b, i.asOf),
      expiresOn: i.preferences.pointsExpiry[b.id] ?? null,
      valueRange: pointsValueRange(examples, b.id),
    }))
    .sort((a, b) => a.programId.localeCompare(b.programId));

  // Advice looks at everything a card could pay on every personal account, not
  // only at the cards the user holds: the user may have stated a card that no
  // bank data shows.
  const adviceSpend = history();
  const advice = computeCardAdvice({
    spend: {
      windowCents: totalOf(adviceSpend),
      months: adviceSpend.months.length,
      foreignCents: adviceSpend.foreignCents,
      excludedForeignCount: adviceSpend.excludedForeignCount,
    },
    catalogue: i.catalogue,
    heldIds: [
      ...new Set([
        ...i.profile.statedCardIds.filter((id) => id !== "other"),
        ...held.flatMap((c) => (c.catalogueId ? [c.catalogueId] : [])),
      ]),
    ],
    hasOtherCard: i.profile.statedCardIds.includes("other"),
    cardBalances: i.profile.cardBalances,
    rewards: i.rewards,
    preferences: i.preferences,
    rates: i.rates,
    buffer,
    asOf: i.asOf,
  });

  const figures: CardsFigures = {
    criteria,
    nets,
    cardInUseKey,
    cardableSpendCents,
    notCardableSpendCents,
    months,
    breakEven,
    balances,
    excludedForeignCount,
    advice,
    sharedCases: true,
  };

  const inUse = nets.find((n) => n.cardKey === cardInUseKey) ?? null;
  const missing: Missing[] = [];
  let status: SectionResult<CardsFigures>["status"];
  let statusReason: StatusReason;
  if (held.length === 0) {
    status = "not-enough-data";
    statusReason = { key: "no-card-data" };
    missing.push({ kind: "cards", action: "import" });
  } else if (cardableSpendCents === 0 || inUse === null) {
    status = "not-enough-data";
    statusReason = { key: "no-cardable-spend" };
    missing.push({ kind: "cardable-spend", action: "connect-bank" });
  } else if (inUse.netCents === null) {
    status = "not-enough-data";
    statusReason = { key: "in-use-card-unknown" };
    missing.push({ kind: "cards", action: "enter-figure", ref: inUse.cardKey });
  } else {
    const base = inUse.netCents;
    const better = nets.filter(
      (n) =>
        n.cardKey !== inUse.cardKey &&
        n.netCents !== null &&
        n.netCents - base - PLAN_THRESHOLDS.cards.betterCardMargin * Math.abs(base) > EPS,
    );
    // Another held card netting more is a fact to show, not a reason for
    // concern: the status stays on-track either way.
    status = "on-track";
    statusReason = {
      key: better.length > 0 ? "other-card-nets-more" : "no-better-card",
    };
  }

  // The advice rests on all of the user's spending, so a user whose card
  // accounts alone cannot be judged still has a section with a verdict. One
  // story: the status follows the advice, and no "import a card" request stays.
  if (status === "not-enough-data" && advice.state === "ok" && advice.options.length > 0) {
    status = "on-track";
    statusReason = { key: "card-advice" };
    missing.length = 0;
  }

  const calc: CalcStep[] = [];
  if (held.length > 0)
    calc.push({
      id: "cardable-spend",
      inputs: {
        months: fig("count", months),
        foreign_excluded: fig("count", excludedForeignCount),
        not_cardable: fig("cents", notCardableSpendCents),
      },
      output: fig("cents", cardableSpendCents),
    });
  if (cardableSpendCents > 0)
    for (const n of nets) {
      const c = held.find((h) => h.accountKey === n.cardKey)!;
      calc.push({
        id: "card-earned",
        inputs: {
          spend: fig("cents", n.spendCents),
          cashback_pct: fig("pct", validPct(c.cashback)),
        },
        output: fig("cents", n.earnedCents),
      });
      calc.push({
        id: "card-fee",
        inputs: {
          months: fig("months", horizon),
          fee_year: fig("cents", yearlyFee(c)),
          prorated: fig("count", horizon < FULL_YEAR_MONTHS ? 1 : 0),
        },
        output: fig("cents", n.feeShareCents),
      });
      calc.push({
        id: "card-net",
        inputs: {
          earned: fig("cents", n.earnedCents),
          fee: fig("cents", n.feeShareCents),
        },
        output: fig("cents", n.netCents),
      });
      if (n.pointsValueRange !== null && n.pointsEarned !== null)
        calc.push({
          id: "points-value",
          inputs: { points: fig("count", n.pointsEarned) },
          output: fig("cents", n.pointsValueRange.medianCents),
        });
    }
  for (const b of breakEven) {
    if (b.annualSpendCents === null) continue;
    const c = held.find((h) => h.accountKey === b.cardKey)!;
    const cost = holdingCostOfProduct(c.fee);
    calc.push({
      id: "break-even",
      inputs: {
        fee_year: fig("cents", cost.kind === "known" ? cost.amount.perYearCents : null),
        cashback_pct: fig("pct", validPct(c.cashback)),
      },
      output: fig("cents", b.annualSpendCents),
    });
  }

  const flat: Record<CardsFlatId, FigureValue> = {
    cards_held_count: fig("count", held.length),
    cards_cardable_spend: fig("cents", cardableSpendCents),
    cards_months: fig("count", months),
    cards_foreign_excluded: fig("count", excludedForeignCount),
    cards_in_use_net: fig("cents", inUse?.netCents ?? null),
  };

  const facts: PlanFact[] = [];
  const used = new Set<string>();
  const fact = (
    id: string,
    f: Omit<PlanFact, "factId" | "section" | "polarity" | "mustMention"> &
      Partial<Pick<PlanFact, "polarity" | "mustMention">>,
  ): void => {
    let factId = id;
    for (let n = 2; used.has(factId); n++) factId = `${id}-${n}`;
    used.add(factId);
    facts.push({
      section: "cards",
      polarity: "neutral",
      mustMention: false,
      ...f,
      factId,
    });
  };
  if (cardableSpendCents > 0) {
    for (const n of nets) {
      const h = hash(n.cardKey);
      if (n.netCents !== null)
        fact(`card_net:${h}`, {
          exact: n.netCents,
          unit: "cents",
          polarity: n.netCents < 0 ? "negative" : "neutral",
        });
    }
    for (const n of [...nets].sort((a, b) => a.cardKey.localeCompare(b.cardKey))) {
      if (n.programId !== null && n.pointsEarned !== null)
        fact(`card_points_year:${idPart(n.programId)}`, {
          exact: n.pointsEarned,
          unit: "count",
          ...(n.pointsValueRange === null
            ? {}
            : {
                range: {
                  low: n.pointsValueRange.lowCents,
                  expected: n.pointsValueRange.medianCents,
                  high: n.pointsValueRange.highCents,
                  assumption: "own-redemption-examples",
                },
              }),
        });
    }
    for (const b of breakEven)
      if (b.annualSpendCents !== null)
        fact(`card_break_even:${hash(b.cardKey)}`, {
          exact: b.annualSpendCents,
          unit: "cents",
        });
  }
  for (const b of balances) {
    if (b.expiresOn === null || !isIsoDate(b.expiresOn)) continue;
    const soon = daysBetween(i.asOf, b.expiresOn) <= EXPIRY_WARN_DAYS;
    fact(`points_expiry:${idPart(b.programId)}`, {
      exact: b.expiresOn,
      unit: "date",
      polarity: soon ? "negative" : "neutral",
      mustMention: soon,
    });
  }

  return {
    section: "cards",
    figures,
    flat,
    headline: inUse?.netCents == null ? null : fig("cents", inUse.netCents),
    status,
    statusReason,
    missing,
    calc,
    facts,
  };
}

export { pointsValueRange, type PointsValueRange } from "./pointsValue.js";
