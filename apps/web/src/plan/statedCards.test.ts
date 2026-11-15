import { expect, test } from "vitest";
import { heldStatedNames, statedCardRows, yearlyFeeTotal } from "./statedCards";

const labels = { credit: "Een andere kaart", debit: "Een andere pas" };
const none = new Set<string>();

test("Amex Gold: monthly fee turned into a yearly figure, fx and points with dates", () => {
  const [row] = statedCardRows(["american-express-gold-card"], [], none, labels, "Onbekende kaart");
  expect(row!.name).toContain("Gold");
  expect(row!.yearlyFee).toMatchObject({
    value: 24000,
    checkedAt: "2024-07-04",
  });
  expect(row!.yearlyFee!.sourceUrl).toContain("americanexpress.com");
  expect(row!.fxFeePct).toMatchObject({ value: 2.5, checkedAt: "2022-03-01" });
  expect(row!.pointsPerEuro).toMatchObject({
    value: 1,
    checkedAt: "2026-08-20",
  });
});

test("other keeps only its name; unknown id gets the fallback", () => {
  const rows = statedCardRows(["other", "gone-card"], ["other"], none, labels, "Onbekende kaart");
  expect(rows.map((r) => [r.kind, r.name])).toEqual([
    ["credit", "Een andere kaart"],
    ["credit", "Onbekende kaart"],
    ["debit", "Een andere pas"],
  ]);
  for (const r of rows)
    expect([r.yearlyFee, r.fxFeePct, r.pointsPerEuro]).toEqual([null, null, null]);
});

test("held catalogue ids are dropped", () => {
  const rows = statedCardRows(
    ["american-express-gold-card", "other"],
    [],
    new Set(["american-express-gold-card"]),
    labels,
    "x",
  );
  expect(rows.map((r) => r.id)).toEqual(["other"]);
});

test("heldStatedNames names the stated cards the bank data already holds, once each", () => {
  const held = new Set(["ing-betaalpas", "american-express-gold-card"]);
  expect(
    heldStatedNames(
      ["american-express-gold-card", "other"],
      ["ing-betaalpas", "ing-betaalpas", "sns-betaalpas"],
      held,
      labels,
    ),
  ).toEqual(["American Express Gold Card", "ING betaalpas"]);
});

test("repeated ids in a list are one row, so the fee is not counted twice", () => {
  const rows = statedCardRows(
    ["american-express-gold-card", "american-express-gold-card"],
    ["other", "other"],
    none,
    labels,
    "x",
  );
  expect(rows.map((r) => r.id)).toEqual(["american-express-gold-card", "other"]);
  expect(yearlyFeeTotal(rows).totalCents).toBe(24000);
});

test("a fee billed per year is kept as it is", () => {
  const [row] = statedCardRows(["sns-creditcard"], [], none, labels, "x");
  expect(row!.yearlyFee).toMatchObject({ value: 3750, billed: { cents: 3750, period: "jaar" } });
});

test("a field the coverage check rejects is null, not a number", () => {
  const [row] = statedCardRows(["ing-creditcard"], [], none, labels, "x");
  expect(row!.pointsPerEuro).toBeNull();
});

test("fee total counts known fees and says how many were left out", () => {
  const rows = statedCardRows(
    ["american-express-gold-card", "other", "gone"],
    [],
    none,
    labels,
    "x",
  );
  expect(yearlyFeeTotal(rows)).toEqual({ totalCents: 24000, unknownCount: 2 });
});
