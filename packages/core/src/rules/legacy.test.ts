/**
 * ACCEPTANCE ARTIFACT for WS1.3 — legacy byte-compatibility.
 *
 * `categorizeLegacy` below is the ENTIRE `categorize()` body copied from
 * `git show HEAD:packages/core/src/views.ts` before the rule loop was replaced
 * by the v2 engine. It is intentionally not imported from views.ts: the point is
 * to keep a second, frozen copy of the old behaviour that the new engine is
 * measured against. When this test passes, swapping the loop did not change a
 * single answer on the existing corpus.
 *
 * The corpus is built from the real fixtures in `views.test.ts`,
 * `categorize.test.ts` and `categories.test.ts`: legacy rule sets, own accounts,
 * own names, foreign terminal rows, person names, direct debits, and the two
 * degenerate matches the old loop guarded against (empty and whitespace-only).
 */
import { describe, expect, test } from "vitest";
import type { Account, LegacyRule, Rule, Tx } from "../model.js";
import {
  DIRECT_DEBIT_CATEGORY,
  isMerchantRow,
  isOwnName,
  isPersonName,
  matchNorm,
  NL_CATEGORY_RULES_NORMALIZED,
  parseOwnName,
  PERSON_CATEGORY,
  directDebit,
} from "../categories.js";
import { categorize, foreignTerminalCategory, ownAccounts, type OwnAccounts } from "../views.js";

/* ---------------------------------------------------------------------------
 * The frozen legacy body. `ownAccountIn` is copied too: it is private in
 * views.ts and the old body calls it.
 * ------------------------------------------------------------------------- */

function ownAccountIn(hayCompact: string, accountKey: string, own: OwnAccounts): string | null {
  const skip = own.byKey.get(accountKey);
  for (const id of own.all) {
    if (skip && skip.includes(id)) continue;
    if (hayCompact.includes(id)) return id;
  }
  return null;
}

function categorizeLegacy(tx: Tx, rules: LegacyRule[], own?: OwnAccounts): string {
  if (tx.category) return tx.category;
  const hay = matchNorm(tx.counterparty + " " + tx.description);
  if (own && own.all.length) {
    if (ownAccountIn(hay.replace(/\s+/g, ""), tx.accountKey, own) !== null)
      return "Eigen overboeking";
  }
  if (own?.names?.length && isOwnName(tx.counterparty, own.names)) return "Eigen overboeking";
  for (const r of rules) {
    const m = matchNorm(r.match);
    if (m && hay.includes(m)) return r.category;
  }
  const sign = tx.amount >= 0 ? "in" : "out";
  for (const r of NL_CATEGORY_RULES_NORMALIZED) {
    if (r.weak) continue;
    if (r.sign && r.sign !== sign) continue;
    if (hay.includes(r.m)) return r.category;
  }
  const abroad = foreignTerminalCategory(tx);
  if (abroad) return abroad;
  if (directDebit(tx)) return DIRECT_DEBIT_CATEGORY;
  const raw = `${tx.counterparty} ${tx.description}`;
  if (isPersonName(tx.counterparty) && !isMerchantRow(raw)) return PERSON_CATEGORY;
  for (const r of NL_CATEGORY_RULES_NORMALIZED) {
    if (!r.weak) continue;
    if (r.sign && r.sign !== sign) continue;
    if (hay.includes(r.m)) return r.category;
  }
  return "onbekend";
}

/* ---------------------------------------------------------------------------
 * Corpus
 * ------------------------------------------------------------------------- */

const OWN_ACCOUNTS: Account[] = [
  {
    key: "NL95INGB0674843703",
    iban: "NL95INGB0674843703",
    name: "ING zakelijk",
    bank: "ING",
    entity: "BV1",
    currency: "EUR",
    balance: null,
  },
  {
    key: "NL88INGB0793113504",
    iban: "NL88INGB0793113504",
    name: "ING prive",
    bank: "ING",
    entity: "BV1",
    currency: "EUR",
    balance: null,
  },
  {
    key: "A28641213",
    iban: "",
    name: "Oranje Spaarrekening",
    bank: "ING",
    entity: "BV1",
    currency: "EUR",
    balance: null,
  },
  {
    key: "Betaalrekening",
    iban: "",
    name: "Betaalrekening",
    bank: "Revolut",
    entity: "BV1",
    currency: "EUR",
    balance: null,
  },
];

