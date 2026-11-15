import { describe, expect, test } from "vitest";
import type { Bill, BillRule } from "./model.js";
import { LAST_DAY } from "./model.js";
import {
  billDaysBetween,
  billLastDayOfMonth,
  cycleStartOn,
  firstOccurrenceAfter,
  occurrencePairsBetween,
  occurrencesBetween,
  occurrencesPerYear,
} from "./schedule.js";

/** The acceptance matrix for WS2.2, one assertion per rule shape. Every date is
 *  a plain ISO string: the engine never reads the clock, so `asOf`/windows are
 *  arguments and nothing here can shift with the host timezone or DST. */

function bill(overrides: Partial<Bill> & { rules?: BillRule[] } = {}): Bill {
  return {
    id: "b1",
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

const between = (b: Bill, start: string, end: string): string[] =>
  occurrencesBetween(b, start, end);

describe("date helpers", () => {
  test("month length, leap years and day distance", () => {
    expect(billLastDayOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(billLastDayOfMonth("2024-02-10")).toBe("2024-02-29");
    expect(billLastDayOfMonth("2026-12-31")).toBe("2026-12-31");
    expect(billDaysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(billDaysBetween("2026-03-30", "2026-03-28")).toBe(-2);
  });
});

describe("cadence matrix", () => {
  test("weekly on its weekday", () => {
    const b = bill({
      anchorDate: "2026-01-05",
      rules: [{ frequency: "weekly", interval: 1, weekday: 1 }],
    });
    expect(between(b, "2026-01-01", "2026-01-31")).toEqual([
      "2026-01-05",
      "2026-01-12",
      "2026-01-19",
      "2026-01-26",
    ]);
  });

  test("biweekly is one weekly rule with interval 2, anchored", () => {
    const b = bill({
      anchorDate: "2026-01-05",
      rules: [{ frequency: "weekly", interval: 2, weekday: 1 }],
    });
    expect(between(b, "2026-01-01", "2026-02-02")).toEqual([
      "2026-01-05",
      "2026-01-19",
      "2026-02-02",
    ]);
  });

  test("monthly day 31 clamps into short months", () => {
    const b = bill({
      anchorDate: "2026-01-31",
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 31 }],
    });
    expect(between(b, "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  test("monthly day 30 clamps February only", () => {
    const b = bill({
      anchorDate: "2026-01-30",
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 30 }],
    });
    expect(between(b, "2026-02-01", "2026-03-31")).toEqual(["2026-02-28", "2026-03-30"]);
  });

  test("monthly day 29 clamps in a non-leap year and holds in a leap year", () => {
    const b = bill({
      anchorDate: "2024-01-29",
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 29 }],
    });
    expect(between(b, "2024-02-01", "2024-02-29")).toEqual(["2024-02-29"]);
    expect(between(b, "2025-02-01", "2025-02-28")).toEqual(["2025-02-28"]);
  });

  test("last calendar day of every month", () => {
    const b = bill({
      anchorDate: "2026-01-31",
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: LAST_DAY }],
    });
    expect(between(b, "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  test("quarterly is monthly interval 3", () => {
    const b = bill({
      anchorDate: "2026-01-15",
      rules: [{ frequency: "monthly", interval: 3, dayOfMonth: 15 }],
    });
    expect(between(b, "2026-01-01", "2026-12-31")).toEqual([
      "2026-01-15",
      "2026-04-15",
      "2026-07-15",
      "2026-10-15",
    ]);
  });

  test("yearly on a month and day, with interval 2", () => {
    const yearly = bill({
      anchorDate: "2024-03-15",
      rules: [{ frequency: "yearly", interval: 1, monthOfYear: 3, dayOfMonth: 15 }],
    });
    expect(between(yearly, "2024-01-01", "2026-12-31")).toEqual([
      "2024-03-15",
      "2025-03-15",
      "2026-03-15",
    ]);
    const everyTwo = bill({
      anchorDate: "2024-03-15",
      rules: [{ frequency: "yearly", interval: 2, monthOfYear: 3, dayOfMonth: 15 }],
    });
    expect(between(everyTwo, "2025-01-01", "2026-12-31")).toEqual(["2026-03-15"]);
  });

  test("nth weekday of the month and the last such weekday", () => {
    const thirdFriday = bill({
      anchorDate: "2026-01-16",
      rules: [{ frequency: "monthly", interval: 1, weekday: 5, weekdayOrdinal: 3 }],
    });
    expect(between(thirdFriday, "2026-01-01", "2026-02-28")).toEqual(["2026-01-16", "2026-02-20"]);
    const lastFriday = bill({
      anchorDate: "2026-01-30",
      rules: [{ frequency: "monthly", interval: 1, weekday: 5, weekdayOrdinal: LAST_DAY }],
    });
    expect(between(lastFriday, "2026-01-01", "2026-02-28")).toEqual(["2026-01-30", "2026-02-27"]);
  });

  test("a month without a 5th weekday is skipped, not clamped", () => {
    const fifthMonday = bill({
      anchorDate: "2026-03-30",
      rules: [{ frequency: "monthly", interval: 1, weekday: 1, weekdayOrdinal: 5 }],
    });
    expect(between(fifthMonday, "2026-02-01", "2026-03-31")).toEqual(["2026-03-30"]);
  });
});

