import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, test } from "vitest";
import type { Bill, BillDecisions, BillMark, BillOccurrence } from "./model.js";
import { EMPTY_BILL_DECISIONS, normalizeBill } from "./model.js";
import type { Account } from "../model.js";
import { generateBillOccurrences } from "./occurrences.js";
import {
  cashOnHandCents,
  paycheckItemsDue,
  paycheckItemsReserved,
  paycheckOverview,
  paycheckPlan,
  type PaycheckPeriod,
} from "./paycheck.js";

/**
 * WS2.7 acceptance evidence: the period slice fixtures and the bridge shortfall
 * rules. The fixture is a labelled, real-shaped matrix (monthly, twice-monthly
 * and weekly declared income; payday on the 25th and on month end; a period that
 * bridges month end). Every expected number was worked out from Sure's
 * `PaycheckPlanner` semantics, not from this implementation.
 */

type Scenario = {
  name: string;
  asOf: string;
  cashCents: number | null;
  bills: Array<Partial<Bill> & Pick<Bill, "id" | "name" | "amountCents">>;
  expected: {
    paydayOn: string | null;
    periods: Array<{
      startsOn: string;
      endsOn: string;
      incomeCents: number;
      dueCents: number;
      reservedCents: number;
      remainingCents: number;
      leading: boolean;
      final: boolean;
      bridge: boolean;
      short: boolean;
      shortfallCents: number | null;
      cashOnHandCents: number | null;
    }>;
    preview: {
      dueBeforePaydayCents: number;
      reservedCents: number;
      paidRecentlyCents: number;
      shortfallCents: number | null;
      shortfallUnknown: boolean;
    };
  };
};

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new NodeURL("./__fixtures__/paycheck-scenarios.json", import.meta.url)),
    "utf8",
  ),
) as { currency: string; scenarios: Scenario[] };

const scenario = (name: string): Scenario => {
  const found = fixture.scenarios.find((s) => s.name === name);
  if (found == null) throw new Error(`scenario ${name} missing`);
  return found;
};

type BillInput = Parameters<typeof normalizeBill>[0];

const billsOf = (s: Scenario): Bill[] =>
  s.bills.map((b) => normalizeBill({ currency: fixture.currency, ...b } as BillInput));

const generated = (s: Scenario): BillOccurrence[] =>
  generateBillOccurrences(billsOf(s), [], s.asOf).occurrences;

/** The period fields under test, as plain data, so a diff reads as numbers. */
const periodShape = (p: PaycheckPeriod) => ({
  startsOn: p.startsOn,
  endsOn: p.endsOn,
  incomeCents: p.incomeCents,
  dueCents: p.dueCents,
  reservedCents: p.reservedCents,
  remainingCents: p.remainingCents,
  leading: p.leading,
  final: p.final,
  bridge: p.bridge,
  short: p.short,
  shortfallCents: p.shortfallCents,
  cashOnHandCents: p.cashOnHandCents,
});

const overviewOf = (s: Scenario, decisions?: BillDecisions) =>
  paycheckOverview({
    bills: billsOf(s),
    occurrences: generated(s),
    decisions,
    asOf: s.asOf,
    cashCents: s.cashCents,
    currency: fixture.currency,
  });

const AS_OF = "2026-11-11";

function bill(overrides: Partial<Bill> = {}): Bill {
  return normalizeBill({
    id: "huur",
    name: "Huur",
    type: "bill",
    direction: "out",
    amountCents: 100000,
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 20 }],
    anchorDate: "2026-11-20",
    currency: "EUR",
    ...overrides,
  } as BillInput);
}

const salary = (overrides: Partial<Bill> = {}): Bill =>
  bill({
    id: "salaris",
    name: "Salaris",
    type: "income",
    direction: "in",
    amountCents: 300000,
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 25 }],
    anchorDate: "2026-11-25",
    ...overrides,
  });

