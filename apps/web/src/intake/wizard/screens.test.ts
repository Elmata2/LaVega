import { expect, test } from "vitest";
import { AdvisorProfile, RISK_SCALE, emptyProfile } from "@lavega/core";
import {
  applyBirthYear,
  applyChildren,
  applyForeignSpend,
  applyGoals,
  applyIncomeRegularity,
  applyPriorities,
  applySpendMix,
  applyStatedBanks,
} from "../state.js";
import {
  answerCards,
  answerDebts,
  answerHasChildren,
  answerNoChildren,
  isAnswered,
  isFinishedIntake,
  markDone,
  pendingNewQuestions,
  reopenRisk,
  resumeScreen,
  screensFor,
  sectionOf,
  ROUND1_NEW,
  ROUND2,
  round2Due,
  round2Pending,
  WIZARD_DEBT,
  WIZARD_GOAL,
  type ScreenId,
} from "./screens.js";

const AS_OF = "2026-10-26";
const firstRisk = `risk:${RISK_SCALE.items[0]?.id}`;
const withBlocks = (blocksDone: 0 | 1 | 2 | 3) => {
  const p = emptyProfile();
  return new AdvisorProfile({ ...p, intake: { ...p.intake, blocksDone } });
};

/** Answers every round-1 question an empty alone-profile is asked. */
const answeredNew = (p: AdvisorProfile): AdvisorProfile =>
  applyPriorities(
    applyForeignSpend(
      applySpendMix(
        applyStatedBanks(
          applyIncomeRegularity(applyBirthYear(p, 1990, AS_OF), "fixed", AS_OF),
          ["other"],
          AS_OF,
        ),
        ["groceries"],
        AS_OF,
      ),
      "never",
      AS_OF,
    ),
    ["save-more"],
    AS_OF,
  );

test("fresh profile resumes at household", () => {
  expect(resumeScreen(emptyProfile())).toBe("household");
});

const ABOUT_DEFAULT: ScreenId[] = [
  "household",
  "birth-year",
  "work",
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
  "spend-mix",
  "foreign-spend",
];
const GOALS_DEFAULT: ScreenId[] = ["goal", "debts", "debt-details", "buffer"];
const riskIds = RISK_SCALE.items.map((i) => `risk:${i.id}` as const);

test("default screens", () => {
  expect(screensFor(emptyProfile())).toEqual([
    ...ABOUT_DEFAULT,
    ...GOALS_DEFAULT,
    ...riskIds,
    "invested",
    "priorities",
    "summary",
    "upload",
  ]);
  expect(screensFor(answerNoChildren(emptyProfile(), AS_OF))).not.toContain("child-years");
});

test("together adds money-sharing", () => {
  const together = new AdvisorProfile({
    ...emptyProfile(),
    household: { value: { kind: "together" }, source: "stated", at: AS_OF },
  });
  const list = screensFor(together);
  expect(list[list.indexOf("household") + 1]).toBe("money-sharing");
  const alone = new AdvisorProfile({
    ...emptyProfile(),
    household: { value: { kind: "alone" }, source: "stated", at: AS_OF },
  });
  expect(screensFor(alone)).not.toContain("money-sharing");
});

test("card-repayment only after a stated card", () => {
  const withCards = (ids: string[]) =>
    new AdvisorProfile({
      ...emptyProfile(),
      statedCards: { value: ids, source: "stated", at: AS_OF },
    });
  expect(screensFor(emptyProfile())).not.toContain("card-repayment");
  expect(screensFor(withCards([]))).not.toContain("card-repayment");
  const list = screensFor(withCards(["other"]));
  expect(list[list.indexOf("cards") + 1]).toBe("card-repayment");
  const flagged = new AdvisorProfile({
    ...withCards(["other"]),
    intake: { ...emptyProfile().intake, noCards: true },
  });
  expect(screensFor(flagged)).not.toContain("card-repayment");
});

test("has-cards no longer exists", () => {
  const all = screensFor(emptyProfile());
  expect(all as string[]).not.toContain("has-cards");
});

test("summary sits after priorities and before upload", () => {
  const all = screensFor(emptyProfile());
  const at = all.indexOf("summary");
  expect(all[at - 1]).toBe("priorities");
  expect(all[at + 1]).toBe("upload");
  expect(all[all.indexOf("priorities") - 1]).toBe("invested");
});

test("ROUND1_NEW lists the eight new screens", () => {
  expect(ROUND1_NEW).toEqual([
    "money-sharing",
    "birth-year",
    "income-regularity",
    "banks",
    "card-repayment",
    "spend-mix",
    "foreign-spend",
    "priorities",
  ]);
});

