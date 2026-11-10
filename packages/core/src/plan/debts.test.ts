import { describe, expect, test } from "vitest";
import type { Debt } from "../advisor/profile.js";
import { mkAccount } from "../advisor/testkit.js";
import type { RateBenchmark } from "../interest.js";
import { AMORTISE_MAX_MONTHS, amortise, computeDebts } from "./debts.js";
import { buildFactSheet } from "./factsheet.js";
import { emptyPlanPreferences } from "./preferences.js";
import { AS_OF, planInput } from "./testkit.js";

const debt = (o: Partial<Debt> & { id: string }): Debt => ({
  lender: "Bank",
  monthlyCents: 30000,
  source: "confirmed",
  at: "2026-10-01",
  ...o,
});
const withDebts = (debts: Debt[], over: Parameters<typeof planInput>[0] = {}) =>
  planInput({ ...over, profile: { debts, ...over.profile } });

describe("amortise", () => {
  test("10000 at 9.5%, payment 300 matches the closed form", () => {
    const i = 0.095 / 12;
    const closed = Math.ceil(-Math.log(1 - (i * 10000) / 300) / Math.log(1 + i));
    const r = amortise({ balanceCents: 1_000_000, ratePct: 9.5, paymentCents: 30_000 });
    // euros in the closed form, cents here: scale the payment accordingly
    const closedCents = Math.ceil(-Math.log(1 - (i * 1_000_000) / 30_000) / Math.log(1 + i));
    expect(closedCents).toBe(closed);
    expect(r.months).toBe(closed);
    expect(Number.isInteger(r.interestCents)).toBe(true);
    expect(r.interestCents).toBeGreaterThan(0);
  });
  test("payment at or below monthly interest -> months null", () => {
    expect(
      amortise({ balanceCents: 1_200_000, ratePct: 12, paymentCents: 12_000 }).months,
    ).toBeNull();
    expect(
      amortise({ balanceCents: 1_200_000, ratePct: 12, paymentCents: 5_000 }).months,
    ).toBeNull();
    expect(amortise({ balanceCents: 100_000, ratePct: 5, paymentCents: 0 }).months).toBeNull();
  });
  test("zero rate: balance / payment, no interest", () => {
    expect(amortise({ balanceCents: 100_000, ratePct: 0, paymentCents: 30_000 })).toEqual({
      months: 4,
      interestCents: 0,
    });
  });
  test("never loops past 1200 months", () => {
    const r = amortise({ balanceCents: 1_000_000_000, ratePct: 1, paymentCents: 900_000 });
    expect(r.months).toBeNull();
  });
});

describe("amortise: mutation-check additions (task 13)", () => {
  test("monthly interest is rounded half-up, not floored: 1000.5 -> 1001", () => {
    // 100_050 at 12% = 1000.5 cents in month 1; paying balance + 1001 clears it in one month.
    expect(amortise({ balanceCents: 100_050, ratePct: 12, paymentCents: 101_051 })).toEqual({
      months: 1,
      interestCents: 1001,
    });
  });
  test("payment exactly equal to the first month's interest never pays off: {null, 0}", () => {
    expect(amortise({ balanceCents: 1_200_000, ratePct: 12, paymentCents: 12_000 })).toEqual({
      months: null,
      interestCents: 0,
    });
  });
  test("payoff in exactly the cap month is reported; one cent more balance is null", () => {
    expect(
      amortise({ balanceCents: AMORTISE_MAX_MONTHS * 100, ratePct: 0, paymentCents: 100 }).months,
    ).toBe(AMORTISE_MAX_MONTHS);
    expect(
      amortise({ balanceCents: AMORTISE_MAX_MONTHS * 100 + 1, ratePct: 0, paymentCents: 100 })
        .months,
    ).toBeNull();
  });
});

