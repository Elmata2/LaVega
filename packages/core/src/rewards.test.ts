import { expect, test } from "vitest";
import {
  makeRewardsBalance, estimateValueCents, totalValueCents, isStale, amexTransferOptions,
  REWARD_PROGRAMS, AMEX_MR_TRANSFERS,
} from "./rewards.js";

const amex = makeRewardsBalance({ program: "American Express Membership Rewards", points: 10000, updatedAt: "2026-06-01" });

test("makeRewardsBalance: stable id per program (same program -> same id)", () => {
  const a = makeRewardsBalance({ program: "American Express Membership Rewards", points: 1, updatedAt: "2026-01-01" });
  const b = makeRewardsBalance({ program: "  american express membership rewards ", points: 999, updatedAt: "2026-07-01" });
  expect(a.id).toBe(b.id); // dedupe by normalized program name
  expect(typeof a.id).toBe("string");
  expect(a.id.length).toBeGreaterThan(0);
});

test("estimateValueCents uses the program's cents-per-point; null for an unknown program", () => {
  // Amex MR default cpp is 1.0 -> 10000 pts = 10000 cents = €100
  expect(estimateValueCents(amex)).toBe(10000);
  const unknown = makeRewardsBalance({ program: "Kruidvat zegeltjes", points: 500, updatedAt: "2026-06-01" });
  expect(estimateValueCents(unknown)).toBeNull();
});

test("totalValueCents sums only the balances whose program is known", () => {
  const unknown = makeRewardsBalance({ program: "Onbekend", points: 500, updatedAt: "2026-06-01" });
  expect(totalValueCents([amex, unknown])).toBe(10000);
});

test("isStale: true past maxDays, false within", () => {
  expect(isStale(amex, "2026-06-15", 90)).toBe(false); // 14 days
  expect(isStale(amex, "2026-10-01", 90)).toBe(true);   // ~122 days
});

test("amexTransferOptions applies each partner ratio", () => {
  const opts = amexTransferOptions(10000);
  expect(opts.length).toBe(AMEX_MR_TRANSFERS.length);
  const fb = opts.find((o) => o.partner.includes("Flying Blue"));
  expect(fb?.miles).toBe(10000 * (AMEX_MR_TRANSFERS.find((t) => t.partner.includes("Flying Blue"))!.ratio));
});

test("reference tables are non-empty and well-formed", () => {
  expect(REWARD_PROGRAMS.length).toBeGreaterThan(5);
  expect(REWARD_PROGRAMS.every((p) => p.centsPerPoint > 0 && p.name && p.category)).toBe(true);
  expect(AMEX_MR_TRANSFERS.every((t) => t.ratio > 0 && t.partner)).toBe(true);
});
