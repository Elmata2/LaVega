import {
  AdvisorProfile,
  RISK_SCALE,
  experienceOf,
  KNOWLEDGE_QUESTIONS,
  scoreKnowledge,
  scoreTolerance,
  type CardBalance,
  type CardRepayment,
  type CheckInCadence,
  type CutTarget,
  type FlightsPerYear,
  type ForeignSpend,
  type Goal,
  type IncomeRegularity,
  type MoneySharing,
  type PointsGoal,
  type Priority,
  type SpendArea,
  type WorkKind,
} from "@lavega/core";

const copyProfile = (
  p: AdvisorProfile,
  patch: Partial<ConstructorParameters<typeof AdvisorProfile>[0]>,
) => new AdvisorProfile({ ...p, ...patch });

type Range = { lowCents: number; highCents: number };

/** A range typed where there was no data to read it from. */
export function applyStatedRange(
  profile: AdvisorProfile,
  section: "income" | "spend",
  range: Range,
  asOf: string,
): AdvisorProfile {
  const prev = profile.statedRanges?.value ?? {};
  return copyProfile(profile, {
    statedRanges: { value: { ...prev, [section]: range }, source: "stated", at: asOf },
  });
}

export const applyWork = (p: AdvisorProfile, kinds: readonly WorkKind[], asOf: string) =>
  copyProfile(p, { work: { value: [...kinds], source: "stated", at: asOf } });

export const applyChargesVat = (p: AdvisorProfile, charges: boolean, asOf: string) =>
  copyProfile(p, { chargesVat: { value: charges, source: "stated", at: asOf } });

export const applyStatedDebitCards = (p: AdvisorProfile, ids: readonly string[], asOf: string) =>
  copyProfile(p, { statedDebitCards: { value: [...ids], source: "stated", at: asOf } });

/** Without the key at all: optional schema keys cannot hold undefined. */
const withoutBalances = (p: AdvisorProfile): AdvisorProfile => {
  const { cardBalances: _gone, ...rest } = p;
  return new AdvisorProfile(rest);
};

/** The stated balances of the credit cards. An empty list removes the fact. */
export function applyCardBalances(
  p: AdvisorProfile,
  rows: readonly CardBalance[],
  asOf: string,
): AdvisorProfile {
  if (rows.length === 0) return withoutBalances(p);
  return copyProfile(p, { cardBalances: { value: [...rows], source: "stated", at: asOf } });
}

/** Picking other cards drops the balances of cards that are no longer stated.
 *  An empty list also clears the repayment answer, as "no cards" does. */
export function applyStatedCards(
  p: AdvisorProfile,
  ids: readonly string[],
  asOf: string,
): AdvisorProfile {
  const next = copyProfile(p, { statedCards: { value: [...ids], source: "stated", at: asOf } });
  if (ids.length === 0) {
    const { cardBalances: _b, cardRepayment: _r, ...rest } = next;
    return new AdvisorProfile(rest);
  }
  const kept = (p.cardBalances?.value ?? []).filter((b) => ids.includes(b.cardId));
  if (p.cardBalances === undefined || kept.length === p.cardBalances.value.length) return next;
  return applyCardBalances(next, kept, p.cardBalances.at);
}

export const applyStatedHousing = (
  p: AdvisorProfile,
  kind: "rent" | "mortgage" | "other",
  monthlyCents: number,
  asOf: string,
): AdvisorProfile =>
  copyProfile(p, { housing: { value: { kind, monthlyCents }, source: "stated", at: asOf } });

export const applyStatedSavings = (p: AdvisorProfile, totalCents: number, asOf: string) =>
  copyProfile(p, { savings: { value: { totalCents }, source: "stated", at: asOf } });

export const applyHousehold = (
  p: AdvisorProfile,
  value: { kind: "alone" | "together"; partnerIncomeInScope?: boolean; moneySharing?: MoneySharing },
  asOf: string,
) => {
  const { moneySharing, ...rest } = value;
  // Together again after Back keeps the earlier answer to "do you share?".
  const prev = p.household?.value;
  const sharing =
    moneySharing ?? (value.kind === "together" && prev?.kind === "together" ? prev.moneySharing : undefined);
  const kept = value.kind === "alone" || sharing === undefined ? rest : { ...rest, moneySharing: sharing };
  return copyProfile(p, { household: { value: kept, source: "stated", at: asOf } });
};

/** Living alone has nobody to share with: the answer is ignored. */
export const applyMoneySharing = (p: AdvisorProfile, sharing: MoneySharing, asOf: string) =>
  p.household?.value.kind === "alone"
    ? p
    : copyProfile(p, {
        household: {
          value: { ...(p.household?.value ?? { kind: "together" as const }), moneySharing: sharing },
          source: "stated",
          at: asOf,
        },
      });

export const applyBirthYear = (p: AdvisorProfile, year: number, asOf: string) =>
  copyProfile(p, { birthYear: { value: year, source: "stated", at: asOf } });

export const applyIncomeRegularity = (p: AdvisorProfile, v: IncomeRegularity, asOf: string) =>
  copyProfile(p, { incomeRegularity: { value: v, source: "stated", at: asOf } });

export const applyStatedBanks = (p: AdvisorProfile, ids: readonly string[], asOf: string) =>
  copyProfile(p, { statedBanks: { value: [...ids], source: "stated", at: asOf } });

