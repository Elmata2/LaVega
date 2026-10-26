import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  bufferMonths,
  capacityInputs,
  capacityToleranceFlag,
  debtPaymentsMonthly,
  scoreCapacity,
  type CapacityInputs,
} from "./capacity.js";
import type { RoomResult } from "./room.js";

const base: CapacityInputs = { bufferMonths: 2, roomShare: 0.05, debtShare: 0.2, horizonYears: 5 };
const parts = (o: Partial<CapacityInputs>) => scoreCapacity({ ...base, ...o }).parts;

const computed = (middleCents: number, middleIncomeCents: number): RoomResult => ({
  kind: "computed",
  months: [],
  middleCents,
  middleIncomeCents,
  lowCents: 0,
  highCents: 0,
  partial: false,
  excludedForeignCount: 0,
  blockingAccounts: [],
});

describe("part boundaries", () => {
  test.each([
    [0.5, 0],
    [1, 1],
    [3, 1],
    [3.01, 2],
  ])("buffer months %s -> %s points", (v, p) => expect(parts({ bufferMonths: v }).buffer).toBe(p));
  test.each([
    [-1, 0],
    [0, 1],
    [0.1, 1],
    [0.11, 2],
  ])("room share %s -> %s points", (v, p) => expect(parts({ roomShare: v }).room).toBe(p));
  test.each([
    [0.31, 0],
    [0.3, 1],
    [0.1, 1],
    [0.09, 2],
  ])("debt share %s -> %s points", (v, p) => expect(parts({ debtShare: v }).debt).toBe(p));
  test.each([
    [2.9, 0],
    [3, 1],
    [10, 1],
    [10.1, 2],
  ])("horizon %s -> %s points", (v, p) => expect(parts({ horizonYears: v }).horizon).toBe(p));
});

describe("scoreCapacity", () => {
  test("all four max -> 5; all zero -> 1", () => {
    expect(
      scoreCapacity({ bufferMonths: 4, roomShare: 0.5, debtShare: 0, horizonYears: 20 }).score,
    ).toBe(5);
    expect(
      scoreCapacity({ bufferMonths: 0, roomShare: -1, debtShare: 0.9, horizonYears: 1 }).score,
    ).toBe(1);
  });

  // Sums are built from the parts: each part is 0, 1 or 2 points.
  const withSum = (sum: number): CapacityInputs => {
    const pts = [0, 0, 0, 0];
    let left = sum;
    for (let k = 0; k < 4 && left > 0; k++) {
      pts[k] = Math.min(2, left);
      left -= pts[k]!;
    }
    return {
      bufferMonths: [0.5, 2, 4][pts[0]!]!,
      roomShare: [-1, 0.05, 0.5][pts[1]!]!,
      debtShare: [0.9, 0.2, 0][pts[2]!]!,
      horizonYears: [1, 5, 20][pts[3]!]!,
    };
  };
  test.each([
    [0, 1],
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 3],
    [5, 3],
    [6, 4],
    [7, 4],
    [8, 5],
  ])("capacity sum %s -> score %s", (sum, score) =>
    expect(scoreCapacity(withSum(sum)).score).toBe(score),
  );

  test("three of four inputs present -> scaled sum, score non-null; two present -> null", () => {
    const three = scoreCapacity({
      ...base,
      horizonYears: null,
      bufferMonths: 4,
      roomShare: 1,
      debtShare: 0,
    });
    expect(three.score).toBe(5); // raw 6 * 8/6 = 8
    expect(three.missing).toEqual(["horizon"]);
    const mid = scoreCapacity({ ...base, horizonYears: null }); // 1+1+1 = 3 -> 4 -> score 3
    expect(mid.score).toBe(3);
    const two = scoreCapacity({ ...base, horizonYears: null, debtShare: null });
    expect(two.score).toBeNull();
    expect(two.missing).toEqual(["debt", "horizon"]);
  });

  test("no goals: horizon is missing, not zero points", () => {
    const r = scoreCapacity(
      capacityInputs({
        savingsCents: 500_000,
        fixedCostsMonthlyCents: 100_000,
        room: computed(20_000, 300_000),
        debtPaymentsMonthlyCents: 0,
        goals: [],
        asOf: "2026-10-23",
      }),
    );
    expect(r.parts.horizon).toBeNull();
    expect(r.missing).toContain("horizon");
  });
});

