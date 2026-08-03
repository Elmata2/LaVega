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
