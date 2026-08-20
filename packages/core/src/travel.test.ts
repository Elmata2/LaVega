import { describe, expect, test } from "vitest";
import type { Account } from "./model.js";
import {
  countryCurrency, rankSpendOptions, rankJourneys, journeyHeadline, planTravel, TRAVEL_AGENT,
  parseWithdrawalFee, withdrawalCost, withdrawalEffectivePct, rankWithdrawOptions, marketCardOffers,
  withdrawalHeadline, catalogueCandidates, cheapestPerIssuer,
} from "./travel.js";
import type { CatalogueEntryLike } from "./catalogRates.js";
import { makeFact, upsertFacts } from "./facts.js";
import type { LearnedFact } from "./facts.js";

function acc(over: Partial<Account>): Account {
  return { key: "k", iban: "", name: "Rekening", bank: "ING", entity: "Prive", currency: "EUR", balance: null, ...over };
}

const fact = (subject: string, key: string, value: string, source: "agent" | "user" = "agent"): LearnedFact =>
  makeFact({ agent: TRAVEL_AGENT, subject, key, value, source, updatedAt: "2026-08-13" });

const CARDS = [
  acc({ key: "t212", bank: "Trading 212", type: "Creditcard" }),
  acc({ key: "amex", bank: "American Express", type: "Creditcard" }),
  acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 4000 }),
];

test("countryCurrency maps destinations, marks euro countries, and refuses to guess", () => {
  expect(countryCurrency("US")).toBe("USD");
  expect(countryCurrency("us")).toBe("USD"); // case-insensitive
  expect(countryCurrency("ES")).toBe("EUR");
  expect(countryCurrency("XX")).toBeNull();
});

test("rankSpendOptions puts the cheapest net cost first and unknown terms LAST", () => {
  const facts = upsertFacts([], [
    fact("Trading 212 creditcard", "fxFeePct", "0"),
    fact("Trading 212 creditcard", "cashbackPct", "1"), // net -1% — pays you to use it
    fact("ING betaalpas", "fxFeePct", "1.2"),
    // American Express deliberately unknown
  ]);
  const ranked = rankSpendOptions(CARDS, facts);
  expect(ranked.map((o) => o.provider)).toEqual(["Trading 212 creditcard", "ING betaalpas", "American Express creditcard"]);
  expect(ranked[0].netCostPct).toBe(-1);
  expect(ranked[2].known).toBe(false);
  expect(ranked[2].netCostPct).toBeNull(); // never assumed free
});

test("an unknown card does not outrank a known cheap one even at 0% cashback", () => {
  const facts = upsertFacts([], [fact("ING betaalpas", "fxFeePct", "0")]);
  const ranked = rankSpendOptions(CARDS, facts);
  expect(ranked[0].provider).toBe("ING betaalpas");
  expect(ranked.filter((o) => o.known)).toHaveLength(1);
});

test("planTravel combines the three answers for a non-euro destination", () => {
  const facts = upsertFacts([], [
    fact("Trading 212 creditcard", "fxFeePct", "0"),
    fact("Trading 212 creditcard", "cashbackPct", "1"),
    fact("Trading 212 creditcard", "transferFreeViaIdeal", "1"),
    fact("ING betaalpas", "fxFeePct", "1.2"),
  ]);
  const plan = planTravel({ accounts: CARDS, txs: [], rates: [], facts, destination: "US", asOf: "2026-08-13" });

  expect(plan.currency).toBe("USD");
  expect(plan.spend[0].provider).toBe("Trading 212 creditcard"); // pay with this
  expect(plan.convert.toProvider).toBe("Trading 212 creditcard"); // move money here
  expect(plan.convert.fromProvider).toBe("ING"); // out of the fullest payment account
  expect(plan.convert.method).toBe("iDEAL");
  expect(plan.convert.note).toContain("gratis");
  expect(plan.unknownProviders).toEqual(["American Express creditcard"]);
});

test("planTravel skips conversion advice entirely for a euro destination", () => {
  const facts = upsertFacts([], [fact("Trading 212 creditcard", "fxFeePct", "0")]);
  const plan = planTravel({ accounts: CARDS, txs: [], rates: [], facts, destination: "ES", asOf: "2026-08-13" });
  expect(plan.currency).toBe("EUR");
  expect(plan.convert.method).toBeNull();
  expect(plan.convert.note).toContain("euro");
});

test("planTravel says what it needs when no card terms are known yet", () => {
  const plan = planTravel({ accounts: CARDS, txs: [], rates: [], facts: [], destination: "US", asOf: "2026-08-13" });
  expect(plan.spend.every((o) => !o.known)).toBe(true);
  expect(plan.convert.note).toContain("ververs");
  expect(plan.unknownProviders.sort()).toEqual(["American Express creditcard", "ING betaalpas", "Trading 212 creditcard"]);
});

test("planTravel surfaces the best place to keep savings", () => {
  const accounts = [acc({ key: "spaar", bank: "ING", type: "Spaarrekening", balance: 20000, interestRate: 1.0 })];
  const rates = [{ bank: "BigBank", product: "Spaarrekening", ratePct: 2.5, freeWithdrawal: true }];
  const plan = planTravel({ accounts, txs: [], rates, facts: [], destination: "US", asOf: "2026-08-13" });
  expect(plan.store.suggestion?.account.key).toBe("spaar");
  expect(plan.store.note).toContain("BigBank");
});

