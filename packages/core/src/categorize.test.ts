import { expect, test } from "vitest";
import type { Tx, Rule } from "./model.js";
import {
  CATEGORY_OPTIONS, uncategorizedTxs, applyCategorizations, recategorize, uncategorizedByMonth,
  redactForAi, aiCategorizeItems, foreignCode, unknownReason, unknownBreakdown,
} from "./categorize.js";

const tx = (id: string, cp: string, amount: number, category = ""): Tx => ({
  id, accountKey: "A1", date: "2026-08-01", amount, currency: "EUR", counterparty: cp, description: "", category, manual: false,
});
const dated = (id: string, cp: string, date: string): Tx => ({ ...tx(id, cp, -10), date });

test("uncategorizedTxs returns only txs that resolve to 'onbekend'", () => {
  const txs = [tx("t1", "Jan Jansen priv", -10), tx("t2", "Albert Heijn", -20)];
  const rules: Rule[] = [];
  // "Albert Heijn" hits a built-in NL default; "Jan Jansen priv" does not.
  const un = uncategorizedTxs(txs, rules);
  expect(un.map((t) => t.id)).toEqual(["t1"]);
});

test("applyCategorizations sets manual category on decided txs + builds deduped rules", () => {
  const txs = [tx("t1", "Jan Jansen priv", -10), tx("t2", "Jan Jansen priv", -12), tx("t3", "Mystery BV", -5)];
  const rules: Rule[] = [];
  const out = applyCategorizations(txs, rules, [
    { id: "t1", category: "Overboekingen" },
    { id: "t2", category: "Overboekingen" },
    { id: "t3", category: "NietBestaand" }, // invalid -> skipped
  ]);
  const byId = Object.fromEntries(out.txs.map((t) => [t.id, t]));
  expect(byId.t1).toMatchObject({ category: "Overboekingen", manual: true });
  expect(byId.t2).toMatchObject({ category: "Overboekingen", manual: true });
  expect(byId.t3.category).toBe(""); // invalid category ignored, tx untouched
  // One deduped rule for "Jan Jansen priv" -> Overboekingen (not two)
  const janRules = out.rules.filter((r) => r.match.toLowerCase().includes("jan jansen"));
  expect(janRules).toHaveLength(1);
  expect(janRules[0].category).toBe("Overboekingen");
});

test("applyCategorizations does not duplicate an existing rule and skips empty counterparty", () => {
  const txs = [tx("t1", "Albert Heijn", -10), tx("t2", "", -5)];
  const existing: Rule[] = [{ id: "r0", match: "Albert Heijn", category: "Boodschappen" }];
  const out = applyCategorizations(txs, existing, [
    { id: "t1", category: "Boodschappen" },
    { id: "t2", category: "Overboekingen" },
  ]);
  expect(out.rules.filter((r) => r.match.toLowerCase() === "albert heijn")).toHaveLength(1); // no dup
  expect(out.rules.some((r) => r.match === "")).toBe(false); // empty counterparty -> no rule
  expect(out.txs.find((t) => t.id === "t2")).toMatchObject({ category: "Overboekingen", manual: true });
});

/* --- recategorize: the pass over transactions that are ALREADY stored ----- */

test("recategorize categorizes a STORED, previously-uncategorised transaction on a re-run", () => {
  // Exactly the vault situation: the tx was imported before the rule existed,
  // so it sits in storage with an empty category.
  const stored: Tx[] = [tx("t1", "Albert Heijn 1234", -20), tx("t2", "Nationale-Nederlanden", -95)];
  expect(stored.every((t) => t.category === "")).toBe(true);

  const out = recategorize(stored, []);
  expect(out.changed).toBe(2);
  expect(out.txs.map((t) => t.category)).toEqual(["Boodschappen", "Verzekeringen"]);
  // Pure: the stored array is untouched.
  expect(stored.map((t) => t.category)).toEqual(["", ""]);
});

test("recategorize never stores 'onbekend' and is idempotent", () => {
  const stored: Tx[] = [tx("t1", "Albert Heijn", -20), tx("t2", "Stichting Derdengelden", -500)];
  const first = recategorize(stored, []);
  expect(first.txs[1].category).toBe(""); // unplaceable stays EMPTY, not "onbekend"
  expect(first.txs.some((t) => t.category === "onbekend")).toBe(false);

  const second = recategorize(first.txs, []);
  expect(second.changed).toBe(0);
  expect(second.txs.map((t) => t.category)).toEqual(first.txs.map((t) => t.category));
});

