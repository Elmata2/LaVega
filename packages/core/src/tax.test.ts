import { expect, test } from "vitest";
import {
  BTW_RULES_AS_OF,
  computeProfitTaxPrepayments,
  computeTaxReservations,
  computeVatSetAside,
  nextBtwDeadline,
  nextVatPeriod,
} from "./tax.js";
import { COUNTRY_OPTIONS, DE_TAX_PACK, TAX_PACKS, taxPack } from "./taxpacks/index.js";
import { reservedCents } from "./scheduledFlows.js";
import { sumTaxFigures, type TaxSheetRow } from "./taxSheet.js";
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

/* ── item 8: the rules follow the user's country ──────────────────────────
 * Everything below is driven by a pack in taxpacks/; nothing in tax.ts knows a
 * country name, so a third country is a new pack and nothing else. */

test("a pack is data only: no functions, and every pack is a dated snapshot", () => {
  for (const p of TAX_PACKS) {
    for (const v of Object.values(p)) expect(typeof v).not.toBe("function");
    expect(p.rulesAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.country).toMatch(/^[A-Z]{2}$/);
    expect(p.caveats.length).toBeGreaterThan(0);
  }
  expect(COUNTRY_OPTIONS.map((c) => c.code)).toEqual(["NL", "DE"]);
});

test("an absent or unknown country falls back to NL, so old vaults are unchanged", () => {
  expect(taxPack(undefined).country).toBe("NL");
  expect(taxPack("XX").country).toBe("NL");
  expect(nextVatPeriod("quarterly", "2026-05-10")).toEqual(nextVatPeriod("quarterly", "2026-05-10", "NL"));
});

test("DE: the USt-Voranmeldung is due on the 10th, not on the last day", () => {
  expect(nextVatPeriod("quarterly", "2026-05-10", "DE")).toEqual({
    periodLabel: "Q2 2026", periodStart: "2026-04-01", periodEnd: "2026-06-30", deadline: "2026-07-10",
  });
  // 12 July: Q2's 10 July deadline has passed, so the next open one is Q3's.
  expect(nextVatPeriod("quarterly", "2026-07-12", "DE").deadline).toBe("2026-10-10");
  // Q4 rolls into next year, still on the 10th.
  expect(nextVatPeriod("quarterly", "2026-11-15", "DE").deadline).toBe("2027-01-10");
  // the annual Umsatzsteuererklärung: 31 July of the following year
  expect(nextVatPeriod("yearly", "2026-02-10", "DE")).toEqual({
    periodLabel: "2025", periodStart: "2025-01-01", periodEnd: "2025-12-31", deadline: "2026-07-31",
  });
});

test("the set-aside is labelled in the country's own words", () => {
  const de = settings({ country: "DE", defaultRatePct: 19 });
  const f = computeVatSetAside([tx("2026-04-10", 11900)], de, "2026-06-20")!;
  expect(f.label).toBe("USt Q2 2026");
  expect(f.dueDate).toBe("2026-07-10");
  expect(f.amountCents).toBe(190000); // 11900 * 19/119
  expect(computeVatSetAside([tx("2026-04-10", 12100)], settings(), "2026-06-20")!.label).toBe("BTW Q2 2026");
});

/* ── the surprise prepayment (the German interview) ───────────────────────── */

test("NL has no modelled profit-tax prepayment, so nothing is invented", () => {
  expect(computeProfitTaxPrepayments([tx("2026-02-01", 1_000_000)], settings(), "2026-06-20")).toEqual([]);
  expect(taxPack("NL").profitTax).toBeNull();
});

test("DE: a year of profit already earned lands as a Nachzahlung early NEXT year", () => {
  // The interview, in numbers: 1M profit, told in December, and the bill turns
  // up at the start of next year — out of money that has felt like his all year.
  const txs = [tx("2026-02-01", 1_000_000)];
  const de = settings({ country: "DE", profitTaxRatePct: 25 });
  const flows = computeProfitTaxPrepayments(txs, de, "2026-12-20");

  expect(flows).toHaveLength(1);
  expect(flows[0]).toMatchObject({
    entity: "BV1",
    label: "Nachzahlung 2026",
    sign: -1,
    amountCents: 25_000_000, // € 250.000 on a million of profit
    dueDate: "2027-03-10",
    source: "prepayment",
    status: "expected",
  });

  // and it is money that is NOT available: the reservation nets out of the saldo
  expect(reservedCents(flows, "2026-12-20")).toBe(25_000_000);

  // at the pack's own indicative rate (30%, a GmbH at Hebesatz 400) it is more
  expect(computeProfitTaxPrepayments(txs, settings({ country: "DE" }), "2026-12-20")[0].amountCents).toBe(30_000_000);
});

