import { describe, expect, test } from "vitest";
import {
  budgetPeriodAt,
  budgetPeriodBounds,
  budgetPeriodFromLimits,
  budgetPeriodsOf,
  computeBudgetChain,
  setBudgetLineAllocation,
  type BudgetPeriod,
} from "./budget.js";
import chain from "./plan/__fixtures__/budget-chain.json";

/* Sure's rollover calculator carries only surplus and stops a negative month at
 * zero; see the header of budget.ts for the pinned source. This fixture is the
 * acceptance evidence for WS2.9. */
describe("carry chain (fixture)", () => {
  const result = computeBudgetChain({
    periods: chain.periods as BudgetPeriod[],
    actuals: chain.actuals,
    groups: chain.groups,
  });
  const byMonth = new Map(result.periods.map((p) => [p.month, p]));

  test("a surplus month carries its surplus into the next month", () => {
    const jan = byMonth.get("2026-01")!;
    const feb = byMonth.get("2026-02")!;
    expect(jan.carryOutCents).toBe(30000);
    expect(feb.carryInCents).toBe(30000);
    expect(feb.remainingCents).toBe(33000);
    expect(feb.carryOutCents).toBe(33000);
  });

  test("line carry comes from the line's own surplus, not from the envelope", () => {
    const feb = byMonth.get("2026-02")!;
    const boodschappen = feb.groups[0]!.lines.find((l) => l.category === "Boodschappen")!;
    expect(boodschappen.carryInCents).toBe(10000);
    expect(boodschappen.availableCents).toBe(50000);
    expect(boodschappen.remainingCents).toBe(0);
    expect(boodschappen.carryOutCents).toBe(0);
  });

  test("a negative line stops at zero and never carries a debt forward", () => {
    const jan = byMonth.get("2026-01")!;
    const horeca = jan.groups[0]!.lines.find((l) => l.category === "Horeca")!;
    expect(horeca.remainingCents).toBe(0);
    expect(horeca.carryOutCents).toBe(0);

    const feb = byMonth.get("2026-02")!;
    const febHoreca = feb.groups[0]!.lines.find((l) => l.category === "Horeca")!;
    expect(febHoreca.remainingCents).toBe(-2000);
    expect(febHoreca.carryOutCents).toBe(0);
  });

  test("a negative period stops at zero", () => {
    const result = computeBudgetChain({
      periods: [
        {
          month: "2026-01",
          currency: "EUR",
          budgetedSpendingCents: 10000,
          rollover: true,
          lines: [{ category: "Boodschappen", allocationCents: 10000 }],
          billsReservedCents: null,
        },
        {
          month: "2026-02",
          currency: "EUR",
          budgetedSpendingCents: 10000,
          rollover: true,
          lines: [{ category: "Boodschappen", allocationCents: 10000 }],
          billsReservedCents: null,
        },
      ],
      actuals: { "2026-01": { Boodschappen: 4000 }, "2026-02": { Boodschappen: 50000 } },
    });
    const jan = result.periods[0]!;
    const feb = result.periods[1]!;
    expect(jan.carryOutCents).toBe(6000);
    expect(feb.carryInCents).toBe(6000);
    expect(feb.remainingCents).toBe(16000 - 50000);
    expect(feb.carryOutCents).toBe(0);
    expect(feb.topLevel[0]!.remainingCents).toBe(10000 + 6000 - 50000);
    expect(feb.topLevel[0]!.carryOutCents).toBe(0);
  });

  test("a currency change breaks the chain", () => {
    const mar = byMonth.get("2026-03")!;
    const apr = byMonth.get("2026-04")!;
    expect(mar.currency).toBe("EUR");
    expect(mar.carryOutCents).toBe(53000);
    expect(apr.currency).toBe("USD");
    expect(apr.carryInCents).toBe(0);
    const aprLine =
      apr.topLevel.find((l) => l.category === "Boodschappen") ?? apr.groups[0]!.lines[0]!;
    expect(aprLine.carryInCents).toBe(0);
    // And it stays broken on the way back.
    expect(byMonth.get("2026-05")!.carryInCents).toBe(0);
  });

  test("the fixture's expected numbers all hold", () => {
    const expected = chain.expected as Record<string, Record<string, number | undefined>>;
    for (const [month, want] of Object.entries(expected)) {
      const got = byMonth.get(month)!;
      expect(got.carryInCents, `${month} carryIn`).toBe(want.carryInCents);
      if (want.carryOutCents !== undefined)
        expect(got.carryOutCents, `${month} carryOut`).toBe(want.carryOutCents);
      if (want.allocatedCents !== undefined)
        expect(got.allocatedCents, `${month} allocated`).toBe(want.allocatedCents);
      if (want.availableToAllocateCents !== undefined)
        expect(got.availableToAllocateCents, `${month} availableToAllocate`).toBe(
          want.availableToAllocateCents,
        );
      if (want.actualCents !== undefined)
        expect(got.actualCents, `${month} actual`).toBe(want.actualCents);
      if (want.remainingCents !== undefined)
        expect(got.remainingCents, `${month} remaining`).toBe(want.remainingCents);
      if (want.groupAllocatedCents !== undefined)
        expect(got.groups[0]!.allocationCents, `${month} group allocated`).toBe(
          want.groupAllocatedCents,
        );
      if (want.groupCarryOutCents !== undefined)
        expect(got.groups[0]!.carryOutCents, `${month} group carry`).toBe(want.groupCarryOutCents);
    }
  });
});

