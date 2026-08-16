import { expect, test } from "vitest";
import type { Rule, Tx } from "./model.js";
import { categorize } from "./views.js";
import { NL_CATEGORY_RULES, matchNorm } from "./categories.js";

const tx = (counterparty: string, description = "", category = ""): Tx => ({
  id: counterparty + description, accountKey: "A1", date: "2026-06-01", amount: -10,
  currency: "EUR", counterparty, description, category, manual: false,
});
const cat = (t: Tx, rules: Rule[] = []) => categorize(t, rules);

test("built-in NL defaults categorize common merchants out of the box (no user rules)", () => {
  expect(cat(tx("Albert Heijn 1234 AMSTERDAM"))).toBe("Boodschappen");
  expect(cat(tx("JUMBO SUPERMARKTEN"))).toBe("Boodschappen");
  expect(cat(tx("NS GROEP IZ NS REIZIGERS"))).toBe("Transport");
  expect(cat(tx("Shell Nederland"))).toBe("Transport");
  expect(cat(tx("Netflix.com"))).toBe("Entertainment");
  expect(cat(tx("Spotify AB"))).toBe("Entertainment");
  expect(cat(tx("Vodafone Libertel"))).toBe("Abonnementen");
  expect(cat(tx("Basic-Fit Nederland"))).toBe("Gezondheid");
  expect(cat(tx("bol.com b.v."))).toBe("Online shopping");
  expect(cat(tx("Belastingdienst"))).toBe("Belastingen & overheid");
  expect(cat(tx("IKEA Amsterdam"))).toBe("Huis & tuin");
  expect(cat(tx("Geldautomaat ING"))).toBe("Geldopname");
});

test("ordering: a specific product beats its broader merchant", () => {
  expect(cat(tx("Amazon Prime Video"))).toBe("Entertainment");
  expect(cat(tx("Amazon EU SARL"))).toBe("Online shopping");
  expect(cat(tx("Uber Eats"))).toBe("Eten & drinken");
  expect(cat(tx("Uber BV pending"))).toBe("Transport");
  expect(cat(tx("Bolt Food"))).toBe("Eten & drinken");
  expect(cat(tx("Bolt.eu ride"))).toBe("Transport");
});

test("a user rule and a manual category both beat the built-in defaults", () => {
  const rules: Rule[] = [{ id: "r1", match: "albert heijn", category: "Mijn boodschappen" }];
  expect(cat(tx("Albert Heijn"), rules)).toBe("Mijn boodschappen"); // user rule wins
  expect(cat(tx("Albert Heijn", "", "Handmatig"), rules)).toBe("Handmatig"); // manual wins over all
});

test("savings: full word 'spaarrekening' -> Sparen & beleggen; bare 'sparen' stays out of Boodschappen", () => {
  expect(cat(tx("Oranje Spaarrekening"))).toBe("Sparen & beleggen");
  // "sparen" does NOT contain "spaarrekening", and bare "spar" was dropped, so a
  // loose "sparen" description must not fall into Boodschappen.
  expect(cat(tx("Potje", "geld opzij sparen"))).toBe("onbekend");
  expect(cat(tx("Onbekende Winkel XYZ", "particuliere betaling"))).toBe("onbekend");
});

test("bank fees -> Bankkosten; Revolut top-up -> Overboekingen", () => {
  expect(cat(tx("Kosten Zakelijk Betalingsverkeer"))).toBe("Bankkosten");
  expect(cat(tx("Geld toegevoegd via IDEAL"))).toBe("Overboekingen");
});

test("no built-in match string normalizes to empty (would catch-all everything)", () => {
  for (const r of NL_CATEGORY_RULES) {
    expect(r.match.trim().length).toBeGreaterThan(0);
    // matchNorm strips punctuation, so an entry made only of punctuation would
    // normalize to "" and substring-match every transaction.
    expect(matchNorm(r.match).length).toBeGreaterThan(0);
    expect(r.category.length).toBeGreaterThan(0);
  }
});

test("matchNorm folds the punctuation real bank strings arrive with", () => {
  expect(matchNorm("Nationale-Nederlanden")).toBe("nationale nederlanden");
  expect(matchNorm("K.v.K.")).toBe("kvk");
  expect(matchNorm("CCV*ALBERT HEIJN")).toBe("ccv albert heijn");
  expect(matchNorm("Domino’s Pizza")).toBe("dominos pizza");
  expect(matchNorm("Café  Pathé")).toBe("cafe pathe");
  // "&" is left alone on purpose: folding it would turn "h&m"/"c&a" into
  // two-letter needles that substring-match unrelated words.
  expect(matchNorm("H&M")).toBe("h&m");
});

test("punctuation in the counterparty no longer defeats a built-in default", () => {
  // Each of these returned "onbekend" before matchNorm.
  expect(cat(tx("Nationale-Nederlanden", "Premie"))).toBe("Verzekeringen");
  expect(cat(tx("K.v.K. Handelsregister"))).toBe("Belastingen & overheid");
  expect(cat(tx("Domino’s Pizza Rotterdam"))).toBe("Eten & drinken");
});

