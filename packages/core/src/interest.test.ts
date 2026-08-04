import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { bestRate, detectInterestRate, resolveAccountRate, analyzeInterest, NL_SAVINGS_RATES } from "./interest.js";

const acc = (over: Partial<Account>): Account =>
  ({ key: "A1", iban: "A1", name: "x", bank: "ING", entity: "BV1", currency: "EUR", balance: 10000, ...over });
const rente = (date: string, amount: number): Tx =>
  ({ id: date, accountKey: "A1", date, amount, currency: "EUR", counterparty: "Rente", description: "Rente spaarrekening", category: "", manual: false });

test("bestRate picks the highest free-withdrawal benchmark", () => {
  expect(bestRate(NL_SAVINGS_RATES)!.ratePct).toBe(3.1);
});

test("detectInterestRate: implied % from trailing-year rente credits vs balance", () => {
  const a = acc({ balance: 10000 });
  expect(detectInterestRate(a, [rente("2026-06-01", 150)], "2026-08-01")).toBe(1.5);
  expect(detectInterestRate(a, [rente("2024-01-01", 150)], "2026-08-01")).toBeNull(); // too old
  expect(detectInterestRate(acc({ balance: 0 }), [rente("2026-06-01", 150)], "2026-08-01")).toBeNull();
});

test("resolveAccountRate: manual > detected > assumed(0 for betaal) > unknown", () => {
  expect(resolveAccountRate(acc({ interestRate: 0.8 }), [], "2026-08-01")).toEqual({ ratePct: 0.8, source: "manual" });
  expect(resolveAccountRate(acc({ type: "Betaalrekening" }), [], "2026-08-01")).toEqual({ ratePct: 0, source: "assumed" });
  expect(resolveAccountRate(acc({ type: "Spaarrekening" }), [], "2026-08-01")).toEqual({ ratePct: null, source: "unknown" });
  expect(resolveAccountRate(acc({ type: "Spaarrekening" }), [rente("2026-06-01", 150)], "2026-08-01")).toEqual({ ratePct: 1.5, source: "detected" });
});

test("analyzeInterest: idle cash on 0% betaalrekening quantifies yearly gain vs best", () => {
  const accounts = [acc({ key: "B", type: "Betaalrekening", balance: 20000 })];
  const r = analyzeInterest(accounts, [], NL_SAVINGS_RATES, "2026-08-01");
  expect(r.best!.ratePct).toBe(3.1);
  expect(r.suggestions).toHaveLength(1);
  expect(r.suggestions[0].extraPerYearCents).toBe(62000); // 20000 * 3.1% = €620
  expect(r.totalExtraPerYearCents).toBe(62000);
});

test("resolveAccountRate: savings at a known bank estimates the current rate from that bank's standard tariff", () => {
  const ing = acc({ type: "Spaarrekening", bank: "ING", balance: 5000 });
  expect(resolveAccountRate(ing, [], "2026-08-01", NL_SAVINGS_RATES)).toEqual({ ratePct: 1.25, source: "benchmark" });
  // unknown bank -> still unknown
  expect(resolveAccountRate(acc({ type: "Spaarrekening", bank: "Onbekende Bank" }), [], "2026-08-01", NL_SAVINGS_RATES).source).toBe("unknown");
});

test("analyzeInterest: an existing savings saldo is compared to its OWN bank rate, not to 0%", () => {
  const accounts = [acc({ key: "S", type: "Spaarrekening", bank: "ING", balance: 10000 })];
  const r = analyzeInterest(accounts, [], NL_SAVINGS_RATES, "2026-08-01");
  expect(r.suggestions[0].ratePct).toBe(1.25); // ING standard, not 0
  expect(r.suggestions[0].extraPerYearCents).toBe(18500); // 10000 * (3.10-1.25)% = €185
});

test("detectInterestRate: implausible rate (tiny balance vs normal interest) is discarded -> benchmark", () => {
  const tiny = acc({ balance: 2, bank: "ING", type: "Spaarrekening" });
  expect(detectInterestRate(tiny, [rente("2026-06-01", 16.5)], "2026-08-01")).toBeNull(); // ~825% -> null
  expect(resolveAccountRate(tiny, [rente("2026-06-01", 16.5)], "2026-08-01", NL_SAVINGS_RATES)).toEqual({ ratePct: 1.25, source: "benchmark" });
});