/* --- Real-data regressions: accounts imported without a bank (his stale ING
 * savings rows are named after their account NUMBER), and several accounts at
 * one bank. --- */

const REAL_WORLD = [
  acc({ key: "A28641213", bank: "", name: "A 286-41213" }), // stale import: name IS the number
  acc({ key: "D12883091", bank: "", name: "D 128-83091" }),
  acc({ key: "abn", bank: "ABN AMRO", name: "ABN AMRO" }),
  acc({ key: "amex", bank: "American Express", name: "activity", type: "Creditcard" }),
  acc({ key: "ing1", bank: "ING", name: "NL12INGB0001" }),
  acc({ key: "ing2", bank: "ING", name: "NL12INGB0002" }),
];

test("an account number is NEVER offered as a provider — no identifier can reach the agent", () => {
  const plan = planTravel({ accounts: REAL_WORLD, txs: [], rates: [], facts: [], destination: "US", asOf: "2026-08-13" });
  const providers = plan.spend.map((o) => o.provider);
  expect(providers).not.toContain("A 286-41213");
  expect(providers).not.toContain("D 128-83091");
  // And nothing digit-shaped may end up in what we would send out.
  expect(plan.unknownProviders.some((p) => /\d{4}/.test(p))).toBe(false);
});

test("one row per PROVIDER, not per account — two ING accounts are one product", () => {
  const plan = planTravel({ accounts: REAL_WORLD, txs: [], rates: [], facts: [], destination: "US", asOf: "2026-08-13" });
  expect(plan.spend.map((o) => o.provider).sort()).toEqual(["ABN AMRO betaalpas", "American Express creditcard", "ING betaalpas"]);
  expect(plan.spend.find((o) => o.provider === "ING betaalpas")!.accounts).toHaveLength(2);
});

test("accounts whose bank is unknown are counted, not silently dropped", () => {
  const plan = planTravel({ accounts: REAL_WORLD, txs: [], rates: [], facts: [], destination: "US", asOf: "2026-08-13" });
  expect(plan.unidentifiedCount).toBe(2); // the two stale savings rows
});

test("savings and investment accounts are not something you pay with abroad", () => {
  const accounts = [
    acc({ key: "s", bank: "BigBank", type: "Spaarrekening" }),
    acc({ key: "b", bank: "Trading 212", type: "Beleggingsrekening" }),
    acc({ key: "c", bank: "Revolut", type: "Betaalrekening" }),
  ];
  const plan = planTravel({ accounts, txs: [], rates: [], facts: [], destination: "US", asOf: "2026-08-13" });
  expect(plan.spend.map((o) => o.provider)).toEqual(["Revolut betaalpas"]);
});

test("the savings advice names an account even when it has no bank (display, not provider)", () => {
  const accounts = [acc({ key: "A28641213", bank: "", name: "A 286-41213", type: "Spaarrekening", balance: 20000, interestRate: 1.0 })];
  const rates = [{ bank: "BigBank", product: "Spaarrekening", ratePct: 3.1, freeWithdrawal: true }];
  const plan = planTravel({ accounts, txs: [], rates, facts: [], destination: "US", asOf: "2026-08-13" });
  expect(plan.store.note).toContain("A 286-41213"); // no dangling "op  —"
  expect(plan.store.note).not.toMatch(/op\s+—/);
  // ...and it is still never offered as a provider to look up.
  expect(plan.unknownProviders).toEqual([]);
});

test("a spend option carries where its fee came from, so the owner can judge it", () => {
  const facts = upsertFacts([], [
    fact("Trading 212 creditcard", "fxFeePct", "0", "agent"),
    makeFact({ agent: TRAVEL_AGENT, subject: "ING betaalpas", key: "fxFeePct", value: "1.4", source: "user", updatedAt: "2026-08-13", note: "zelf nagekeken" }),
  ]);
  const ranked = rankSpendOptions(CARDS, facts);
  const t212 = ranked.find((o) => o.provider === "Trading 212 creditcard")!;
  const ing = ranked.find((o) => o.provider === "ING betaalpas")!;
  expect(t212.feeSource).toBe("agent");
  expect(t212.feeUpdatedAt).toBe("2026-08-13");
  expect(ing.feeSource).toBe("user"); // shown as "door jou ingesteld"
  expect(ing.note).toBe("zelf nagekeken");
  // Unknown terms carry no provenance to display.
  expect(ranked.find((o) => o.provider === "American Express creditcard")!.feeSource).toBeNull();
});

test("a debit card and a credit card at the SAME bank are separate products", () => {
  // The real bug: ING's betaalpas charges 1.4% while ABN's creditcard charges
  // 2%, so ranking by bank crowned ING while ABN's own debit card (~1%) was
  // cheaper still. Terms belong to the product, not the brand.
  const accounts = [
    acc({ key: "ing-pas", bank: "ING", type: "Betaalrekening" }),
    acc({ key: "ing-cc", bank: "ING", type: "Creditcard" }),
    acc({ key: "abn-pas", bank: "ABN AMRO", type: "Betaalrekening" }),
  ];
  const facts = upsertFacts([], [
    fact("ING betaalpas", "fxFeePct", "1.4"),
    fact("ING creditcard", "fxFeePct", "2"),
    fact("ABN AMRO betaalpas", "fxFeePct", "1"),
  ]);
  const ranked = rankSpendOptions(accounts, facts);
  expect(ranked.map((o) => o.provider)).toEqual(["ABN AMRO betaalpas", "ING betaalpas", "ING creditcard"]);
  expect(ranked[0].fxFeePct).toBe(1); // the cheapest product wins, not the cheapest bank
});

