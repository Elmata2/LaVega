import { expect, test } from "vitest";
import { nextBtwDeadline, BTW_RULES_AS_OF, computeVatSetAside } from "./tax.js";
import type { Tx, VatSettings } from "./model.js";

test("nextBtwDeadline quarterly: mid-Q2, Q1 filing already closed -> Q2 (deadline 07-31)", () => {
  expect(nextBtwDeadline("quarterly", "2026-05-10")).toEqual({ periodLabel: "Q2 2026", periodStart: "2026-04-01", periodEnd: "2026-06-30", deadline: "2026-07-31" });
});
test("nextBtwDeadline quarterly: Q4 deadline rolls into next year (31 Jan)", () => {
  expect(nextBtwDeadline("quarterly", "2026-11-15")).toEqual({ periodLabel: "Q4 2026", periodStart: "2026-10-01", periodEnd: "2026-12-31", deadline: "2027-01-31" });
});
test("nextBtwDeadline quarterly: 15 Apr -> the unfiled Q1 (due 30 Apr), not in-progress Q2", () => {
  expect(nextBtwDeadline("quarterly", "2026-04-15")).toEqual({ periodLabel: "Q1 2026", periodStart: "2026-01-01", periodEnd: "2026-03-31", deadline: "2026-04-30" });
});
test("nextBtwDeadline quarterly: mid-Jan -> Q4 of last year (due 31 Jan)", () => {
  expect(nextBtwDeadline("quarterly", "2026-01-15")).toEqual({ periodLabel: "Q4 2025", periodStart: "2025-10-01", periodEnd: "2025-12-31", deadline: "2026-01-31" });
});
test("nextBtwDeadline monthly: 4 Aug -> July return still due 31 Aug", () => {
  expect(nextBtwDeadline("monthly", "2026-08-04")).toEqual({ periodLabel: "jul 2026", periodStart: "2026-07-01", periodEnd: "2026-07-31", deadline: "2026-08-31" });
});
test("nextBtwDeadline monthly: 5 Sep -> Aug return due 30 Sep", () => {
  expect(nextBtwDeadline("monthly", "2026-09-05")).toEqual({ periodLabel: "aug 2026", periodStart: "2026-08-01", periodEnd: "2026-08-31", deadline: "2026-09-30" });
});
test("nextBtwDeadline yearly: 10 Feb -> prior-year return due 31 Mar", () => {
  expect(nextBtwDeadline("yearly", "2026-02-10")).toEqual({ periodLabel: "2025", periodStart: "2025-01-01", periodEnd: "2025-12-31", deadline: "2026-03-31" });
});
test("nextBtwDeadline yearly: 10 May -> current year (prior return already filed)", () => {
  expect(nextBtwDeadline("yearly", "2026-05-10")).toEqual({ periodLabel: "2026", periodStart: "2026-01-01", periodEnd: "2026-12-31", deadline: "2027-03-31" });
});
test("has a verified-as-of date", () => { expect(BTW_RULES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/); });

const tx = (date: string, amount: number): Tx => ({ id: date + amount, accountKey: "A", date, amount, currency: "EUR", counterparty: "x", description: "", category: "", manual: false });
const settings = (o: Partial<VatSettings> = {}): VatSettings => ({ entity: "BV1", frequency: "quarterly", defaultRatePct: 21, mixedRates: false, ...o });

test("computeVatSetAside: 21% net-VAT on Q2 margin, due 07-31", () => {
  // Q2 2026 (apr-jun): income 12100, expense 2420 -> margin 9680 -> VAT 9680*21/121 = 1680.00
  const txs = [tx("2026-04-10", 12100), tx("2026-05-05", -2420), tx("2026-01-01", 99999)];
  const f = computeVatSetAside(txs, settings(), "2026-06-20")!;
  expect(f).toMatchObject({ source: "vat", sign: -1, status: "confirmed", dueDate: "2026-07-31", entity: "BV1" });
  expect(f.amountCents).toBe(168000);
});

test("computeVatSetAside: negative margin -> no reservation (null)", () => {
  expect(computeVatSetAside([tx("2026-05-01", 1000), tx("2026-05-02", -5000)], settings(), "2026-06-20")).toBeNull();
});

test("computeVatSetAside: mixedRates without manual -> null; manual override wins", () => {
  expect(computeVatSetAside([tx("2026-05-01", 99999)], settings({ mixedRates: true }), "2026-06-20")).toBeNull();
  const f = computeVatSetAside([tx("2026-05-01", 99999)], settings({ mixedRates: true, manualCents: 500000 }), "2026-06-20")!;
  expect(f.amountCents).toBe(500000);
});
