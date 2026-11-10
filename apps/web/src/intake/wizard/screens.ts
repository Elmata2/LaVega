import { AdvisorProfile, RISK_SCALE, type WorkKind } from "@lavega/core";
import { applyChildren } from "../state.js";

export type ScreenId =
  | "household"
  | "money-sharing"
  | "birth-year"
  | "work"
  | "vat"
  | "income-regularity"
  | "children"
  | "child-years"
  | "income"
  | "spend"
  | "housing"
  | "savings"
  | "banks"
  | "debit-cards"
  | "cards"
  | "card-repayment"
  | "spend-mix"
  | "foreign-spend"
  | "goal"
  | "debts"
  | "debt-details"
  | "buffer"
  | `risk:${string}`
  | "cut-targets"
  | "check-in"
  | "confidence"
  | "programs"
  | "points-goal"
  | "flights"
  | "invested"
  | "priorities"
  | "summary"
  | "upload";

export type Section = "about" | "goals" | "risk";

/** The wizard owns the goal and the debt with these ids. */
export const WIZARD_GOAL = "wizard-goal";
export const WIZARD_DEBT = "wizard-debt";

const ABOUT: readonly ScreenId[] = [
  "household",
  "money-sharing",
  "birth-year",
  "work",
  "vat",
  "income-regularity",
  "children",
  "child-years",
  "income",
  "spend",
  "housing",
  "savings",
  "banks",
  "debit-cards",
  "cards",
  "card-repayment",
  "spend-mix",
  "foreign-spend",
];

/** Screens added in round 1 of the personalisation; Task 13 uses them to
 *  find which of them an older profile has not seen. */
export const ROUND1_NEW: readonly ScreenId[] = [
  "money-sharing",
  "birth-year",
  "income-regularity",
  "banks",
  "card-repayment",
  "spend-mix",
  "foreign-spend",
  "priorities",
];

/** Round 2 is its own run, offered once the first transaction is in; its ids
 *  are not part of canonical(), so round 1 never walks or resumes into them. */
export const ROUND2: readonly ScreenId[] = [
  "cut-targets",
  "check-in",
  "confidence",
  "programs",
  "points-goal",
  "flights",
];
const GOALS: readonly ScreenId[] = ["goal", "debts", "debt-details", "buffer"];

const riskScreens = (): ScreenId[] => RISK_SCALE.items.map((i) => `risk:${i.id}` as const);

/** Every screen in order, including the conditional ones. */
const canonical = (): ScreenId[] => [...ABOUT, ...GOALS, ...riskScreens(), "invested", "priorities", "summary", "upload"];

/** Freelance or own business: the work kinds that ask the VAT question. */
export const isSelfEmployed = (p: AdvisorProfile): boolean =>
  (p.work?.value ?? []).some((w) => w === "freelance" || w === "business");

export function screensFor(p: AdvisorProfile): ScreenId[] {
  const noChildren = Array.isArray(p.children?.value) && p.children.value.length === 0;
  const hasStatedCard = (p.statedCards?.value.length ?? 0) > 0;
  return canonical().filter(
    (id) =>
      !(id === "money-sharing" && p.household?.value.kind !== "together") &&
      !(id === "card-repayment" && (!hasStatedCard || p.intake.noCards === true)) &&
      !(id === "vat" && !isSelfEmployed(p)) &&
      !(id === "child-years" && noChildren) &&
      !(id === "debt-details" && p.intake.noUserDebts === true),
  );
}

/** True when the field this screen writes is already set on the profile. */
export function isAnswered(p: AdvisorProfile, id: ScreenId): boolean {
  if (id.startsWith("risk:")) return p.risk?.answers?.[id.slice("risk:".length)] !== undefined;
  switch (id) {
    case "household":
      return p.household !== undefined;
    case "money-sharing":
      return p.household?.value.moneySharing !== undefined;
    case "birth-year":
      return p.birthYear !== undefined;
    case "work":
      return p.work !== undefined;
    case "vat":
      return p.chargesVat !== undefined;
    case "income-regularity":
      return p.incomeRegularity !== undefined;
    case "children":
      return p.children !== undefined;
    case "child-years":
      return (p.children?.value.length ?? 0) > 0;
    case "income":
      return p.statedRanges?.value.income !== undefined;
    case "spend":
      return p.statedRanges?.value.spend !== undefined;
    case "housing":
      return p.housing !== undefined;
    case "savings":
      return p.savings !== undefined;
    case "banks":
      return p.statedBanks !== undefined;
    case "debit-cards":
      return p.statedDebitCards !== undefined;
    case "cards":
      return p.statedCards !== undefined || p.intake.noCards === true;
    case "card-repayment":
      return p.cardRepayment !== undefined;
    case "spend-mix":
      return p.spendMix !== undefined;
    case "foreign-spend":
      return p.foreignSpend !== undefined;
    case "goal":
      return (p.goals ?? []).some((g) => g.value.id === WIZARD_GOAL);
    case "debts":
      return p.intake.noUserDebts === true || (p.debts ?? []).some((d) => d.id === WIZARD_DEBT);
    case "debt-details":
      return (p.debts ?? []).some((d) => d.id === WIZARD_DEBT);
    case "buffer":
      return p.buffer !== undefined;
    case "invested":
      return p.knowledge?.value.investedBefore !== undefined;
    case "priorities":
      return p.priorities !== undefined;
    case "cut-targets":
      return p.cutTargets !== undefined;
    case "check-in":
      return p.checkInCadence !== undefined;
    case "confidence":
      return p.confidence !== undefined;
    case "programs":
      return p.statedPrograms !== undefined;
    case "points-goal":
      return p.pointsGoal !== undefined;
    case "flights":
      return p.flightsPerYear !== undefined;
    case "summary":
    case "upload":
      return false;
    default:
      return false;
  }
}

