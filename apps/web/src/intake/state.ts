import {
  AdvisorProfile,
  RISK_SCALE,
  capacityInputs,
  debtPaymentsMonthly,
  experienceOf,
  fingerprint,
  isSuppressed,
  KNOWLEDGE_QUESTIONS,
  removeDerived,
  roomFromStated,
  scoreCapacity,
  scoreKnowledge,
  scoreTolerance,
  type CapacityScore,
  type DataProposal,
  type DebtProposal,
  type FixedCostProposal,
  type Goal,
  type HousingProposalCard,
  type IncomeProposal,
  type RoomResult,
} from "@lavega/core";

export type Stage = "step0" | "block1" | "block2" | "block3" | "done";
export type IntakeState = { profile: AdvisorProfile; stage: Stage };

export type SavingsCard = DataProposal<"savings", { totalCents: number; excluded: number }>;
export type CardProposal =
  | IncomeProposal
  | HousingProposalCard
  | FixedCostProposal
  | DebtProposal
  | SavingsCard;

/** `cents` is a monthly figure for income, housing, fixed costs and debts, and
 *  the total balance for savings. */
export type ProposalAnswer =
  | { kind: "confirm" }
  | { kind: "correct"; value: { cents: number } }
  | { kind: "notMine" };

export type AnswerStatus = "open" | "confirmed" | "stated" | "rejected";

const copyProfile = (
  p: AdvisorProfile,
  patch: Partial<ConstructorParameters<typeof AdvisorProfile>[0]>,
) => new AdvisorProfile({ ...p, ...patch });

/** Where the intake should open. Step 0 once chosen counts as done, so a user
 *  who left for the bank returns to block 1. */
export function resumeStage(profile: AdvisorProfile): Stage {
  const { blocksDone, step0 } = profile.intake;
  if (blocksDone >= 3) return "done";
  if (blocksDone === 2) return "block3";
  if (blocksDone === 1) return "block2";
  return step0 === null ? "step0" : "block1";
}

export const markStep0 = (p: AdvisorProfile, step0: "bank" | "upload" | "none"): AdvisorProfile =>
  copyProfile(p, { intake: { ...p.intake, step0 } });

export const completeBlock = (p: AdvisorProfile, block: 1 | 2 | 3): AdvisorProfile =>
  p.intake.blocksDone >= block ? p : copyProfile(p, { intake: { ...p.intake, blocksDone: block } });

const housingKindOf = (k: "huur" | "hypotheek" | "wonen"): "rent" | "mortgage" | "other" =>
  k === "huur" ? "rent" : k === "hypotheek" ? "mortgage" : "other";

const isFixedCost = (p: CardProposal): p is FixedCostProposal =>
  (p.kind === "fixedCost" || p.kind === "housing") && "origin" in p.data;
const isHousing = (p: CardProposal): p is HousingProposalCard =>
  p.kind === "housing" && "housingKind" in p.data;

const fpOf = (ev: readonly string[] | undefined): string | null =>
  ev === undefined || ev.length === 0 ? null : fingerprint(ev);

/** Drop what a proposal produced before, by id, by label (the same payment
 *  stream changes id when one more transaction arrives) or by evidence. */
function withoutEntry(p: AdvisorProfile, proposal: CardProposal): AdvisorProfile {
  if (proposal.kind === "income" && "regularity" in proposal.data) {
    const label = proposal.data.label;
    return copyProfile(p, {
      incomeStreams: (p.incomeStreams ?? []).filter(
        (f) => f.value.id !== proposal.id && f.value.label !== label,
      ),
    });
  }
  if (isFixedCost(proposal)) {
    const label = proposal.data.label;
    return copyProfile(p, {
      fixedCosts: (p.fixedCosts ?? []).filter(
        (f) => f.value.id !== proposal.id && f.value.label !== label,
      ),
    });
  }
  if (proposal.kind === "debt") {
    const lender = proposal.data.lender;
    return copyProfile(p, {
      debts: (p.debts ?? []).filter((d) => d.id !== proposal.id && d.lender !== lender),
    });
  }
  if (isHousing(proposal)) {
    const { housing: _h, ...rest } = p;
    return new AdvisorProfile(rest);
  }
  const { savings: _s, ...rest } = p;
  return new AdvisorProfile(rest);
}