describe("category groups", () => {
  test("a child ring-fence is counted once, not twice", () => {
    const result = computeBudgetChain({
      periods: [
        {
          month: "2026-01",
          currency: "EUR",
          budgetedSpendingCents: 50000,
          rollover: true,
          billsReservedCents: null,
          lines: [
            { category: "Boodschappen", allocationCents: 20000, rollover: true },
            { category: "Horeca", allocationCents: 10000, rollover: true },
          ],
        },
      ],
      actuals: { "2026-01": { Boodschappen: 5000, Horeca: 9000 } },
      groups: [{ name: "Huishouden", categories: ["Boodschappen", "Horeca"] }],
    });
    const p = result.last!;
    const group = p.groups[0]!;
    // One bucket: the grouped children are not repeated in `topLevel`.
    expect(p.topLevel).toHaveLength(0);
    expect(group.lines).toHaveLength(2);
    expect(group.allocationCents).toBe(p.allocatedCents);
    // The group's carry is the sum of its children's, once.
    expect(group.carryOutCents).toBe(15000 + 1000);
    expect(group.carryOutCents).toBe(group.lines.reduce((s, l) => s + l.carryOutCents, 0));
    expect(group.carryOutCents).not.toBe(p.carryOutCents * 2);
  });

  test("a category with no group is a top-level line, not an invented parent", () => {
    const result = computeBudgetChain({
      periods: [
        {
          month: "2026-01",
          currency: "EUR",
          budgetedSpendingCents: 30000,
          rollover: true,
          billsReservedCents: null,
          lines: [
            { category: "Boodschappen", allocationCents: 20000 },
            { category: "Vervoer", allocationCents: 10000 },
          ],
        },
      ],
      actuals: { "2026-01": { Vervoer: 2000 } },
      groups: [{ name: "Huishouden", categories: ["Boodschappen"] }],
    });
    const p = result.last!;
    expect(p.groups.map((g) => g.name)).toEqual(["Huishouden"]);
    expect(p.topLevel.map((l) => l.category)).toEqual(["Vervoer"]);
    expect(p.topLevel[0]!.group).toBeNull();
    // No group row exists for the ungrouped category.
    expect(p.groups.some((g) => g.name === "Vervoer")).toBe(false);
  });

  test("a group with no children present adds no row", () => {
    const result = computeBudgetChain({
      periods: [
        {
          month: "2026-01",
          currency: "EUR",
          budgetedSpendingCents: 0,
          rollover: false,
          billsReservedCents: null,
          lines: [],
        },
      ],
      groups: [{ name: "Leeg", categories: ["Iets"] }],
    });
    expect(result.last!.groups).toEqual([]);
  });
});