test("recategorize leaves a manual/AI-confirmed category alone, but re-derives the rest", () => {
  const confirmed: Tx = { ...tx("t1", "Albert Heijn", -20, "Mijn eigen bucket"), manual: true };
  const auto: Tx = tx("t2", "Jan Jansen priv", -30, "Boodschappen"); // written by an earlier run
  const rules: Rule[] = [{ id: "r1", match: "Jan Jansen", category: "Overboekingen" }];

  const out = recategorize([confirmed, auto], rules);
  expect(out.txs[0]).toMatchObject({ category: "Mijn eigen bucket", manual: true }); // untouched
  // A better rule set overwrites what an earlier run wrote — that is what makes
  // the pass re-runnable instead of freezing the first answer.
  expect(out.txs[1].category).toBe("Overboekingen");
  expect(out.changed).toBe(1);
});

test("recategorize picks up a rule the AI review just appended", () => {
  const stored: Tx[] = [tx("t1", "Mystery Holding BV", -75), tx("t2", "Mystery Holding BV", -75)];
  expect(recategorize(stored, []).changed).toBe(0); // nothing matches yet

  // The AI review confirms t1; applyCategorizations appends a rule for it...
  const applied = applyCategorizations(stored, [], [{ id: "t1", category: "Abonnementen" }]);
  // ...and a re-run over storage now also places t2, which was never reviewed.
  const out = recategorize(applied.txs, applied.rules);
  expect(out.txs.find((t) => t.id === "t2")).toMatchObject({ category: "Abonnementen", manual: false });
  expect(out.txs.find((t) => t.id === "t1")).toMatchObject({ category: "Abonnementen", manual: true });
});

/* --- uncategorizedByMonth: point the AI pass at the newest month first ---- */

test("uncategorizedByMonth groups the remainder newest month first", () => {
  // Stored in import order = oldest first, which is why a capped slice of
  // uncategorizedTxs used to hand the AI the oldest rows.
  const stored: Tx[] = [
    dated("a", "Stichting Derdengelden", "2026-06-04"),
    dated("b", "Albert Heijn", "2026-07-11"), // placed by a default -> excluded
    dated("c", "Mystery Holding BV", "2026-07-20"),
    dated("d", "Onbekende Winkel XYZ", "2026-08-02"),
    dated("e", "Andere Onbekende BV", "2026-08-14"),
  ];
  expect(uncategorizedTxs(stored, [])[0].id).toBe("a"); // oldest first, as stored

  const months = uncategorizedByMonth(stored, []);
  expect(months.map((m) => m.month)).toEqual(["2026-08", "2026-07", "2026-06"]);
  expect(months[0].txs.map((t) => t.id)).toEqual(["e", "d"]); // newest first within the month
  expect(months[1].txs.map((t) => t.id)).toEqual(["c"]); // "b" was categorized, so not offered
});

test("uncategorizedByMonth shrinks as rules improve", () => {
  const stored: Tx[] = [dated("a", "Mystery Holding BV", "2026-08-02"), dated("b", "Andere BV", "2026-08-03")];
  expect(uncategorizedByMonth(stored, [])[0].txs).toHaveLength(2);
  const rules: Rule[] = [{ id: "r1", match: "Mystery Holding", category: "Abonnementen" }];
  expect(uncategorizedByMonth(stored, rules)[0].txs.map((t) => t.id)).toEqual(["b"]);
});

test("CATEGORY_OPTIONS is a non-empty set including the common NL buckets", () => {
  expect(CATEGORY_OPTIONS).toContain("Boodschappen");
  expect(CATEGORY_OPTIONS).toContain("Overboekingen");
  expect(CATEGORY_OPTIONS.length).toBeGreaterThan(10);
});

/* ---------------------------------------------------------------------------
 * The "onbekend" problem (app review 20-08-2026, item 2).
 *
 * These tests were written against MEASUREMENTS of the owner's real exports
 * (1.394 onbekend rows over 7 files: ING NL + ING EN + ING creditcard, Revolut,
 * Amex, MT940). The numbers quoted in the comments are from that run — they are
 * why each case below is here rather than a guess about what might happen.
 * ------------------------------------------------------------------------ */

const abroad = (id: string, cp: string, desc: string): Tx => ({
  id, accountKey: "A1", date: "2026-07-14", amount: -24.5, currency: "EUR",
  counterparty: cp, description: desc, category: "", manual: false,
});

test("redactForAi keeps the merchant name that follows an IBAN", () => {
  // THE BUG this whole block exists for: 747 of 1.394 (53,6%) onbekend rows
  // reached the model as an EMPTY string, because the IBAN pattern was allowed
  // to hop across spaces and ate every word after the IBAN.
  expect(redactForAi("NL17INGB0539576085 Albert Heijn 1234 Rotterdam")).toBe("Albert Heijn Rotterdam");
  expect(redactForAi("DE77100110012424146089 Wise Europe SA")).toBe("Wise Europe SA");
  expect(redactForAi("PT50002300004565716939794 Continente Lisboa PRT")).toBe("Continente Lisboa PRT");
});