export function sectionOf(id: ScreenId): Section {
  if (ABOUT.includes(id) || ROUND2.includes(id)) return "about";
  if (GOALS.includes(id)) return "goals";
  return "risk";
}

/** The intake was completed once: blocksDone 3 and not on the last screens.
 *  Only invested, priorities and summary are where a new user can stand with
 *  blocksDone 3; any other lastScreen (upload, legacy ids, none) is finished. */
export function isFinishedIntake(p: AdvisorProfile): boolean {
  const { lastScreen, blocksDone } = p.intake;
  return blocksDone >= 3 && lastScreen !== "invested" && lastScreen !== "priorities" && lastScreen !== "summary";
}

/** A finished user's unanswered round-1 questions, in wizard order. */
export function pendingNewQuestions(p: AdvisorProfile): ScreenId[] {
  const present = new Set(screensFor(p));
  return canonical().filter((id) => ROUND1_NEW.includes(id) && present.has(id) && !isAnswered(p, id));
}

/** Round 2 screens still to answer, in order. */
export const round2Pending = (p: AdvisorProfile): ScreenId[] => ROUND2.filter((id) => !isAnswered(p, id));

export const round2Due = (p: AdvisorProfile, hasTransactions: boolean): boolean =>
  p.intake.blocksDone >= 3 && hasTransactions && p.intake.round2Done !== true;

/** Round 2 finishes without touching round 1's lastScreen. */
export const markRound2Done = (p: AdvisorProfile): AdvisorProfile =>
  withIntake(p, { ...p.intake, round2Done: true });

export function resumeScreen(p: AdvisorProfile): ScreenId | "done" {
  const { lastScreen, blocksDone } = p.intake;
  // A finished user only sees what is new to them.
  if (isFinishedIntake(p)) return pendingNewQuestions(p)[0] ?? "done";
  if (lastScreen !== undefined) {
    const all = canonical();
    // "has-cards" was removed; those users continue where it led, at cards.
    const last = lastScreen === "has-cards" ? "debit-cards" : lastScreen;
    const at = all.indexOf(last as ScreenId);
    if (at >= 0) {
      const present = new Set(screensFor(p));
      // A mid-wizard user from before the new questions went in has not seen
      // the ones that now sit before where they stopped: ask those first.
      const missed = all
        .slice(0, at + 1)
        .find((id) => ROUND1_NEW.includes(id) && present.has(id) && !isAnswered(p, id));
      if (missed !== undefined) return missed;
      return all.slice(at + 1).find((id) => present.has(id)) ?? "done";
    }
  }
  if (blocksDone >= 3) return "done";
  if (blocksDone === 2) return riskScreens()[0] ?? "invested";
  if (blocksDone === 1) return "goal";
  return "household";
}

const withIntake = (p: AdvisorProfile, intake: AdvisorProfile["intake"]) =>
  new AdvisorProfile({ ...p, intake });

const SECTION_END: Partial<Record<string, 1 | 2 | 3>> = { "foreign-spend": 1, buffer: 2, invested: 3 };

export function markDone(p: AdvisorProfile, id: ScreenId): AdvisorProfile {
  const end = SECTION_END[id];
  return withIntake(p, {
    ...p.intake,
    lastScreen: id,
    step0: p.intake.step0 ?? "none",
    blocksDone: end === undefined ? p.intake.blocksDone : Math.max(p.intake.blocksDone, end),
  });
}

export const answerNoChildren = (p: AdvisorProfile, asOf: string): AdvisorProfile =>
  applyChildren(p, [], asOf);

export function answerHasChildren(p: AdvisorProfile): AdvisorProfile {
  if (!Array.isArray(p.children?.value) || p.children.value.length > 0) return p;
  const { children: _c, ...rest } = p;
  return new AdvisorProfile(rest);
}

export function answerDebts(p: AdvisorProfile, has: boolean): AdvisorProfile {
  if (!has) return withIntake(p, { ...p.intake, noUserDebts: true });
  const { noUserDebts: _n, ...rest } = p.intake;
  return withIntake(p, rest);
}

/** Nee stores an empty stated list (the answer is a fact) and `noCards`, which
 *  skips the cards screen. Ja clears both an empty list and the Nee flag. */
export function answerCards(p: AdvisorProfile, has: boolean, asOf: string): AdvisorProfile {
  if (!has) {
    const { cardRepayment: _dropped, ...kept } = p;
    return new AdvisorProfile({
      ...kept,
      statedCards: { value: [], source: "stated", at: asOf },
      intake: { ...p.intake, noCards: true },
    });
  }
  const { statedCards, ...rest } = p;
  const keep = statedCards !== undefined && statedCards.value.length > 0;
  return new AdvisorProfile({
    ...rest,
    ...(keep ? { statedCards } : {}),
    intake: { ...p.intake, noCards: false },
  });
}

export const WORK_ORDER: readonly WorkKind[] = [
  "employed",
  "freelance",
  "business",
  "student",
  "jobseeking",
  "retired",
  "other",
];

export const reopenRisk = (p: AdvisorProfile): AdvisorProfile =>
  withIntake(p, {
    ...p.intake,
    blocksDone: Math.min(p.intake.blocksDone, 2) as 0 | 1 | 2,
    lastScreen: "buffer",
  });