test("isAnswered follows the field each screen writes", () => {
  const e = emptyProfile();
  for (const id of screensFor(e)) expect(isAnswered(e, id)).toBe(false);
  const f = <T,>(value: T) => ({ value, source: "stated" as const, at: AS_OF });
  const mk = (extra: Record<string, unknown>) => new AdvisorProfile({ ...e, ...extra });
  expect(isAnswered(mk({ household: f({ kind: "alone" }) }), "household")).toBe(true);
  expect(isAnswered(mk({ household: f({ kind: "alone" }) }), "money-sharing")).toBe(false);
  expect(isAnswered(mk({ household: f({ kind: "together", moneySharing: "shared" }) }), "money-sharing")).toBe(true);
  expect(isAnswered(mk({ work: f(["employed"]) }), "work")).toBe(true);
  expect(isAnswered(mk({ chargesVat: f(false) }), "vat")).toBe(true);
  expect(isAnswered(mk({ children: f([]) }), "children")).toBe(true);
  expect(isAnswered(mk({ children: f([]) }), "child-years")).toBe(false);
  expect(isAnswered(mk({ children: f([{ id: "c1", birthYear: 2015 }]) }), "child-years")).toBe(true);
  const range = { lowCents: 1, highCents: 2 };
  expect(isAnswered(mk({ statedRanges: f({ income: range }) }), "income")).toBe(true);
  expect(isAnswered(mk({ statedRanges: f({ income: range }) }), "spend")).toBe(false);
  expect(isAnswered(mk({ statedCards: f(["other"]) }), "cards")).toBe(true);
  expect(isAnswered(answerCards(e, false, AS_OF), "cards")).toBe(true);
  expect(isAnswered(mk({ intake: { ...e.intake, noUserDebts: true } }), "debts")).toBe(true);
  expect(isAnswered(mk({ intake: { ...e.intake, noUserDebts: true } }), "debt-details")).toBe(false);
  const wizardDebt = { id: WIZARD_DEBT, lender: "x", monthlyCents: 100, source: "stated" as const, at: AS_OF };
  expect(isAnswered(mk({ debts: [wizardDebt] }), "debts")).toBe(true);
  expect(isAnswered(mk({ debts: [{ id: WIZARD_DEBT, lender: "x", monthlyCents: 100, source: "stated", at: AS_OF }] }), "debt-details")).toBe(true);
  const goal = (id: string) => ({
    id,
    purpose: "Huis",
    kind: "general" as const,
    targetCents: 5_000_000,
    targetDate: "2030-01-01",
    priority: "important" as const,
    accountRefs: [],
  });
  expect(isAnswered(applyGoals(e, [goal(WIZARD_GOAL)], AS_OF), "goal")).toBe(true);
  expect(isAnswered(applyGoals(e, [goal("other")], AS_OF), "goal")).toBe(false);
  expect(isAnswered(mk({ buffer: f({ months: 3 }) }), "buffer")).toBe(true);
  expect(isAnswered(mk({ knowledge: f({ correct: 0, of: 0, investedBefore: false }) }), "invested")).toBe(true);
  expect(isAnswered(mk({ risk: { answers: { [RISK_SCALE.items[0]!.id]: "x" }, scaleId: RISK_SCALE.id, at: AS_OF } }), firstRisk as ScreenId)).toBe(true);
  expect(isAnswered(mk({ birthYear: f(1990) }), "birth-year")).toBe(true);
  expect(isAnswered(mk({ priorities: f(["save-more"]) }), "priorities")).toBe(true);
  expect(isAnswered(mk({ foreignSpend: f("never") }), "foreign-spend")).toBe(true);
  expect(isAnswered(mk({ housing: f({ kind: "rent", monthlyCents: 100 }) }), "housing")).toBe(true);
  expect(isAnswered(mk({ savings: f({ totalCents: 0 }) }), "savings")).toBe(true);
  expect(isAnswered(mk({ statedBanks: f(["other"]) }), "banks")).toBe(true);
  expect(isAnswered(mk({ statedDebitCards: f(["other"]) }), "debit-cards")).toBe(true);
  expect(isAnswered(mk({ incomeRegularity: f("fixed") }), "income-regularity")).toBe(true);
  expect(isAnswered(mk({ spendMix: f(["groceries"]) }), "spend-mix")).toBe(true);
  expect(isAnswered(mk({ cardRepayment: f("full") }), "card-repayment")).toBe(true);
  expect(isAnswered(mk({ intake: { ...e.intake, noCards: true } }), "cards")).toBe(true);
  expect(isAnswered(e, "summary")).toBe(false);
  expect(isAnswered(markDone(e, "upload"), "upload")).toBe(false);
});