test("points are shown but never priced into the ranking", () => {
  const accounts = [
    acc({ key: "amex", bank: "American Express", type: "Creditcard" }),
    acc({ key: "ing", bank: "ING", type: "Betaalrekening" }),
  ];
  const facts = upsertFacts([], [
    fact("American Express creditcard", "fxFeePct", "2.5"),
    fact("American Express creditcard", "pointsPerEuro", "1"),
    fact("ING betaalpas", "fxFeePct", "1.4"),
  ]);
  const plan = planTravel({ accounts, txs: [], rates: [], facts, destination: "US", asOf: "2026-08-15" });
  // Cash still decides the order — a point has no honest euro value.
  expect(plan.spend[0].provider).toBe("ING betaalpas");
  expect(plan.spend[0].netCostPct).toBe(1.4);
  expect(plan.spend.find((o) => o.provider === "American Express creditcard")!.netCostPct).toBe(2.5);
  // ...but the trade-off is stated instead of buried.
  expect(plan.spendNote).toContain("1.10% meer");
  expect(plan.spendNote).toContain("1 punt per euro");
});

test("no points note when the cheapest card is also the one earning points", () => {
  const accounts = [acc({ key: "amex", bank: "American Express", type: "Creditcard" })];
  const facts = upsertFacts([], [
    fact("American Express creditcard", "fxFeePct", "0"),
    fact("American Express creditcard", "pointsPerEuro", "1"),
  ]);
  expect(planTravel({ accounts, txs: [], rates: [], facts, destination: "US", asOf: "2026-08-15" }).spendNote).toBeNull();
});

/* --- Journeys: the whole route priced, not just the card. Ranking cards alone
 * priced only the last leg, so "move it first" always looked free. --- */

const ROUTE_ACCOUNTS = [
  acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 4000 }),
  acc({ key: "rev", bank: "Revolut", type: "Betaalrekening", balance: 100 }),
];

const ROUTE_FACTS = upsertFacts([], [
  fact("ING betaalpas", "fxFeePct", "1.4"),
  fact("Revolut betaalpas", "fxFeePct", "0.5"), // paying direct still carries a surcharge
  fact("Revolut betaalpas", "convertFeePct", "0"), // converting inside the app is free
  fact("Revolut betaalpas", "transferFreeViaIdeal", "1"),
]);

test("rankJourneys prices the transfer and conversion legs, which can change the winner", () => {
  const js = rankJourneys(ROUTE_ACCOUNTS, ROUTE_FACTS);
  const best = js[0];

  expect(best.via).toBe("Revolut betaalpas"); // moving first wins
  expect(best.fundedFrom).toBe("ING"); // out of the fullest account at another bank
  expect(best.method).toBe("iDEAL");
  expect(best.totalCostPct).toBe(0);
  expect(best.costOnReference).toBe(0);

  // ...and it beats paying straight from that same card, which is the comparison
  // the old card-only ranking could not make.
  const revDirect = js.find((j) => j.provider === "Revolut betaalpas" && j.via === null);
  expect(revDirect?.totalCostPct).toBe(0.5);
  expect(revDirect?.costOnReference).toBe(5);

  const ingDirect = js.find((j) => j.provider === "ING betaalpas" && j.via === null);
  expect(ingDirect?.costOnReference).toBe(14);
});

test("a journey with any unknown leg is unknown as a whole and ranks last", () => {
  // Revolut's conversion cost is deliberately absent.
  const facts = upsertFacts([], [
    fact("ING betaalpas", "fxFeePct", "1.4"),
    fact("Revolut betaalpas", "fxFeePct", "0"),
    fact("Revolut betaalpas", "transferFreeViaIdeal", "1"),
  ]);
  const js = rankJourneys(ROUTE_ACCOUNTS, facts);
  const via = js.find((j) => j.via !== null && j.provider === "Revolut betaalpas");

  expect(via?.known).toBe(false);
  expect(via?.totalCostPct).toBeNull(); // never assumed free
  expect(js.findIndex((j) => j === via)).toBeGreaterThan(js.findIndex((j) => j.known));
});

test("an unknown transfer cost is not treated as free either", () => {
  const facts = upsertFacts([], [
    fact("Revolut betaalpas", "fxFeePct", "0"),
    fact("Revolut betaalpas", "convertFeePct", "0"),
    // transferFreeViaIdeal deliberately absent
  ]);
  const js = rankJourneys(ROUTE_ACCOUNTS, facts);
  const via = js.find((j) => j.via !== null && j.provider === "Revolut betaalpas");

  expect(via?.transferPct).toBeNull();
  expect(via?.known).toBe(false);
  expect(via?.method).toBeNull();
});

