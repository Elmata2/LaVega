import { expect, test } from "vitest";
import {
  emptyProfile,
  fingerprint,
  isSuppressed,
  makeProposal,
  type RoomResult,
} from "@lavega/core";
import {
  addUserDebt,
  removeUserDebt,
  applyBuffer,
  applyKnowledge,
  applyProposalAnswer,
  applyRiskAnswers,
  applyStatedHousing,
  applyStatedRange,
  applyStatedSavings,
  capacityFor,
  completeBlock,
  markStep0,
  resumeStage,
  statusOf,
  type SavingsCard,
} from "./state.js";

const AS_OF = "2026-10-23";
const income = makeProposal("income", ["t1", "t2", "t3"], {
  label: "Acme BV",
  monthlyCents: 300_000,
  regularity: "regular" as const,
});
const housing = makeProposal("housing", ["h1", "h2", "h3"], {
  housingKind: "huur" as const,
  counterparty: "Verhuurder",
  monthlyCents: 120_000,
});
const debt = makeProposal("debt", ["d1", "d2", "d3"], {
  lender: "DUO",
  monthlyCents: 15_000,
  origin: "stream" as const,
});
const card = makeProposal("debt", ["account:cc"], {
  lender: "Visa",
  monthlyCents: null,
  balanceCents: 40_000,
  origin: "creditCard" as const,
});
const savings: SavingsCard = makeProposal("savings", ["account:s1"], {
  totalCents: 500_000,
  excluded: 0,
});

test("confirm -> confirmed with evidence kept", () => {
  const p = applyProposalAnswer(emptyProfile(), income, { kind: "confirm" }, AS_OF);
  const f = p.incomeStreams![0]!;
  expect(f.source).toBe("confirmed");
  expect(f.evidence).toEqual(["t1", "t2", "t3"]);
  expect(f.value.monthlyCents).toBe(300_000);
  expect(f.at).toBe(AS_OF);
  expect(statusOf(p, income)).toBe("confirmed");
});

test("correct -> stated with the user's figure", () => {
  const p = applyProposalAnswer(
    emptyProfile(),
    housing,
    { kind: "correct", value: { cents: 110_000 } },
    AS_OF,
  );
  expect(p.housing!.source).toBe("stated");
  expect(p.housing!.value).toEqual({ kind: "rent", monthlyCents: 110_000 });
  expect(statusOf(p, housing)).toBe("stated");
});

test("notMine -> fingerprint in removed, earlier answer dropped", () => {
  const confirmed = applyProposalAnswer(emptyProfile(), income, { kind: "confirm" }, AS_OF);
  const p = applyProposalAnswer(confirmed, income, { kind: "notMine" }, AS_OF);
  expect(p.incomeStreams).toEqual([]);
  expect(isSuppressed(p, fingerprint(["t1", "t2", "t3"]))).toBe(true);
  expect(statusOf(p, income)).toBe("rejected");
});

test("a credit card with no fixed payment is stored with its balance and 0 a month", () => {
  const p = applyProposalAnswer(emptyProfile(), card, { kind: "confirm" }, AS_OF);
  expect(p.debts![0]).toMatchObject({ lender: "Visa", monthlyCents: 0, balanceCents: 40_000 });
  expect(statusOf(p, card)).toBe("confirmed");
});

test("savings and debts answer; a re-answer replaces, not duplicates", () => {
  let p = applyProposalAnswer(emptyProfile(), savings, { kind: "confirm" }, AS_OF);
  p = applyProposalAnswer(p, savings, { kind: "correct", value: { cents: 450_000 } }, AS_OF);
  expect(p.savings!.value.totalCents).toBe(450_000);
  p = applyProposalAnswer(p, debt, { kind: "confirm" }, AS_OF);
  p = applyProposalAnswer(p, debt, { kind: "confirm" }, AS_OF);
  expect(p.debts).toHaveLength(1);
});

test("the same stream with one more payment replaces the earlier answer by label", () => {
  let p = applyProposalAnswer(emptyProfile(), income, { kind: "confirm" }, AS_OF);
  const later = makeProposal("income", ["t1", "t2", "t3", "t4"], {
    label: "Acme BV",
    monthlyCents: 300_000,
    regularity: "regular" as const,
  });
  p = applyProposalAnswer(p, later, { kind: "confirm" }, AS_OF);
  expect(p.incomeStreams).toHaveLength(1);
});

