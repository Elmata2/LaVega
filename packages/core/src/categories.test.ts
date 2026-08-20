import { describe, expect, test } from "vitest";
import type { Rule, Tx } from "./model.js";
import { categorize } from "./views.js";
import { FOREIGN_COUNTRY_CODES } from "./categories.js";
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
  // The same word outgoing is a company paying wages, which LaVega's taxonomy
  // has no bucket for — so it is never labelled the owner's income. It used to
  // stop at "onbekend"; since the 20-08-2026 review the counterparty is read as
  // well, and a wage paid to a named person is a booking to that person. The
  // guard under test is unchanged: "Inkomen" is still refused.
  const outgoing: Tx = { ...tx("J. de Vries", "Salaris juli"), amount: -3200 };
  expect(cat(outgoing)).not.toBe("Inkomen");
  expect(cat(outgoing)).toBe(PERSON_CATEGORY);
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

test("FOREIGN_COUNTRY_CODES holds only well-formed codes, and none that is also a word", () => {
  // A typo here is invisible in normal use — it just quietly never matches, or
  // matches something that is not a country ("MOR" for Morocco, which is MAR).
  for (const c of FOREIGN_COUNTRY_CODES) expect(c).toMatch(/^[A-Z]{3}$/);
  // Home is not a signal.
  expect(FOREIGN_COUNTRY_CODES.has("NLD")).toBe(false);
  // Valid ISO codes that are also ordinary words, left out on purpose — see the
  // comment on the set. Morocco and Switzerland are unreachable as a result.
  for (const c of ["CAN", "PER", "MAR", "CHE", "IND", "COL", "ARE", "SEN", "AND", "ALB", "ISL"]) {
    expect(FOREIGN_COUNTRY_CODES.has(c)).toBe(false);
  }
});

/* ── Item 6 of the 20-08-2026 review: who the counterparty IS ───────────────
 *
 * Three rules he described precisely, and all three are LAST-RESORT readings:
 * they only speak where a manual label, an own-account match, a user rule and
 * every built-in merchant default have all stayed silent. That order is the
 * whole safety argument — "Albert Heijn" is two Titlecase words and would pass
 * the person-name shape test, so the person rule may never be allowed to see a
 * row a merchant rule can place.
 *
 * The fixtures below are INVENTED names in the shapes his real exports print
 * (initials with dots, tussenvoegsels, honorifics, ALL-CAPS, surname-first).
 * Third parties' names from a bank export do not belong in a public repo.
 */
import {
  isPersonName, directDebit, parseOwnName, isOwnName,
  PERSON_CATEGORY, DIRECT_DEBIT_CATEGORY,
} from "./categories.js";

