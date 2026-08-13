import { expect, test } from "vitest";
import { factId, makeFact, upsertFacts, factValue, factNumber, factsFor } from "./facts.js";
import type { LearnedFact } from "./facts.js";

const fact = (over: Partial<LearnedFact> = {}): LearnedFact =>
  makeFact({
    agent: "travel",
    subject: "Trading 212",
    key: "fxFeePct",
    value: "0",
    source: "agent",
    updatedAt: "2026-08-13",
    ...over,
  });

test("factId is stable and case/whitespace-insensitive, so a refresh upserts in place", () => {
  expect(factId("travel", "Trading 212", "fxFeePct")).toBe(factId("TRAVEL", " trading 212 ", "FxFeePct"));
  expect(factId("travel", "Revolut", "fxFeePct")).not.toBe(factId("travel", "Trading 212", "fxFeePct"));
});

test("an agent refresh updates its own earlier fact instead of duplicating it", () => {
  const first = upsertFacts([], [fact({ value: "0" })]);
  const second = upsertFacts(first, [fact({ value: "0.15" })]);
  expect(second).toHaveLength(1);
  expect(second[0].value).toBe("0.15");
});

test("THE learning rule: an agent never overwrites what the owner corrected", () => {
  const corrected = upsertFacts([], [fact({ value: "0.5", source: "user", note: "boven €2000" })]);
  const afterRefresh = upsertFacts(corrected, [fact({ value: "0", source: "agent" })]);
  expect(afterRefresh).toHaveLength(1);
  expect(afterRefresh[0].value).toBe("0.5"); // survived the refresh
  expect(afterRefresh[0].source).toBe("user");
  expect(afterRefresh[0].note).toBe("boven €2000");
});

test("the owner can still overwrite an agent fact, and his own earlier one", () => {
  const fromAgent = upsertFacts([], [fact({ value: "0" })]);
  const fixed = upsertFacts(fromAgent, [fact({ value: "0.5", source: "user" })]);
  expect(fixed[0]).toMatchObject({ value: "0.5", source: "user" });
  const refixed = upsertFacts(fixed, [fact({ value: "0.7", source: "user" })]);
  expect(refixed[0].value).toBe("0.7");
});

test("factNumber parses a human-typed value but keeps unknown as null", () => {
  const facts = [fact({ key: "fxFeePct", value: "0,5%" }), fact({ key: "cashbackPct", value: "1" })];
  expect(factNumber(facts, "travel", "Trading 212", "fxFeePct")).toBe(0.5);
  expect(factNumber(facts, "travel", "Trading 212", "cashbackPct")).toBe(1);
  // Unknown must NOT read as 0 — else an unknown card would rank as the cheapest.
  expect(factNumber(facts, "travel", "Trading 212", "pointsPerEuro")).toBeNull();
  expect(factNumber([fact({ value: "onbekend" })], "travel", "Trading 212", "fxFeePct")).toBeNull();
});

test("factValue and factsFor read back what was stored", () => {
  const facts = upsertFacts([], [fact({ key: "fxFeePct", value: "0" }), fact({ key: "cashbackPct", value: "1" }), fact({ subject: "Revolut", value: "1.2" })]);
  expect(factValue(facts, "travel", "Trading 212", "fxFeePct")).toBe("0");
  expect(factValue(facts, "travel", "Onbekend", "fxFeePct")).toBeNull();
  expect(factsFor(facts, "travel", "Trading 212").map((f) => f.key).sort()).toEqual(["cashbackPct", "fxFeePct"]);
});
