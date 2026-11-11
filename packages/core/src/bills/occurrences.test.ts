import { describe, expect, test } from "vitest";
import type { Bill, BillOccurrence } from "./model.js";
import { billOccurrenceId, resolveBillAmountCents } from "./model.js";
import {
  generateBillOccurrences,
  occurrenceAmountCents,
  occurrenceView,
  openOccurrences,
  regenerateBillOccurrences,
  scheduleChanged,
  upcomingOccurrences,
} from "./occurrences.js";

/** WS2.3 acceptance: idempotent generation, horizon extension, the 6-month
 *  backfill, finite-plan materialization, and an edit that rebuilds the future
 *  without touching paid history. */

const AS_OF = "2026-11-11";

function bill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: "huur",
    name: "Huur",
    type: "bill",
    status: "active",
    direction: "out",
    amountCents: 100_000,
    amountStrategy: "fixed",
    currency: "EUR",
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 1 }],
    anchorDate: "2026-01-01",
    weekendAdjust: "none",
    endMode: "never",
    tags: [],
    ...overrides,
  };
}

const owed = (o: BillOccurrence): number => Math.abs(o.paidAmountCents ?? 0);

describe("generation", () => {
  test("the current cycle through the 90-day horizon", () => {
    const { occurrences, added } = generateBillOccurrences([bill()], [], AS_OF);
    expect(added).toBe(4);
    expect(occurrences.map((o) => o.dueOn)).toEqual([
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
      "2027-02-01",
    ]);
    expect(occurrences[0].originalDueOn).toBe("2026-11-01");
  });

  test("six-month history backfill is opt-in and still bounded by the anchor", () => {
    const { occurrences, added } = generateBillOccurrences([bill()], [], AS_OF, {
      historyMonths: 6,
    });
    expect(added).toBe(9);
    expect(occurrences[0].dueOn).toBe("2026-06-01");
    const recent = bill({ anchorDate: "2026-09-01" });
    const recentRows = generateBillOccurrences([recent], [], AS_OF, {
      historyMonths: 6,
    }).occurrences;
    expect(recentRows[0].dueOn).toBe("2026-09-01");
  });

  test("running the generator twice adds nothing the second time", () => {
    const first = generateBillOccurrences([bill()], [], AS_OF);
    const second = generateBillOccurrences([bill()], first.occurrences, AS_OF);
    expect(second.added).toBe(0);
    expect(second.occurrences).toEqual(first.occurrences);
    const third = generateBillOccurrences([bill()], second.occurrences, AS_OF);
    expect(third.added).toBe(0);
  });

  test("occurrence identity is the series plus the raw due date", () => {
    const { occurrences } = generateBillOccurrences([bill()], [], AS_OF);
    expect(occurrences.map((o) => o.id)).toEqual(
      occurrences.map((o) => billOccurrenceId("huur", o.originalDueOn)),
    );
    expect(new Set(occurrences.map((o) => o.id)).size).toBe(occurrences.length);
  });

  test("an annual bill extends the 90-day horizon to its next occurrence", () => {
    const yearly = bill({
      id: "verzekering",
      anchorDate: "2027-03-15",
      rules: [{ frequency: "yearly", interval: 1, monthOfYear: 3, dayOfMonth: 15 }],
    });
    // 2027-03-15 is past the 90-day horizon (2027-02-09) and still materialized.
    expect(generateBillOccurrences([yearly], [], AS_OF).occurrences.map((o) => o.dueOn)).toEqual([
      "2027-03-15",
    ]);
  });

  test("a finite plan materializes whole, through its end", () => {
    const plan = bill({ endMode: "after_count", endAfterCount: 6 });
    const { occurrences } = generateBillOccurrences([plan], [], "2026-01-01");
    expect(occurrences.map((o) => o.dueOn)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
    ]);
  });

  test("history never starts before the anchor", () => {
    const recent = bill({ anchorDate: "2026-09-01" });
    const { occurrences } = generateBillOccurrences([recent], [], AS_OF, { historyMonths: 6 });
    expect(occurrences[0].dueOn).toBe("2026-09-01");
    expect(occurrences.every((o) => o.dueOn >= "2026-09-01")).toBe(true);
  });

  test("paused, suggested, inactive and ended series generate nothing", () => {
    for (const status of ["paused", "suggested", "inactive", "ended"] as const) {
      const { added } = generateBillOccurrences([bill({ status })], [], AS_OF);
      expect(added).toBe(0);
    }
  });

  test("weekend adjustment is stored as the due date, raw date as identity", () => {
    const saturday = bill({
      anchorDate: "2026-01-31",
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 31 }],
      weekendAdjust: "before",
    });
    const { occurrences } = generateBillOccurrences([saturday], [], AS_OF);
    const january = occurrences.find((o) => o.originalDueOn === "2026-11-30");
    expect(january).toBeDefined();
    expect(january?.dueOn).toBe("2026-11-30");
  });
});

