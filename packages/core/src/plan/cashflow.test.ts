import { describe, expect, test } from "vitest";
import { mkAccount, mkTx } from "../advisor/testkit.js";
import type { Tx } from "../model.js";
import { computeCashflow, bufferMonthsFor } from "./cashflow.js";
import { emptyPlanPreferences } from "./preferences.js";
import { planInput } from "./testkit.js";
import type { PlanProfile } from "./profileView.js";
import type { PlanInput } from "./types.js";

const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"] as const;
const euro = (e: number) => Math.round(e * 100);
const CUR = (balance: number) =>
  mkAccount("A1", { iban: "NL01INGB0000000001", balance, balanceDate: "2026-10-20" });

/** Salary on the 25th, spending on the 2nd, a 2000 client payment in the
 *  months listed. */
const history = (clientMonths: readonly string[], opts: { salary?: boolean; spend?: number } = {}): Tx[] =>
  MONTHS.flatMap((m) => [
    ...(opts.salary === false ? [] : [mkTx("Employer", `${m}-25`, 3000, { category: "Inkomen" })]),
    mkTx("Shops", `${m}-02`, -(opts.spend ?? 3500), { category: "Boodschappen" }),
    ...(clientMonths.includes(m) ? [mkTx("Studio Noord BV", `${m}-15`, 2000)] : []),
  ]);

const base = (over: Parameters<typeof planInput>[0] = {}): PlanInput =>
  planInput({
    accounts: [CUR(6000)],
    txs: history(["2026-04", "2026-07"]),
    ...over,
    profile: {
      workKinds: ["employed", "freelance"],
      fixedCostsMonthlyCents: euro(2000),
      ...over.profile,
    },
  });

const YEAR = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

describe("applies", () => {
  test("employed only: null, also with holiday pay and a 13th month (income spread above 0.25)", () => {
    const txs = YEAR.flatMap((m) => [
      mkTx("Bakker Logistiek BV", `${m}-25`, 3000, { category: "Inkomen" }),
      mkTx("Shops", `${m}-02`, -3000, { category: "Boodschappen" }),
      ...(m === "2026-05" ? [mkTx("Bakker Logistiek BV", `${m}-20`, 2200, { description: "Vakantiegeld" })] : []),
      ...(m === "2025-12" ? [mkTx("Bakker Logistiek BV", `${m}-20`, 2600, { description: "13e maand" })] : []),
    ]);
    const i = planInput({ accounts: [CUR(6000)], txs, profile: { workKinds: ["employed"] } });
    expect(computeCashflow(i)).toBeNull();
  });

  test("no work kind stated, lumpy income in the data: still null", () => {
    const i = planInput({
      accounts: [CUR(6000)],
      txs: history(["2026-04", "2026-07"], { salary: false }),
      profile: { workKinds: [] },
    });
    expect(computeCashflow(i)).toBeNull();
  });

  test("freelance and business both apply", () => {
    expect(computeCashflow(base())).not.toBeNull();
    expect(computeCashflow(base({ profile: { workKinds: ["business"] } }))).not.toBeNull();
  });

  test("freelance with under three full months: applies, enough = false, no forward look", () => {
    const i = base({ txs: history(["2026-08"]).filter((t) => t.date >= "2026-08-01") });
    const r = computeCashflow(i)!;
    expect(r.figures.enough).toBe(false);
    expect(r.figures.forward).toBeNull();
  });
});

