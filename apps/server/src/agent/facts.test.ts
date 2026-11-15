import { expect, test } from "vitest";
import { AGENTS } from "@lavega/core";
import { sanitizeKnownFacts, factsBlock } from "./facts.js";

test("only {subject,key,value,source} is read — the note and everything else is dropped", () => {
  const out = sanitizeKnownFacts(
    [
      {
        subject: "ING betaalpas",
        key: "fxFeePct",
        value: "1.4",
        source: "user",
        note: "zelf nagekeken",
        balance: 12450,
        accountKey: "NL91ABNA0417164300",
      },
    ],
    AGENTS.travel,
  );
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({
    agent: "travel",
    subject: "ING betaalpas",
    key: "fxFeePct",
    value: "1.4",
    source: "user",
  });
  expect(out[0].note).toBeUndefined();
  const serialized = JSON.stringify(out);
  expect(serialized).not.toContain("12450");
  expect(serialized).not.toContain("ABNA");
  expect(serialized).not.toContain("zelf nagekeken");
});

test("the ROUTE decides the agent — a client cannot smuggle a fact into another namespace", () => {
  // Claiming agent "travel" on the categorize route does not make it a travel
  // fact; it is stamped `categorize`, where a brand subject is not allowed.
  expect(
    sanitizeKnownFacts(
      [{ agent: "travel", subject: "ING betaalpas", key: "fxFeePct", value: "1.4" }],
      AGENTS.categorize,
    ),
  ).toEqual([]);
  const ok = sanitizeKnownFacts(
    [
      {
        agent: "travel",
        subject: "Overboekingen",
        key: "corrigeerNaar",
        value: "Eigen overboeking",
      },
    ],
    AGENTS.categorize,
  );
  expect(ok).toHaveLength(1);
  expect(ok[0].agent).toBe("categorize");
});

test("a fact carrying a balance, an amount, an IBAN or a counterparty never gets through", () => {
  const poisoned = [
    { subject: "ING betaalpas", key: "fxFeePct", value: "12450" }, // a balance
    { subject: "ING betaalpas", key: "fxFeePct", value: "1.234,56" }, // an amount
    { subject: "NL91ABNA0417164300", key: "fxFeePct", value: "0" }, // an IBAN
    { subject: "A 286-41213", key: "fxFeePct", value: "0" }, // an account number
    { subject: "ING betaalpas", key: "saldo", value: "3" }, // outside the namespace
  ];
  expect(sanitizeKnownFacts(poisoned, AGENTS.travel)).toEqual([]);
  // A counterparty cannot be a subject anywhere but travel, and there it is a
  // public brand — categorize/facturen/chat subjects come from closed lists.
  expect(
    sanitizeKnownFacts(
      [{ subject: "Albert Heijn", key: "corrigeerNaar", value: "Boodschappen" }],
      AGENTS.categorize,
    ),
  ).toEqual([]);
  expect(
    sanitizeKnownFacts(
      [{ subject: "ACME BV", key: "voorkeur", value: "30 dagen" }],
      AGENTS.facturen,
    ),
  ).toEqual([]);
});

test("malformed input yields no facts rather than an error, and the list is capped", () => {
  expect(sanitizeKnownFacts(undefined, AGENTS.chat)).toEqual([]);
  expect(sanitizeKnownFacts("nope", AGENTS.chat)).toEqual([]);
  expect(sanitizeKnownFacts([null, 3, {}, { subject: "antwoord" }], AGENTS.chat)).toEqual([]);
  const many = Array.from({ length: 99 }, () => ({
    subject: "antwoord",
    key: "lengte",
    value: "kort",
  }));
  // 60 read, then deduped by (agent,subject,key) — the cap is what matters.
  expect(sanitizeKnownFacts(many, AGENTS.chat).length).toBeLessThanOrEqual(60);
});

test("factsBlock renders what an agent knows, marks the owner's, and is empty when nothing is known", () => {
  const facts = sanitizeKnownFacts(
    [
      { subject: "ING betaalpas", key: "fxFeePct", value: "1.4", source: "user" },
      { subject: "Trading 212 creditcard", key: "fxFeePct", value: "0", source: "agent" },
    ],
    AGENTS.travel,
  );
  const block = factsBlock(facts, AGENTS.travel);
  expect(block).toContain("WAT LAVEGA AL WEET");
  expect(block).toContain("- ING betaalpas fxFeePct = 1.4 (door de gebruiker)");
  expect(block).toContain("- Trading 212 creditcard fxFeePct = 0");
  // Another agent's block does not leak travel's facts.
  expect(factsBlock(facts, AGENTS.chat)).toBe("");
  expect(factsBlock([], AGENTS.travel)).toBe("");
});
