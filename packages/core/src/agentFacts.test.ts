import { expect, test } from "vitest";
import {
  AGENTS,
  AGENT_SPECS,
  agentFacts,
  carriesPersonalData,
  checkFact,
  factBriefing,
  isSafeFact,
  validateFacts,
} from "./agentFacts.js";
import { makeFact, upsertFacts, learnFacts } from "./facts.js";
import type { LearnedFact } from "./facts.js";

const fact = (over: Partial<LearnedFact> & Pick<LearnedFact, "agent" | "subject" | "key" | "value">): LearnedFact =>
  makeFact({ source: "agent", updatedAt: "2026-08-16", ...over });

const travelFact = (over: Partial<LearnedFact> = {}) =>
  fact({ agent: AGENTS.travel, subject: "ING betaalpas", key: "fxFeePct", value: "1.4", ...over });

/* ── the namespace itself ─────────────────────────────────────────────── */

test("every agent in the namespace is documented and has at least one key", () => {
  expect(AGENT_SPECS.map((s) => s.agent).sort()).toEqual(["belasting", "categorize", "chat", "facturen", "travel"]);
  for (const spec of AGENT_SPECS) {
    expect(spec.what.length).toBeGreaterThan(0);
    expect(spec.subjectWhat.length).toBeGreaterThan(0);
    expect(spec.keys.length).toBeGreaterThan(0);
    for (const k of spec.keys) expect(k.what.length).toBeGreaterThan(0);
  }
});

test("one valid fact per agent passes the guard", () => {
  expect(checkFact(travelFact())).toBeNull();
  expect(checkFact(fact({ agent: AGENTS.travel, subject: "Trading 212 creditcard", key: "transferFreeViaIdeal", value: "1" }))).toBeNull();
  expect(checkFact(fact({ agent: AGENTS.categorize, subject: "Overboekingen", key: "corrigeerNaar", value: "Eigen overboeking" }))).toBeNull();
  expect(checkFact(fact({ agent: AGENTS.facturen, subject: "dueDate", key: "voorkeur", value: "issueDate+30" }))).toBeNull();
  expect(checkFact(fact({ agent: AGENTS.chat, subject: "antwoord", key: "lengte", value: "kort" }))).toBeNull();
  expect(checkFact(fact({ agent: AGENTS.belasting, subject: "revenue", key: "kolom", value: "Omzet excl. btw" }))).toBeNull();
});

/* ── the belasting namespace: a column header, never a figure ─────────────
 * A sheet's headers routinely carry a year, which the ordinary identifier test
 * would refuse — so `column` is scanned for what actually means personal data. */

test("belasting learns WHERE a figure lives, and only that", () => {
  const col = (value: string, subject = "revenue") =>
    checkFact(fact({ agent: AGENTS.belasting, subject, key: "kolom", value }));

  // a real header, including one with a year in it
  expect(col("Omzet 2026")).toBeNull();
  expect(col("Umsatz netto")).toBeNull();
  expect(col("Bedrag €")).toBeNull();

  // but never a figure out of the sheet, or a bank identifier
  expect(col("12.450,00")).toBe("kolomnaam bevat een bedrag of rekeningnummer");
  expect(col("€ 12450")).toBe("kolomnaam bevat een bedrag of rekeningnummer");
  expect(col("NL91ABNA0417164300")).toBe("kolomnaam bevat een bedrag of rekeningnummer");
  expect(col("saldo 12345678")).toBe("kolomnaam bevat een bedrag of rekeningnummer");

  // and only the six tax figures are legal subjects — a client or a BV has
  // nowhere to live here either
  expect(col("Omzet", "Klant BV")).toBe("subject valt buiten de namespace");
  expect(checkFact(fact({ agent: AGENTS.belasting, subject: "revenue", key: "waarde", value: "10000" })))
    .toBe("key valt buiten de namespace");
});

test("an agent, subject or key outside the namespace is refused", () => {
  expect(checkFact(fact({ agent: "spionage", subject: "x", key: "y", value: "z" }))).toBe("onbekende agent");
  // categorize may only talk about categories — a merchant has nowhere to live.
  expect(checkFact(fact({ agent: AGENTS.categorize, subject: "Albert Heijn", key: "corrigeerNaar", value: "Boodschappen" })))
    .toBe("subject valt buiten de namespace");
  expect(checkFact(fact({ agent: AGENTS.facturen, subject: "ACME BV", key: "voorkeur", value: "30 dagen" })))
    .toBe("subject valt buiten de namespace");
  expect(checkFact(fact({ agent: AGENTS.travel, subject: "ING betaalpas", key: "saldo", value: "12" })))
    .toBe("key valt buiten de namespace");
  expect(checkFact(fact({ agent: AGENTS.categorize, subject: "Boodschappen", key: "corrigeerNaar", value: "Verzonnen categorie" })))
    .toBe("waarde is geen bestaande categorie");
  // A percentage is bounded, so nothing bigger than 100 can hide in one.
  expect(checkFact(travelFact({ value: "150" }))).toBe("waarde valt buiten 0..100");
  expect(checkFact(travelFact({ value: "veel" }))).toBe("waarde is geen getal");
  expect(checkFact(fact({ agent: AGENTS.travel, subject: "ING betaalpas", key: "transferFreeViaIdeal", value: "misschien" })))
    .toBe("waarde moet 0 of 1 zijn");
});