test("redactForAi still removes IBANs, amounts and dates", () => {
  const out = redactForAi("IBAN NL91ABNA0417164300 op 2026-07-14 bedrag EUR 45,00 naar Netflix");
  expect(out).not.toMatch(/NL91ABNA0417164300/);
  expect(out).not.toMatch(/2026-07-14/);
  expect(out).not.toMatch(/45,00/);
  expect(out).toMatch(/Netflix/);
});

test("aiCategorizeItems sends only {id,text,sign} and drops rows with no readable text", () => {
  const txs = [
    abroad("t1", "NL17INGB0539576085", "Mercadona Valencia ESP"),
    // Nothing but identifiers/numbers: after redaction there is no text to read,
    // so this must not consume a slot in the 200-item batch.
    abroad("t2", "NL17INGB0539576085", "0539576085 20260714"),
  ];
  const items = aiCategorizeItems(txs);
  expect(items).toEqual([{ id: "t1", text: "Mercadona Valencia ESP", sign: "out" }]);
});

test("foreignCode finds the ISO country code Dutch card exports print, and ignores NLD", () => {
  // Measured in his own exports: PRT=48, ESP=35, FRA=16, BGR=1.
  expect(foreignCode(abroad("t1", "MERCADONA", "VALENCIA ESP"))).toBe("ESP");
  expect(foreignCode(abroad("t2", "PINGO DOCE", "LISBOA PRT"))).toBe("PRT");
  expect(foreignCode(abroad("t3", "ALBERT HEIJN", "ROTTERDAM NLD"))).toBe(null);
  expect(foreignCode(abroad("t4", "Albert Heijn", "Rotterdam"))).toBe(null);
});

test("foreignCode does not fire on three-letter words that are also country codes", () => {
  // CAN/PER/MAR/CHE/IND/COL are real ISO codes and also ordinary words; a
  // probe over every row of his exports found 0 legitimate uses, so they are
  // excluded rather than risked.
  for (const w of ["CAN", "PER", "MAR", "CHE", "IND", "COL", "ARE", "SEN"]) {
    expect(foreignCode(abroad("t", "MERCHANT", `SOMETHING ${w}`))).toBe(null);
  }
  // lowercase is not a country code either — exports print them in caps
  expect(foreignCode(abroad("t", "merchant", "esp"))).toBe(null);
});

test("unknownReason names the real cause instead of just 'onbekend'", () => {
  expect(unknownReason(abroad("t1", "MERCADONA", "VALENCIA ESP"))).toBe("buitenland");
  expect(unknownReason(abroad("t2", "", ""))).toBe("geen-tekst");
  expect(unknownReason(abroad("t3", "NL17INGB0539576085", "0539576085"))).toBe("alleen-nummers");
  expect(unknownReason(abroad("t4", "Jan Jansen", "priveopname"))).toBe("onbekende-tegenpartij");
});

test("unknownBreakdown totals the onbekend rows per reason, with the countries found", () => {
  const txs = [
    // Foreign merchants no rule knows — "MERCADONA" would be a bad fixture here
    // precisely because the Zuid-Europese block now places it as Boodschappen.
    abroad("t1", "TIENDA J LOPEZ", "VALENCIA ESP"),
    abroad("t2", "LOJA DO SR SILVA", "LISBOA PRT"),
    // NOT a person's name any more: "Jan Jansen" used to stand here as an
    // unplaceable counterparty, and the person rule now places it as "Tussen
    // personen" — correctly. A row that is genuinely unplaceable is one with no
    // rule, no country and no name shape: a bare terminal code.
    abroad("t3", "QUIOSC 4412", "priveopname"),
    abroad("t4", "Albert Heijn", "Rotterdam"), // categorized -> excluded
  ];
  const b = unknownBreakdown(txs, []);
  expect(b.count).toBe(3);
  expect(b.amount).toBeCloseTo(-73.5, 2);
  const byReason = Object.fromEntries(b.byReason.map((r) => [r.reason, r]));
  expect(byReason.buitenland.count).toBe(2);
  expect(byReason.buitenland.countries).toEqual(["ESP", "PRT"]);
  expect(byReason["onbekende-tegenpartij"].count).toBe(1);
  // Reasons with no rows are not listed — an empty bucket is not a finding.
  expect(byReason["geen-tekst"]).toBeUndefined();
  // Sorted biggest bucket first so the UI leads with what actually matters.
  expect(b.byReason[0].reason).toBe("buitenland");
});