describe("computeDebts", () => {
  test("interest per year = round(balance*rate/100): 12000 at 9.5% -> 114000 cents", () => {
    const r = computeDebts(withDebts([debt({ id: "d1", balanceCents: 1_200_000, ratePct: 9.5 })]));
    expect(r.figures.rows[0]!.interestPerYearCents).toBe(114_000);
    expect(r.figures.totalInterestPerYearCents).toBe(114_000);
    expect(r.status).toBe("on-track");
    expect(r.statusReason.key).toBe("debt-payments");
    expect(r.flat["debt_interest_year_total"]).toEqual({ unit: "cents", value: 114_000 });
  });

  test("zero-rate debt: interest 0, payoff from balance/payment", () => {
    const row = computeDebts(withDebts([debt({ id: "d1", balanceCents: 90_000, ratePct: 0 })]))
      .figures.rows[0]!;
    expect(row.interestPerYearCents).toBe(0);
    expect(row.payoffMonths).toBe(3);
    expect(row.payoffDate).toBe("2027-01-24");
  });

  test("payment below interest: payoff null, extra that covers it gives payoff but no saving", () => {
    const d = debt({ id: "d1", balanceCents: 1_200_000, ratePct: 12, monthlyCents: 10_000 });
    const prefs = emptyPlanPreferences();
    (prefs.extraDebtPayment as Mut)["d1"] = { cents: 50_000, at: "2026-10-01" };
    const row = computeDebts(withDebts([d], { preferences: prefs })).figures.rows[0]!;
    expect(row.payoffMonths).toBeNull();
    expect(row.withExtra!.payoffMonths).not.toBeNull();
    expect(row.withExtra!.monthsEarlier).toBeNull();
    expect(row.withExtra!.interestSavedCents).toBeNull();
  });

  test("extra 50/month: positive integers; extra 0 equals base; none -> null", () => {
    const d = debt({ id: "d1", balanceCents: 1_000_000, ratePct: 9.5 });
    const none = computeDebts(withDebts([d])).figures.rows[0]!;
    expect(none.withExtra).toBeNull();
    const prefs = emptyPlanPreferences();
    (prefs.extraDebtPayment as Mut)["d1"] = { cents: 5_000, at: "2026-10-01" };
    const row = computeDebts(withDebts([d], { preferences: prefs })).figures.rows[0]!;
    expect(row.withExtra!.monthsEarlier).toBeGreaterThan(0);
    expect(Number.isInteger(row.withExtra!.monthsEarlier!)).toBe(true);
    expect(row.withExtra!.interestSavedCents).toBeGreaterThan(0);
    expect(Number.isInteger(row.withExtra!.interestSavedCents!)).toBe(true);
    (prefs.extraDebtPayment as Mut)["d1"] = { cents: 0, at: "2026-10-01" };
    const zero = computeDebts(withDebts([d], { preferences: prefs })).figures.rows[0]!;
    expect(zero.withExtra).toMatchObject({ monthsEarlier: 0, interestSavedCents: 0 });
    expect(zero.withExtra!.payoffMonths).toBe(zero.payoffMonths);
  });

  test("debt without rate: no cost, missing debt-rate, no invented rate, not-enough-data", () => {
    const r = computeDebts(withDebts([debt({ id: "d1", balanceCents: 500_000 })]));
    const row = r.figures.rows[0]!;
    expect(row.ratePct).toBeNull();
    expect(row.rateSource).toBeNull();
    expect(row.interestPerYearCents).toBeNull();
    expect(row.payoffMonths).toBeNull();
    expect(r.missing).toEqual([{ kind: "debt-rate", action: "enter-figure", ref: "d1" }]);
    expect(r.status).toBe("not-enough-data");
    expect(r.statusReason.key).toBe("debt-rate-missing");
    expect(r.figures.totalInterestPerYearCents).toBeNull();
    expect(r.facts).toEqual([]);
  });

  test("debts with all-zero payments -> on-track, not debt-payments", () => {
    const r = computeDebts(
      withDebts([debt({ id: "d1", balanceCents: 50_000, ratePct: 3, monthlyCents: 0 })]),
    );
    expect(r.status).toBe("on-track");
    expect(r.statusReason.key).toBe("debt-no-payments");
    expect(computeDebts(planInput({ profile: { intakeBlocksDone: 2 } })).statusReason.key).toBe(
      "no-debt",
    );
    const unasked = computeDebts(planInput());
    expect(unasked.status).toBe("not-enough-data");
    expect(unasked.statusReason.key).toBe("debts-not-asked");
    expect(unasked.missing).toEqual([{ kind: "debts", action: "intake-question", ref: "debts" }]);
  });

  test("rate but no balance: missing debt-balance, interest null, total null", () => {
    const r = computeDebts(
      withDebts([
        debt({ id: "d1", ratePct: 5 }),
        debt({ id: "d2", balanceCents: 100_000, ratePct: 5 }),
      ]),
    );
    expect(r.missing).toEqual([{ kind: "debt-balance", action: "enter-figure", ref: "d1" }]);
    expect(r.figures.rows[0]!.interestPerYearCents).toBeNull();
    expect(r.figures.rows[1]!.interestPerYearCents).toBe(5_000);
    expect(r.figures.totalInterestPerYearCents).toBeNull();
    // payments exist and none is known to be below its interest
    expect(r.status).toBe("on-track");
  });

  test("attention only when a payment is below its own interest", () => {
    const below = computeDebts(
      withDebts([debt({ id: "a", balanceCents: 1_200_000, ratePct: 12, monthlyCents: 5_000 })]),
    );
    expect(below.status).toBe("attention");
    expect(below.statusReason.key).toBe("debt-payment-below-interest");
    const covered = computeDebts(
      withDebts([debt({ id: "a", balanceCents: 1_200_000, ratePct: 12, monthlyCents: 50_000 })]),
    );
    expect(covered.status).toBe("on-track");
    expect(covered.statusReason.key).toBe("debt-payments");
  });

  test("the user's own savings rate comes from the biggest EUR savings account, not a foreign one", () => {
    const eur = mkAccount("S1", {
      iban: "NL02INGB0000000002",
      type: "Spaarrekening",
      balance: 1000,
      balanceDate: "2026-10-20",
      interestRate: 1.5,
    });
    const huf = mkAccount("S2", {
      iban: "HU02INGB0000000003",
      type: "Spaarrekening",
      currency: "HUF",
      balance: 900_000,
      balanceDate: "2026-10-20",
      interestRate: 7,
    });
    const r = computeDebts(planInput({ accounts: [eur, huf] }));
    expect(r.figures.savingsRatePct).toBe(1.5);
    const calc = r.calc.find((c) => c.id === "savings-rate")!;
    expect(calc.inputs["balance"]).toEqual({ unit: "cents", value: 100_000 });
  });

  test("payoffReason names why the payoff is null", () => {
    const rows = computeDebts(
      withDebts([
        debt({ id: "a", balanceCents: 1_200_000, ratePct: 12, monthlyCents: 5_000 }),
        debt({ id: "b", ratePct: 5 }),
        debt({ id: "c", balanceCents: 1000 }),
        debt({ id: "d", balanceCents: 100_000, ratePct: 5 }),
      ]),
    ).figures.rows;
    expect(rows.map((r) => r.payoffReason)).toEqual([
      "payment-below-interest",
      "no-balance",
      "no-rate",
      null,
    ]);
  });

  test("negative rate is invalid: treated as missing debt-rate", () => {
    const r = computeDebts(withDebts([debt({ id: "d1", balanceCents: 100_000, ratePct: -3 })]));
    expect(r.figures.rows[0]!.ratePct).toBeNull();
    expect(r.missing).toEqual([{ kind: "debt-rate", action: "enter-figure", ref: "d1" }]);
    expect(r.status).toBe("not-enough-data");
  });

  test("duplicate debt ids do not make duplicate fact ids", () => {
    const r = computeDebts(
      withDebts([
        debt({ id: "d1", balanceCents: 100_000, ratePct: 5 }),
        debt({ id: "d1", balanceCents: 200_000, ratePct: 5 }),
      ]),
    );
    expect(new Set(r.facts.map((f) => f.factId)).size).toBe(r.facts.length);
    expect(() => buildFactSheet(r.facts, { locale: "nl", asOf: AS_OF })).not.toThrow();
  });

  test("sub-euro balance: guard uses the rounded interest, so a payment that cannot cover it is null and one that can finishes", () => {
    // 100c at 9.5%: rounded monthly interest is 1c.
    expect(amortise({ balanceCents: 100, ratePct: 9.5, paymentCents: 1 }).months).toBeNull();
    const r = amortise({ balanceCents: 100, ratePct: 9.5, paymentCents: 2 });
    expect(r.months).not.toBeNull();
    expect(r.months!).toBeLessThan(AMORTISE_MAX_MONTHS);
  });

  test("rate source: stated/confirmed -> stated, derived -> detected", () => {
    const rows = computeDebts(
      withDebts([
        debt({ id: "a", ratePct: 5, balanceCents: 1000 }),
        debt({ id: "b", ratePct: 5, balanceCents: 1000, source: "stated" }),
        debt({ id: "c", ratePct: 5, balanceCents: 1000, source: "derived", evidence: ["x"] }),
      ]),
    ).figures.rows;
    expect(rows.map((r) => r.rateSource)).toEqual(["stated", "stated", "detected"]);
  });

  test("no debts -> on-track, invisibleDebtNotice, nothing missing, no debt-free fact", () => {
    const r = computeDebts(planInput({ profile: { intakeBlocksDone: 2 } }));
    expect(r.status).toBe("on-track");
    expect(r.statusReason.key).toBe("no-debt");
    expect(r.figures.invisibleDebtNotice).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.facts.some((f) => /free|vrij/.test(f.factId))).toBe(false);
    expect(r.figures.totalInterestPerYearCents).toBeNull();
  });

  test("DUO recognised as kind duo; the row carries no rule text field", () => {
    const row = computeDebts(
      withDebts([
        debt({ id: "d1", lender: "DUO", balanceCents: 1_000_000, ratePct: 2.57 }),
        debt({ id: "d2", lender: "Klarna", balanceCents: 10_000, ratePct: 12 }),
        debt({ id: "d3", lender: "Oom Jan", balanceCents: 10_000, ratePct: 0 }),
      ]),
    ).figures.rows;
    expect(row.map((r) => r.kind)).toEqual(["duo", "consumer", "other"]);
    expect(Object.keys(row[0]!).sort()).toEqual(
      [
        "balanceCents",
        "id",
        "interestPerYearCents",
        "kind",
        "lender",
        "monthlyCents",
        "payoffDate",
        "payoffMonths",
        "payoffReason",
        "ratePct",
        "rateSource",
        "withExtra",
      ].sort(),
    );
  });

  const RATES: RateBenchmark[] = [
    { bank: "A", product: "Flex", ratePct: 2.0, freeWithdrawal: true, asOf: "2026-10-01" },
    { bank: "B", product: "Fix", ratePct: 3.5, freeWithdrawal: false },
    {
      bank: "C",
      product: "Teaser",
      ratePct: 4,
      freeWithdrawal: true,
      promo: true,
      standardRatePct: 1.5,
      asOf: "2026-09-15",
      productId: "c-1",
    },
  ];

  test("the debts card shows the user's own savings rate only: no free-rate figure, flat id or calc step exists", () => {
    const none = computeDebts(planInput()).figures;
    expect(none.savingsRatePct).toBeNull();
    const acc = mkAccount("S1", { type: "Spaarrekening", balance: 1000, interestRate: 1.25 });
    const r = computeDebts(planInput({ accounts: [acc], rates: RATES }));
    expect(r.figures.savingsRatePct).toBe(1.25);
    expect(JSON.stringify(r)).not.toMatch(/free[-_ ]?rate|bestFree/i);
    expect(Object.keys(r.flat)).not.toContain("best_free_rate_pct");
    expect(r.calc.map((c) => c.id)).not.toContain("best-free-rate");
    // the catalogue rates do not move the user's own rate
    expect(computeDebts(planInput({ accounts: [acc], rates: [] })).figures.savingsRatePct).toBe(
      1.25,
    );
  });

  test("no figure labels a debt expensive at any rate", () => {
    for (const rate of [0.1, 9.5, 29]) {
      const r = computeDebts(withDebts([debt({ id: "d", balanceCents: 100_000, ratePct: rate })]));
      expect(JSON.stringify(r)).not.toMatch(/expensive|duur|high-rate/i);
    }
  });

  test("fact ids pass buildFactSheet, raw ids with odd characters are hashed", () => {
    const acc = mkAccount("S1", { type: "Spaarrekening", balance: 1000, interestRate: 1.25 });
    const prefs = emptyPlanPreferences();
    (prefs.extraDebtPayment as Mut)["Loan 1/ABC"] = { cents: 5_000, at: "2026-10-01" };
    const r = computeDebts(
      withDebts(
        [
          debt({ id: "Loan 1/ABC", lender: "Klarna", balanceCents: 500_000, ratePct: 9 }),
          debt({ id: "d-2", balanceCents: 500_000, ratePct: 9 }),
        ],
        { accounts: [acc], preferences: prefs },
      ),
    );
    expect(r.facts.length).toBeGreaterThan(4);
    expect(() => buildFactSheet(r.facts, { locale: "nl", asOf: AS_OF })).not.toThrow();
    expect(r.facts.some((f) => f.factId.includes("Loan"))).toBe(false);
    expect(r.facts.some((f) => f.factId === "debt_interest_year:d-2")).toBe(true);
    expect(r.facts.some((f) => f.factId === "savings_interest_pct")).toBe(true);
    expect(r.facts.every((f) => f.polarity === "neutral")).toBe(true);
  });

  test("every calc id is declared", async () => {
    const { DEBTS_CALC_IDS } = await import("./debts.js");
    const prefs = emptyPlanPreferences();
    (prefs.extraDebtPayment as Mut)["d"] = { cents: 100, at: "2026-10-01" };
    const acc = mkAccount("S1", { type: "Spaarrekening", balance: 1000, interestRate: 1 });
    const r = computeDebts(
      withDebts([debt({ id: "d", balanceCents: 100_000, ratePct: 5 })], {
        accounts: [acc],
        preferences: prefs,
        rates: [{ bank: "A", product: "A", ratePct: 2, freeWithdrawal: true }],
      }),
    );
    for (const c of r.calc) expect(DEBTS_CALC_IDS).toContain(c.id);
    expect(r.calc.map((c) => c.id).sort()).toEqual([...DEBTS_CALC_IDS].sort());
  });
});

type Mut = Record<string, { cents: number; at: string }>;