const OWN: OwnAccounts = (() => {
  const base = ownAccounts(OWN_ACCOUNTS);
  const name = parseOwnName("Alexander van der Meer");
  return name ? { ...base, names: [name] } : base;
})();

const tx = (
  id: string,
  counterparty: string,
  description = "",
  amount = -10,
  category = "",
  manual = false,
  accountKey = "A1",
): Tx => ({
  id,
  accountKey,
  date: "2026-06-01",
  amount,
  currency: "EUR",
  counterparty,
  description,
  category,
  manual,
});

const txs: Tx[] = [
  // views.test.ts fixtures
  tx("salary", "Salaris", "Loon januari", 2500),
  tx("ah", "Albert Heijn", "Boodschappen", -12.34),
  tx("coolblue", "Coolblue", "Laptop", -45),
  tx("klant", "Klant", "Factuur", 100),
  // categorize.test.ts fixtures
  tx("jan", "Jan Jansen priv", "", -10),
  tx("mystery", "Mystery Holding BV", "", -75),
  // categories.test.ts: built-ins, person, betaalverzoek, incasso
  tx("jumbo", "JUMBO SUPERMARKTEN"),
  tx("ns", "NS GROEP IZ NS REIZIGERS"),
  tx("belasting", "Belastingdienst"),
  tx("netflix", "Netflix.com"),
  tx("cafe", "CAFE AMSTERDAM"),
  tx("nn", "NATIONALE NEDERLANDEN", "POLIS 1234", -95),
  tx("person", "Mustafa Habib", "Naam: Mustafa Habib Omschrijving: Expense reimbursement"),
  tx("person-ah", "Mustafa Habib", "Naam: Mustafa Habib Omschrijving: Albert Heijn boodschappen"),
  tx(
    "betaalverzoek-person",
    "T.J. van Wijngaarden via Rabo Betaalverzoek",
    "Omschrijving: Vacance",
    -52.8,
  ),
  tx(
    "betaalverzoek-club",
    "Turing Students via ING Betaalverzoek",
    "Omschrijving: contributie",
    -15,
  ),
  tx(
    "incasso",
    "Sportclub Voorbeeld",
    "Naam: Sportclub Voorbeeld Omschrijving: contributie IBAN: NL83INGB0007811682 Kenmerk: FDA4C7 Machtiging ID: 014-M162245502 Incassant ID: NL12ZZZ271247010002 Doorlopende incasso",
    -11.89,
  ),
  // Foreign terminal rows from the Barcelona review.
  tx(
    "barcelona-metro",
    "METRO BARCELONA",
    "METRO BARCELONA ESP Kaartnr: 5238 53** **** 1748 Tijd: 11:36 Term: 02013791 Apple Pay",
    -2.4,
  ),
  tx(
    "camper-park",
    "CAMPER PARK BARCELONA",
    "CAMPER PARK BARCELONA TEIA ESP Kaartnr: 5238 53** **** 1748 Tijd: 11:36 Term: KJOLH2QT Apple Pay",
    -30,
  ),
  tx("aliexpress", "ALIEXPRESS", "ALIEXPRESS CHN Kaartnr: 5238 53** **** 1748", -18.4),
  // Own-account and own-name rows.
  tx(
    "own-iban",
    "Overboeking naar betaalrekening NL88INGB0793113504",
    "",
    -100,
    "",
    false,
    "NL95INGB0674843703",
  ),
  tx("own-iban-spaced", "", "Naar NL88 INGB 0793 1135 04", -100, "", false, "NL95INGB0674843703"),
  tx("own-savings", "Oranje Spaarrekening A28641213", "", -100, "", false, "NL95INGB0674843703"),
  tx("own-name", "A. van der Meer", "eigen rekening", -500, "", false, "NL95INGB0674843703"),
  // Stored / manual labels win before any tier runs.
  tx("stored", "Albert Heijn", "", -20, "Handmatig"),
  tx("manual-empty", "Albert Heijn", "", -20, "", true),
  // Degenerate text.
  tx("blank", "", "", -1),
  tx("kiosk", "Quiosc 4412", "particuliere betaling", -5),
];