test("journeyHeadline states the winner and what it saves, in euros", () => {
  const js = rankJourneys(ROUTE_ACCOUNTS, ROUTE_FACTS);
  const line = journeyHeadline(js, "USD");

  expect(line).toContain("van ING naar Revolut betaalpas");
  expect(line).toContain("iDEAL");
  expect(line).toContain("€ 5,00 goedkoper");
});

test("journeyHeadline says nothing to convert for a euro destination, and asks for a refresh when nothing is known", () => {
  expect(journeyHeadline([], "EUR")).toContain("euro");
  expect(journeyHeadline(rankJourneys(ROUTE_ACCOUNTS, []), "USD")).toContain("ververs");
});

test("planTravel carries the priced journeys and leads with one sentence", () => {
  const plan = planTravel({ accounts: ROUTE_ACCOUNTS, txs: [], rates: [], facts: ROUTE_FACTS, destination: "US", asOf: "2026-08-16" });
  expect(plan.journeys.length).toBeGreaterThan(0);
  expect(plan.journeys[0].totalCostPct).toBe(0);
  expect(plan.headline).toContain("Revolut");

  // A euro destination has nothing to rank.
  const es = planTravel({ accounts: ROUTE_ACCOUNTS, txs: [], rates: [], facts: ROUTE_FACTS, destination: "ES", asOf: "2026-08-16" });
  expect(es.journeys).toEqual([]);
  expect(es.headline).toContain("euro");
});

test("the winning journey carries the provider's caveat, so a capped rate cannot read as absolute", () => {
  // Revolut converts at 0% up to EUR 1.000 a month and 1% above it. Reported as
  // a bare 0% it made LaVega rank it first and say "dat kost je niets".
  const facts = upsertFacts([], [
    { ...fact("Revolut betaalpas", "fxFeePct", "0"),
      note: "0% tot € 1.000 per maand, daarna 1% fair-usage." },
    fact("ING betaalpas", "fxFeePct", "1.4"),
  ]);
  const js = rankJourneys(ROUTE_ACCOUNTS, facts);
  const winner = js.find((j) => j.known);

  expect(winner?.provider).toBe("Revolut betaalpas");
  expect(winner?.note).toContain("tot € 1.000 per maand");
});

/* ─────────────────────────────────────────── CASH, not just cards
 *
 * App review, 20 August, item 6: "Also include taking money, physical cash.
 * Which card can you take out money?" Every tariff document we hold prices a
 * withdrawal as its own row and almost always worse than a payment, and those
 * rows are already sitting in the catalogue's `conditions` text. The fixtures
 * below are VERBATIM excerpts from docs/catalog/catalog.json — a parser tested
 * against invented Dutch would prove nothing about the file it has to read. */

const CAT_ING_BETAALPAS: CatalogueEntryLike = {
  id: "ing-betaalpas",
  product: "ING betaalpas",
  issuer: "ING Bank N.V.",
  kind: "betaalpas",
  fields: {
    fxFeePct: {
      value: 1.4, route: "agent", sourceUrl: "https://assets.ing.com/kosten.pdf", checkedAt: "2026-06-15",
      conditionsKnown: true,
      conditions: "Geldt bij betalen met de Betaalpas in het buitenland in vreemde valuta (betalingen in euro's € 0,00); bij geldopname in vreemde valuta geldt een apart tarief (€ 3,50 + 1,40%).",
    },
  },
};

const CAT_ING_CREDITCARD: CatalogueEntryLike = {
  id: "ing-creditcard",
  product: "ING creditcard",
  issuer: "ING Bank N.V.",
  kind: "creditcard",
  fields: {
    fxFeePct: {
      value: 2, route: "agent", sourceUrl: "https://assets.ing.com/kosten.pdf", checkedAt: "2026-06-15",
      conditionsKnown: true,
      conditions: "Geldt bij betalen met een creditcard in vreemde valuta. Bij geldopnemen met de creditcard in vreemde valuta geldt een andere prijs: 4,00% van het opgenomen bedrag met minimum € 4,50 + 2,00% koersopslag.",
    },
  },
};

const CAT_ING_PLATINUM: CatalogueEntryLike = {
  id: "ing-platinumcard",
  product: "ING PlatinumCard",
  issuer: "ING Bank N.V.",
  kind: "creditcard",
  fields: {
    fxFeePct: {
      value: 0, route: "agent", sourceUrl: "https://www.ing.nl/platinum", checkedAt: "2026-06-15",
      conditionsKnown: true,
      conditions: "0% koersopslag voor transacties tot € 1.000 per maandelijkse incassoperiode, daarna 2,00% koersopslag per transactie",
    },
  },
};

const CAT_ABN_CREDITCARD: CatalogueEntryLike = {
  id: "abn-amro-creditcard",
  product: "ABN AMRO creditcard",
  issuer: "ABN AMRO Bank N.V.",
  kind: "creditcard",
  fields: {
    fxFeePct: {
      value: 2, route: "provider-pdf", sourceUrl: "https://abnamro.nl/voorwaarden.pdf", checkedAt: "2026-05-01",
      conditionsKnown: true,
      conditions: "Geldt voor betalingen en geldopnames in vreemde valuta, omgerekend door Mastercard. Voor geldopnames gelden daarnaast aparte transactiekosten (1% met maximum € 1,50 uit positief saldo, anders 4%).",
    },
  },
};

