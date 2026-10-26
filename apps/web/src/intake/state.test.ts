import { expect, test } from "vitest";
import {
  AdvisorProfile,
  capacityFor,
  emptyProfile,
  type RoomResult,
} from "@lavega/core";
import {
  addUserDebt,
  removeUserDebt,
  applyBuffer,
  applyKnowledge,
  applyRiskAnswers,
  applyStatedHousing,
  applyStatedRange,
  applyStatedSavings,
} from "./state.js";

const AS_OF = "2026-10-23";
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
  const debt = { id: "debt-1" };
  let p = new AdvisorProfile({
    ...emptyProfile(),
    debts: [
      {
        id: debt.id,
        lender: "DUO",
        monthlyCents: 20_000,
        source: "confirmed",
        at: "2026-09-01",
        evidence: ["d1", "d2", "d3"],
      },
    ],
  } as never);
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