describe("end conditions", () => {
  test("end on date truncates the schedule", () => {
    const b = bill({ endMode: "on_date", endOn: "2026-03-15" });
    expect(between(b, "2026-01-01", "2026-12-31")).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
    expect(firstOccurrenceAfter(b, "2026-03-01")).toBeNull();
  });

  test("end after count counts from the anchor and then stops", () => {
    const b = bill({ anchorDate: "2026-01-01", endMode: "after_count", endAfterCount: 3 });
    expect(between(b, "2026-01-01", "2026-12-31")).toHaveLength(3);
    expect(firstOccurrenceAfter(b, "2026-03-01")).toBeNull();
    expect(firstOccurrenceAfter(b, "2026-02-01")).toBe("2026-03-01");
  });

  test("a plan anchored in the future does not leak into an earlier window", () => {
    const b = bill({ anchorDate: "2026-06-01", endMode: "after_count", endAfterCount: 2 });
    expect(between(b, "2026-01-01", "2026-05-31")).toEqual([]);
    expect(between(b, "2026-01-01", "2026-12-31")).toEqual(["2026-06-01", "2026-07-01"]);
  });
});

describe("weekend policy", () => {
  // 2026-01-31 and 2026-02-28 both fall on a Saturday.
  const saturday = bill({
    anchorDate: "2026-01-31",
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 31 }],
  });
  test("none keeps the weekend date", () => {
    expect(between(saturday, "2026-01-01", "2026-02-28")).toEqual(["2026-01-31", "2026-02-28"]);
  });
  test("before moves to Friday", () => {
    const b = bill({
      anchorDate: "2026-01-31",
      weekendAdjust: "before",
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 31 }],
    });
    expect(between(b, "2026-01-01", "2026-02-28")).toEqual(["2026-01-30", "2026-02-27"]);
  });
  test("after moves to Monday", () => {
    const b = bill({
      anchorDate: "2026-01-31",
      weekendAdjust: "after",
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 31 }],
    });
    // The adjusted date decides the window: Jan 31 -> Feb 2, Feb 28 -> Mar 2.
    expect(between(b, "2026-01-01", "2026-02-28")).toEqual(["2026-02-02"]);
    expect(between(b, "2026-01-01", "2026-03-31")).toEqual([
      "2026-02-02",
      "2026-03-02",
      "2026-03-31",
    ]);
  });
  test("skip drops the occurrence entirely", () => {
    const b = bill({
      anchorDate: "2026-01-31",
      weekendAdjust: "skip",
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 31 }],
    });
    expect(between(b, "2026-01-01", "2026-02-28")).toEqual([]);
    expect(between(b, "2026-01-01", "2026-03-31")).toEqual(["2026-03-31"]);
  });
});

describe("cycle, frequency and search", () => {
  test("occurrences per year follows the cadence", () => {
    expect(occurrencesPerYear(bill())).toBe(12);
    expect(
      occurrencesPerYear(bill({ rules: [{ frequency: "weekly", interval: 1, weekday: 1 }] })),
    ).toBeCloseTo(52.18, 2);
    expect(
      occurrencesPerYear(bill({ rules: [{ frequency: "monthly", interval: 3, dayOfMonth: 1 }] })),
    ).toBe(4);
    expect(
      occurrencesPerYear(
        bill({ rules: [{ frequency: "yearly", interval: 1, monthOfYear: 3, dayOfMonth: 1 }] }),
      ),
    ).toBe(1);
  });

  test("cycle start is the last occurrence on or before the date", () => {
    const b = bill({
      anchorDate: "2026-01-15",
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 15 }],
    });
    expect(cycleStartOn(b, "2026-11-11")).toBe("2026-10-15");
    expect(cycleStartOn(b, "2026-11-15")).toBe("2026-11-15");
    // Lookback extends before the anchor (Sure generates history backward too);
    // the generator clamps the window to the anchor itself.
    expect(cycleStartOn(b, "2026-01-01")).toBe("2025-12-15");
  });

  test("first occurrence after a date, skipping the year search window", () => {
    const b = bill({
      anchorDate: "2026-03-15",
      rules: [{ frequency: "yearly", interval: 1, monthOfYear: 3, dayOfMonth: 15 }],
    });
    expect(firstOccurrenceAfter(b, "2026-01-01")).toBe("2026-03-15");
    expect(firstOccurrenceAfter(b, "2026-03-15")).toBe("2027-03-15");
  });

  test("pairs carry the raw date and the adjusted due date", () => {
    const b = bill({
      anchorDate: "2026-01-31",
      weekendAdjust: "before",
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 31 }],
    });
    expect(occurrencePairsBetween(b, "2026-01-01", "2026-01-31")).toEqual([
      { originalDueOn: "2026-01-31", dueOn: "2026-01-30" },
    ]);
  });

  test("iso dates do not shift across a DST boundary", () => {
    const b = bill({
      anchorDate: "2026-03-28",
      rules: [{ frequency: "weekly", interval: 1, weekday: 6 }],
    });
    expect(between(b, "2026-03-28", "2026-04-12")).toEqual([
      "2026-03-28",
      "2026-04-04",
      "2026-04-11",
    ]);
  });
});
