import {
  AdvisorProfile,
  RISK_SCALE,
  experienceOf,
  KNOWLEDGE_QUESTIONS,
  scoreKnowledge,
  scoreTolerance,
  type Goal,
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

export const applyStatedCards = (p: AdvisorProfile, ids: readonly string[], asOf: string) =>
  copyProfile(p, { statedCards: { value: [...ids], source: "stated", at: asOf } });

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
  value: { kind: "alone" | "together"; partnerIncomeInScope?: boolean },
  asOf: string,
) => copyProfile(p, { household: { value, source: "stated", at: asOf } });

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