/* ── the redaction rule: no balances, amounts, IBANs or counterparties ── */

test("a fact carrying a balance, an amount, an IBAN or an account number is REJECTED", () => {
  const poison: LearnedFact[] = [
    // A balance parked in a numeric key — bounded percentages make it impossible.
    travelFact({ key: "fxFeePct", value: "12450" }),
    travelFact({ key: "cashbackPct", value: "1.234,56" }),
    // An amount in a free-text value.
    fact({ agent: AGENTS.chat, subject: "antwoord", key: "toon", value: "let op mijn saldo van € 12.450" }),
    fact({ agent: AGENTS.facturen, subject: "currency", key: "voorkeur", value: "1234 EUR" }),
    // An IBAN or an account number as the subject.
    travelFact({ subject: "NL91ABNA0417164300" }),
    travelFact({ subject: "A 286-41213" }),
    // An IBAN smuggled into the note.
    travelFact({ note: "staat op NL91ABNA0417164300" }),
  ];
  const { valid, rejected } = validateFacts(poison);
  expect(valid).toEqual([]);
  expect(rejected).toHaveLength(poison.length);
  expect(poison.every((f) => !isSafeFact(f))).toBe(true);

  // And they cannot get in through the store's one door either.
  expect(upsertFacts([], poison)).toEqual([]);
  const learned = learnFacts([], poison);
  expect(learned.facts).toEqual([]);
  expect(learned.rejected.map((r) => r.reason)).toEqual([
    "waarde bevat een bedrag of rekeningnummer",
    "waarde bevat een bedrag of rekeningnummer",
    "waarde bevat een bedrag of rekeningnummer",
    "waarde bevat een bedrag of rekeningnummer",
    "subject lijkt op een rekeningnummer of bedrag",
    "subject lijkt op een rekeningnummer of bedrag",
    "note bevat een rekeningnummer",
  ]);
});

test("carriesPersonalData spots money and identifiers but not a fee percentage", () => {
  for (const s of ["NL91ABNA0417164300", "0417164300", "€ 12,50", "12,50 EUR", "1.234,56", "$40", "A 286-41213"]) {
    expect(carriesPersonalData(s)).toBe(true);
  }
  for (const s of ["1.4", "0", "0,5%", "Trading 212", "N26", "ING betaalpas", "EUR", "issueDate+30"]) {
    expect(carriesPersonalData(s)).toBe(false);
  }
});

test("a real brand fact still gets through — the guard must not eat the feature", () => {
  const real = [
    travelFact({ subject: "Trading 212 creditcard", key: "fxFeePct", value: "0" }),
    travelFact({ subject: "Trading 212 creditcard", key: "cashbackPct", value: "1" }),
    // A public tariff threshold in a note is a provider's amount, not the owner's.
    travelFact({ subject: "Revolut betaalpas", key: "fxFeePct", value: "0", note: "gratis tot €1000 per maand" }),
  ];
  expect(validateFacts(real).rejected).toEqual([]);
  expect(upsertFacts([], real)).toHaveLength(3);
});

/* ── reading facts back before an agent answers ───────────────────────── */

test("each agent reads only its own facts, and the briefing marks the owner's", () => {
  const facts = upsertFacts([], [
    travelFact({ subject: "ING betaalpas", key: "fxFeePct", value: "1.4", source: "user", note: "zelf nagekeken" }),
    travelFact({ subject: "Trading 212 creditcard", key: "fxFeePct", value: "0" }),
    fact({ agent: AGENTS.chat, subject: "antwoord", key: "lengte", value: "kort", source: "user" }),
  ]);

  expect(agentFacts(facts, AGENTS.travel)).toHaveLength(2);
  expect(agentFacts(facts, AGENTS.chat)).toHaveLength(1);
  expect(agentFacts(facts, AGENTS.categorize)).toEqual([]);

  const lines = factBriefing(facts, AGENTS.travel);
  expect(lines).toEqual([
    "ING betaalpas fxFeePct = 1.4 (door de gebruiker)",
    "Trading 212 creditcard fxFeePct = 0",
  ]);
  // The note is free text and never leaves the device.
  expect(lines.join("\n")).not.toContain("zelf nagekeken");
  expect(factBriefing(facts, AGENTS.categorize)).toEqual([]);
});

test("learnFacts keeps the owner's correction and still reports what it refused", () => {
  const corrected = upsertFacts([], [travelFact({ value: "1.4", source: "user" })]);
  const { facts, rejected } = learnFacts(corrected, [
    travelFact({ value: "2", source: "agent" }), // valid, but must not overrule the owner
    travelFact({ subject: "NL91ABNA0417164300", value: "0" }), // refused
  ]);
  expect(facts).toHaveLength(1);
  expect(facts[0]).toMatchObject({ value: "1.4", source: "user" });
  expect(rejected).toHaveLength(1);
});