describe("rollover flag", () => {
  test("rollover off kills both incoming and outgoing carry", () => {
    const result = computeBudgetChain({
      periods: [
        {
          month: "2026-01",
          currency: "EUR",
          budgetedSpendingCents: 10000,
          rollover: true,
          billsReservedCents: null,
          lines: [{ category: "Boodschappen", allocationCents: 10000 }],
        },
        {
          month: "2026-02",
          currency: "EUR",
          budgetedSpendingCents: 10000,
          rollover: false,
          billsReservedCents: null,
          lines: [{ category: "Boodschappen", allocationCents: 10000 }],
        },
      ],
      actuals: { "2026-01": { Boodschappen: 4000 }, "2026-02": { Boodschappen: 4000 } },
    });
    const feb = result.last!;
    expect(feb.carryInCents).toBe(0);
    expect(feb.carryOutCents).toBe(0);
    expect(feb.topLevel[0]!.carryInCents).toBe(0);
  });

  test("a month gap breaks the chain", () => {
    const result = computeBudgetChain({
      periods: [
        {
          month: "2026-01",
          currency: "EUR",
          budgetedSpendingCents: 10000,
          rollover: true,
          lines: [],
          billsReservedCents: null,
        },
        {
          month: "2026-03",
          currency: "EUR",
          budgetedSpendingCents: 10000,
          rollover: true,
          lines: [],
          billsReservedCents: null,
        },
      ],
    });
    expect(result.periods[1]!.carryInCents).toBe(0);
  });
});

describe("legacy categoryLimits migration", () => {
  const limits = {
    Boodschappen: { cents: 40000, at: "2026-10-02" },
    Horeca: { cents: 15000, at: "2026-10-09" },
  };

  test("the first period takes one line per limit, stamped in the newest limit's month", () => {
    const period = budgetPeriodFromLimits(limits)!;
    expect(period.month).toBe("2026-10");
    expect(period.currency).toBe("EUR");
    expect(period.rollover).toBe(false);
    expect(period.billsReservedCents).toBeNull();
    expect(period.lines).toEqual([
      { category: "Boodschappen", allocationCents: 40000 },
      { category: "Horeca", allocationCents: 15000 },
    ]);
    expect(period.budgetedSpendingCents).toBe(55000);
  });

  test("nothing to migrate is null, not an empty period", () => {
    expect(budgetPeriodFromLimits({})).toBeNull();
  });

  test("stored periods win; a vault without them still reads its limits", () => {
    expect(budgetPeriodsOf([], limits)).toHaveLength(1);
    const stored: BudgetPeriod[] = [
      {
        month: "2026-11",
        currency: "EUR",
        budgetedSpendingCents: 1,
        rollover: true,
        lines: [],
        billsReservedCents: null,
      },
    ];
    expect(budgetPeriodsOf(stored, limits)).toBe(stored);
    expect(budgetPeriodsOf(undefined, {})).toEqual([]);
  });

  test("an unmigrated vault computes the same budget the migration would write", () => {
    const direct = computeBudgetChain({
      periods: [budgetPeriodFromLimits(limits)!],
      actuals: { "2026-10": { Boodschappen: 45000 } },
    });
    const lazy = computeBudgetChain({
      periods: budgetPeriodsOf([], limits),
      actuals: { "2026-10": { Boodschappen: 45000 } },
    });
    expect(lazy).toEqual(direct);
    expect(budgetPeriodAt(lazy, "2026-10")?.topLevel[0]!.remainingCents).toBe(-5000);
  });
});