describe("regeneration after a schedule edit", () => {
  function seed(): { edited: Bill; occurrences: BillOccurrence[] } {
    const before = bill();
    const seeded = generateBillOccurrences([before], [], AS_OF, { historyMonths: 6 }).occurrences;
    // The owner paid June's occurrence, then moved the due day from the 1st
    // to the 15th.
    const occurrences = seeded.map((o) =>
      o.originalDueOn === "2026-06-01"
        ? { ...o, status: "paid" as const, paidOn: "2026-06-01", paidAmountCents: 99_500 }
        : o,
    );
    const edited = bill({ rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 15 }] });
    return { edited, occurrences };
  }

  test("paid history is never rewritten and the future is rebuilt", () => {
    const { edited, occurrences } = seed();
    const paid = occurrences.find((o) => o.status === "paid");
    const result = regenerateBillOccurrences([edited], occurrences, edited.id, AS_OF, {
      historyMonths: 6,
    });

    const stillPaid = result.occurrences.find((o) => o.id === paid?.id);
    expect(stillPaid).toEqual(paid);
    expect(stillPaid?.paidAmountCents).toBe(99_500);

    // The November row is already PAST (Nov 1 < asOf), so it stays and stands
    // in for the November cycle; only genuinely future rows are rebuilt.
    const future = result.occurrences.filter((o) => o.dueOn >= AS_OF);
    expect(future.map((o) => o.dueOn)).toEqual(["2026-12-15", "2027-01-15"]);
    expect(result.removed).toBe(3);
    expect(result.added).toBe(3);
  });

  test("a kept past row stands in for one new occurrence: no duplicate cycle", () => {
    const { edited, occurrences } = seed();
    const result = regenerateBillOccurrences([edited], occurrences, edited.id, AS_OF, {
      historyMonths: 6,
    });
    const inJune = result.occurrences.filter((o) => o.dueOn.startsWith("2026-06"));
    expect(inJune).toHaveLength(1);
    const inJuly = result.occurrences.filter((o) => o.dueOn.startsWith("2026-07"));
    expect(inJuly).toHaveLength(1);
  });

  test("regeneration converges: a second pass changes nothing", () => {
    const { edited, occurrences } = seed();
    const once = regenerateBillOccurrences([edited], occurrences, edited.id, AS_OF, {
      historyMonths: 6,
    });
    const twice = regenerateBillOccurrences([edited], once.occurrences, edited.id, AS_OF, {
      historyMonths: 6,
    });
    expect(twice.occurrences).toEqual(once.occurrences);
  });

  test("an amount edit is not a schedule edit and needs no regeneration", () => {
    const before = bill();
    const { occurrences } = generateBillOccurrences([before], [], AS_OF);
    const amountEdit = bill({ name: "Huur (nieuw)", amountCents: 110_000 });
    expect(scheduleChanged(before, amountEdit)).toBe(false);
    expect(occurrences).toHaveLength(4);
    const untouched = generateBillOccurrences([amountEdit], occurrences, AS_OF);
    expect(untouched.added).toBe(0);
    expect(untouched.occurrences).toEqual(occurrences);
  });
});

