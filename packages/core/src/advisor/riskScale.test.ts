import { describe, expect, test } from "vitest";
import { RISK_SCALE, scoreTolerance, toleranceBucket } from "./riskScale.js";

const answerWith = (n: number, pick: (i: number) => number): Record<string, string> =>
  Object.fromEntries(
    RISK_SCALE.items.slice(0, n).map((it, i) => [it.id, it.options[pick(i)]!.id]),
  );

describe("RISK_SCALE", () => {
  test("shape: 5 items, 4 options, points 1..5", () => {
    expect(RISK_SCALE.items).toHaveLength(5);
    for (const it of RISK_SCALE.items) {
      expect(it.options).toHaveLength(4);
      expect(it.options[0]!.points).toBe(1);
      expect(it.options[3]!.points).toBe(5);
    }
  });
  test("loss-20 matches the brief", () => {
    const it = RISK_SCALE.items.find((i) => i.id === "loss-20")!;
    expect(it.options.map((o) => o.points)).toEqual([1, 2, 4, 5]);
  });
  test("licence is non-empty and the UNVERIFIED marker is present (launch needs a conscious edit)", () => {
    expect(RISK_SCALE.licence.trim()).not.toBe("");
    expect(RISK_SCALE.source).toContain("UNVERIFIED");
  });
});

describe("scoreTolerance", () => {
  // Means built from 4 answers: sum / 4.
  // Assign each wanted point value to the first unused item offering it.
  const meanOf = (points: number[]): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const p of points) {
      const it = RISK_SCALE.items.find(
        (i) => !(i.id in out) && i.options.some((o) => o.points === p),
      )!;
      out[it.id] = it.options.find((o) => o.points === p)!.id;
    }
    return out;
  };
  test("mean rounds half up at every band edge", () => {
    // [answers], expected score
    const rows: [number[], number][] = [
      [[1, 1, 1, 2], 1], // 1.25
      [[1, 2, 1, 2], 2], // 1.5
      [[2, 2, 2, 2], 2], // 2.0
      [[1, 2, 4, 2], 2], // 2.25
      [[2, 2, 2, 4], 3], // 2.5
      [[2, 4, 4, 4], 4], // 3.5
      [[4, 4, 4, 4], 4], // 4.0
      [[4, 4, 5, 5], 5], // 4.5
      [[5, 5, 5, 5], 5],
    ];
    for (const [pts, score] of rows) expect(scoreTolerance(meanOf(pts)).score).toBe(score);
  });
  test("mean 1.49 -> 1 and 3.49 -> 3, 4.49 -> 4 via five answers", () => {
    // 5 answers: sums 7.45 not reachable with ints; check nearest integer sums.
    expect(scoreTolerance(meanOf([1, 1, 2, 1, 2])).score).toBe(1); // 1.4
    expect(scoreTolerance(meanOf([2, 4, 4, 4, 2])).score).toBe(3); // 3.2
    expect(scoreTolerance(meanOf([4, 4, 5, 4, 5])).score).toBe(4); // 4.4
  });
  test("fewer than 4 answered -> null score, answered reported", () => {
    expect(scoreTolerance(answerWith(3, () => 3))).toEqual({ score: null, answered: 3 });
    expect(scoreTolerance({})).toEqual({ score: null, answered: 0 });
  });
  test("unknown ids and options are not counted", () => {
    const a = { ...answerWith(3, () => 3), nope: "x", "horizon-attitude": "bogus" };
    expect(scoreTolerance(a).answered).toBe(3);
  });
});

test("tolerance buckets 1..5", () => {
  expect([1, 2, 3, 4, 5].map((s) => toleranceBucket(s as 1 | 2 | 3 | 4 | 5))).toEqual([
    "conservative",
    "conservative",
    "balanced",
    "aggressive",
    "aggressive",
  ]);
});
