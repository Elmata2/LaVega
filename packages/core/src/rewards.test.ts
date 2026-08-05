import { expect, test } from "vitest";
import { makeRewardsBalance, isStale, REWARD_PROGRAMS } from "./rewards.js";

const amex = makeRewardsBalance({ program: "American Express Membership Rewards", points: 10000, updatedAt: "2026-06-01" });

test("makeRewardsBalance: stable id per program (same program -> same id)", () => {
  const a = makeRewardsBalance({ program: "American Express Membership Rewards", points: 1, updatedAt: "2026-01-01" });
  const b = makeRewardsBalance({ program: "  american express membership rewards ", points: 999, updatedAt: "2026-07-01" });
  expect(a.id).toBe(b.id); // dedupe by normalized program name
  expect(typeof a.id).toBe("string");
  expect(a.id.length).toBeGreaterThan(0);
});

test("isStale: true past maxDays, false within", () => {
  expect(isStale(amex, "2026-06-15", 90)).toBe(false); // 14 days
  expect(isStale(amex, "2026-10-01", 90)).toBe(true);   // ~122 days
});

test("reference table is non-empty and well-formed", () => {
  expect(REWARD_PROGRAMS.length).toBeGreaterThan(5);
  expect(REWARD_PROGRAMS.every((p) => p.name && p.category)).toBe(true);
});