describe("a counterparty that is a person's name", () => {
  test("the shapes Dutch exports actually print are recognised", () => {
    for (const name of [
      "Mustafa Habib",            // Firstname Lastname
      "MARTA TOKARZ",             // ALL CAPS full name
      "J WANG",                   // initial + ALL-CAPS surname
      "SS CHEN",                  // two initials, no vowel, + surname
      "Y LAI",                    // initial + 3-letter surname
      "K. Chen",                  // dotted initial
      "A.A. Kovalchuk",           // two dotted initials
      "J.W. van 't Veer",         // initials + tussenvoegsels
      "N.D. van Laar",
      "Hr R Swennen",             // honorific + initial + surname
      "Mevr A de Vries",
      "Mw DK Azzahra",
      "Hr JAJ Wiebrens",          // three initials, no dots
      "T.J. van Wijngaarden",
      "Hr J v d Fliert",          // abbreviated tussenvoegsels
      "Hr Z el Aimani",
      "Mlle FELICIE MOULY-AIGROT", // French honorific, hyphenated surname
      "Jenewein  Patrick",        // surname first, double space
      "Frederik-Moritz Buhrig",
      "Laura Amado Baltazar Marquez", // four name words
      "Anh Tran Huu Nam",
      "AE Terjesen",
      "Steunenberg A",            // surname first with initial
    ]) {
      expect(isPersonName(name), name).toBe(true);
    }
  });

  test("a shop, an institution or a bank's own wording is NOT a person", () => {
    for (const name of [
      "Coolblue",                         // one word is never enough
      "Newtone Belastingadviseurs B.V.",
      "Maes Law B.V.",
      "Simmons + Simmons LLP",
      "Penshee Limited",
      "SC Happy Advertising SRL",
      "CM Technology TicketFlow",
      "Stichting Higher Horizons",
      "Turing Students",
      "Erasmus Universiteit Rotterdam",
      "BELASTINGDIENST",
      "Centraal Justitieel Incasso Bureau",
      "Eau Lounge",                       // a bar he paid by bank transfer
      "De Smitse",                        // a leading tussenvoegsel is not a name
      "Oranje Spaarrekening",
      "DUO Hoofdrekening",
      "ING Bank NV OS Bedrijfsrekening",
      "Kosten Zakelijk Betalingsverkeer",
      "Betaling naar creditcard",
      "Creditcard More",
      "Incasso ING creditcard",
      "Betaling aan leverancier",         // a lowercase word is not a name part
      "Trans.Reference: 5A0ACE43FC8947BA",
      "Albert Heijn 1405 NOOTDORP NLD",   // digits, and a country token
      "MERCADONA PZA. REYES M MADRID ESP",
      "V Business",
      "Fenna Voorbeeld fennav outlook.com",
      "",
      "   ",
    ]) {
      expect(isPersonName(name), name).toBe(false);
    }
  });

  test("the SHAPE test cannot tell a two-word shop from a person — the ORDER is what does", () => {
    // "Albert Heijn" passes the shape test and always will; no rule about
    // capital letters can know it is a supermarket. That is exactly why the
    // person reading is only allowed to run after every merchant rule has been
    // tried, and why this pair of assertions is the load-bearing one.
    expect(isPersonName("Albert Heijn")).toBe(true);
    expect(cat(tx("Albert Heijn 1405 Nootdorp"))).toBe("Boodschappen");
    expect(cat(tx("Albert Heijn"))).toBe("Boodschappen");
  });

  test("a card row is never read as a person, whatever the name looks like", () => {
    // The shape test only ever sees the counterparty, so a merchant whose name
    // reads like a person is caught by the MECHANISM instead: a row carrying a
    // card number was paid at a till, and a row ending in a country token is a
    // card descriptor. Both are purchases, not bookings to a person.
    expect(categorize({
      id: "y", accountKey: "A1", date: "2026-07-14", amount: -20, currency: "EUR",
      counterparty: "TIENDA J LOPEZ", description: "VALENCIA ESP", category: "", manual: false,
    }, [])).toBe("onbekend");
    const t: Tx = {
      id: "x", accountKey: "A1", date: "2026-07-19", amount: -12.4, currency: "EUR",
      counterparty: "Jorien Bastiaans",
      description: "Jorien Bastiaans Kaartnr: 5238 53** **** 1748 Tijd: 09:12 Term: 11223344",
      category: "", manual: false,
    };
    expect(categorize(t, [])).toBe("onbekend");
  });

  test("the description decides first; only a silent description leaves it between people", () => {
    // His words: "check the description — and if the description says something,
    // use that to categorise. If not, just see it as a transaction between people."
    expect(cat(tx("Mustafa Habib", "Naam: Mustafa Habib Omschrijving: Albert Heijn boodschappen"))).toBe("Boodschappen");
    expect(cat(tx("Mustafa Habib", "Naam: Mustafa Habib Omschrijving: Expense reimbursement"))).toBe(PERSON_CATEGORY);
    // and a user rule still outranks the reading
    expect(cat(tx("Mustafa Habib", "huur juli"), [{ id: "r1", match: "Mustafa Habib", category: "Wonen & energie" }])).toBe("Wonen & energie");
  });

  test("a betaalverzoek from a person is booked between people, not as an Overboeking", () => {
    // He is explicit that a person-to-person booking is NOT "Overboekingen".
    // "via Rabo Betaalverzoek" is the mechanism, not the counterparty.
    expect(cat(tx("T.J. van Wijngaarden via Rabo Betaalverzoek", "Omschrijving: Vacance"))).toBe(PERSON_CATEGORY);
    // A payment request from something that is NOT a person keeps the old, still
    // honest reading — the mechanism is all we know about it.
    expect(cat(tx("Turing Students via ING Betaalverzoek", "Omschrijving: contributie"))).toBe("Overboekingen");
  });
});