describe("period slice fixtures", () => {
  for (const name of fixture.scenarios.map((s) => s.name)) {
    test(`${name}: the slice matches the hand-worked expectations`, () => {
      const s = scenario(name);
      const overview = overviewOf(s);
      expect(overview.plan).not.toBeNull();
      expect(overview.plan?.paydayOn).toBe(s.expected.paydayOn);
      expect(overview.plan?.periods.map(periodShape)).toEqual(s.expected.periods);
      expect(overview.preview).toMatchObject(s.expected.preview);
    });
  }

  test("monthly income on the 25th slices today into a bridge window plus three paychecks", () => {
    const overview = overviewOf(scenario("monthly-25th"));
    const periods = overview.plan?.periods ?? [];
    expect(periods.map((p) => [p.startsOn, p.endsOn])).toEqual([
      ["2026-11-11", "2026-11-24"],
      ["2026-11-25", "2026-12-24"],
      ["2026-12-25", "2027-01-24"],
    ]);
    expect(periods[0]?.bridge).toBe(true);
    expect(periods[0]?.incomeCents).toBe(0);
  });

  test("twice-monthly declared income makes a payday out of each arrival", () => {
    const overview = overviewOf(scenario("twice-monthly"));
    const starts = (overview.plan?.periods ?? []).map((p) => p.startsOn);
    expect(starts).toEqual(["2026-11-11", "2026-11-15", "2026-12-01", "2026-12-15"]);
    expect(overview.plan?.periods.map((p) => p.incomeCents)).toEqual([0, 150000, 150000, 150000]);
  });

  test("weekly income gives a weekly slice, not a synthetic monthly one", () => {
    const overview = overviewOf(scenario("weekly-reserve-cascade"));
    const periods = overview.plan?.periods ?? [];
    expect(periods).toHaveLength(4);
    expect(periods.map((p) => p.startsOn)).toEqual([
      "2026-11-11",
      "2026-11-16",
      "2026-11-23",
      "2026-11-30",
    ]);
  });

  test("a payday on the last day of the month still opens a period on that day", () => {
    const overview = overviewOf(scenario("month-end-bridge"));
    expect(overview.plan?.paydayOn).toBe("2026-11-30");
    expect(overview.plan?.periods[0]?.endsOn).toBe("2026-11-29");
    expect(overview.plan?.periods[1]?.startsOn).toBe("2026-11-30");
  });

  test("the bridge window crosses month end without borrowing from next month's payday", () => {
    const overview = overviewOf(scenario("month-end-bridge"));
    const bridge = overview.plan?.periods[0];
    expect(bridge?.startsOn).toBe("2026-11-11");
    expect(bridge?.endsOn).toBe("2026-11-29");
    expect(bridge?.incomeCents).toBe(0);
    expect(bridge?.dueCents).toBe(100000); // Huur on 28 Nov, before the payday
    expect(bridge?.shortfallCents).toBe(50000); // EUR 500 cash against EUR 1000 due
  });
});

describe("declared income only", () => {
  test("an active inflow that is not an income series is not a payday", () => {
    const s = scenario("monthly-25th");
    const bills = billsOf(s);
    // The fixture holds an active `other`/in series on the 16th and an
    // unconfirmed `income` series on the 20th; neither may move the payday.
    expect(overviewOf(s).plan?.paydayOn).toBe("2026-11-25");
    expect(overviewOf(s).plan?.periods[0]?.incomeCents).toBe(0);
    // Nor may either inflow reduce what the bridge must cover.
    expect(overviewOf(s).plan?.periods[0]?.dueCents).toBe(100000);
    expect(bills.filter((b) => b.status === "active" && b.type === "income")).toHaveLength(1);
  });

  test("no declared income means no invented payday and an unknown shortfall", () => {
    const rent = bill();
    const occurrences = generateBillOccurrences([rent], [], AS_OF).occurrences;
    const overview = paycheckOverview({
      bills: [rent],
      occurrences,
      asOf: AS_OF,
      cashCents: 50000,
    });
    expect(overview.plan).toBeNull();
    expect(overview.preview.hasIncome).toBe(false);
    expect(overview.preview.paydayOn).toBeNull();
    expect(overview.preview.shortfallCents).toBeNull();
    // The due figure still answers "what is due" over the visible horizon.
    // Three open EUR 1.000 rent rows fall inside the 90-day horizon.
    expect(overview.preview.dueBeforePaydayCents).toBe(300000);
    expect(overview.preview.coversUntil).toBe("2027-02-09");
  });
});