describe("period dates", () => {
  test("a calendar month is the whole month", () => {
    expect(budgetPeriodBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(budgetPeriodBounds("2026-12")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });

  test("a custom start day shifts both ends", () => {
    expect(budgetPeriodBounds("2026-02", 5)).toEqual({ start: "2026-02-05", end: "2026-03-04" });
    expect(budgetPeriodBounds("2026-01", 28)).toEqual({ start: "2026-01-28", end: "2026-02-27" });
  });

  test("custom days are clamped to Sure's 1..28 range", () => {
    expect(budgetPeriodBounds("2026-01", 0).start).toBe("2026-01-01");
    expect(budgetPeriodBounds("2026-01", 40).start).toBe("2026-01-28");
  });
});

describe("money and unknown values", () => {
  test("non-integer cents round and never go negative", () => {
    const result = computeBudgetChain({
      periods: [
        {
          month: "2026-01",
          currency: "EUR",
          budgetedSpendingCents: 1000.6,
          rollover: true,
          billsReservedCents: null,
          lines: [{ category: "A", allocationCents: -50 }],
        },
      ],
    });
    expect(result.last!.budgetedSpendingCents).toBe(1001);
    expect(result.last!.allocatedCents).toBe(0);
  });

  test("bills-reserved stays null: this module never invents it", () => {
    const result = computeBudgetChain({
      periods: [
        {
          month: "2026-01",
          currency: "EUR",
          budgetedSpendingCents: 1000,
          rollover: true,
          billsReservedCents: null,
          lines: [],
        },
      ],
    });
    expect(result.last!.billsReservedCents).toBeNull();
  });

  test("an empty chain has no last period and no invented zero", () => {
    expect(computeBudgetChain({ periods: [] })).toEqual({ periods: [], last: null });
  });
});

describe("setBudgetLineAllocation", () => {
  test("creates the month's first period and keeps the list sorted", () => {
    const periods = setBudgetLineAllocation([], "2026-10-24", "Boodschappen", 40_000);
    expect(periods).toEqual([
      {
        month: "2026-10",
        currency: "EUR",
        budgetedSpendingCents: 40_000,
        rollover: false,
        lines: [{ category: "Boodschappen", allocationCents: 40_000 }],
        billsReservedCents: null,
      },
    ]);
    const more = setBudgetLineAllocation(periods, "2026-09-01", "Horeca", 10_000);
    expect(more.map((p) => p.month)).toEqual(["2026-09", "2026-10"]);
  });

  test("edits one line and keeps the envelope the sum of the lines", () => {
    const start = setBudgetLineAllocation([], "2026-10-24", "Boodschappen", 40_000);
    const withHoreca = setBudgetLineAllocation(start, "2026-10-24", "Horeca", 10_000);
    expect(withHoreca[0]!.budgetedSpendingCents).toBe(50_000);
    const raised = setBudgetLineAllocation(withHoreca, "2026-10-24", "Boodschappen", 60_000);
    expect(raised[0]!.lines).toEqual([
      { category: "Boodschappen", allocationCents: 60_000 },
      { category: "Horeca", allocationCents: 10_000 },
    ]);
    expect(raised[0]!.budgetedSpendingCents).toBe(70_000);
  });

  test("clearing the only line leaves an empty envelope, not a deleted month", () => {
    const start = setBudgetLineAllocation([], "2026-10-24", "Boodschappen", 40_000);
    const cleared = setBudgetLineAllocation(start, "2026-10-24", "Boodschappen", null);
    expect(cleared[0]!.lines).toEqual([]);
    expect(cleared[0]!.budgetedSpendingCents).toBe(0);
    // Clearing a month that does not exist changes nothing.
    expect(setBudgetLineAllocation([], "2026-10-24", "Boodschappen", null)).toEqual([]);
  });
});