test("None on cards keeps the cards screen (it holds the answer) and Ja clears the flag", () => {
  const no = answerCards(emptyProfile(), false, AS_OF);
  expect(screensFor(no)).toContain("cards");
  expect(screensFor(no)).toEqual(screensFor(emptyProfile()));
  expect(screensFor(answerCards(no, true, AS_OF))).toContain("cards");
  expect(answerCards(no, true, AS_OF).intake.noCards).toBe(false);
  expect(answerCards(no, true, AS_OF).statedCards).toBeUndefined();
});

test("Nee on cards stores an empty stated list and noCards", () => {
  const p = new AdvisorProfile({
    ...emptyProfile(),
    statedCards: { value: ["other"], source: "stated", at: AS_OF },
  });
  const no = answerCards(p, false, AS_OF);
  expect(no.statedCards).toEqual({ value: [], source: "stated", at: AS_OF });
  expect(no.intake.noCards).toBe(true);
  expect(answerCards(no, true, AS_OF).statedCards).toBeUndefined();
});

test("finished profile with every new question answered stays done", () => {
  expect(resumeScreen(answeredNew(withBlocks(3)))).toBe("done");
});

test("round-1 finisher resumes at priorities", () => {
  const { priorities: _p, ...rest } = answeredNew(withBlocks(3));
  const p = markDone(new AdvisorProfile(rest), "invested");
  expect(resumeScreen(p)).toBe("priorities");
});

test("markDone upload then resume is done once the new questions are answered", () => {
  const p = markDone(markDone(answeredNew(withBlocks(3)), "invested"), "upload");
  expect(resumeScreen(p)).toBe("done");
});

test("finished user resumes at the first new question", () => {
  expect(resumeScreen(withBlocks(3))).toBe("birth-year");
  const half = applyBirthYear(withBlocks(3), 1990, AS_OF);
  expect(resumeScreen(half)).toBe("income-regularity");
});

test("a mid-wizard user is first asked the new screens that sit before where they stopped", () => {
  const p = markDone(withBlocks(1), "goal");
  expect(isFinishedIntake(p)).toBe(false);
  expect(resumeScreen(p)).toBe("birth-year");
  expect(resumeScreen(applyBirthYear(p, 1990, AS_OF))).toBe("income-regularity");
  expect(resumeScreen(answeredNew(p))).toBe("debts");
});

test("a finished user whose lastScreen is upload is never sent through the full wizard", () => {
  const p = markDone(markDone(withBlocks(3), "invested"), "upload");
  expect(p.intake.lastScreen).toBe("upload");
  expect(resumeScreen(p)).toBe("birth-year");
  expect(resumeScreen(p)).not.toBe("household");
  expect(pendingNewQuestions(p)).toEqual([
    "birth-year",
    "income-regularity",
    "banks",
    "spend-mix",
    "foreign-spend",
    "priorities",
  ]);
});

test("pendingNewQuestions skips screens the profile does not ask and answered ones", () => {
  const p = applyBirthYear(withBlocks(3), 1990, AS_OF);
  expect(pendingNewQuestions(p)).not.toContain("birth-year");
  expect(pendingNewQuestions(p)).not.toContain("money-sharing");
  expect(pendingNewQuestions(p)).not.toContain("card-repayment");
  expect(pendingNewQuestions(answeredNew(withBlocks(3)))).toEqual([]);
});

test("after the new questions comes the summary, not the risk block", () => {
  const p = markDone(answeredNew(withBlocks(3)), "priorities");
  expect(pendingNewQuestions(p)).toEqual([]);
  expect(resumeScreen(p)).toBe("summary");
  expect(resumeScreen(p)).not.toBe(firstRisk);
});

test("new screens belong to their sections", () => {
  for (const id of ["work", "debit-cards", "cards", "money-sharing", "foreign-spend"] as const) expect(sectionOf(id)).toBe("about");
  expect(sectionOf("upload")).toBe("risk");
  expect(sectionOf("priorities")).toBe("risk");
});

test("risk screens follow RISK_SCALE order and sections are assigned", () => {
  const ids = screensFor(emptyProfile());
  const risk = ids.filter((i) => i.startsWith("risk:"));
  expect(risk).toEqual(RISK_SCALE.items.map((i) => `risk:${i.id}`));
  expect(sectionOf("household")).toBe("about");
  expect(sectionOf("savings")).toBe("about");
  expect(sectionOf("goal")).toBe("goals");
  expect(sectionOf("buffer")).toBe("goals");
  expect(sectionOf(risk[0] as never)).toBe("risk");
  expect(sectionOf("invested")).toBe("risk");
});