describe("capacityInputs", () => {
  const common = {
    savingsCents: 300_000,
    fixedCostsMonthlyCents: 100_000,
    debtPaymentsMonthlyCents: 60_000,
    goals: [{ targetDate: "2036-10-23" }, { targetDate: "2029-10-23" }],
    asOf: "2026-10-23",
  };
  test("shares use middleIncomeCents; horizon is the nearest goal", () => {
    const r = capacityInputs({ ...common, room: computed(30_000, 300_000) });
    expect(r.roomShare).toBeCloseTo(0.1);
    expect(r.debtShare).toBeCloseTo(0.2);
    expect(r.bufferMonths).toBe(3);
    expect(r.horizonYears).toBe(3);
  });
  test("a stated room scores from the midpoint of its range over the stated income midpoint", () => {
    const room: RoomResult = {
      kind: "stated",
      lowCents: 20_000,
      highCents: 40_000,
      incomeMidCents: 300_000,
    };
    const r = capacityInputs({ ...common, room });
    expect(r.roomShare).toBeCloseTo(0.1);
    expect(r.debtShare).toBeCloseTo(0.2);
    expect(scoreCapacity(r).parts.room).not.toBeNull();
    expect(scoreCapacity(r).parts.debt).not.toBeNull();
  });
  test("room kind none, stated, or income 0 -> null shares, no NaN/Infinity", () => {
    for (const room of [
      { kind: "none", reason: "no-data" } as RoomResult,
      { kind: "stated", lowCents: 0, highCents: 1, incomeMidCents: 0 } as RoomResult,
      computed(0, 0),
    ]) {
      const r = capacityInputs({ ...common, room });
      expect(r.roomShare).toBeNull();
      expect(r.debtShare).toBeNull();
      const s = scoreCapacity(r);
      expect(s.missing).toEqual(expect.arrayContaining(["room", "debt"]));
    }
  });
  test("past-dated goals are ignored for the horizon; none left -> null", () => {
    const room = computed(30_000, 300_000);
    expect(
      capacityInputs({
        ...common,
        room,
        goals: [{ targetDate: "2025-01-01" }, { targetDate: "2029-10-23" }],
      }).horizonYears,
    ).toBe(3);
    expect(
      capacityInputs({ ...common, room, goals: [{ targetDate: "2025-01-01" }] }).horizonYears,
    ).toBeNull();
  });
  test("zero fixed costs -> buffer null", () => {
    expect(bufferMonths(100, 0)).toBeNull();
    expect(
      capacityInputs({ ...common, fixedCostsMonthlyCents: 0, room: computed(1, 1) }).bufferMonths,
    ).toBeNull();
  });
  test("debt payments sum proposeDebts monthly figures, skipping a null (card) and adding stated", () => {
    expect(
      debtPaymentsMonthly(
        [
          { data: { monthlyCents: 20_000 } },
          { data: { monthlyCents: null } },
          { data: { monthlyCents: 5_000 } },
        ],
        [1_000],
      ),
    ).toBe(26_000);
  });
});

describe("capacityToleranceFlag", () => {
  test("5 vs 3 disagree; 4 vs 3 agree; null unknown", () => {
    expect(capacityToleranceFlag(5, 3)).toBe("disagree");
    expect(capacityToleranceFlag(3, 5)).toBe("disagree");
    expect(capacityToleranceFlag(4, 3)).toBe("agree");
    expect(capacityToleranceFlag(null, 3)).toBe("unknown");
    expect(capacityToleranceFlag(3, null)).toBe("unknown");
  });
});

test("thresholds live in one table: no 0.30 or 0.10 literal in capacity.ts", () => {
  const src = readFileSync(new URL("./capacity.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/0?\.(30|3|10|1)\b/);
});