describe("what counts as client income", () => {
  const monthly = (over: Partial<PlanProfile> = {}) =>
    planInput({
      accounts: [CUR(5000)],
      txs: YEAR.flatMap((m) => [
        mkTx("Opdrachtgever BV", `${m}-15`, 7260),
        mkTx("Shops", `${m}-02`, -3000, { category: "Boodschappen" }),
      ]),
      profile: { workKinds: ["freelance"], chargesVat: true, fixedCostsMonthlyCents: euro(2000), ...over },
      preferences: { ...emptyPlanPreferences(), incomeTaxSetAsidePct: { pct: 30, at: "2026-10-01" } },
    });

  test("a client that pays every month is client income: VAT, tax base and a normal buffer", () => {
    const f = computeCashflow(monthly())!.figures;
    expect(f.client.meanCents).toBe(726000);
    expect(f.client.emptyMonths).toBe(0);
    expect(f.client.longestDryMonths).toBe(0);
    expect(f.buffer.months).toBe(3);
    expect(f.setAside.vat.cents).toBe(126000);
    expect(f.setAside.incomeTax.cents).toBe(Math.round((726000 - 126000) * 0.3));
  });

  test("payments without any client are no dry stretch: buffer stays at the base", () => {
    const f = computeCashflow(base({ txs: history([]) }))!.figures;
    expect(f.client.payments).toBe(0);
    expect(f.buffer.months).toBe(3);
  });

  test("salary, holiday pay, 13th month, Tikkie, shop refunds and unmarked sales are not client income", () => {
    const txs = YEAR.flatMap((m) => [
      mkTx("Bakker Logistiek BV", `${m}-25`, 3000, { category: "Inkomen" }),
      mkTx("Shops", `${m}-02`, -3000, { category: "Boodschappen" }),
      ...(m === "2026-05" ? [mkTx("Bakker Logistiek BV", `${m}-20`, 2200, { description: "Vakantiegeld" })] : []),
      ...(m === "2025-12" ? [mkTx("Bakker Logistiek BV", `${m}-20`, 2600, { description: "13e maand" })] : []),
      ...(m === "2026-03" ? [mkTx("Jan Jansen", `${m}-11`, 40, { category: "Tussen personen", description: "Tikkie" })] : []),
      ...(m === "2026-03" ? [mkTx("Bol.com", `${m}-12`, 60, { category: "Online shopping", description: "Retour" })] : []),
      ...(m === "2026-04" ? [mkTx("Marktplaats koper", `${m}-12`, 150)] : []),
      ...(m === "2026-06" ? [mkTx("Studio Noord BV", `${m}-12`, 1400, { description: "Factuur 2026-014" })] : []),
    ]);
    const f = computeCashflow(planInput({ accounts: [CUR(6000)], txs, profile: { workKinds: ["employed", "freelance"] } }))!.figures;
    expect(f.client.payments).toBe(1);
    expect(f.client.paymentList).toEqual([{ date: "2026-06-12", counterparty: "Studio Noord BV", cents: 140000 }]);
    expect(f.client.meanCents).toBe(Math.round(140000 / 12));
  });
});

describe("how irregular", () => {
  test("client income per month, dry stretch and gap come from the bank rows", () => {
    const c = computeCashflow(base())!.figures.client;
    expect(c.perMonthCents).toEqual([200000, 0, 0, 200000, 0, 0]);
    expect(c.meanCents).toBe(66667);
    expect(c.medianCents).toBe(0);
    expect(c.minCents).toBe(0);
    expect(c.maxCents).toBe(200000);
    expect(c.emptyMonths).toBe(4);
    expect(c.longestDryMonths).toBe(2);
    expect(c.payments).toBe(2);
    expect(c.longestGapDays).toBe(91);
  });

  test("monthly salary is steady income, not client income", () => {
    const f = computeCashflow(base())!.figures;
    expect(f.steadyMonthlyCents).toBe(300000);
    expect(f.spendMonthlyCents).toBe(350000);
  });

});

describe("quiet month", () => {
  test("a month without client income = steady - spending; savings cover floor(start / deficit)", () => {
    const f = computeCashflow(base())!.figures;
    expect(f.quietNetCents).toBe(-50000);
    expect(f.startCents).toBe(600000);
    expect(f.quietCoverMonths).toBe(12);
  });

  test("no deficit in a quiet month: cover is null", () => {
    const f = computeCashflow(base({ txs: history(["2026-04", "2026-07"], { spend: 2500 }) }))!.figures;
    expect(f.quietNetCents).toBe(50000);
    expect(f.quietCoverMonths).toBeNull();
  });
});

