import { expect, test } from "vitest";
import { AdvisorProfile, RISK_SCALE, emptyProfile } from "@lavega/core";
import { applyChildren, applyGoals } from "../state.js";
import {
  answerCards,
  answerDebts,
  answerHasChildren,
  answerNoChildren,
  markDone,
  reopenRisk,
  resumeScreen,
  screensFor,
  sectionOf,
} from "./screens.js";

const AS_OF = "2026-10-26";
const riskCount = RISK_SCALE.items.length;
const firstRisk = `risk:${RISK_SCALE.items[0]?.id}`;
const withBlocks = (blocksDone: 0 | 1 | 2 | 3) => {
  const p = emptyProfile();
  return new AdvisorProfile({ ...p, intake: { ...p.intake, blocksDone } });
};

test("fresh profile resumes at household", () => {
  expect(resumeScreen(emptyProfile())).toBe("household");
});

test("screensFor has 21 screens by default and one fewer after Nee on children", () => {
  expect(screensFor(emptyProfile())).toHaveLength(16 + riskCount);
  expect(screensFor(answerNoChildren(emptyProfile(), AS_OF))).toHaveLength(15 + riskCount);
  expect(screensFor(emptyProfile())).toHaveLength(21);
});

test("Nee on cards drops the cards screen and Ja restores it", () => {
  const no = answerCards(emptyProfile(), false, AS_OF);
  expect(screensFor(no)).not.toContain("cards");
  expect(screensFor(no)).toHaveLength(20);
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

test("finished old profile stays done", () => {
  expect(resumeScreen(withBlocks(3))).toBe("done");
});

test("round-1 finisher resumes at upload", () => {
  const p = markDone(withBlocks(3), "invested");
  expect(resumeScreen(p)).toBe("upload");
});

test("markDone upload then resume is done", () => {
  expect(resumeScreen(markDone(markDone(withBlocks(3), "invested"), "upload"))).toBe("done");
});

test("new screens belong to their sections", () => {
  for (const id of ["work", "has-cards", "cards"] as const) expect(sectionOf(id)).toBe("about");
  expect(sectionOf("upload")).toBe("risk");
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
  expect(resumeScreen(markDone(emptyProfile(), "children"))).toBe("child-years");
});

test("resume after Ja on debts opens debt-details", () => {
  expect(resumeScreen(markDone(answerDebts(emptyProfile(), true), "debts"))).toBe("debt-details");
  expect(resumeScreen(markDone(answerDebts(emptyProfile(), false), "debts"))).toBe("buffer");
});

test("resume after Nee on children skips child-years", () => {
  expect(resumeScreen(markDone(answerNoChildren(emptyProfile(), AS_OF), "children"))).toBe("income");
});

test("a lastScreen absent from screensFor moves on to the next present screen", () => {
  const p = markDone(answerNoChildren(emptyProfile(), AS_OF), "child-years");
  expect(resumeScreen(p)).toBe("income");
  const q = markDone(answerDebts(emptyProfile(), false), "debt-details");
  expect(resumeScreen(q)).toBe("buffer");
});

test("resume after the last screen is done", () => {
  expect(resumeScreen(markDone(emptyProfile(), "upload"))).toBe("done");
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
  expect(markDone(emptyProfile(), "savings").intake.blocksDone).toBe(1);
  expect(markDone(emptyProfile(), "buffer").intake.blocksDone).toBe(2);
  expect(markDone(emptyProfile(), "invested").intake.blocksDone).toBe(3);
  expect(markDone(withBlocks(3), "household").intake.blocksDone).toBe(3);
  expect(markDone(withBlocks(2), "savings").intake.blocksDone).toBe(2);
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
  expect(resumeScreen(withBlocks(3))).toBe("done");
});

test("answerDebts toggles noUserDebts", () => {
  expect(answerDebts(emptyProfile(), false).intake.noUserDebts).toBe(true);
  const back = answerDebts(answerDebts(emptyProfile(), false), true);
  expect(back.intake.noUserDebts).toBeUndefined();
  expect("noUserDebts" in back.intake).toBe(false);
});

test("reopenRisk resumes at the first risk screen", () => {
  const done = markDone(emptyProfile(), "invested");
  const re = reopenRisk(done);
  expect(re.intake.blocksDone).toBe(2);
  expect(resumeScreen(re)).toBe(firstRisk);
  expect(reopenRisk(withBlocks(1)).intake.blocksDone).toBe(1);
});

test("Nee then Ja opens child-years", () => {
  const p = markDone(answerHasChildren(answerNoChildren(emptyProfile(), AS_OF)), "children");
  expect(screensFor(p)).toContain("child-years");
  expect(resumeScreen(p)).toBe("child-years");
  const kept = applyChildren(emptyProfile(), [{ id: "c1", birthYear: 2015 }], AS_OF);
  expect(answerHasChildren(kept)).toBe(kept);
});