test("applyStatedRange is stated and merges sections", () => {
  let p = applyStatedRange(
    emptyProfile(),
    "income",
    { lowCents: 250_000, highCents: 300_000 },
    AS_OF,
  );
  p = applyStatedRange(p, "spend", { lowCents: 180_000, highCents: 220_000 }, AS_OF);
  expect(p.statedRanges!.source).toBe("stated");
  expect(p.statedRanges!.value.income!.highCents).toBe(300_000);
  expect(p.statedRanges!.value.spend!.lowCents).toBe(180_000);
});

test("resumeStage: blocksDone 0 -> step0, 1 -> block2, 3 -> done", () => {
  const p = emptyProfile();
  expect(resumeStage(p)).toBe("step0");
  expect(resumeStage(markStep0(p, "bank"))).toBe("block1");
  expect(resumeStage(completeBlock(markStep0(p, "none"), 1))).toBe("block2");
  expect(resumeStage(completeBlock(p, 2))).toBe("block3");
  expect(resumeStage(completeBlock(p, 3))).toBe("done");
});

test("completeBlock never goes backwards", () => {
  expect(completeBlock(completeBlock(emptyProfile(), 2), 1).intake.blocksDone).toBe(2);
});

test("risk needs enough answers for a score; knowledge needs all three", () => {
  const few = applyRiskAnswers(emptyProfile(), { "loss-20": "buy-more" }, AS_OF);
  expect(few.risk?.score).toBeUndefined();
  expect(few.risk?.answers).toEqual({ "loss-20": "buy-more" });
  const enough = applyRiskAnswers(
    emptyProfile(),
    {
      "loss-20": "buy-more",
      "gain-vs-loss": "big-loss-huge-gain",
      sleep: "never-worry",
      "friend-crash": "invest-more",
    },
    AS_OF,
  );
  expect(enough.risk!.score).toBe(5);
  expect(enough.risk!.answers["sleep"]).toBe("never-worry");

  const part = applyKnowledge(emptyProfile(), { interest: "more-than-102" }, null, AS_OF);
  expect(part.knowledge?.value.answers).toEqual({ interest: "more-than-102" });
  expect(part.experience).toBeUndefined();
  const k = applyKnowledge(
    emptyProfile(),
    { interest: "more-than-102", inflation: "buy-less", diversification: "lower-risk" },
    true,
    AS_OF,
  );
  expect(k.knowledge!.value).toMatchObject({ correct: 3, of: 3, investedBefore: true });
  expect(k.experience!.value).toBe("experienced");
});

test("capacity counts confirmed figures only and is null with too little", () => {
  const room: RoomResult = {
    kind: "computed",
    months: [],
    middleCents: 50_000,
    middleIncomeCents: 300_000,
    lowCents: 0,
    highCents: 90_000,
    partial: false,
    excludedForeignCount: 0,
    blockingAccounts: [],
  };
  expect(capacityFor(emptyProfile(), room, AS_OF).score).toBeNull();
  let p = applyStatedHousing(emptyProfile(), "rent", 100_000, AS_OF);
  p = applyStatedSavings(p, 400_000, AS_OF);
  p = applyBuffer(p, 3, AS_OF);
  const c = capacityFor(p, room, AS_OF);
  expect(c.parts.buffer).toBe(2);
  expect(c.parts.room).toBe(2);
  expect(c.parts.debt).toBe(2);
  expect(c.parts.horizon).toBeNull();
  expect(c.score).not.toBeNull();
});

test("block 2 debt edits touch only typed debts; block 1 debts keep evidence and date", () => {
  let p = applyProposalAnswer(
    emptyProfile(),
    debt,
    { kind: "correct", value: { cents: 20_000 } },
    "2026-09-01",
  );
  p = addUserDebt(p, { id: "debt-9", lender: "Aunt", monthlyCents: 5000 }, AS_OF);
  p = removeUserDebt(p, debt.id); // not a typed debt: ignored
  expect(p.debts).toHaveLength(2);
  const kept = p.debts!.find((d) => d.id === debt.id)!;
  expect(kept.evidence).toEqual(["d1", "d2", "d3"]);
  expect(kept.at).toBe("2026-09-01");
  p = removeUserDebt(p, "debt-9");
  expect(p.debts).toHaveLength(1);
  expect(p.debts![0]!.at).toBe("2026-09-01");
});
