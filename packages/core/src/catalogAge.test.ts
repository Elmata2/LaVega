import { expect, test } from "vitest";
import type { CatalogValue } from "./catalog.js";
import { AGE_REMOVAL_FIELDS, isAgedOut, isOlderThanMaxAge, lastConfirmed } from "./catalogAge.js";

const val = (checkedAt: string, confirmedAt?: string): CatalogValue => ({
  value: 1,
  route: "provider-page",
  sourceUrl: "https://www.bank.test/tarieven",
  checkedAt,
  conditions: null,
  conditionsKnown: true,
  ...(confirmedAt ? { confirmedAt } : {}),
});

test("lastConfirmed prefers confirmedAt, falls back to checkedAt", () => {
  expect(lastConfirmed(val("2026-01-01", "2026-05-05"))).toBe("2026-05-05");
  expect(lastConfirmed(val("2026-01-01"))).toBe("2026-01-01");
});

test("isOlderThanMaxAge: 2025-11-21 vs today 2026-11-21 is true; 2025-11-22 is false", () => {
  expect(isOlderThanMaxAge(val("2025-11-21"), "2026-11-21")).toBe(true);
  expect(isOlderThanMaxAge(val("2025-11-22"), "2026-11-21")).toBe(false);
});

test("isOlderThanMaxAge uses confirmedAt when present", () => {
  expect(isOlderThanMaxAge(val("2024-01-01", "2026-10-01"), "2026-11-21")).toBe(false);
});

test("isAgedOut is false for every field with the default switch", () => {
  expect(AGE_REMOVAL_FIELDS.size).toBe(0);
  expect(isAgedOut("fxFeePct", val("2020-01-01"), "2026-11-21")).toBe(false);
  expect(isAgedOut("interestPct", val("2020-01-01"), "2026-11-21")).toBe(false);
});

test("isAgedOut is true for an old figure when its field is enabled", () => {
  const on = new Set(["fxFeePct" as const]);
  expect(isAgedOut("fxFeePct", val("2020-01-01"), "2026-11-21", on)).toBe(true);
  expect(isAgedOut("interestPct", val("2020-01-01"), "2026-11-21", on)).toBe(false);
  expect(isAgedOut("fxFeePct", val("2026-10-01"), "2026-11-21", on)).toBe(false);
});

test("malformed date counts as old", () => {
  expect(isOlderThanMaxAge(val(""), "2026-11-21")).toBe(true);
  expect(isOlderThanMaxAge(val("2023"), "2026-11-21")).toBe(true);
  expect(isOlderThanMaxAge(val("2026-13-01"), "2026-11-21")).toBe(true);
});