test("a user rule written with punctuation still matches plain bank text", () => {
  const rules: Rule[] = [{ id: "r1", match: "Van der Meer-Advies B.V.", category: "Zakelijk advies" }];
  expect(cat(tx("VAN DER MEER ADVIES BV", "factuur"), rules)).toBe("Zakelijk advies");
});

test("business software/cloud: the block a company account actually spends in", () => {
  // "amazon web services" must beat the broader "amazon" -> Online shopping.
  expect(cat(tx("AMAZON WEB SERVICES EMEA SARL"))).toBe("Abonnementen");
  expect(cat(tx("Google Ireland Ltd", "Google Cloud EMEA"))).toBe("Abonnementen");
  expect(cat(tx("ANTHROPIC PBC"))).toBe("Abonnementen");
  expect(cat(tx("GITHUB INC"))).toBe("Abonnementen");
  expect(cat(tx("Vercel Inc"))).toBe("Abonnementen");
  expect(cat(tx("Moneybird B.V."))).toBe("Abonnementen");
  // Consumer Amazon is untouched by the new block.
  expect(cat(tx("Amazon EU SARL"))).toBe("Online shopping");
});

test("payment processors stay 'onbekend' on purpose — the sign cannot decide them", () => {
  // A Mollie/Stripe row is revenue one way and a fee the other; a substring
  // rule cannot tell, and a guess would pollute the books.
  expect(cat(tx("MOLLIE B.V.", "Uitbetaling"))).toBe("onbekend");
  expect(cat({ ...tx("STRIPE PAYMENTS UK"), amount: 250 })).toBe("onbekend");
});

test("sign-gated built-in: 'salaris' is Inkomen incoming, and NOT guessed outgoing", () => {
  const incoming: Tx = { ...tx("Werkgever B.V.", "Salaris juli"), amount: 3200 };
  expect(cat(incoming)).toBe("Inkomen");
  // The same word outgoing is a company paying wages — no honest bucket, so it
  // stays "onbekend" rather than being labelled the owner's income.
  const outgoing: Tx = { ...tx("J. de Vries", "Salaris juli"), amount: -3200 };
  expect(cat(outgoing)).toBe("onbekend");
});

import type { Account } from "./model.js";
import { ownAccounts } from "./views.js";

const OWN: Account[] = [
  { key: "NL95INGB0674843703", iban: "NL95INGB0674843703", name: "ING zakelijk", bank: "ING", entity: "BV1", currency: "EUR", balance: null },
  { key: "NL88INGB0793113504", iban: "NL88INGB0793113504", name: "ING prive", bank: "ING", entity: "BV1", currency: "EUR", balance: null },
  { key: "A28641213", iban: "", name: "Oranje Spaarrekening", bank: "ING", entity: "BV1", currency: "EUR", balance: null },
  { key: "Betaalrekening", iban: "", name: "Betaalrekening", bank: "Revolut", entity: "BV1", currency: "EUR", balance: null }, // generic key -> NOT an identifier
];
const own = ownAccounts(OWN);

const onKey = (accountKey: string, counterparty: string, description = ""): Tx => ({
  id: accountKey + counterparty, accountKey, date: "2026-06-01", amount: -100,
  currency: "EUR", counterparty, description, category: "", manual: false,
});

test("Eigen overboeking: counterparty/description naming another own account is flagged", () => {
  // tx on NL95, transfer to own NL88
  expect(categorize(onKey("NL95INGB0674843703", "Overboeking naar betaalrekening NL88INGB0793113504"), [], own)).toBe("Eigen overboeking");
  // spaced IBAN in description still matches (compact comparison)
  expect(categorize(onKey("NL95INGB0674843703", "", "Naar NL88 INGB 0793 1135 04"), [], own)).toBe("Eigen overboeking");
  // transfer to own savings account number
  expect(categorize(onKey("NL95INGB0674843703", "Oranje Spaarrekening A28641213"), [], own)).toBe("Eigen overboeking");
});

test("Eigen overboeking: a row citing only its OWN account IBAN is NOT a transfer", () => {
  // Bank-fee row on NL95 that references its own IBAN -> should be Bankkosten, not a transfer
  const fee = onKey("NL95INGB0674843703", "Kosten Zakelijk Betalingsverkeer", "Betreft IBAN: NL95INGB0674843703");
  expect(categorize(fee, [], own)).toBe("Bankkosten");
});

test("Eigen overboeking: generic keys never match, and manual label still wins", () => {
  // "betaalrekening" is a generic key, not an identifier -> a payment to some third party's betaalrekening is not flagged
  expect(categorize(onKey("NL95INGB0674843703", "Betaling aan leverancier", "iets met betaalrekening"), [], own)).toBe("onbekend");
  // manual category overrides even an internal transfer
  const manual = { ...onKey("NL95INGB0674843703", "Naar NL88INGB0793113504"), category: "Handmatig" };
  expect(categorize(manual, [], own)).toBe("Handmatig");
});

test("without own accounts, categorize behaves as before (no Eigen overboeking)", () => {
  expect(categorize(onKey("NL95INGB0674843703", "Naar NL88INGB0793113504"), [])).toBe("onbekend");
});
