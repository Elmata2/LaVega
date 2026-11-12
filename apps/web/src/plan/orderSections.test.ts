import { SECTION_IDS } from "@lavega/core";
import { expect, test } from "vitest";
import { orderSections } from "./orderSections";

test("cards-points first puts cards first, others keep order", () => {
  expect(orderSections(SECTION_IDS, ["cards-points"])).toEqual([
    "cards",
    ...SECTION_IDS.filter((s) => s !== "cards"),
  ]);
});

test("matched sections follow priority order", () => {
  expect(orderSections(SECTION_IDS, ["pay-off-debt", "spend-less", "subscriptions"]).slice(0, 3)).toEqual([
    "debts",
    "spending",
    "subscriptions",
  ]);
});

test("save-more and children both map to goals, which moves once at its first position", () => {
  const out = orderSections(SECTION_IDS, ["save-more", "cards-points", "children", "start-investing"]);
  expect(out.slice(0, 2)).toEqual(["goals", "cards"]);
  expect(out).toHaveLength(SECTION_IDS.length);
  expect(new Set(out).size).toBe(SECTION_IDS.length);
});

test("empty priorities keeps today's order", () => {
  expect(orderSections(SECTION_IDS, [])).toEqual([...SECTION_IDS]);
});