const CAT_ABN_GOLD: CatalogueEntryLike = {
  id: "abn-amro-gold-card",
  product: "ABN AMRO Gold Card",
  issuer: "ABN AMRO Bank N.V.",
  kind: "creditcard",
  fields: {
    fxFeePct: {
      value: 2, route: "provider-pdf", sourceUrl: "https://abnamro.nl/gold.pdf", checkedAt: "2026-05-01",
      conditionsKnown: true,
      conditions: "de opslag is 2%. Voor geldopnames brengen wij daarnaast aparte kosten in rekening (artikel 13.3).",
    },
  },
};

const CAT_212: CatalogueEntryLike = {
  id: "212-card",
  product: "212 Card",
  issuer: "Paynetics (card issuer); NL customers under Trading 212 Markets Ltd",
  kind: "betaalpas",
  fields: {
    fxFeePct: {
      value: 0, route: "provider-page", sourceUrl: "https://trading212.com/card", checkedAt: "2026-08-01",
      conditionsKnown: true,
      conditions: "Geen wisselkoersopslag op kaartbetalingen in vreemde valuta.",
    },
  },
};

const CAT_REVOLUT: CatalogueEntryLike = {
  id: "revolut-standard-betaalpas",
  product: "Revolut Standard betaalpas",
  issuer: "Revolut Bank UAB (Lithuania), in NL via passport/branch",
  kind: "betaalpas",
  fields: {
    fxFeePct: {
      value: 1, route: "provider-page", sourceUrl: "https://revolut.com/fees", checkedAt: "2026-08-01",
      conditionsKnown: true,
      conditions: "1% opslag buiten de maandelijkse vrije ruimte op het Standard-plan.",
    },
  },
};

const CAT_CRYPTO_OBSIDIAN: CatalogueEntryLike = {
  id: "crypto-com-prepaid-card-private-obsidian",
  product: "Crypto.com Prepaid Card — Private (Obsidian)",
  issuer: "Crypto.com (EEA entity; prepaid Visa)",
  kind: "prepaid",
  fields: {
    fxFeePct: {
      value: 0, route: "provider-page", sourceUrl: "https://crypto.com/cards", checkedAt: "2026-08-01",
      conditionsKnown: true,
      conditions: "No fee on non-EUR purchases. ATM Withdrawal: 2% on amounts above the monthly free ATM limit.",
    },
    cashbackPct: {
      value: 5, route: "provider-page", sourceUrl: "https://crypto.com/cards", checkedAt: "2026-08-01",
      conditionsKnown: true,
      conditions: "TIER GATE: crypto.com/nl/cards prices Obsidian at '€450,000 12-month CRO staking'. Paid in CRO to the Token Wallet, not euro.",
    },
  },
};

/** A figure the catalogue recorded but could not qualify. It must never reach a
 *  comparison — that is the whole reason `isCovered` exists. */
const CAT_UNCOVERED: CatalogueEntryLike = {
  id: "mystery-card",
  product: "Mystery Card",
  issuer: "Mystery Bank N.V.",
  kind: "creditcard",
  fields: {
    fxFeePct: {
      value: 0, route: "agent", sourceUrl: "https://example.org/mystery", checkedAt: "2026-08-01",
      conditionsKnown: false, conditions: null,
    },
  },
};

const CATALOGUE = [
  CAT_ING_BETAALPAS, CAT_ING_CREDITCARD, CAT_ING_PLATINUM, CAT_ABN_CREDITCARD,
  CAT_ABN_GOLD, CAT_212, CAT_REVOLUT, CAT_CRYPTO_OBSIDIAN, CAT_UNCOVERED,
];

test("a withdrawal priced as a percentage PLUS a fixed fee is read in either order", () => {
  const ing = parseWithdrawalFee("bij geldopname in vreemde valuta geldt een apart tarief (€ 3,50 + 1,40%)");
  expect(ing.known).toBe(true);
  expect(ing.components).toEqual([{ kind: "fixed", eur: 3.5 }, { kind: "pct", pct: 1.4, minEur: null }]);

  // SNS writes the same two components the other way round.
  const sns = parseWithdrawalFee("Contant geld opnemen met de betaalpas in vreemde valuta is een apart tarief (1,4% + € 3,50 per opname)");
  expect(sns.known).toBe(true);
  expect(sns.components).toEqual([{ kind: "pct", pct: 1.4, minEur: null }, { kind: "fixed", eur: 3.5 }]);
});

test("a minimum attaches to the percentage it qualifies, and two percentages stack", () => {
  const fee = parseWithdrawalFee(CAT_ING_CREDITCARD.fields!.fxFeePct!.conditions);
  expect(fee.components).toEqual([
    { kind: "pct", pct: 4, minEur: 4.5 },
    { kind: "pct", pct: 2, minEur: null },
  ]);
  // € 200: 4% is € 8, above the € 4,50 floor, plus 2% = € 12 — 6%.
  expect(withdrawalCost(fee, 200)).toBe(12);
  // € 50: 4% is € 2, so the floor bites — € 4,50 + € 1 = € 5,50, which is 11%.
  expect(withdrawalCost(fee, 50)).toBe(5.5);
  expect(withdrawalEffectivePct(fee, 50)).toBe(11);
});

