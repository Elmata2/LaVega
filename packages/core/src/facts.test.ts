import { expect, test } from "vitest";
import { factId, makeFact, upsertFacts, factValue, factNumber, factsFor, renameFactSubject } from "./facts.js";
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

/* --- renameFactSubject: a product name is generated, so it can change, and
 * everything learned about it has to travel with it. --- */

test("renameFactSubject carries facts to the new name and leaves nothing behind at the old one", () => {
  const facts = [
    fact({ key: "fxFeePct", value: "0" }),
    fact({ key: "cashbackPct", value: "1.5" }),
    fact({ subject: "Revolut betaalpas", key: "fxFeePct", value: "0" }),
  ];
  const out = renameFactSubject(facts, "travel", "Trading 212", "Trading 212 betaalpas");

  expect(factValue(out, "travel", "Trading 212 betaalpas", "fxFeePct")).toBe("0");
  expect(factValue(out, "travel", "Trading 212 betaalpas", "cashbackPct")).toBe("1.5");
  expect(factValue(out, "travel", "Trading 212", "fxFeePct")).toBeNull();
  // an unrelated subject is untouched
  expect(factValue(out, "travel", "Revolut betaalpas", "fxFeePct")).toBe("0");
  expect(out).toHaveLength(3);
});

test("renameFactSubject keeps a correction the owner made — that is the whole point", () => {
  const facts = [fact({ key: "fxFeePct", value: "1.4", source: "user", note: "zelf nagekeken" })];
  const out = renameFactSubject(facts, "travel", "Trading 212", "Trading 212 betaalpas");
  const moved = out.find((f) => f.subject === "Trading 212 betaalpas");

  expect(moved?.value).toBe("1.4");
  expect(moved?.source).toBe("user");
  expect(moved?.note).toBe("zelf nagekeken");
});

test("renameFactSubject never lets a carried agent fact overwrite the owner's at the destination", () => {
  const facts = [
    fact({ key: "fxFeePct", value: "0", source: "agent" }),
    fact({ subject: "Trading 212 betaalpas", key: "fxFeePct", value: "2", source: "user" }),
  ];
  const out = renameFactSubject(facts, "travel", "Trading 212", "Trading 212 betaalpas");

  expect(factValue(out, "travel", "Trading 212 betaalpas", "fxFeePct")).toBe("2");
  expect(out).toHaveLength(1);
});

test("renameFactSubject is a no-op for the same name, a blank name, or an unknown subject", () => {
  const facts = [fact()];
  expect(renameFactSubject(facts, "travel", "Trading 212", " trading 212 ")).toHaveLength(1);
  expect(factValue(renameFactSubject(facts, "travel", "Trading 212", ""), "travel", "Trading 212", "fxFeePct")).toBe("0");
  expect(factValue(renameFactSubject(facts, "travel", "Knab", "Knab betaalpas"), "travel", "Trading 212", "fxFeePct")).toBe("0");
});