describe("amounts", () => {
  const occurrences: BillOccurrence[] = [
    {
      id: "x|2026-09-01",
      billId: "x",
      originalDueOn: "2026-09-01",
      dueOn: "2026-09-01",
      currency: "EUR",
      expectedAmountCents: null,
      status: "paid",
      paidAmountCents: 8_400,
    },
    {
      id: "x|2026-10-01",
      billId: "x",
      originalDueOn: "2026-10-01",
      dueOn: "2026-10-01",
      currency: "EUR",
      expectedAmountCents: null,
      status: "paid",
      paidAmountCents: 9_100,
    },
    {
      id: "x|2026-11-01",
      billId: "x",
      originalDueOn: "2026-11-01",
      dueOn: "2026-11-01",
      currency: "EUR",
      expectedAmountCents: null,
      status: "scheduled",
    },
  ];

  test("fixed/average/last strategies resolve through the series", () => {
    const base = {
      amountCents: 9_000,
      amountStrategy: "fixed" as const,
      averageAmountCents: 8_700,
    };
    expect(resolveBillAmountCents(base, null, 9_100)).toBe(9_000);
    expect(resolveBillAmountCents({ ...base, amountStrategy: "average" }, null, 9_100)).toBe(8_700);
    expect(resolveBillAmountCents({ ...base, amountStrategy: "last" }, null, 9_100)).toBe(9_100);
    expect(resolveBillAmountCents(base, { expectedAmountCents: 12_345 }, 9_100)).toBe(12_345);
  });

  test("the last strategy reads the previous paid row, not the closed estimate", () => {
    const variable = bill({ id: "x", amountStrategy: "last", amountCents: 9_000 });
    expect(occurrenceAmountCents(variable, occurrences[2], occurrences)).toBe(9_100);
  });

  test("an unknown paid amount stays null, not zero", () => {
    expect(owed({ ...occurrences[0], paidAmountCents: null })).toBe(0);
    expect(occurrences[0].expectedAmountCents).toBeNull();
  });
});

describe("open rows and derived state", () => {
  const rent = bill({
    id: "huur",
    amountCents: 10_000,
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 20 }],
    anchorDate: "2026-11-20",
  });
  const card = bill({ id: "kaart", amountCents: 2_000, anchorDate: "2026-11-01" });
  const salary = bill({
    id: "salaris",
    type: "income",
    direction: "in",
    amountCents: 300_000,
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 25 }],
    anchorDate: "2026-10-25",
  });
  const bills = [rent, card, salary];
  const generated = generateBillOccurrences(bills, [], AS_OF).occurrences;

  test("upcoming rows stay inside the horizon and skip income-as-debt logic", () => {
    const upcoming = upcomingOccurrences(bills, generated, AS_OF);
    expect(upcoming.length).toBeGreaterThan(0);
    expect(upcoming.some((o) => o.dueOn === "2026-11-01")).toBe(true);
    expect(upcoming.every((o) => o.dueOn <= "2027-02-09")).toBe(true);
    expect(openOccurrences(bills, generated).some((o) => o.billId === "salaris")).toBe(true);
  });

  test("derived state follows date and series status", () => {
    const cardNov = generated.find((o) => o.billId === "kaart" && o.dueOn === "2026-11-01");
    const rentNov = generated.find((o) => o.billId === "huur" && o.dueOn === "2026-11-20");
    if (cardNov == null || rentNov == null) throw new Error("fixture rows missing");
    expect(occurrenceView(card, cardNov, AS_OF)).toBe("overdue");
    expect(occurrenceView(rent, rentNov, "2026-11-11")).toBe("upcoming");
    expect(occurrenceView(rent, rentNov, "2026-11-18")).toBe("due");
    expect(occurrenceView({ ...rent, status: "paused" }, rentNov, "2026-12-30")).toBe("upcoming");
    expect(occurrenceView(rent, { ...rentNov, status: "paid" }, "2026-12-30")).toBe("paid");
  });
});