export const applyCardRepayment = (p: AdvisorProfile, v: CardRepayment, asOf: string) =>
  copyProfile(p, { cardRepayment: { value: v, source: "stated", at: asOf } });

export const applySpendMix = (p: AdvisorProfile, areas: readonly SpendArea[], asOf: string) =>
  copyProfile(p, { spendMix: { value: areas.slice(0, 3), source: "stated", at: asOf } });

export const applyForeignSpend = (p: AdvisorProfile, v: ForeignSpend, asOf: string) =>
  copyProfile(p, { foreignSpend: { value: v, source: "stated", at: asOf } });

export const applyPriorities = (p: AdvisorProfile, v: readonly Priority[], asOf: string) =>
  copyProfile(p, { priorities: { value: [...v], source: "stated", at: asOf } });

export const applyCutTargets = (p: AdvisorProfile, v: readonly CutTarget[], asOf: string) =>
  copyProfile(p, { cutTargets: { value: [...v], source: "stated", at: asOf } });

export const applyCheckInCadence = (p: AdvisorProfile, v: CheckInCadence, asOf: string) =>
  copyProfile(p, { checkInCadence: { value: v, source: "stated", at: asOf } });

export const applyConfidence = (p: AdvisorProfile, n: 1 | 2 | 3 | 4, asOf: string) =>
  copyProfile(p, { confidence: { value: n, source: "stated", at: asOf } });

export const applyStatedPrograms = (p: AdvisorProfile, ids: readonly string[], asOf: string) =>
  copyProfile(p, { statedPrograms: { value: [...ids], source: "stated", at: asOf } });

export const applyPointsGoal = (p: AdvisorProfile, v: PointsGoal, asOf: string) =>
  copyProfile(p, { pointsGoal: { value: v, source: "stated", at: asOf } });

export const applyFlightsPerYear = (p: AdvisorProfile, v: FlightsPerYear, asOf: string) =>
  copyProfile(p, { flightsPerYear: { value: v, source: "stated", at: asOf } });

export const applyChildren = (
  p: AdvisorProfile,
  children: readonly { id: string; birthYear: number }[],
  asOf: string,
) => copyProfile(p, { children: { value: [...children], source: "stated", at: asOf } });

export const applyGoals = (p: AdvisorProfile, goals: readonly Goal[], asOf: string) =>
  copyProfile(p, { goals: goals.map((value) => ({ value, source: "stated" as const, at: asOf })) });

export const applyBuffer = (p: AdvisorProfile, months: number, asOf: string) =>
  copyProfile(p, { buffer: { value: { months }, source: "stated", at: asOf } });

/** A debt the user typed in block 2: stated and with no evidence. Debts from
 *  block 1 (confirmed, or corrected and still carrying their evidence) are
 *  never matched by this. */
export const isUserDebt = (d: { source: string; evidence?: readonly string[] }): boolean =>
  d.source === "stated" && d.evidence === undefined;

type UserDebt = {
  id: string;
  lender: string;
  monthlyCents: number;
  balanceCents?: number;
  ratePct?: number;
};

/** Adds one typed debt; every other debt is left exactly as it was. */
export const addUserDebt = (p: AdvisorProfile, debt: UserDebt, asOf: string): AdvisorProfile =>
  copyProfile(p, { debts: [...(p.debts ?? []), { ...debt, source: "stated" as const, at: asOf }] });

/** Removes one typed debt by id, and only a typed one. */
export const removeUserDebt = (p: AdvisorProfile, id: string): AdvisorProfile =>
  copyProfile(p, { debts: (p.debts ?? []).filter((d) => !(d.id === id && isUserDebt(d))) });

/** Every risk pick is kept as given (item id -> option id). The score is set
 *  only once enough items are answered for the scale to give one. */
export function applyRiskAnswers(
  p: AdvisorProfile,
  answers: Record<string, string>,
  asOf: string,
): AdvisorProfile {
  if (Object.keys(answers).length === 0) return p;
  const { score } = scoreTolerance(answers);
  return copyProfile(p, {
    risk: {
      ...(score === null ? {} : { score }),
      answers: { ...answers },
      scaleId: RISK_SCALE.id,
      at: asOf,
    },
  });
}

/** Every knowledge pick and the invested-before answer are kept as given.
 *  `correct` is the count so far; experience is set only when everything is
 *  answered. */
export function applyKnowledge(
  p: AdvisorProfile,
  answers: Record<string, string>,
  investedBefore: boolean | null,
  asOf: string,
): AdvisorProfile {
  if (Object.keys(answers).length === 0 && investedBefore === null) return p;
  const correct = scoreKnowledge(answers);
  const complete =
    investedBefore !== null && KNOWLEDGE_QUESTIONS.every((q) => answers[q.id] !== undefined);
  const next = copyProfile(p, {
    knowledge: {
      value: {
        correct,
        of: KNOWLEDGE_QUESTIONS.length,
        answers: { ...answers },
        ...(investedBefore === null ? {} : { investedBefore }),
      },
      source: "stated",
      at: asOf,
    },
  });
  return complete
    ? copyProfile(next, {
        experience: { value: experienceOf(correct, investedBefore), source: "stated", at: asOf },
      })
    : next;
}
