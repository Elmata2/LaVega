import { expect, test } from "vitest";
import { AdvisorProfile, RISK_SCALE, emptyProfile, type AdvisorProfileStore } from "@lavega/core";
import { inviteKindOf, inviteState } from "./inviteState";
import {
  applyBirthYear,
  applyConfidence,
  applyForeignSpend,
  applyIncomeRegularity,
  applyPriorities,
  applyRiskAnswers,
  applySpendMix,
  applyStatedBanks,
} from "./state";
import { markDone, reopenRisk } from "./wizard/screens";

const AS_OF = "2026-10-23";
const store = (build: (p: ReturnType<typeof emptyProfile>) => ReturnType<typeof emptyProfile>) =>
  ({
    current: build(emptyProfile()),
    versions: [],
    updatedAt: "2026-10-01T00:00:00Z",
  }) as AdvisorProfileStore;
const answers = Object.fromEntries(RISK_SCALE.items.map((i) => [i.id, i.options[0]!.id]));
const answerNew = (p: ReturnType<typeof emptyProfile>) =>
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
const doneWithRisk = (at: string) =>
  store((p) =>
    answerNew(markDone(applyRiskAnswers(markDone(p, "invested"), answers, at), "upload")),
  );
/** Finished the intake before the round-1 questions existed. */
const doneWithoutNew = () =>
  store((p) =>
    markDone(applyRiskAnswers(markDone(p, "invested"), answers, "2026-08-01"), "upload"),
  );

test("invite shows start for a fresh store and continue for a half-done one", () => {
  expect(inviteState(null, AS_OF)).toEqual({ kind: "intake", resumeAt: null, riskDue: false });
  expect(
    inviteState(
      store((p) => p),
      AS_OF,
    ),
  ).toEqual({ kind: "intake", resumeAt: null, riskDue: false });
  expect(
    inviteState(
      store((p) => markDone(answerNew(p), "spend")),
      AS_OF,
    ),
  ).toEqual({
    kind: "intake",
    resumeAt: "housing",
    riskDue: false,
  });
  expect(inviteState(doneWithRisk("2026-08-01"), AS_OF)).toBeNull();
});

test("invite after reopenRisk resumes at the first risk screen", () => {
  const s = store((p) => reopenRisk(markDone(answerNew(p), "invested")));
  expect(inviteState(s, AS_OF)).toEqual({
    kind: "intake",
    resumeAt: `risk:${RISK_SCALE.items[0]!.id}`,
    riskDue: false,
  });
});

test("riskDue still surfaces after blocksDone 3", () => {
  const s = doneWithRisk("2025-09-01");
  expect(s.current.intake.blocksDone).toBe(3);
  expect(inviteState(s, AS_OF)).toEqual({
    kind: "intake",
    resumeAt: `risk:${RISK_SCALE.items[0]!.id}`,
    riskDue: true,
  });
});

test("new questions come before the risk review", () => {
  const s = store((p) =>
    markDone(applyRiskAnswers(markDone(p, "invested"), answers, "2025-09-01"), "upload"),
  );
  expect(inviteState(s, AS_OF)).toMatchObject({ kind: "new-questions" });
  const answered = { ...s, current: answerNew(s.current) };
  expect(inviteState(answered, AS_OF)).toMatchObject({ kind: "intake", riskDue: true });
});

test("blocksDone 3 with lastScreen invested is partway: resume at priorities, no new-questions card", () => {
  const s = store((p) =>
    markDone(
      applyRiskAnswers(markDone(answerNew(p), "invested"), answers, "2026-08-01"),
      "invested",
    ),
  );
  expect(inviteState(s, AS_OF)).toEqual({ kind: "intake", resumeAt: "priorities", riskDue: false });
});

const finishedAnswered = () =>
  store((p) =>
    answerNew(markDone(applyRiskAnswers(markDone(p, "invested"), answers, "2026-10-01"), "upload")),
  );

test("round 2 count drops as answers come in", () => {
  const s = finishedAnswered();
  const one = { ...s, current: applyConfidence(s.current, 3, AS_OF) };
  expect(inviteState(one, AS_OF, true)).toEqual({ kind: "round2", count: 5 });
});

test("invite precedence: new questions, then round 2, then risk due", () => {
  const old = store((p) =>
    markDone(applyRiskAnswers(markDone(p, "invested"), answers, "2025-09-01"), "upload"),
  );
  expect(inviteState(old, AS_OF, true)).toMatchObject({ kind: "new-questions" });
  const answered = { ...old, current: answerNew(old.current) };
  expect(inviteState(answered, AS_OF, true)).toMatchObject({ kind: "round2" });
  const round2Done = {
    ...answered,
    current: new AdvisorProfile({
      ...answered.current,
      intake: { ...answered.current.intake, round2Done: true },
    }),
  };
  expect(inviteState(round2Done, AS_OF, true)).toMatchObject({ kind: "intake", riskDue: true });
});

test("inviteKindOf maps the state to a pop-up kind", () => {
  expect(inviteKindOf(null)).toBeNull();
  expect(inviteKindOf({ kind: "intake", resumeAt: null, riskDue: false })).toBe("intake");
  expect(inviteKindOf({ kind: "intake", resumeAt: null, riskDue: true })).toBe("risk");
  expect(inviteKindOf({ kind: "new-questions", count: 2 })).toBe("new-questions");
  expect(inviteKindOf({ kind: "round2", count: 2 })).toBe("round2");
});

test("a finished intake without the round-1 answers has new questions with a count", () => {
  expect(inviteState(doneWithoutNew(), AS_OF)).toEqual({ kind: "new-questions", count: 6 });
});
