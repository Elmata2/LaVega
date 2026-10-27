import { AdvisorProfile, RISK_SCALE, type WorkKind } from "@lavega/core";
import { applyChildren } from "../state.js";

export type ScreenId =
  | "household"
  | "work"
  | "children"
  | "child-years"
  | "income"
  | "spend"
  | "housing"
  | "savings"
  | "debit-cards"
  | "has-cards"
  | "cards"
  | "goal"
  | "debts"
  | "debt-details"
  | "buffer"
  | `risk:${string}`
  | "invested"
  | "upload";

export type Section = "about" | "goals" | "risk";

const ABOUT: readonly ScreenId[] = [
  "household",
  "work",
  "children",
  "child-years",
  "income",
  "spend",
  "housing",
  "savings",
  "debit-cards",
  "has-cards",
  "cards",
];
const GOALS: readonly ScreenId[] = ["goal", "debts", "debt-details", "buffer"];

const riskScreens = (): ScreenId[] => RISK_SCALE.items.map((i) => `risk:${i.id}` as const);

/** Every screen in order, including the conditional ones. */
const canonical = (): ScreenId[] => [...ABOUT, ...GOALS, ...riskScreens(), "invested", "upload"];

export function screensFor(p: AdvisorProfile): ScreenId[] {
  const noChildren = Array.isArray(p.children?.value) && p.children.value.length === 0;
  return canonical().filter(
    (id) =>
      !(id === "child-years" && noChildren) &&
      !(id === "debt-details" && p.intake.noUserDebts === true) &&
      !(id === "cards" && p.intake.noCards === true),
  );
}

export function sectionOf(id: ScreenId): Section {
  if (ABOUT.includes(id)) return "about";
  if (GOALS.includes(id)) return "goals";
  return "risk";
}

export function resumeScreen(p: AdvisorProfile): ScreenId | "done" {
  const { lastScreen, blocksDone } = p.intake;
  if (lastScreen !== undefined) {
    const all = canonical();
    const at = all.indexOf(lastScreen as ScreenId);
    if (at >= 0) {
      const present = new Set(screensFor(p));
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

const SECTION_END: Partial<Record<string, 1 | 2 | 3>> = { savings: 1, buffer: 2, invested: 3 };

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
    return new AdvisorProfile({
      ...p,
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