test("DE: told in April, the remaining Vorauszahlungen are dated and the passed one rolls forward", () => {
  const txs = [tx("2026-01-15", 400_000)];
  const flows = computeProfitTaxPrepayments(txs, settings({ country: "DE", profitTaxRatePct: 25 }), "2026-04-01");

  expect(flows.map((f) => [f.label, f.dueDate, f.amountCents])).toEqual([
    ["Vorauszahlung 2/4 2026", "2026-06-10", 2_500_000],
    ["Vorauszahlung 3/4 2026", "2026-09-10", 2_500_000],
    ["Vorauszahlung 4/4 2026", "2026-12-10", 2_500_000],
    ["Nachzahlung 2026", "2027-03-10", 2_500_000], // 10 March had already gone
  ]);
  // the four together are exactly the full liability, never more, never less
  expect(flows.reduce((s, f) => s + f.amountCents, 0)).toBe(10_000_000);
});

test("DE: no profit yet -> no reservation at all", () => {
  expect(computeProfitTaxPrepayments([tx("2026-02-01", -5000)], settings({ country: "DE" }), "2026-06-20")).toEqual([]);
});

test("DE: an assessed Vorauszahlungsbescheid beats every estimate and is confirmed", () => {
  const de = settings({ country: "DE", profitTaxManualCents: 10_001 });
  const flows = computeProfitTaxPrepayments([tx("2026-02-01", 999_999)], de, "2026-01-01");
  expect(flows.map((f) => f.amountCents)).toEqual([2500, 2500, 2500, 2501]); // remainder on the last
  expect(flows.reduce((s, f) => s + f.amountCents, 0)).toBe(10_001);
  expect(flows.every((f) => f.status === "confirmed")).toBe(true);
});

test("DE: the four prepayment dates are the pack's, not the engine's", () => {
  expect(DE_TAX_PACK.profitTax.prepayDates).toEqual(["03-10", "06-10", "09-10", "12-10"]);
});

test("computeTaxReservations gives one entity everything its country demands", () => {
  const txs = [tx("2026-04-10", 11900), tx("2026-02-01", 100_000)];
  const nl = computeTaxReservations({ txs, settings: settings(), asOf: "2026-06-20" });
  expect(nl.map((f) => f.source)).toEqual(["vat"]);

  const de = computeTaxReservations({ txs, settings: settings({ country: "DE", defaultRatePct: 19 }), asOf: "2026-06-20" });
  expect(de.map((f) => f.source)).toEqual(["vat", "prepayment", "prepayment", "prepayment"]);
  expect(de[0].label).toBe("USt Q2 2026");
});

/* ── item 5: the owner's own spreadsheet feeds the reservation ────────────── */

const sheetRow = (date: string, o: Partial<TaxSheetRow> = {}): TaxSheetRow => ({
  period: date, date, revenueCents: null, expensesCents: null, profitCents: null,
  vatChargedCents: null, vatPaidCents: null, ...o,
});

test("the sheet's own VAT figures beat the margin proxy — and answer a mixed-rate entity", () => {
  const rows = [
    sheetRow("2026-04-01", { vatChargedCents: 210000, vatPaidCents: 42000 }),
    sheetRow("2026-05-01", { vatChargedCents: 100000, vatPaidCents: 0 }),
    sheetRow("2026-01-01", { vatChargedCents: 999999, vatPaidCents: 0 }), // outside Q2
  ];
  const { periodStart, periodEnd } = nextVatPeriod("quarterly", "2026-06-20");
  const figures = sumTaxFigures(rows, periodStart, periodEnd);

  const q2Txs = [tx("2026-04-10", 12100), tx("2026-05-05", -2420)]; // the proxy would say 168000
  const f = computeVatSetAside(q2Txs, settings(), "2026-06-20", figures)!;
  expect(f.amountCents).toBe(268000); // 310000 charged - 42000 paid

  // mixed rates are exactly the case the proxy has to refuse — his own sheet doesn't
  const mixed = computeVatSetAside(q2Txs, settings({ mixedRates: true }), "2026-06-20", figures)!;
  expect(mixed.amountCents).toBe(268000);

  // but a manual override is still the owner's word, and it wins
  expect(computeVatSetAside([], settings({ manualCents: 500 }), "2026-06-20", figures)!.amountCents).toBe(500);
});

test("figures for the wrong window are ignored rather than half-used", () => {
  const rows = [sheetRow("2026-01-15", { vatChargedCents: 210000, vatPaidCents: 0 })];
  const figures = sumTaxFigures(rows, "2026-01-01", "2026-03-31"); // Q1, not the Q2 we ask for
  const f = computeVatSetAside([tx("2026-04-10", 12100), tx("2026-05-05", -2420)], settings(), "2026-06-20", figures)!;
  expect(f.amountCents).toBe(168000); // fell back to the proxy
});

test("DE prepayment sizes itself on the profit in his sheet, not on bank movements", () => {
  const rows = [sheetRow("2026-01-01", { profitCents: 100_000_000 })]; // € 1.000.000
  const figures = sumTaxFigures(rows, "2026-01-01", "2026-12-31");
  const flows = computeProfitTaxPrepayments([tx("2026-02-01", 12)], settings({ country: "DE", profitTaxRatePct: 25 }), "2026-12-20", figures);
  expect(flows[0]).toMatchObject({ label: "Nachzahlung 2026", amountCents: 25_000_000 });
});
