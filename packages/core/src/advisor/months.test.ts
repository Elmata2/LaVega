import { describe, expect, it } from "vitest";
import { addMonths, isoMonth, lastDayOfMonth, monthsBetween, previousMonths } from "./months.js";

describe("isoMonth", () => {
  it("cuts a date and a date-time to YYYY-MM", () => {
    expect(isoMonth("2026-10-22")).toBe("2026-10");
    expect(isoMonth("2026-01-05T23:59:00Z")).toBe("2026-01");
  });
});

describe("previousMonths", () => {
  it("ends with asOf's own month, newest first", () => {
    expect(previousMonths("2026-10-22", 3)).toEqual(["2026-10", "2026-09", "2026-08"]);
  });
  it("crosses a year end", () => {
    expect(previousMonths("2026-02-15", 4)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });
  it("handles the 31st landing on a short month", () => {
    expect(previousMonths("2026-03-31", 3)).toEqual(["2026-03", "2026-02", "2026-01"]);
  });
  it("leap-year February", () => {
    expect(previousMonths("2024-03-31", 2)).toEqual(["2024-03", "2024-02"]);
    expect(isoMonth("2024-02-29")).toBe("2024-02");
  });
  it("n = 0 is empty", () => {
    expect(previousMonths("2026-10-22", 0)).toEqual([]);
  });
});

describe("monthsBetween", () => {
  it("exactly 12 months", () => {
    expect(monthsBetween("2025-10-23", "2026-10-23")).toBe(12);
  });
  it("11 months and 30 days is 11", () => {
    expect(monthsBetween("2025-10-23", "2026-10-22")).toBe(11);
    expect(monthsBetween("2025-01-01", "2025-12-31")).toBe(11);
  });
  it("clamps the day: Jan 31 to Feb 28 is one month", () => {
    expect(monthsBetween("2026-01-31", "2026-02-28")).toBe(1);
  });
  it("leap day to the next Feb 28 is 11, to Mar 1 is 12", () => {
    expect(monthsBetween("2024-02-29", "2025-02-28")).toBe(12);
    expect(monthsBetween("2024-02-29", "2025-02-27")).toBe(11);
  });
  it("same day is 0; reversed is negative", () => {
    expect(monthsBetween("2026-10-22", "2026-10-22")).toBe(0);
    expect(monthsBetween("2026-10-23", "2025-10-23")).toBe(-12);
  });
});

describe("addMonths", () => {
  it("clamps Jan 31 + 1 month to Feb 28, or 29 in a leap year", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });
  it("0 months is the same day; crosses a year end", () => {
    expect(addMonths("2026-10-24", 0)).toBe("2026-10-24");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
});

describe("lastDayOfMonth", () => {
  it("handles 28, 29, 30 and 31 day months", () => {
    expect(lastDayOfMonth("2026-02")).toBe("2026-02-28");
    expect(lastDayOfMonth("2024-02")).toBe("2024-02-29");
    expect(lastDayOfMonth("2026-04")).toBe("2026-04-30");
    expect(lastDayOfMonth("2026-12")).toBe("2026-12-31");
  });
});