describe("due versus reserved", () => {
  test("a bill that outgrows its own paycheck reserves from nearer paychecks first", () => {
    const overview = overviewOf(scenario("weekly-reserve-cascade"));
    const periods = overview.plan?.periods ?? [];
    const reserved = periods.flatMap((p) => paycheckItemsReserved(p));
    expect(reserved.map((i) => [i.billId, i.shareCents])).toEqual([
      ["verzekering", 50000],
      ["verzekering", 100000],
    ]);
    // The reserved slices come out of paychecks, never out of the bridge window.
    expect(periods[0]?.reservedCents).toBe(0);
    expect(periods[0]?.items.some((i) => i.billId === "verzekering")).toBe(false);
  });

  test("the reserve keeps the whole obligation in the item, not only the slice", () => {
    const overview = overviewOf(scenario("weekly-reserve-cascade"));
    const reserved = paycheckItemsReserved(overview.plan!.periods[1]!)[0];
    expect(reserved?.remainingTotalCents).toBe(250000);
    expect(reserved?.shareCents).toBe(50000);
    expect(reserved?.dueInPeriod).toBe(false);
  });

  test("an uncovered reserve overflows onto the earliest paycheck and shows as short today", () => {
    const overview = overviewOf(scenario("monthly-reserve-overflow"));
    const leading = overview.plan?.periods[0];
    expect(leading?.reservedCents).toBe(400000);
    expect(leading?.remainingCents).toBe(-100000);
    expect(leading?.short).toBe(true);
    expect(leading?.shortfallCents).toBe(100000);
    expect(overview.preview.shortfallCents).toBe(100000);
  });

  test("due items and reserved items both keep the due-date order", () => {
    const overview = overviewOf(scenario("month-end-bridge"));
    const due = paycheckItemsDue(overview.plan!.periods[1]!);
    expect(due.map((i) => i.dueOn)).toEqual(due.map((i) => i.dueOn).sort());
  });
});

describe("bridge shortfall versus cash on hand", () => {
  test("the bridge is measured against cash, never against the incoming paycheck", () => {
    const s = scenario("month-end-bridge");
    const overview = overviewOf(s);
    const bridge = overview.plan!.periods[0]!;
    // EUR 1000 due, EUR 500 cash, EUR 3000 salary arriving on 30 Nov: the gap
    // is EUR 500, and the salary must not close it.
    expect(bridge.incomeCents).toBe(0);
    expect(bridge.shortfallCents).toBe(50000);
    expect(overview.plan!.periods[1]!.incomeCents).toBe(300000);
  });

  test("enough cash on hand means no shortfall", () => {
    const s = scenario("month-end-bridge");
    const overview = paycheckOverview({
      bills: billsOf(s),
      occurrences: generated(s),
      asOf: s.asOf,
      cashCents: 250000,
    });
    expect(overview.plan?.periods[0]?.short).toBe(false);
    expect(overview.plan?.periods[0]?.shortfallCents).toBe(0);
    expect(overview.preview.shortfallCents).toBe(0);
  });

  test("a missing cash figure is unknown, not zero", () => {
    const overview = overviewOf(scenario("month-end-unknown-cash"));
    const bridge = overview.plan?.periods[0];
    expect(bridge?.cashOnHandCents).toBeNull();
    expect(bridge?.short).toBe(false);
    expect(bridge?.shortfallCents).toBeNull();
    expect(bridge?.cashAfterObligationsCents).toBeNull();
    expect(overview.preview.shortfallCents).toBeNull();
    expect(overview.preview.shortfallUnknown).toBe(true);
  });

  test("a partially paid occurrence shrinks the bridge obligation", () => {
    const s = scenario("month-end-bridge");
    const occurrences = generated(s);
    const rent = occurrences.find((o) => o.id === "huur|2026-11-28");
    if (rent == null) throw new Error("fixture row missing");
    const decisions: BillDecisions = {
      ...EMPTY_BILL_DECISIONS,
      matches: [
        {
          id: "m1",
          occurrenceId: rent.id,
          billId: "huur",
          txId: "tx-partial",
          amountCents: 40000,
          currency: "EUR",
          source: "user",
          confidence: 1,
          decidedAt: AS_OF,
        },
      ],
    };
    const overview = paycheckOverview({
      bills: billsOf(s),
      occurrences,
      decisions,
      asOf: s.asOf,
      cashCents: s.cashCents,
    });
    expect(overview.plan?.periods[0]?.dueCents).toBe(60000);
    expect(overview.plan?.periods[0]?.shortfallCents).toBe(10000);
  });
});