describe("forward look", () => {
  test("typical path adds mean client income; quiet path drops it for the longest dry stretch", () => {
    const fw = computeCashflow(base())!.figures.forward!;
    expect(fw.typical.points[0]).toEqual({ month: "2026-11", cents: 616667 });
    expect(fw.typical.lowest).toEqual({ month: "2026-11", cents: 616667 });
    expect(fw.quietMonths).toBe(2);
    expect(fw.quiet.points.slice(0, 3).map((p) => p.cents)).toEqual([550000, 500000, 516667]);
    expect(fw.quiet.lowest).toEqual({ month: "2026-12", cents: 500000 });
    expect(fw.points).toBe(6);
  });

  test("quiet path below zero warns; typical path stays fine", () => {
    const r = computeCashflow(base({ accounts: [CUR(800)] }))!;
    expect(r.figures.forward!.quiet.lowest).toEqual({ month: "2026-12", cents: -20000 });
    expect(r.warnings).toEqual([{ kind: "quiet-below-zero", month: "2026-12", cents: -20000 }]);
  });

  test("typical path below zero is its own, stronger warning", () => {
    const r = computeCashflow(base({ accounts: [CUR(800)], txs: history(["2026-04", "2026-07"], { spend: 4000 }) }))!;
    expect(r.warnings[0]!.kind).toBe("typical-below-zero");
  });

  test("no account balance known: the typed savings total is the start, and says so", () => {
    const noBalance = mkAccount("A1", { iban: "NL01INGB0000000001", balance: null, balanceDate: "2026-10-20" });
    const f = computeCashflow(base({ accounts: [noBalance], profile: { savingsStatedCents: 800000 } }))!.figures;
    expect(f.startCents).toBe(800000);
    expect(f.startSource).toBe("stated");
    expect(f.forward).not.toBeNull();
    expect(computeCashflow(base())!.figures.startSource).toBe("accounts");
  });

  test("quarterly tax-office payments and a yearly cost count in average spending: the quiet path warns", () => {
    const amt = [9000, 0, 6000, 3000, 0, 9000, 6000, 0, 3000, 9000, 0, 6000];
    const txs = YEAR.flatMap((m, k) => [
      ...(amt[k] ? [mkTx(`Klant ${k} BV`, `${m}-${10 + k}`, Math.round(amt[k]! * 1.21))] : []),
      mkTx("Shops", `${m}-02`, -3000, { category: "Boodschappen" }),
      ...(k % 3 === 0 ? [mkTx("Belastingdienst", `${m}-28`, -2400, { category: "Belasting" })] : []),
      ...(m === "2026-06" ? [mkTx("Verzekeraar", `${m}-05`, -1800, { category: "Verzekering" })] : []),
    ]);
    const r = computeCashflow(base({ accounts: [CUR(3000)], txs, profile: { chargesVat: true } }))!;
    expect(r.figures.spendMonthlyCents).toBe(395000);
    expect(r.warnings.map((w) => w.kind)).toContain("quiet-below-zero");
  });

  test("the typical path subtracts the VAT and income-tax set-asides the card recommends", () => {
    const plain = computeCashflow(base())!.figures.forward!.typical.points[0]!.cents;
    const r = computeCashflow(
      base({
        profile: { chargesVat: true },
        preferences: { ...emptyPlanPreferences(), incomeTaxSetAsidePct: { pct: 20, at: "2026-10-24" } },
      }),
    )!;
    expect(plain - r.figures.forward!.typical.points[0]!.cents).toBe(11570 + 11019);
  });

  test("tax-office payments leave spending only when both set-asides are known", () => {
    const withTax = base({
      txs: [...history(["2026-04", "2026-07"]), mkTx("Belastingdienst", "2026-06-28", -1200, { category: "Belasting" })],
    });
    expect(computeCashflow(withTax)!.figures.spendMonthlyCents).toBe(350000 + 20000);
    const known = {
      ...withTax,
      profile: { ...withTax.profile, chargesVat: true as const },
      preferences: { ...emptyPlanPreferences(), incomeTaxSetAsidePct: { pct: 20, at: "2026-10-24" } },
    };
    const f = computeCashflow(known)!.figures;
    expect(f.taxPaymentsReplaced).toBe(true);
    expect(f.spendMonthlyCents).toBe(350000);
  });

  test("unknown balance: no forward look", () => {
    const r = computeCashflow(base({ accounts: [] }))!;
    expect(r.figures.forward).toBeNull();
    expect(r.warnings).toEqual([]);
  });
});