test("a fixed fee per withdrawal makes a small withdrawal far worse, and the numbers say so", () => {
  const fee = parseWithdrawalFee("geldopname: € 3,50 + 1,40%");
  expect(withdrawalCost(fee, 50)).toBe(4.2);
  expect(withdrawalEffectivePct(fee, 50)).toBe(8.4); // a € 3,50 flat fee on € 50 is brutal
  expect(withdrawalEffectivePct(fee, 500)).toBe(2.1);
});

test("a tiered or capped withdrawal row is refused, and the refusal names the real cause", () => {
  const abn = parseWithdrawalFee(CAT_ABN_CREDITCARD.fields!.fxFeePct!.conditions);
  expect(abn.known).toBe(false);
  expect(abn.components).toEqual([]);
  expect(abn.why).toMatch(/staffel|vrijstelling|voorwaarde/i);
  // The sentence we refused is kept, so he can read it himself and correct us.
  expect(abn.quoted).toContain("aparte transactiekosten");
});

test("a cross-reference with no figure in it is unknown, not free", () => {
  const gold = parseWithdrawalFee(CAT_ABN_GOLD.fields!.fxFeePct!.conditions);
  expect(gold.known).toBe(false);
  expect(gold.why).toMatch(/artikel|aparte/i);
  expect(withdrawalCost(gold, 200)).toBeNull();
});

test("a source that says nothing about cash is unknown, and says that much", () => {
  const t212 = parseWithdrawalFee(CAT_212.fields!.fxFeePct!.conditions);
  expect(t212.known).toBe(false);
  expect(t212.quoted).toBeNull();
  expect(t212.why).toMatch(/niets|geen/i);
  expect(parseWithdrawalFee(null).known).toBe(false);
});

test("rankWithdrawOptions prices his own cards for cash, cheapest first, unknown last", () => {
  const accounts = [
    acc({ key: "ingp", bank: "ING", type: "Betaalrekening", balance: 4000 }),
    acc({ key: "ingc", bank: "ING", type: "Creditcard" }),
    acc({ key: "t212", bank: "Trading 212", type: "Betaalrekening" }),
  ];
  const facts = upsertFacts([], [
    fact("ING betaalpas", "fxFeePct", "1.4"),
    fact("ING creditcard", "fxFeePct", "2"), // narrows ING's two creditcards to the plain one
    fact("Trading 212 betaalpas", "fxFeePct", "0"),
  ]);
  const ranked = rankWithdrawOptions(rankSpendOptions(accounts, facts), CATALOGUE);

  expect(ranked.map((o) => o.provider)).toEqual(["ING betaalpas", "ING creditcard", "Trading 212 betaalpas"]);
  expect(ranked[0].costOnReference).toBe(6.3); // € 3,50 + 1,4% of € 200
  expect(ranked[1].costOnReference).toBe(12);
  expect(ranked[2].fee.known).toBe(false); // Trading 212's page prices no withdrawal
  expect(ranked[2].costOnReference).toBeNull();
  // A card the catalogue does not name at all cannot be priced either.
  expect(ranked[0].sourceUrl).toContain("ing.com");
});

test("two catalogue products for one card are only separated by a fee we already hold", () => {
  const accounts = [acc({ key: "ingc", bank: "ING", type: "Creditcard" })];
  // Without a known surcharge, ING's creditcard and PlatinumCard are both
  // candidates and they disagree — so the answer is "which one do you have",
  // not the cheaper of the two.
  const blind = rankWithdrawOptions(rankSpendOptions(accounts, []), CATALOGUE);
  expect(blind[0].fee.known).toBe(false);
  expect(blind[0].fee.why).toMatch(/meer dan één|welke/i);
});

test("marketCardOffers ranks the whole catalogue and never includes an uncovered figure", () => {
  const offers = marketCardOffers(CATALOGUE, []);
  expect(offers.some((o) => o.productId === "mystery-card")).toBe(false);
  expect(offers.every((o) => !o.held)).toBe(true);

  // ING's PlatinumCard is also 0%, but only up to € 1.000 a month and 2% after
  // that. A conditional zero must not outrank an unconditional one — that is
  // the Revolut mistake, and this is the rule that prevents it.
  expect(offers[0].productId).toBe("212-card");
  expect(offers[0].conditional).toBe(false);
  const platinum = offers.find((o) => o.productId === "ing-platinumcard");
  expect(platinum?.conditional).toBe(true);
  expect(platinum?.capNote).toContain("€ 1.000");
});

test("a card he already holds is marked as held, so it is never offered as a switch", () => {
  const offers = marketCardOffers(CATALOGUE, [{ provider: "Revolut betaalpas", fxFeePct: 1 }]);
  const rev = offers.find((o) => o.productId === "revolut-standard-betaalpas");
  expect(rev?.held).toBe(true);
  expect(offers.find((o) => o.productId === "212-card")?.held).toBe(false);
});

