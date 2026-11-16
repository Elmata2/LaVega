import { expect, test } from "vitest";
import {
  DEGIRO_STALE_AFTER_DAYS,
  deGiroDaysSince,
  deGiroStaleDays,
  deGiroStaleProblems,
  type DeGiroDataState,
} from "./degiroFreshness.js";

/* Issue #325: the warning follows the data, not the import. An import of an
 * old window is stale on the day its rows are old; importedAt alone never
 * decides it. */
const state = (over: Partial<DeGiroDataState> = {}): DeGiroDataState => ({
  importedAt: "2026-10-01T09:00:00.000Z",
  coversFrom: "2026-09-01",
  coversTo: "2026-10-01",
  positionsAsOf: "2026-10-01",
  ...over,
});

test("31 days old raises the problem and 29 days does not", () => {
  expect(deGiroStaleProblems(state(), "2026-11-01")).toEqual([
    "DeGiro-gegevens zijn 31 dagen oud. Importeer een nieuw rekeningoverzicht.",
  ]);
  expect(deGiroStaleProblems(state(), "2026-10-30")).toEqual([]);
});

test("the 30-day boundary is quiet, because the rule says older than 30", () => {
  expect(deGiroStaleDays(state(), "2026-10-31")).toBeNull();
  expect(deGiroStaleDays(state(), "2026-11-01")).toBe(DEGIRO_STALE_AFTER_DAYS + 1);
});

test("the older of positionsAsOf and coversTo decides the age", () => {
  expect(
    deGiroStaleDays(state({ positionsAsOf: "2026-09-01", coversTo: "2026-10-20" }), "2026-10-21"),
  ).toBe(50);
  expect(
    deGiroStaleDays(state({ positionsAsOf: null, coversTo: "2026-09-01" }), "2026-10-02"),
  ).toBe(31);
});

test("one fresh date does not hide the other stale one", () => {
  expect(
    deGiroStaleProblems(
      state({ positionsAsOf: "2026-08-01", coversTo: "2026-10-20" }),
      "2026-10-21",
    ),
  ).toEqual(["DeGiro-gegevens zijn 81 dagen oud. Importeer een nieuw rekeningoverzicht."]);
});

test("importedAt alone never triggers the stale rule", () => {
  expect(
    deGiroStaleProblems(
      state({ importedAt: "2025-01-01T00:00:00.000Z", positionsAsOf: null, coversTo: null }),
      "2026-11-01",
    ),
  ).toEqual([]);
});

test("a date after today is zero days old, and a malformed day is ignored", () => {
  expect(deGiroDaysSince("2026-12-01", "2026-11-01")).toBe(0);
  expect(deGiroDaysSince("not-a-day", "2026-11-01")).toBeNull();
  expect(
    deGiroStaleDays(state({ positionsAsOf: "2026-12-01", coversTo: null }), "2026-11-01"),
  ).toBeNull();
});
