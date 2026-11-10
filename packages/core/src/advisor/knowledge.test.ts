import { describe, expect, test } from "vitest";
import { experienceOf, KNOWLEDGE_QUESTIONS, riskDue, scoreKnowledge } from "./knowledge.js";

describe("knowledge", () => {
  test("three questions, exactly one correct option each", () => {
    expect(KNOWLEDGE_QUESTIONS.map((q) => q.id)).toEqual(["interest", "inflation", "diversification"]);
    for (const q of KNOWLEDGE_QUESTIONS) expect(q.options.filter((o) => o.correct)).toHaveLength(1);
  });
  test("scoreKnowledge counts correct answers", () => {
    const right = Object.fromEntries(
      KNOWLEDGE_QUESTIONS.map((q) => [q.id, q.options.find((o) => o.correct)!.id]),
    );
    expect(scoreKnowledge(right)).toBe(3);
    expect(scoreKnowledge({})).toBe(0);
    expect(scoreKnowledge({ ...right, inflation: "buy-same" })).toBe(2);
  });
  test.each([
    [0, false, "beginner"],
    [1, false, "beginner"],
    [2, false, "some"],
    [3, false, "some"],
    [0, true, "some"],
    [2, true, "some"],
    [3, true, "experienced"],
  ] as const)("experience %s correct, invested %s -> %s", (c, inv, e) =>
    expect(experienceOf(c, inv)).toBe(e));
});

describe("riskDue", () => {
  test("11 months no event false; 12 months true", () => {
    expect(riskDue("2025-11-23", "2026-10-23", [])).toBe(false);
    expect(riskDue("2025-10-23", "2026-10-23", [])).toBe(true);
  });
  test("3 months + income change 21% true, 20% and 19% false", () => {
    const ev = (changePct: number) => [{ kind: "income-change" as const, at: "2026-09-01", changePct }];
    expect(riskDue("2026-07-23", "2026-10-23", ev(0.21))).toBe(true);
    expect(riskDue("2026-07-23", "2026-10-23", ev(0.2))).toBe(false);
    expect(riskDue("2026-07-23", "2026-10-23", ev(0.19))).toBe(false);
  });
  test("income change without a size is not counted", () => {
    expect(riskDue("2026-07-23", "2026-10-23", [{ kind: "income-change", at: "2026-09-01" }])).toBe(false);
  });
  test("events dated after asOf do not count", () => {
    expect(riskDue("2026-07-23", "2026-10-23", [{ kind: "child", at: "2026-11-01" }])).toBe(false);
    expect(riskDue("2026-07-23", "2026-10-23", [{ kind: "child", at: "2026-10-23" }])).toBe(true);
  });
  test("child and new debt after riskAt are due; before riskAt are not", () => {
    expect(riskDue("2026-07-23", "2026-10-23", [{ kind: "child", at: "2026-08-01" }])).toBe(true);
    expect(riskDue("2026-07-23", "2026-10-23", [{ kind: "new-debt", at: "2026-08-01" }])).toBe(true);
    expect(riskDue("2026-07-23", "2026-10-23", [{ kind: "child", at: "2026-06-01" }])).toBe(false);
  });
});