test("cashback is carried but never priced into the ranking, and names its gate", () => {
  const offers = marketCardOffers(CATALOGUE, []);
  const obsidian = offers.find((o) => o.productId === "crypto-com-prepaid-card-private-obsidian");
  expect(obsidian?.cashbackPct).toBe(5);
  // 5% cashback minus a 0% surcharge would crown it; it is paid in CRO behind a
  // €450.000 stake, so the ranking stays on the surcharge alone.
  expect(obsidian?.netCostPct).toBe(0);
  expect(obsidian?.cashbackNote).toMatch(/crypto/i);
  expect(obsidian?.cashbackNote).toMatch(/stak|inleg|vastge/i);
});

test("planTravel answers 'what could I switch to' beside 'what should I pay with today'", () => {
  const accounts = [
    acc({ key: "rev", bank: "Revolut", type: "Betaalrekening", balance: 500 }),
    acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 4000 }),
  ];
  const facts = upsertFacts([], [
    fact("Revolut betaalpas", "fxFeePct", "1"),
    fact("ING betaalpas", "fxFeePct", "1.4"),
  ]);
  const plan = planTravel({
    accounts, txs: [], rates: [], facts, destination: "US", asOf: "2026-08-20", catalogue: CATALOGUE,
  });

  // What he holds still decides the answer he can act on today.
  expect(plan.spend[0].provider).toBe("Revolut betaalpas");
  // And the catalogue answers the other question, kept separate.
  expect(plan.switchGain?.best.productId).toBe("212-card");
  expect(plan.switchGain?.savingCents).toBe(1000); // 1% of € 1.000
  expect(plan.offers.some((o) => o.productId === "212-card")).toBe(true);
  expect(plan.offers.some((o) => o.held)).toBe(false);
  expect(plan.withdraw.length).toBe(2);
});

test("without a catalogue nothing is invented — no offers, no switch, no cash price", () => {
  const accounts = [acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 4000 })];
  const facts = upsertFacts([], [fact("ING betaalpas", "fxFeePct", "1.4")]);
  const plan = planTravel({ accounts, txs: [], rates: [], facts, destination: "US", asOf: "2026-08-20" });
  expect(plan.offers).toEqual([]);
  expect(plan.switchGain).toBeNull();
  expect(plan.withdraw[0].fee.known).toBe(false);
});

test("a figure whose document prices withdrawal differently elsewhere carries that caveat", () => {
  // Crypto.com's real conditions, verbatim: the ATM row is 0,2% inside the EU
  // and the clause that tiers it never says "ATM" again — so a cash-only scan
  // would have shown 0,2% bare to someone flying outside the EU.
  const fee = parseWithdrawalFee(
    'Effective 1 October 2026, Ruby tier: non-EUR purchases and ATM transactions within the EU & UK 0.2%; outside the EU & UK no fee up to EUR 400 per calendar month, 2.0% thereafter',
  );
  expect(fee.known).toBe(true);
  expect(fee.components).toEqual([{ kind: "pct", pct: 0.2, minEur: null }]);
  expect(fee.caveat).toMatch(/limiet|regio|vrije ruimte/i);
});

test("a decimal point is not a thousands separator — 1.7% is not 17%", () => {
  // N26 prices a foreign-currency ATM withdrawal at "1.7% of amount drawn".
  // Read as 17% it priced a € 200 withdrawal at € 68.
  const fee = parseWithdrawalFee(
    "Cash withdrawal in a foreign currency is NOT free on this plan: 'Mastercard withdrawals at ATMs in other currencies: 1.7% of amount drawn'",
  );
  expect(fee.components).toEqual([{ kind: "pct", pct: 1.7, minEur: null }]);
  expect(withdrawalCost(fee, 200)).toBe(3.4);
});

test("the same figure quoted twice in one row is one charge, not two", () => {
  const fee = parseWithdrawalFee(
    "foreign-currency ATM withdrawals cost 1.7% on Smart: 'For Business, Current Account, N26 Smart 1.7% of amount drawn'",
  );
  expect(fee.components).toEqual([{ kind: "pct", pct: 1.7, minEur: null }]);
  // Genuinely stacked charges differ from each other, so they still both count.
  const stacked = parseWithdrawalFee("Opname van contant geld in vreemde valuta 4% van opgenomen bedrag + 2% wisselkoersopslag");
  expect(stacked.components).toHaveLength(2);
});

test("withdrawalHeadline leads with the euros and warns about small withdrawals", () => {
  const accounts = [acc({ key: "ingp", bank: "ING", type: "Betaalrekening", balance: 4000 })];
  const facts = upsertFacts([], [fact("ING betaalpas", "fxFeePct", "1.4")]);
  const line = withdrawalHeadline(rankWithdrawOptions(rankSpendOptions(accounts, facts), CATALOGUE), "USD");

  expect(line).toContain("ING betaalpas");
  expect(line).toContain("€ 6,30");
  expect(line).toContain("8,4%"); // what € 50 costs, because of the € 3,50 flat fee
  expect(line).toContain("in één keer meer");
});

test("with no cash price anywhere the headline says that, and never says free", () => {
  const accounts = [acc({ key: "t212", bank: "Trading 212", type: "Betaalrekening" })];
  const facts = upsertFacts([], [fact("Trading 212 betaalpas", "fxFeePct", "0")]);
  const line = withdrawalHeadline(rankWithdrawOptions(rankSpendOptions(accounts, facts), CATALOGUE), "USD");
  expect(line).toMatch(/weten we .*niet|weten we wat|onbekend/i);
  expect(line).not.toMatch(/gratis|kost je niets/i);
});

