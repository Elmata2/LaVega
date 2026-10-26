import { expect, test } from "vitest";
import { AdvisorProfile, RISK_SCALE, emptyProfile } from "@lavega/core";
import { applyChildren, applyGoals } from "../state.js";
import {
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

test("screensFor has 12 + risk screens by default and one fewer after Nee on children", () => {
  expect(screensFor(emptyProfile())).toHaveLength(12 + riskCount);
  expect(screensFor(answerNoChildren(emptyProfile(), AS_OF))).toHaveLength(11 + riskCount);
  expect(screensFor(emptyProfile())).toHaveLength(17);
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
  expect(resumeScreen(markDone(emptyProfile(), "invested"))).toBe("done");
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