const ruleSets: ReadonlyArray<{ name: string; rules: LegacyRule[] }> = [
  { name: "no rules", rules: [] },
  {
    name: "views.test.ts rules",
    rules: [
      { id: "r1", match: "albert heijn", category: "Boodschappen" },
      { id: "r2", match: "klant", category: "Inkomen" },
    ],
  },
  {
    name: "categorize.test.ts rules",
    rules: [
      { id: "r-jan", match: "Jan Jansen", category: "Overboekingen" },
      { id: "r-mustafa", match: "Mustafa Habib", category: "Wonen & energie" },
    ],
  },
  {
    name: "punctuation + accents normalize on both sides",
    rules: [
      { id: "r-nn", match: "nationale-nederlanden", category: "Verzekeringen" },
      { id: "r-cafe", match: "café", category: "Eten & drinken" },
    ],
  },
  {
    name: "empty category is an answer, not a miss",
    rules: [{ id: "r-empty", match: "albert heijn", category: "" }],
  },
  {
    name: "whitespace-only match must never match",
    rules: [{ id: "r-space", match: "   ", category: "Alles" }],
  },
  {
    name: "punctuation-only match must never match",
    rules: [{ id: "r-punct", match: "!!!", category: "Alles" }],
  },
  {
    name: "empty match must never match",
    rules: [{ id: "r-blank", match: "", category: "Alles" }],
  },
];

const ownVariants: ReadonlyArray<{ name: string; own: OwnAccounts | undefined }> = [
  { name: "without own accounts/names", own: undefined },
  { name: "with own accounts/names", own: OWN },
];

describe("legacy categorize is byte-identical under the v2 engine", () => {
  test("every corpus row, rule set and own-account variant gives the same answer", () => {
    let checks = 0;
    for (const ruleSet of ruleSets) {
      for (const variant of ownVariants) {
        for (const row of txs) {
          // The v2 engine is typed for `Rule[]`; these are all legacy rows, which
          // is exactly what the acceptance corpus is about.
          const actual = categorize(row, ruleSet.rules as Rule[], variant.own);
          const expected = categorizeLegacy(row, ruleSet.rules, variant.own);
          expect(actual, `${ruleSet.name} / ${variant.name} / ${row.id}`).toBe(expected);
          checks++;
        }
      }
    }
    expect(checks).toBe(ruleSets.length * ownVariants.length * txs.length);
  });

  test("a legacy rule with an empty category still returns the empty string immediately", () => {
    const rules: LegacyRule[] = [{ id: "r-empty", match: "albert heijn", category: "" }];
    const row = txs.find((t) => t.id === "ah")!;
    expect(categorize(row, rules)).toBe("");
    expect(categorizeLegacy(row, rules)).toBe("");
  });

  test("the whitespace-only rule does not relabel the dataset", () => {
    const rules: LegacyRule[] = [{ id: "r-space", match: "   ", category: "Alles" }];
    const row = txs.find((t) => t.id === "kiosk")!;
    expect(categorize(row, rules)).toBe("onbekend");
    expect(categorizeLegacy(row, rules)).toBe("onbekend");
  });

  test("a legacy rule still outranks the person and built-in readings", () => {
    const rules: LegacyRule[] = [{ id: "r-jan", match: "Jan Jansen", category: "Overboekingen" }];
    const row = txs.find((t) => t.id === "jan")!;
    expect(categorize(row, rules)).toBe("Overboekingen");
    expect(categorizeLegacy(row, rules)).toBe("Overboekingen");
  });

  test("a manual row with an empty category still falls through to the rules", () => {
    // The old `categorize` only short-circuited on a NON-EMPTY stored category;
    // the `manual` flag locked nothing. Passing locks into the engine here would
    // change this answer, which is why `categorizeDetailed` does not.
    const rules: LegacyRule[] = [{ id: "r-ah", match: "albert heijn", category: "Boodschappen" }];
    const row = txs.find((t) => t.id === "manual-empty")!;
    expect(categorize(row, rules)).toBe("Boodschappen");
    expect(categorizeLegacy(row, rules)).toBe("Boodschappen");
  });
});
