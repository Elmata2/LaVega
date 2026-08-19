import { expect, test } from "vitest";
import { coverage, isCovered, type CatalogEntry, type CatalogValue } from "./catalog.js";

const value = (over: Partial<CatalogValue> = {}): CatalogValue => ({
  value: 1.4,
  route: "provider-pdf",
  sourceUrl: "https://assets.ing.com/…/kostenoverzicht.pdf",
  checkedAt: "2026-06-15",
  conditions: null,
  conditionsKnown: true,
  ...over,
});

test("a rate whose conditions were never established is NOT covered", () => {
  // 104 of 124 rates are conditional. Revolut's 0% holds only inside a EUR 1.000
  // monthly limit, and shipped as unconditional it ranked first and said the
  // trip would cost nothing. A rate without its conditions is not an answer.
  expect(isCovered(value())).toBe(true);
  expect(isCovered(value({ conditions: "0% tot € 1.000 p/m, daarna 1%" }))).toBe(true);
  expect(isCovered(value({ conditionsKnown: false }))).toBe(false);
  expect(isCovered(undefined)).toBe(false);
});

test("a value with no source is a rumour and does not count", () => {
  expect(isCovered(value({ sourceUrl: "" }))).toBe(false);
});

test("coverage reports the tier as well as the total, because 99% model-derived is a different product", () => {
  const entries: CatalogEntry[] = [
    { id: "a", product: "A", fields: { fxFeePct: value({ route: "provider-pdf" }) } },
    { id: "b", product: "B", fields: { fxFeePct: value({ route: "agent" }) } },
    { id: "c", product: "C", fields: { fxFeePct: value({ conditionsKnown: false }) } },
    { id: "d", product: "D", fields: {} },
  ];
  const c = coverage(entries, "fxFeePct");

  expect(c.total).toBe(4);
  expect(c.covered).toBe(2); // c has no conditions, d has nothing
  expect(c.byRoute["provider-pdf"]).toBe(1);
  expect(c.byRoute.agent).toBe(1);
});