describe("an incasso is recognised from its code", () => {
  const row = (counterparty: string, description: string): Tx => ({
    id: "d", accountKey: "NL88INGB0793113504", date: "2026-07-24", amount: -11.89,
    currency: "EUR", counterparty, description, category: "", manual: false,
  });

  test("ING's Machtiging ID / Incassant ID are read off the row", () => {
    const t = row("Sportclub Voorbeeld", "Naam: Sportclub Voorbeeld Omschrijving: contributie IBAN: NL83INGB0007811682 Kenmerk: FDA4C7 Machtiging ID: 014-M162245502 Incassant ID: NL12ZZZ271247010002 Doorlopende incasso");
    expect(directDebit(t)).toEqual({ machtigingId: "014-M162245502", incassantId: "NL12ZZZ271247010002" });
    expect(categorize(t, [])).toBe(DIRECT_DEBIT_CATEGORY);
  });

  test("the phrase forms other banks print count too", () => {
    expect(directDebit(row("X", "SEPA Incasso algemeen doorlopend Incassant: NL34ZZZ123456780000 Naam: X"))).toEqual({
      machtigingId: null, incassantId: "NL34ZZZ123456780000",
    });
    expect(directDebit(row("X", "Eenmalige incasso"))).toEqual({ machtigingId: null, incassantId: null });
    expect(directDebit(row("X", "Machtigingskenmerk: 4711 Incassant ID: NL01ZZZ000000000000"))).toEqual({
      machtigingId: "4711", incassantId: "NL01ZZZ000000000000",
    });
  });

  test("the WORD 'incasso' alone is not a code — a debt collector is not a collection", () => {
    // "Centraal Justitieel Incasso Bureau" and ING's own "Incasso ING creditcard"
    // both carry the word and neither is a SEPA mandate.
    expect(directDebit(row("Centraal Justitieel Incasso Bureau", "boete"))).toBeNull();
    expect(directDebit(row("Incasso ING creditcard", "Accountnr 210036258304 Periode juni 2026"))).toBeNull();
  });

  test("a merchant rule still wins — the mechanism only speaks when nothing else does", () => {
    // His phone bill arrives as an incasso and is still Abonnementen.
    const simyo = row("SIMYO", "Naam: SIMYO Omschrijving: Simyo FACTUURNUMMER Machtiging ID: 014-M162245502 Incassant ID: NL12ZZZ271247010002 Doorlopende incasso");
    expect(categorize(simyo, [])).toBe("Abonnementen");
  });
});

describe("his own name goes to the own-transfer section", () => {
  const own = parseOwnName("Alexander Steunenberg")!;

  test("surname alone, initial plus surname, and the full name all match", () => {
    for (const n of [
      "Steunenberg", "A Steunenberg", "A. Steunenberg", "Steunenberg A",
      "Hr A Steunenberg", "Alexander Steunenberg", "ALEXANDER STEUNENBERG",
      "A.Steunenberg", "Hr JAJ Wiebrens,Hr A Steunenberg", // a joint account he is on
    ]) {
      expect(isOwnName(n, [own]), n).toBe(true);
    }
  });

  test("a relative with the same surname is NOT him", () => {
    for (const n of [
      "Hr B Steunenberg", "Mw NL Steunenberg", "Nadia Lina Steunenberg",
      "Hr B Steunenberg en/of Mw A L Dimitrova", "Steunenberg B.V.", "Steunenbergen",
    ]) {
      expect(isOwnName(n, [own]), n).toBe(false);
    }
  });

  test("a surname with a tussenvoegsel is parsed and matched whole", () => {
    const vd = parseOwnName("Jan van der Meer")!;
    expect(vd).toEqual({ surname: "van der meer", given: ["jan"] });
    expect(isOwnName("J van der Meer", [vd])).toBe(true);
    expect(isOwnName("van der Meer", [vd])).toBe(true);
    expect(isOwnName("P van der Meer", [vd])).toBe(false);
    expect(isOwnName("Jan Meer", [vd])).toBe(false); // the tussenvoegsel is part of the name
  });

  test("a surname on its own is not enough to check an initial against", () => {
    // If all he tells the app is "Steunenberg", the bare surname matches and an
    // initial cannot be verified against anything — so "A Steunenberg" is
    // refused rather than guessed, and the UI must ask for a full name.
    const surnameOnly = parseOwnName("Steunenberg")!;
    expect(surnameOnly).toEqual({ surname: "steunenberg", given: [] });
    expect(isOwnName("Steunenberg", [surnameOnly])).toBe(true);
    expect(isOwnName("A Steunenberg", [surnameOnly])).toBe(false);
  });

  test("a bank's own wording in front of the name is dropped, not read as a name", () => {
    // Revolut writes "To A Steunenberg"; ING writes "Overschrijving van <naam>".
    expect(isOwnName("To A Steunenberg", [own])).toBe(true);
    expect(isPersonName("Overschrijving van Elisa Sophie van de Velde")).toBe(true);
    // The prefix is not EVIDENCE of a person, though: one word behind it is
    // still just one word, the way "Coolblue" is.
    expect(isPersonName("Betaling Coolblue")).toBe(false);
    expect(isPersonName("To Vitam")).toBe(false);
  });

  test("no name supplied means no claim — nothing becomes an own transfer by default", () => {
    expect(parseOwnName("")).toBeNull();
    expect(parseOwnName("   ")).toBeNull();
    expect(isOwnName("A Steunenberg", [])).toBe(false);
    expect(isOwnName("A Steunenberg", undefined)).toBe(false);
  });

  test("in categorize it is an own transfer, and it outranks the person reading", () => {
    const t = tx("A Steunenberg", "Naam: A Steunenberg IBAN: NL48ABNA0155430750");
    expect(categorize(t, [], { all: [], byKey: new Map(), names: [own] })).toBe("Eigen overboeking");
    // without the name, the same row is only a booking between people
    expect(categorize(t, [])).toBe(PERSON_CATEGORY);
  });
});