describe("buffer target", () => {
  test("months = clamp(3 + longest dry stretch, 3, 12)", () => {
    expect(bufferMonthsFor(0)).toBe(3);
    expect(bufferMonthsFor(2)).toBe(5);
    expect(bufferMonthsFor(20)).toBe(12);
  });

  test("amount = months x fixed costs; gap against liquid savings", () => {
    const b = computeCashflow(base())!.figures.buffer;
    expect(b.months).toBe(5);
    expect(b.fixedCents).toBe(200000);
    expect(b.targetCents).toBe(1000000);
    expect(b.liquidCents).toBe(600000);
    expect(b.gapCents).toBe(400000);
  });

  test("no fixed costs: months known, amount unknown", () => {
    const b = computeCashflow(base({ profile: { fixedCostsMonthlyCents: null } }))!.figures.buffer;
    expect(b.months).toBe(5);
    expect(b.targetCents).toBeNull();
  });
});

describe("set-asides", () => {
  test("income tax: the person's own percentage on average client income excl. VAT", () => {
    const i = base({
      profile: { chargesVat: true },
      preferences: { ...emptyPlanPreferences(), incomeTaxSetAsidePct: { pct: 20, at: "2026-10-24" } },
    });
    const s = computeCashflow(i)!.figures.setAside;
    expect(s.vat.ratePct).toBe(21);
    expect(s.vat.cents).toBe(11570);
    expect(s.incomeTax.baseCents).toBe(55097);
    expect(s.incomeTax.pct).toBe(20);
    expect(s.incomeTax.cents).toBe(11019);
    expect(s.leftCents).toBe(66667 - 11570 - 11019);
  });

  test("no percentage entered: the amount is null, never a default", () => {
    const s = computeCashflow(base())!.figures.setAside;
    expect(s.incomeTax.pct).toBeNull();
    expect(s.incomeTax.cents).toBeNull();
    expect(s.leftCents).toBeNull();
  });

  test("VAT: no answer or a No gives no VAT amount", () => {
    expect(computeCashflow(base())!.figures.setAside.vat.cents).toBeNull();
    expect(computeCashflow(base({ profile: { chargesVat: false } }))!.figures.setAside.vat.cents).toBeNull();
  });

  test("the VAT due next is the period amount: client receipts of the filed quarter x 21/121", () => {
    const v = computeCashflow(base({ profile: { chargesVat: true } }))!.figures.setAside.vat;
    // Q3 2026 (Jul-Sep): one 2000 payment in July.
    expect(v.periodCents).toBe(Math.round((200000 * 21) / 121));
  });

  test("a saved filing frequency moves the deadline", () => {
    const v = computeCashflow(base({ profile: { chargesVat: true }, vatFrequency: "yearly" }))!.figures.setAside.vat;
    expect(v.frequency).toBe("yearly");
    expect(v.deadline).toBe("2027-03-31");
  });

  test("the percentage is clamped to 0-60 in core too", () => {
    const i = base({ preferences: { ...emptyPlanPreferences(), incomeTaxSetAsidePct: { pct: 90, at: "2026-10-24" } } });
    expect(computeCashflow(i)!.figures.setAside.incomeTax.pct).toBe(60);
  });

  test("VAT shows the next filing deadline from the tax pack, quarterly", () => {
    const v = computeCashflow(base({ profile: { chargesVat: true } }))!.figures.setAside.vat;
    expect(v.deadline).toBe("2026-10-31");
    expect(v.frequency).toBe("quarterly");
    expect(v.rulesAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("no client payment recognised", () => {
  test("no VAT, income-tax or left-over amount, and the state is flagged", () => {
    const i = base({
      txs: history([]),
      profile: { chargesVat: true },
      preferences: { ...emptyPlanPreferences(), incomeTaxSetAsidePct: { pct: 20, at: "2026-10-24" } },
    });
    const f = computeCashflow(i)!.figures;
    expect(f.client.payments).toBe(0);
    expect(f.noClientPayments).toBe(true);
    expect(f.setAside.vat.cents).toBeNull();
    expect(f.setAside.vat.periodCents).toBeNull();
    expect(f.setAside.incomeTax.cents).toBeNull();
    expect(f.setAside.leftCents).toBeNull();
    expect(computeCashflow(base())!.figures.noClientPayments).toBe(false);
  });
});