test("resume after Ja on children opens child-years", () => {
  expect(resumeScreen(markDone(answeredNew(emptyProfile()), "children"))).toBe("child-years");
});

test("resume after Ja on debts opens debt-details", () => {
  expect(resumeScreen(markDone(answeredNew(answerDebts(emptyProfile(), true)), "debts"))).toBe("debt-details");
  expect(resumeScreen(markDone(answeredNew(answerDebts(emptyProfile(), false)), "debts"))).toBe("buffer");
});

test("resume after Nee on children skips child-years", () => {
  expect(resumeScreen(markDone(answeredNew(answerNoChildren(emptyProfile(), AS_OF)), "children"))).toBe("income");
});

test("a lastScreen absent from screensFor moves on to the next present screen", () => {
  const p = markDone(answeredNew(answerNoChildren(emptyProfile(), AS_OF)), "child-years");
  expect(resumeScreen(p)).toBe("income");
  const q = markDone(answeredNew(answerDebts(emptyProfile(), false)), "debt-details");
  expect(resumeScreen(q)).toBe("buffer");
});

test("resume after the last screen is done", () => {
  expect(resumeScreen(markDone(answeredNew(emptyProfile()), "upload"))).toBe("done");
});

test("answering Nee after Ja clears children, keeps goals", () => {
  let p = applyChildren(emptyProfile(), [
    { id: "c1", birthYear: 2015 },
    { id: "c2", birthYear: 2018 },
  ], AS_OF);
  p = applyGoals(p, [
    { id: "g1", purpose: "Huis", kind: "general", targetCents: 5_000_000, targetDate: "2030-01-01", priority: "important", accountRefs: [] },
  ], AS_OF);
  const out = answerNoChildren(p, AS_OF);
  expect(out.children?.value).toEqual([]);
  expect(out.goals).toHaveLength(1);
});

test("markDone raises blocksDone at section ends and never lowers it", () => {
  expect(markDone(emptyProfile(), "foreign-spend").intake.blocksDone).toBe(1);
  expect(markDone(emptyProfile(), "buffer").intake.blocksDone).toBe(2);
  expect(markDone(answeredNew(emptyProfile()), "invested").intake.blocksDone).toBe(3);
  expect(markDone(withBlocks(3), "household").intake.blocksDone).toBe(3);
  expect(markDone(withBlocks(2), "foreign-spend").intake.blocksDone).toBe(2);
});

const withStep0 = (step0: "bank" | "upload" | "none") => {
  const p = emptyProfile();
  return new AdvisorProfile({ ...p, intake: { ...p.intake, step0 } });
};

test("markDone writes step0 none once", () => {
  expect(markDone(emptyProfile(), "household").intake.step0).toBe("none");
  expect(markDone(withStep0("bank"), "household").intake.step0).toBe("bank");
});

test("old-intake profiles resume by section", () => {
  expect(resumeScreen(withBlocks(1))).toBe("goal");
  expect(resumeScreen(withBlocks(2))).toBe(firstRisk);
  expect(resumeScreen(answeredNew(withBlocks(3)))).toBe("done");
});

test("answerDebts toggles noUserDebts", () => {
  expect(answerDebts(emptyProfile(), false).intake.noUserDebts).toBe(true);
  const back = answerDebts(answerDebts(emptyProfile(), false), true);
  expect(back.intake.noUserDebts).toBeUndefined();
  expect("noUserDebts" in back.intake).toBe(false);
});

test("reopenRisk resumes at the first risk screen", () => {
  const done = markDone(answeredNew(emptyProfile()), "invested");
  const re = reopenRisk(done);
  expect(re.intake.blocksDone).toBe(2);
  expect(resumeScreen(re)).toBe(firstRisk);
  expect(reopenRisk(withBlocks(1)).intake.blocksDone).toBe(1);
});

test("Nee then Ja opens child-years", () => {
  const p = markDone(answeredNew(answerHasChildren(answerNoChildren(emptyProfile(), AS_OF))), "children");
  expect(screensFor(p)).toContain("child-years");
  expect(resumeScreen(p)).toBe("child-years");
  const kept = applyChildren(emptyProfile(), [{ id: "c1", birthYear: 2015 }], AS_OF);
  expect(answerHasChildren(kept)).toBe(kept);
});

