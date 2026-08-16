import { expect, test } from "vitest";
import type { Tx } from "@lavega/core";
import { categoryTrend, shortCategory } from "./category-trend";
import { own, rules, txs } from "./components/blocks/fixtures";

/* The derivation behind the "changes in major categories" bar chart. Headless:
 * the block test pins the markup, this pins the numbers. */

test("categoryTrend compares the newest month with the one before it", () => {
  const t = categoryTrend(txs, rules, own, "maand", 10);
  expect(t.currentLabel).toBe("aug 2026");
  expect(t.previousLabel).toBe("jul 2026");

  const byCat = Object.fromEntries(t.rows.map((r) => [r.category, r]));
  // August: Inkoop 1.100 (manual label) + Energie 250 (user rule "Vattenfall").
  expect(byCat["Inkoop"].current).toBe(1_100);
  expect(byCat["Energie"].current).toBe(250);
  // July had Inkoop 1.880, so Inkoop is down and Energie is new.
  expect(byCat["Inkoop"].previous).toBe(1_880);
  expect(byCat["Inkoop"].changePct).toBeCloseTo(((1_100 - 1_880) / 1_880) * 100, 6);
  expect(byCat["Energie"].previous).toBe(0);
  expect(byCat["Energie"].changePct).toBeNull();
});

test("categoryTrend keeps a category that dropped to zero — that IS the change", () => {
  const gone: Tx[] = [
    { id: "a", accountKey: "A1", date: "2026-07-04", amount: -600, currency: "EUR", counterparty: "Basic-Fit", description: "", category: "", manual: false },
    { id: "b", accountKey: "A1", date: "2026-08-04", amount: -100, currency: "EUR", counterparty: "Albert Heijn", description: "", category: "", manual: false },
  ];
  const t = categoryTrend(gone, [], own, "maand", 10);
  const gezondheid = t.rows.find((r) => r.category === "Gezondheid");
  expect(gezondheid).toBeDefined();
  expect(gezondheid!.current).toBe(0);
  expect(gezondheid!.previous).toBe(600);
  // Ranked by the bigger of the two sides, so a vanished category ranks first.
  expect(t.rows[0].category).toBe("Gezondheid");
});

test("categoryTrend windows three months per side for a quarter", () => {
  const t = categoryTrend(txs, rules, own, "kwartaal", 10);
  expect(t.currentLabel).toBe("jun 2026 – aug 2026");
  expect(t.previousLabel).toBe("mrt 2026 – mei 2026");
  const byCat = Object.fromEntries(t.rows.map((r) => [r.category, r]));
  // Jun–Aug: Inkoop 1.880 + 1.100, Boodschappen 420,50, Energie 250.
  expect(byCat["Inkoop"].current).toBe(2_980);
  expect(byCat["Boodschappen"].current).toBe(420.5);
  // Nothing before June in the fixture.
  expect(t.rows.every((r) => r.previous === 0)).toBe(true);
});

test("categoryTrend excludes income and transfers between the owner's own accounts", () => {
  const t = categoryTrend(txs, rules, own, "kwartaal", 20);
  expect(t.rows.some((r) => r.category === "Eigen overboeking")).toBe(false);
  // t1/t4 are income (+12.000 / +9.500) and must not appear as spend anywhere.
  expect(t.rows.reduce((s, r) => s + r.current, 0)).toBe(2_980 + 420.5 + 250);
});

test("categoryTrend caps the rows — a bar chart of twenty categories is unreadable", () => {
  expect(categoryTrend(txs, rules, own, "kwartaal", 2).rows).toHaveLength(2);
});

test("categoryTrend returns an empty comparison rather than guessing with no data", () => {
  const t = categoryTrend([], [], own, "maand", 6);
  expect(t.rows).toEqual([]);
  expect(t.currentLabel).toBe("");
});

test("shortCategory truncates only what does not fit", () => {
  expect(shortCategory("Transport")).toBe("Transport");
  expect(shortCategory("Kleding & winkelen")).toBe("Kleding & w…");
  expect(shortCategory("Kleding & winkelen").length).toBeLessThanOrEqual(12);
});