export function applyProposalAnswer(
  profile: AdvisorProfile,
  proposal: CardProposal,
  answer: ProposalAnswer,
  asOf: string,
): AdvisorProfile {
  const cleared = withoutEntry(profile, proposal);
  if (answer.kind === "notMine") return removeDerived(cleared, proposal.fingerprint);
  const source = answer.kind === "correct" ? ("stated" as const) : ("confirmed" as const);
  const meta = { source, at: asOf, evidence: [...proposal.evidence] };
  const pick = (proposed: number): number =>
    answer.kind === "correct" ? answer.value.cents : proposed;

  if (proposal.kind === "income" && "regularity" in proposal.data) {
    const d = proposal.data;
    return copyProfile(cleared, {
      incomeStreams: [
        ...(cleared.incomeStreams ?? []),
        {
          ...meta,
          value: {
            id: proposal.id,
            label: d.label,
            monthlyCents: pick(d.monthlyCents),
            regular: d.regularity === "regular",
          },
        },
      ],
    });
  }
  if (isFixedCost(proposal)) {
    const d = proposal.data;
    return copyProfile(cleared, {
      fixedCosts: [
        ...(cleared.fixedCosts ?? []),
        { ...meta, value: { id: proposal.id, label: d.label, monthlyCents: pick(d.monthlyCents) } },
      ],
    });
  }
  if (proposal.kind === "debt") {
    const d = proposal.data;
    return copyProfile(cleared, {
      debts: [
        ...(cleared.debts ?? []),
        {
          id: proposal.id,
          lender: d.lender,
          monthlyCents: pick(d.monthlyCents ?? 0),
          ...(d.balanceCents === undefined ? {} : { balanceCents: d.balanceCents }),
          ...meta,
        },
      ],
    });
  }
  if (isHousing(proposal)) {
    const d = proposal.data;
    return copyProfile(cleared, {
      housing: {
        ...meta,
        value: { kind: housingKindOf(d.housingKind), monthlyCents: pick(d.monthlyCents) },
      },
    });
  }
  const d = proposal.data as { totalCents: number };
  return copyProfile(cleared, { savings: { ...meta, value: { totalCents: pick(d.totalCents) } } });
}

/** `confirmed`/`stated` when the profile holds an answer for this proposal,
 *  `rejected` when "Not mine" suppresses it, otherwise `open`. */
export function statusOf(profile: AdvisorProfile, proposal: CardProposal): AnswerStatus {
  if (isSuppressed(profile, proposal.fingerprint)) return "rejected";
  const hit = (ev: readonly string[] | undefined) => fpOf(ev) === proposal.fingerprint;
  let source: "derived" | "confirmed" | "stated" | undefined;
  if (proposal.kind === "income" && "regularity" in proposal.data)
    source = profile.incomeStreams?.find((f) => f.value.id === proposal.id)?.source;
  else if (isFixedCost(proposal))
    source = profile.fixedCosts?.find((f) => f.value.id === proposal.id)?.source;
  else if (proposal.kind === "debt")
    source = profile.debts?.find((d) => d.id === proposal.id)?.source;
  else if (isHousing(proposal))
    source = hit(profile.housing?.evidence) ? profile.housing?.source : undefined;
  else source = hit(profile.savings?.evidence) ? profile.savings?.source : undefined;
  return source === "confirmed" || source === "stated" ? source : "open";
}

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

export const applyWorries = (p: AdvisorProfile, text: string, asOf: string) =>
  copyProfile(p, { worries: { value: text, source: "stated", at: asOf } });

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

/** Fixed costs as the profile holds them: the confirmed housing line plus the
 *  confirmed fixed costs. A guess nobody confirmed is not counted. */
export const fixedCostsMonthlyCents = (p: AdvisorProfile): number =>
  (p.housing?.value.monthlyCents ?? 0) +
  (p.fixedCosts ?? []).reduce((s, f) => s + f.value.monthlyCents, 0);

/** Capacity from what the profile holds plus the room. Never stored. */
export function capacityFor(p: AdvisorProfile, room: RoomResult, asOf: string): CapacityScore {
  const inputs = capacityInputs({
    savingsCents: p.savings?.value.totalCents ?? 0,
    fixedCostsMonthlyCents: fixedCostsMonthlyCents(p),
    room,
    debtPaymentsMonthlyCents: debtPaymentsMonthly(
      [],
      (p.debts ?? []).map((d) => d.monthlyCents),
    ),
    goals: (p.goals ?? []).map((g) => g.value),
    asOf,
  });
  return scoreCapacity({
    ...inputs,
    bufferMonths: p.savings === undefined ? null : inputs.bufferMonths,
  });
}

/** The room to show: the computed one when transactions allow it, else the one
 *  worked out from the user's own ranges, else the computed "none". */
export function resolveRoom(
  computed: RoomResult,
  profile: AdvisorProfile,
): { room: RoomResult; statedInputs?: { income: Range; spend: Range } } {
  if (computed.kind === "computed") return { room: computed };
  const r = profile.statedRanges?.value;
  if (r?.income === undefined || r.spend === undefined) return { room: computed };
  return {
    room: roomFromStated(r.income, r.spend),
    statedInputs: { income: r.income, spend: r.spend },
  };
}