test("debit-cards sits right after banks and before cards, always present", () => {
  const all = screensFor(emptyProfile());
  const at = all.indexOf("debit-cards");
  expect(all[at - 1]).toBe("banks");
  expect(all[at + 1]).toBe("cards");
  const noCards = answerCards(emptyProfile(), false, AS_OF);
  expect(screensFor(noCards)).toContain("debit-cards");
});

test("legacy lastScreen has-cards resumes at cards; legacy savings at banks", () => {
  const legacy = (last: string) =>
    new AdvisorProfile({ ...answeredNew(emptyProfile()), intake: { ...emptyProfile().intake, lastScreen: last } });
  expect(resumeScreen(legacy("has-cards"))).toBe("cards");
  expect(resumeScreen(legacy("savings"))).toBe("banks");
});

test("resume after savings lands on banks; after debit-cards on cards", () => {
  expect(resumeScreen(markDone(answeredNew(emptyProfile()), "savings"))).toBe("banks");
  expect(resumeScreen(markDone(answeredNew(emptyProfile()), "debit-cards"))).toBe("cards");
});

test("the VAT screen follows work and appears only for freelance or business", () => {
  const withWork = (kinds: ("employed" | "freelance" | "business")[]) =>
    new AdvisorProfile({
      ...emptyProfile(),
      work: { value: kinds, source: "stated", at: AS_OF },
    });
  expect(screensFor(emptyProfile())).not.toContain("vat");
  expect(screensFor(withWork(["employed"]))).not.toContain("vat");
  for (const k of ["freelance", "business"] as const) {
    const list = screensFor(withWork([k]));
    expect(list[list.indexOf("work") + 1]).toBe("vat");
    expect(list).toHaveLength(screensFor(emptyProfile()).length + 1);
  }
  expect(sectionOf("vat")).toBe("about");
});

test("Nee on cards drops cardRepayment", () => {
  const p = new AdvisorProfile({
    ...emptyProfile(),
    cardRepayment: { value: "full", source: "stated", at: AS_OF },
  });
  expect(answerCards(p, false, AS_OF).cardRepayment).toBeUndefined();
  expect(answerCards(p, true, AS_OF).cardRepayment).toEqual(p.cardRepayment);
});

test("lastScreen invested with blocksDone 3 is mid-wizard: priorities, summary, upload", () => {
  const p = markDone(answeredNew(withBlocks(3)), "invested");
  expect(isFinishedIntake(p)).toBe(false);
  expect(resumeScreen(p)).toBe("priorities");
  expect(resumeScreen(markDone(p, "priorities"))).toBe("summary");
  expect(resumeScreen(markDone(p, "summary"))).toBe("upload");
});

test("blocksDone 3 with lastScreen upload, undefined or unknown is finished", () => {
  expect(isFinishedIntake(markDone(withBlocks(3), "upload"))).toBe(true);
  expect(isFinishedIntake(withBlocks(3))).toBe(true);
  const legacy = new AdvisorProfile({
    ...withBlocks(3),
    intake: { ...withBlocks(3).intake, lastScreen: "has-cards" },
  });
  expect(isFinishedIntake(legacy)).toBe(true);
  expect(isFinishedIntake(withBlocks(2))).toBe(false);
  expect(resumeScreen(withBlocks(3))).toBe("birth-year");
});

test("legacy savings with blocksDone 3 is finished and resumes at the first pending question", () => {
  const base = withBlocks(3);
  const p = new AdvisorProfile({ ...base, intake: { ...base.intake, lastScreen: "savings" } });
  expect(isFinishedIntake(p)).toBe(true);
  expect(resumeScreen(p)).toBe("birth-year");
  expect(resumeScreen(answeredNew(p))).toBe("done");
});

test("finished with nothing pending resumes at done whatever the lastScreen", () => {
  const p = answeredNew(markDone(withBlocks(3), "upload"));
  expect(isFinishedIntake(p)).toBe(true);
  expect(resumeScreen(p)).toBe("done");
});

const finished = () => markDone(markDone(withBlocks(3), "invested"), "upload");

test("round 2 not due before any transaction", () => {
  expect(round2Due(finished(), false)).toBe(false);
});

test("round 2 due after first transaction", () => {
  expect(round2Due(finished(), true)).toBe(true);
  expect(round2Due(withBlocks(2), true)).toBe(false);
  const done = new AdvisorProfile({ ...finished(), intake: { ...finished().intake, round2Done: true } });
  expect(round2Due(done, true)).toBe(false);
});

test("round 2 ids stay out of round 1 and are tracked as answered", () => {
  const all = screensFor(emptyProfile());
  for (const id of ROUND2) expect(all).not.toContain(id);
  expect(round2Pending(emptyProfile())).toEqual([...ROUND2]);
});