describe("what is paid", () => {
  test("marks and payments closed in the last 31 days are the paid figure", () => {
    const bills = [bill({ id: "huur", amountCents: 100000, anchorDate: "2026-10-20" })];
    const occurrences = generateBillOccurrences(bills, [], AS_OF).occurrences.map((o) =>
      o.id === "huur|2026-10-20"
        ? {
            ...o,
            status: "paid" as const,
            paidOn: "2026-11-20",
            paidAmountCents: 99000,
            closedAt: AS_OF,
            closedSource: "user" as const,
          }
        : o,
    );
    const mark: BillMark = {
      occurrenceId: "huur|2026-10-20",
      billId: "huur",
      paidOn: "2026-11-20",
      amountCents: 99000,
      currency: "EUR",
      markedAt: AS_OF,
    };
    const overview = paycheckOverview({
      bills,
      occurrences,
      decisions: { ...EMPTY_BILL_DECISIONS, marks: [mark] },
      asOf: AS_OF,
      cashCents: 50000,
    });
    // A marked row has no transaction; the paid figure still counts it.
    expect(overview.preview.paidRecentlyCents).toBe(99000);
    expect(overview.preview.cashCents).toBe(50000);
  });
});

describe("cash on hand", () => {
  const account = (overrides: Partial<Account> = {}): Account => ({
    key: "NL01",
    iban: "NL01",
    name: "Betaalrekening",
    bank: "ING",
    entity: "Prive",
    currency: "EUR",
    balance: 100,
    ...overrides,
  });

  test("spending accounts count; a credit card and an investment account are not cash", () => {
    expect(
      cashOnHandCents([
        account({ balance: 1200 }),
        account({ key: "S1", name: "Spaarrekening", type: "Spaarrekening", balance: 800 }),
        account({ key: "C1", name: "Creditcard", type: "Creditcard", balance: -200 }),
        account({ key: "B1", name: "Beleggingen", type: "Beleggingsrekening", balance: 5000 }),
      ]),
    ).toBe(200000);
  });

  test("one unknown balance keeps the total unknown, never a partial sum", () => {
    expect(
      cashOnHandCents([account({ balance: 1200 }), account({ key: "S1", balance: null })]),
    ).toBe(null);
  });

  test("no spending account at all is unknown, not zero", () => {
    expect(cashOnHandCents([account({ type: "Beleggingsrekening", balance: 5000 })])).toBeNull();
    expect(cashOnHandCents([])).toBeNull();
  });

  test("a foreign-currency spending account stays out instead of shrinking the sum", () => {
    expect(
      cashOnHandCents([account({ balance: 1200 }), account({ key: "U1", currency: "USD" })]),
    ).toBe(120000);
  });
});

describe("period limit and currency", () => {
  test("the limit bounds the slice count: leading window plus three paychecks", () => {
    const bills = [salary({ anchorDate: "2026-10-25" })];
    const occurrences = generateBillOccurrences(bills, [], AS_OF).occurrences;
    const plan = paycheckPlan({ bills, occurrences, asOf: AS_OF, cashCents: 0, periodsLimit: 3 });
    expect(plan?.periods).toHaveLength(3);
    const one = paycheckPlan({ bills, occurrences, asOf: AS_OF, cashCents: 0, periodsLimit: 1 });
    expect(one?.periods).toHaveLength(2);
  });

  test("a series in another currency is counted, not silently summed", () => {
    const bills = [
      salary({ anchorDate: "2026-10-25" }),
      bill({ id: "usd", currency: "USD", amountCents: 5000 }),
    ];
    const occurrences = generateBillOccurrences(bills, [], AS_OF).occurrences;
    const plan = paycheckPlan({
      bills,
      occurrences,
      asOf: AS_OF,
      cashCents: 0,
      currency: "EUR",
    });
    expect(plan?.excludedCurrencyCount).toBe(1);
    expect(plan?.periods[0]?.dueCents).toBe(0);
  });
});
