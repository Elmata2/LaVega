import { expect, test } from "vitest";
import {
  AdvisorProfile,
  emptyProfileStore,
  type AdvisorProfileStore,
} from "../advisor/profile.js";
import { planProfileOf } from "./profileView.js";

const storeWith = (
  extra: ConstructorParameters<typeof AdvisorProfile>[0],
): AdvisorProfileStore => ({
  ...emptyProfileStore("2026-10-24"),
  current: new AdvisorProfile(extra),
});

const base = { removed: [], intake: { blocksDone: 2, step0: null } } as const;

test("planProfileOf(null) is the empty profile with intakeBlocksDone 0 and no NaN", () => {
  const p = planProfileOf(null);
  expect(p.intakeBlocksDone).toBe(0);
  expect(p.goals).toEqual([]);
  expect(p.fixedCostsMonthlyCents).toBeNull();
  expect(p.tolerance).toBeNull();
  expect(p.profileHash).toBe(planProfileOf(emptyProfileStore()).profileHash);
  expect(JSON.stringify(p)).not.toMatch(/NaN|null,null,NaN/);
  for (const v of Object.values(p)) expect(Number.isNaN(v)).toBe(false);
});

const goal = {
  id: "g1",
  purpose: "Auto",
  kind: "general" as const,
  targetCents: 1_000_000,
  targetDate: "2028-01-01",
  priority: "important" as const,
  accountRefs: [],
};

test("goal 'since' and start are the Field.at and typed balance; a goal anchor overrides both", () => {
  const store = storeWith({
    ...base,
    goals: [{ value: goal, source: "stated", at: "2026-09-15" }],
  });
  expect(planProfileOf(store).goals[0]).toMatchObject({
    goal,
    since: "2026-09-15",
  });
  expect(
    planProfileOf(store, { g1: { at: "2026-01-01", startCents: 25_000 } }).goals[0],
  ).toMatchObject({ since: "2026-01-01", startCents: 25_000 });
});

test("maps the profile fields and hashes the profile", () => {
  const store = storeWith({
    ...base,
    housing: {
      value: { kind: "rent", monthlyCents: 120_000 },
      source: "confirmed",
      at: "2026-10-01",
    },
    fixedCosts: [
      {
        value: { id: "f1", label: "Zorg", monthlyCents: 15_000 },
        source: "stated",
        at: "2026-10-01",
      },
    ],
    buffer: { value: { months: 4 }, source: "stated", at: "2026-10-01" },
    savings: {
      value: { totalCents: 500_000 },
      source: "stated",
      at: "2026-10-01",
    },
    statedRanges: {
      value: { income: { lowCents: 200_000, highCents: 300_000 } },
      source: "stated",
      at: "2026-10-01",
    },
    risk: { answers: {}, scaleId: "s", at: "2026-10-01", score: 3 },
  });
  const p = planProfileOf(store);
  expect(p).toMatchObject({
    housingMonthlyCents: 120_000,
    fixedCostsMonthlyCents: 135_000,
    bufferTargetMonths: 4,
    savingsStatedCents: 500_000,
    incomeStatedRange: { lowCents: 200_000, highCents: 300_000 },
    spendStatedRange: null,
    tolerance: 3,
    intakeBlocksDone: 2,
  });
  const q = planProfileOf(storeWith({ ...base, removed: ["x"] }));
  expect(q.profileHash).not.toBe(p.profileHash);
  expect(planProfileOf(store).profileHash).toBe(p.profileHash);
});

test("profileUpdatedAt is the store's updatedAt; null store or the epoch gives null", () => {
  expect(planProfileOf(null).profileUpdatedAt).toBeNull();
  expect(planProfileOf(emptyProfileStore()).profileUpdatedAt).toBeNull();
  expect(planProfileOf(storeWith(base)).profileUpdatedAt).toBe("2026-10-24");
});