test("a card is matched by its product name too, because the issuer is often a different company", () => {
  // ING's own creditcard is issued by International Card Services. Matching on
  // the issuer alone found ING's debit card and missed both of its credit
  // cards — the same mismatch the review reports for the savings table.
  const ics: CatalogueEntryLike = {
    id: "ing-creditcard", product: "ING creditcard", issuer: "International Card Services (ICS)", kind: "creditcard",
    fields: {
      fxFeePct: {
        value: 2, route: "provider-pdf", sourceUrl: "https://ing.nl/tarieven.pdf", checkedAt: "2026-06-15",
        conditionsKnown: true,
        conditions: "Bij geldopnemen met de creditcard in vreemde valuta: 4,00% van het opgenomen bedrag met minimum € 4,50 + 2,00% koersopslag.",
      },
    },
  };
  expect(catalogueCandidates([ics], "ING creditcard").map((e) => e.id)).toEqual(["ing-creditcard"]);

  const accounts = [acc({ key: "c", bank: "ING", type: "Creditcard" })];
  const facts = upsertFacts([], [fact("ING creditcard", "fxFeePct", "2")]);
  const ranked = rankWithdrawOptions(rankSpendOptions(accounts, facts), [ics]);
  expect(ranked[0].costOnReference).toBe(12);
});

test("one row per issuer, so four N26 plans are not four near-identical answers", () => {
  const plan = (id: string, value: number): CatalogueEntryLike => ({
    id, product: `N26 ${id} betaalpas`, issuer: "N26 Bank AG (Germany); Mastercard Debit", kind: "betaalpas",
    fields: {
      fxFeePct: {
        value, route: "provider-pdf", sourceUrl: "https://n26.com/prices", checkedAt: "2026-08-01",
        conditionsKnown: true, conditions: "0% op kaartbetalingen.",
      },
    },
  });
  const collapsed = cheapestPerIssuer(marketCardOffers([plan("go", 0), plan("metal", 0), plan("smart", 0.5)], []));
  expect(collapsed).toHaveLength(1);
  expect(collapsed[0].productId).toBe("go"); // the cheapest, and stable between renders
});

test("in euroland the cash advice is withdrawn, not repeated — those tariffs are for foreign currency", () => {
  const accounts = [acc({ key: "ingp", bank: "ING", type: "Betaalrekening", balance: 4000 })];
  const facts = upsertFacts([], [fact("ING betaalpas", "fxFeePct", "1.4")]);
  const es = planTravel({ accounts, txs: [], rates: [], facts, destination: "ES", asOf: "2026-08-20", catalogue: CATALOGUE });

  expect(es.withdraw).toEqual([]);
  expect(es.withdrawHeadline).toContain("euro");
  expect(es.withdrawHeadline).not.toContain("€ 6,30"); // ING's foreign-currency price does not apply here
});

/* EEN GRATIS OPNAME IS EEN BEKENDE PRIJS, GEEN ONTBREKENDE.
 *
 * N26 Go en Metal zeggen in woorden dat opnemen in vreemde valuta gratis is, en de
 * parser zocht een cijfer — dus vielen ze door naar "de bron noemt opnemen wel,
 * maar zonder tarief" en uit een ranking die ze met 0% winnen. Dezelfde fout als
 * een cashback van "No fee" als onbekend lezen: een percentagetest is het
 * verkeerde instrument voor een uitgesproken nul.
 */
describe("parseWithdrawalFee: gratis", () => {
  test("een uitgesproken gratis opname kost 0 en is bekend", () => {
    const f = parseWithdrawalFee("Go krijgt geldopnames in vreemde valuta gratis.");
    expect(f.known).toBe(true);
    expect(withdrawalCost(f, 100)).toBe(0);
    expect(withdrawalEffectivePct(f, 100)).toBe(0);
  });

  test("Engels net zo goed — de catalogus bevat beide talen", () => {
    expect(parseWithdrawalFee("Foreign-currency ATM withdrawals are free for these plans.").known).toBe(true);
  });

  test("GRATIS MET EEN VRIJE RUIMTE IS NIET GRATIS en blijft onbekend", () => {
    // Zeal: vijf opnames of € 200 per maand vrij, daarna betalen. De prijs hangt af
    // van hoeveel hij opneemt, dus een 0 zou een bedrag beloven dat niet klopt.
    for (const row of [
      "You can make up to 5 free ATM withdrawals per month or withdraw up to 200 EUR free.",
      "ATM Withdrawal Fee 2% (after the first 100 EUR monthly).",
      "Free ATM limit (Monthly) is € 800 — above that, ATM Withdrawal 2%.",
    ]) {
      expect(parseWithdrawalFee(row).known).toBe(false);
    }
  });

  test("een geprijsde regel wint nog steeds van het woord gratis in dezelfde tekst", () => {
    // "Betalen gratis, opnemen € 3,50 + 1,4%" mag geen 0 worden omdat het woord
    // gratis erin staat.
    const f = parseWithdrawalFee("Betalen is gratis; bij geldopname in vreemde valuta geldt € 3,50 + 1,40%.");
    expect(f.known).toBe(true);
    expect(withdrawalEffectivePct(f, 100)).toBe(4.9);
  });
});
