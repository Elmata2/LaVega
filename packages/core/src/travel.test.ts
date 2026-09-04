import { describe, expect, test } from "vitest";
import type { Account } from "./model.js";
import {
  countryCurrency,
  rankSpendOptions,
  rankJourneys,
  journeyHeadline,
  planTravel,
  TRAVEL_AGENT,
  parseWithdrawalFee,
  withdrawalCost,
  withdrawalEffectivePct,
  rankWithdrawOptions,
  marketCardOffers,
  withdrawalHeadline,
  catalogueCandidates,
  cheapestPerIssuer,
  bestPayAdvice,
  payHeadline,
  marketWithdrawOptions,
  bestWithdrawAdvice,
  compareCardOffers,
  offerSwitchGain,
  TRAVEL_TRIP_MONTHS,
} from "./travel.js";
import { describeNetBenefit } from "./netBenefit.js";
import type { CatalogueEntryLike } from "./catalogRates.js";
import { makeFact, upsertFacts } from "./facts.js";
import type { LearnedFact } from "./facts.js";

function acc(over: Partial<Account>): Account {
  return {
    key: "k",
    iban: "",
    name: "Rekening",
    bank: "ING",
    entity: "Prive",
    currency: "EUR",
    balance: null,
    ...over,
  };
}

const fact = (
  subject: string,
  key: string,
  value: string,
  source: "agent" | "user" = "agent",
): LearnedFact =>
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
  const facts = upsertFacts(
    [],
    [
      fact("Trading 212 creditcard", "fxFeePct", "0"),
      fact("Trading 212 creditcard", "cashbackPct", "1"), // net -1% — pays you to use it
      fact("ING betaalpas", "fxFeePct", "1.2"),
      // American Express deliberately unknown
    ],
  );
  const ranked = rankSpendOptions(CARDS, facts);
  expect(ranked.map((o) => o.provider)).toEqual([
    "Trading 212 creditcard",
    "ING betaalpas",
    "American Express creditcard",
  ]);
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
  const facts = upsertFacts(
    [],
    [
      fact("Trading 212 creditcard", "fxFeePct", "0"),
      fact("Trading 212 creditcard", "cashbackPct", "1"),
      fact("Trading 212 creditcard", "transferFreeViaIdeal", "1"),
      fact("ING betaalpas", "fxFeePct", "1.2"),
    ],
  );
  const plan = planTravel({
    accounts: CARDS,
    txs: [],
    rates: [],
    facts,
    destination: "US",
    asOf: "2026-08-13",
  });

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
  const plan = planTravel({
    accounts: CARDS,
    txs: [],
    rates: [],
    facts,
    destination: "ES",
    asOf: "2026-08-13",
  });
  expect(plan.currency).toBe("EUR");
  expect(plan.convert.method).toBeNull();
  expect(plan.convert.note).toContain("euro");
});

test("planTravel says what it needs when no card terms are known yet", () => {
  const plan = planTravel({
    accounts: CARDS,
    txs: [],
    rates: [],
    facts: [],
    destination: "US",
    asOf: "2026-08-13",
  });
  expect(plan.spend.every((o) => !o.known)).toBe(true);
  expect(plan.convert.note).toContain("ververs");
  expect(plan.unknownProviders.sort()).toEqual([
    "American Express creditcard",
    "ING betaalpas",
    "Trading 212 creditcard",
  ]);
});

test("planTravel surfaces the best place to keep savings", () => {
  const accounts = [
    acc({ key: "spaar", bank: "ING", type: "Spaarrekening", balance: 20000, interestRate: 1.0 }),
  ];
  const rates = [{ bank: "BigBank", product: "Spaarrekening", ratePct: 2.5, freeWithdrawal: true }];
  const plan = planTravel({
    accounts,
    txs: [],
    rates,
    facts: [],
    destination: "US",
    asOf: "2026-08-13",
  });
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
  const plan = planTravel({
    accounts: REAL_WORLD,
    txs: [],
    rates: [],
    facts: [],
    destination: "US",
    asOf: "2026-08-13",
  });
  const providers = plan.spend.map((o) => o.provider);
  expect(providers).not.toContain("A 286-41213");
  expect(providers).not.toContain("D 128-83091");
  // And nothing digit-shaped may end up in what we would send out.
  expect(plan.unknownProviders.some((p) => /\d{4}/.test(p))).toBe(false);
});

test("one row per PROVIDER, not per account — two ING accounts are one product", () => {
  const plan = planTravel({
    accounts: REAL_WORLD,
    txs: [],
    rates: [],
    facts: [],
    destination: "US",
    asOf: "2026-08-13",
  });
  expect(plan.spend.map((o) => o.provider).sort()).toEqual([
    "ABN AMRO betaalpas",
    "American Express creditcard",
    "ING betaalpas",
  ]);
  expect(plan.spend.find((o) => o.provider === "ING betaalpas")!.accounts).toHaveLength(2);
});

test("accounts whose bank is unknown are counted, not silently dropped", () => {
  const plan = planTravel({
    accounts: REAL_WORLD,
    txs: [],
    rates: [],
    facts: [],
    destination: "US",
    asOf: "2026-08-13",
  });
  expect(plan.unidentifiedCount).toBe(2); // the two stale savings rows
});

test("savings and investment accounts are not something you pay with abroad", () => {
  const accounts = [
    acc({ key: "s", bank: "BigBank", type: "Spaarrekening" }),
    acc({ key: "b", bank: "Trading 212", type: "Beleggingsrekening" }),
    acc({ key: "c", bank: "Revolut", type: "Betaalrekening" }),
  ];
  const plan = planTravel({
    accounts,
    txs: [],
    rates: [],
    facts: [],
    destination: "US",
    asOf: "2026-08-13",
  });
  expect(plan.spend.map((o) => o.provider)).toEqual(["Revolut betaalpas"]);
});

test("the savings advice names an account even when it has no bank (display, not provider)", () => {
  const accounts = [
    acc({
      key: "A28641213",
      bank: "",
      name: "A 286-41213",
      type: "Spaarrekening",
      balance: 20000,
      interestRate: 1.0,
    }),
  ];
  const rates = [{ bank: "BigBank", product: "Spaarrekening", ratePct: 3.1, freeWithdrawal: true }];
  const plan = planTravel({
    accounts,
    txs: [],
    rates,
    facts: [],
    destination: "US",
    asOf: "2026-08-13",
  });
  expect(plan.store.note).toContain("A 286-41213"); // no dangling "op  —"
  expect(plan.store.note).not.toMatch(/op\s+—/);
  // ...and it is still never offered as a provider to look up.
  expect(plan.unknownProviders).toEqual([]);
});

test("a spend option carries where its fee came from, so the owner can judge it", () => {
  const facts = upsertFacts(
    [],
    [
      fact("Trading 212 creditcard", "fxFeePct", "0", "agent"),
      makeFact({
        agent: TRAVEL_AGENT,
        subject: "ING betaalpas",
        key: "fxFeePct",
        value: "1.4",
        source: "user",
        updatedAt: "2026-08-13",
        note: "zelf nagekeken",
      }),
    ],
  );
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
  const facts = upsertFacts(
    [],
    [
      fact("ING betaalpas", "fxFeePct", "1.4"),
      fact("ING creditcard", "fxFeePct", "2"),
      fact("ABN AMRO betaalpas", "fxFeePct", "1"),
    ],
  );
  const ranked = rankSpendOptions(accounts, facts);
  expect(ranked.map((o) => o.provider)).toEqual([
    "ABN AMRO betaalpas",
    "ING betaalpas",
    "ING creditcard",
  ]);
  expect(ranked[0].fxFeePct).toBe(1); // the cheapest product wins, not the cheapest bank
});

test("points are shown but never priced into the ranking", () => {
  const accounts = [
    acc({ key: "amex", bank: "American Express", type: "Creditcard" }),
    acc({ key: "ing", bank: "ING", type: "Betaalrekening" }),
  ];
  const facts = upsertFacts(
    [],
    [
      fact("American Express creditcard", "fxFeePct", "2.5"),
      fact("American Express creditcard", "pointsPerEuro", "1"),
      fact("ING betaalpas", "fxFeePct", "1.4"),
    ],
  );
  const plan = planTravel({
    accounts,
    txs: [],
    rates: [],
    facts,
    destination: "US",
    asOf: "2026-08-15",
  });
  // Cash still decides the order — a point has no honest euro value.
  expect(plan.spend[0].provider).toBe("ING betaalpas");
  expect(plan.spend[0].netCostPct).toBe(1.4);
  expect(plan.spend.find((o) => o.provider === "American Express creditcard")!.netCostPct).toBe(
    2.5,
  );
  // ...but the trade-off is stated instead of buried.
  expect(plan.spendNote).toContain("1.10% meer");
  expect(plan.spendNote).toContain("1 punt per euro");
});

test("no points note when the cheapest card is also the one earning points", () => {
  const accounts = [acc({ key: "amex", bank: "American Express", type: "Creditcard" })];
  const facts = upsertFacts(
    [],
    [
      fact("American Express creditcard", "fxFeePct", "0"),
      fact("American Express creditcard", "pointsPerEuro", "1"),
    ],
  );
  expect(
    planTravel({ accounts, txs: [], rates: [], facts, destination: "US", asOf: "2026-08-15" })
      .spendNote,
  ).toBeNull();
});

/* --- Journeys: the whole route priced, not just the card. Ranking cards alone
 * priced only the last leg, so "move it first" always looked free. --- */

const ROUTE_ACCOUNTS = [
  acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 4000 }),
  acc({ key: "rev", bank: "Revolut", type: "Betaalrekening", balance: 100 }),
];

const ROUTE_FACTS = upsertFacts(
  [],
  [
    fact("ING betaalpas", "fxFeePct", "1.4"),
    fact("Revolut betaalpas", "fxFeePct", "0.5"), // paying direct still carries a surcharge
    fact("Revolut betaalpas", "convertFeePct", "0"), // converting inside the app is free
    fact("Revolut betaalpas", "transferFreeViaIdeal", "1"),
  ],
);

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
  const facts = upsertFacts(
    [],
    [
      fact("ING betaalpas", "fxFeePct", "1.4"),
      fact("Revolut betaalpas", "fxFeePct", "0"),
      fact("Revolut betaalpas", "transferFreeViaIdeal", "1"),
    ],
  );
  const js = rankJourneys(ROUTE_ACCOUNTS, facts);
  const via = js.find((j) => j.via !== null && j.provider === "Revolut betaalpas");

  expect(via?.known).toBe(false);
  expect(via?.totalCostPct).toBeNull(); // never assumed free
  expect(js.findIndex((j) => j === via)).toBeGreaterThan(js.findIndex((j) => j.known));
});

test("an unknown transfer cost is not treated as free either", () => {
  const facts = upsertFacts(
    [],
    [
      fact("Revolut betaalpas", "fxFeePct", "0"),
      fact("Revolut betaalpas", "convertFeePct", "0"),
      // transferFreeViaIdeal deliberately absent
    ],
  );
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
  const plan = planTravel({
    accounts: ROUTE_ACCOUNTS,
    txs: [],
    rates: [],
    facts: ROUTE_FACTS,
    destination: "US",
    asOf: "2026-08-16",
  });
  expect(plan.journeys.length).toBeGreaterThan(0);
  expect(plan.journeys[0].totalCostPct).toBe(0);
  expect(plan.headline).toContain("Revolut");

  // A euro destination has nothing to rank.
  const es = planTravel({
    accounts: ROUTE_ACCOUNTS,
    txs: [],
    rates: [],
    facts: ROUTE_FACTS,
    destination: "ES",
    asOf: "2026-08-16",
  });
  expect(es.journeys).toEqual([]);
  expect(es.headline).toContain("euro");
});

test("the winning journey carries the provider's caveat, so a capped rate cannot read as absolute", () => {
  // Revolut converts at 0% up to EUR 1.000 a month and 1% above it. Reported as
  // a bare 0% it made LaVega rank it first and say "dat kost je niets".
  const facts = upsertFacts(
    [],
    [
      {
        ...fact("Revolut betaalpas", "fxFeePct", "0"),
        note: "0% tot € 1.000 per maand, daarna 1% fair-usage.",
      },
      fact("ING betaalpas", "fxFeePct", "1.4"),
    ],
  );
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
      value: 1.4,
      route: "agent",
      sourceUrl: "https://assets.ing.com/kosten.pdf",
      checkedAt: "2026-06-15",
      conditionsKnown: true,
      conditions:
        "Geldt bij betalen met de Betaalpas in het buitenland in vreemde valuta (betalingen in euro's € 0,00); bij geldopname in vreemde valuta geldt een apart tarief (€ 3,50 + 1,40%).",
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
      value: 2,
      route: "agent",
      sourceUrl: "https://assets.ing.com/kosten.pdf",
      checkedAt: "2026-06-15",
      conditionsKnown: true,
      conditions:
        "Geldt bij betalen met een creditcard in vreemde valuta. Bij geldopnemen met de creditcard in vreemde valuta geldt een andere prijs: 4,00% van het opgenomen bedrag met minimum € 4,50 + 2,00% koersopslag.",
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
      value: 0,
      route: "agent",
      sourceUrl: "https://www.ing.nl/platinum",
      checkedAt: "2026-06-15",
      conditionsKnown: true,
      conditions:
        "0% koersopslag voor transacties tot € 1.000 per maandelijkse incassoperiode, daarna 2,00% koersopslag per transactie",
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
      value: 2,
      route: "provider-pdf",
      sourceUrl: "https://abnamro.nl/voorwaarden.pdf",
      checkedAt: "2026-05-01",
      conditionsKnown: true,
      conditions:
        "Geldt voor betalingen en geldopnames in vreemde valuta, omgerekend door Mastercard. Voor geldopnames gelden daarnaast aparte transactiekosten (1% met maximum € 1,50 uit positief saldo, anders 4%).",
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
      value: 2,
      route: "provider-pdf",
      sourceUrl: "https://abnamro.nl/gold.pdf",
      checkedAt: "2026-05-01",
      conditionsKnown: true,
      conditions:
        "de opslag is 2%. Voor geldopnames brengen wij daarnaast aparte kosten in rekening (artikel 13.3).",
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
      value: 0,
      route: "provider-page",
      sourceUrl: "https://trading212.com/card",
      checkedAt: "2026-08-01",
      conditionsKnown: true,
      conditions: "Geen wisselkoersopslag op kaartbetalingen in vreemde valuta.",
    },
  },
};

/** N26 Go, verbatim. The only shape in the catalogue that proves a FREE
 *  foreign-currency withdrawal in words rather than in a numeral — which is
 *  exactly the row the withdrawal advice has to be able to win on. */
const CAT_N26_GO: CatalogueEntryLike = {
  id: "n26-go-betaalpas",
  product: "N26 Go betaalpas",
  issuer: "N26 Bank AG (Germany); Mastercard Debit",
  kind: "betaalpas",
  fields: {
    fxFeePct: {
      value: 0,
      route: "agent",
      sourceUrl: "https://docs.n26.com/legal/13account-pricelist-en.pdf",
      checkedAt: "2026-06-26",
      conditionsKnown: true,
      conditions:
        "WORDING CAVEAT \u2014 the 0 is written as 'Free' / 'without foreign currency surcharge'; no numeral in the row. SCOPE: NL named on the price list's country cover. Unlike Standard/Smart, Go ALSO gets foreign-currency ATM withdrawals free: 'For, N26 Go, N26 Business Go, N26 Metal and N26               Free / Business Metal users'. EUR-ATM fair use on Go is 5 free withdrawals per calendar month, EUR 2.00 each thereafter.",
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
      value: 1,
      route: "provider-page",
      sourceUrl: "https://revolut.com/fees",
      checkedAt: "2026-08-01",
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
      value: 0,
      route: "provider-page",
      sourceUrl: "https://crypto.com/cards",
      checkedAt: "2026-08-01",
      conditionsKnown: true,
      conditions:
        "No fee on non-EUR purchases. ATM Withdrawal: 2% on amounts above the monthly free ATM limit.",
    },
    cashbackPct: {
      value: 5,
      route: "provider-page",
      sourceUrl: "https://crypto.com/cards",
      checkedAt: "2026-08-01",
      conditionsKnown: true,
      conditions:
        "TIER GATE: crypto.com/nl/cards prices Obsidian at '€450,000 12-month CRO staking'. Paid in CRO to the Token Wallet, not euro.",
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
      value: 0,
      route: "agent",
      sourceUrl: "https://example.org/mystery",
      checkedAt: "2026-08-01",
      conditionsKnown: false,
      conditions: null,
    },
  },
};

const CATALOGUE = [
  CAT_ING_BETAALPAS,
  CAT_ING_CREDITCARD,
  CAT_ING_PLATINUM,
  CAT_ABN_CREDITCARD,
  CAT_ABN_GOLD,
  CAT_212,
  CAT_N26_GO,
  CAT_REVOLUT,
  CAT_CRYPTO_OBSIDIAN,
  CAT_UNCOVERED,
];

test("a withdrawal priced as a percentage PLUS a fixed fee is read in either order", () => {
  const ing = parseWithdrawalFee(
    "bij geldopname in vreemde valuta geldt een apart tarief (€ 3,50 + 1,40%)",
  );
  expect(ing.known).toBe(true);
  expect(ing.components).toEqual([
    { kind: "fixed", eur: 3.5 },
    { kind: "pct", pct: 1.4, minEur: null },
  ]);

  // SNS writes the same two components the other way round.
  const sns = parseWithdrawalFee(
    "Contant geld opnemen met de betaalpas in vreemde valuta is een apart tarief (1,4% + € 3,50 per opname)",
  );
  expect(sns.known).toBe(true);
  expect(sns.components).toEqual([
    { kind: "pct", pct: 1.4, minEur: null },
    { kind: "fixed", eur: 3.5 },
  ]);
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
  const facts = upsertFacts(
    [],
    [
      fact("ING betaalpas", "fxFeePct", "1.4"),
      fact("ING creditcard", "fxFeePct", "2"), // narrows ING's two creditcards to the plain one
      fact("Trading 212 betaalpas", "fxFeePct", "0"),
    ],
  );
  const ranked = rankWithdrawOptions(rankSpendOptions(accounts, facts), CATALOGUE);

  expect(ranked.map((o) => o.provider)).toEqual([
    "ING betaalpas",
    "ING creditcard",
    "Trading 212 betaalpas",
  ]);
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
  const facts = upsertFacts(
    [],
    [fact("Revolut betaalpas", "fxFeePct", "1"), fact("ING betaalpas", "fxFeePct", "1.4")],
  );
  const plan = planTravel({
    accounts,
    txs: [],
    rates: [],
    facts,
    destination: "US",
    asOf: "2026-08-20",
    catalogue: CATALOGUE,
  });

  // What he holds still decides what he can pay with TODAY.
  expect(plan.spend[0].provider).toBe("Revolut betaalpas");
  // And the catalogue answers the other question, kept separate.
  expect(plan.pay?.product).toBe("212 Card");
  expect(plan.pay?.held).toBe(false);
  expect(plan.pay?.savingOnReference).toBe(10); // 1% of € 1.000
  expect(plan.offers.some((o) => o.productId === "212-card")).toBe(true);
  expect(plan.offers.some((o) => o.held)).toBe(false);
  expect(plan.withdraw.length).toBe(2);
});

test("without a catalogue nothing is invented — no offers, no switch, no cash price", () => {
  const accounts = [acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 4000 })];
  const facts = upsertFacts([], [fact("ING betaalpas", "fxFeePct", "1.4")]);
  const plan = planTravel({
    accounts,
    txs: [],
    rates: [],
    facts,
    destination: "US",
    asOf: "2026-08-20",
  });
  expect(plan.offers).toEqual([]);
  // Nothing to switch to, so the advice is his own card and claims no saving.
  expect(plan.pay?.held).toBe(true);
  expect(plan.pay?.savingOnReference).toBeNull();
  expect(plan.withdraw[0].fee.known).toBe(false);
  // Nothing proven anywhere, so there is no advice — but the card is still NAMED
  // as a gap. Dropping it silently is what reads as "opnemen kost hier niets".
  expect(plan.withdrawAdvice).toBeNull();
  expect(plan.withdrawHeadline).toContain("ING betaalpas");
  expect(plan.withdrawHeadline).not.toMatch(/gratis|kost je niets/i);
});

test("a figure whose document prices withdrawal differently elsewhere carries that caveat", () => {
  // Crypto.com's real conditions, verbatim: the ATM row is 0,2% inside the EU
  // and the clause that tiers it never says "ATM" again — so a cash-only scan
  // would have shown 0,2% bare to someone flying outside the EU.
  const fee = parseWithdrawalFee(
    "Effective 1 October 2026, Ruby tier: non-EUR purchases and ATM transactions within the EU & UK 0.2%; outside the EU & UK no fee up to EUR 400 per calendar month, 2.0% thereafter",
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
  const stacked = parseWithdrawalFee(
    "Opname van contant geld in vreemde valuta 4% van opgenomen bedrag + 2% wisselkoersopslag",
  );
  expect(stacked.components).toHaveLength(2);
});

test("withdrawalHeadline leads with the euros and warns about small withdrawals", () => {
  const accounts = [acc({ key: "ingp", bank: "ING", type: "Betaalrekening", balance: 4000 })];
  const facts = upsertFacts([], [fact("ING betaalpas", "fxFeePct", "1.4")]);
  const line = withdrawalHeadline(
    rankWithdrawOptions(rankSpendOptions(accounts, facts), CATALOGUE),
    "USD",
  );

  expect(line).toContain("ING betaalpas");
  expect(line).toContain("€ 6,30");
  expect(line).toContain("8,4%"); // what € 50 costs, because of the € 3,50 flat fee
  expect(line).toContain("in één keer meer");
});

test("with no cash price anywhere the headline says that, and never says free", () => {
  const accounts = [acc({ key: "t212", bank: "Trading 212", type: "Betaalrekening" })];
  const facts = upsertFacts([], [fact("Trading 212 betaalpas", "fxFeePct", "0")]);
  const line = withdrawalHeadline(
    rankWithdrawOptions(rankSpendOptions(accounts, facts), CATALOGUE),
    "USD",
  );
  expect(line).toMatch(/weten we .*niet|weten we wat|onbekend/i);
  expect(line).not.toMatch(/gratis|kost je niets/i);
});

test("a card is matched by its product name too, because the issuer is often a different company", () => {
  // ING's own creditcard is issued by International Card Services. Matching on
  // the issuer alone found ING's debit card and missed both of its credit
  // cards — the same mismatch the review reports for the savings table.
  const ics: CatalogueEntryLike = {
    id: "ing-creditcard",
    product: "ING creditcard",
    issuer: "International Card Services (ICS)",
    kind: "creditcard",
    fields: {
      fxFeePct: {
        value: 2,
        route: "provider-pdf",
        sourceUrl: "https://ing.nl/tarieven.pdf",
        checkedAt: "2026-06-15",
        conditionsKnown: true,
        conditions:
          "Bij geldopnemen met de creditcard in vreemde valuta: 4,00% van het opgenomen bedrag met minimum € 4,50 + 2,00% koersopslag.",
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
    id,
    product: `N26 ${id} betaalpas`,
    issuer: "N26 Bank AG (Germany); Mastercard Debit",
    kind: "betaalpas",
    fields: {
      fxFeePct: {
        value,
        route: "provider-pdf",
        sourceUrl: "https://n26.com/prices",
        checkedAt: "2026-08-01",
        conditionsKnown: true,
        conditions: "0% op kaartbetalingen.",
      },
    },
  });
  const collapsed = cheapestPerIssuer(
    marketCardOffers([plan("go", 0), plan("metal", 0), plan("smart", 0.5)], []),
  );
  expect(collapsed).toHaveLength(1);
  expect(collapsed[0].productId).toBe("go"); // the cheapest, and stable between renders
});

test("in euroland the cash advice is withdrawn, not repeated — those tariffs are for foreign currency", () => {
  const accounts = [acc({ key: "ingp", bank: "ING", type: "Betaalrekening", balance: 4000 })];
  const facts = upsertFacts([], [fact("ING betaalpas", "fxFeePct", "1.4")]);
  const es = planTravel({
    accounts,
    txs: [],
    rates: [],
    facts,
    destination: "ES",
    asOf: "2026-08-20",
    catalogue: CATALOGUE,
  });

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
    expect(
      parseWithdrawalFee("Foreign-currency ATM withdrawals are free for these plans.").known,
    ).toBe(true);
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
    const f = parseWithdrawalFee(
      "Betalen is gratis; bij geldopname in vreemde valuta geldt € 3,50 + 1,40%.",
    );
    expect(f.known).toBe(true);
    expect(withdrawalEffectivePct(f, 100)).toBe(4.9);
  });
});

/* ═══════════════════════════════════ THE ADVICE IS THE BEST OPTION THERE IS
 *
 * App review 3, items 2 and 3. Both rankings answered "which of YOUR cards" and
 * led with it. His words: "I don't want 'pay today you're paying with what you
 * have'. Say pay with Revolut, which would save you € 14 on a thousand compared
 * to ING." So the headline is the cheapest option the catalogue can PROVE, with
 * the difference in euros against what he would otherwise use — and a product he
 * does not hold has to be recognisable as such, or the app recommends a payment
 * he cannot make today.
 */

test("the recommendation is the cheapest proven card, even one he does not hold, priced against his own", () => {
  const accounts = [acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 4000 })];
  const facts = upsertFacts([], [fact("ING betaalpas", "fxFeePct", "1.4")]);
  const plan = planTravel({
    accounts,
    txs: [],
    rates: [],
    facts,
    destination: "US",
    asOf: "2026-08-20",
    catalogue: CATALOGUE,
  });

  expect(plan.pay?.product).toBe("212 Card");
  expect(plan.pay?.held).toBe(false);
  expect(plan.pay?.costOnReference).toBe(0);
  // What he can pay with TODAY is still computed and still named.
  expect(plan.pay?.ownProduct).toBe("ING betaalpas");
  expect(plan.pay?.ownCostOnReference).toBe(14);
  expect(plan.pay?.savingOnReference).toBe(14); // his own 1,4% on € 1.000
  expect(plan.pay?.sourceUrl).toContain("trading212");

  // ...and the headline leads with it, in euros, the way he dictated it.
  expect(plan.headline).toContain("212 Card");
  expect(plan.headline).toContain("€ 14,00");
  expect(plan.headline).toContain("ING betaalpas");
  expect(plan.headline).toMatch(/heb je nog niet/i);
});

test("a card he does not hold never wins a tie — opening an account for nothing is not advice", () => {
  // His own route already costs nothing (move to Revolut via iDEAL, convert at
  // 0%). The catalogue's best is also 0%. Recommending that he open it would be
  // a step with no gain at the end of it.
  const accounts = [
    acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 4000 }),
    acc({ key: "rev", bank: "Revolut", type: "Betaalrekening", balance: 100 }),
  ];
  const facts = upsertFacts(
    [],
    [
      fact("ING betaalpas", "fxFeePct", "1.4"),
      fact("Revolut betaalpas", "fxFeePct", "0"),
      fact("Revolut betaalpas", "convertFeePct", "0"),
      fact("Revolut betaalpas", "transferFreeViaIdeal", "1"),
    ],
  );
  const plan = planTravel({
    accounts,
    txs: [],
    rates: [],
    facts,
    destination: "US",
    asOf: "2026-08-20",
    catalogue: CATALOGUE,
  });

  expect(plan.pay?.held).toBe(true);
  expect(plan.pay?.savingOnReference).toBeNull();
  expect(plan.headline).not.toContain("212 Card");
  expect(plan.headline).toContain("Revolut betaalpas");
});

test("the baseline is the cheapest thing he can ALREADY do, route included — not only a card tap", () => {
  // Paying directly with Revolut costs 0,5%; moving the money there first and
  // converting at 0,2% costs 0,2%. Measuring a switch against the 0,5% tap would
  // overstate the gain by more than half, and could crown a card he does not need.
  const accounts = [
    acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 4000 }),
    acc({ key: "rev", bank: "Revolut", type: "Betaalrekening", balance: 100 }),
  ];
  const facts = upsertFacts(
    [],
    [
      fact("ING betaalpas", "fxFeePct", "1.4"),
      fact("Revolut betaalpas", "fxFeePct", "0.5"),
      fact("Revolut betaalpas", "convertFeePct", "0.2"),
      fact("Revolut betaalpas", "transferFreeViaIdeal", "1"),
    ],
  );
  const plan = planTravel({
    accounts,
    txs: [],
    rates: [],
    facts,
    destination: "US",
    asOf: "2026-08-20",
    catalogue: CATALOGUE,
  });

  expect(plan.pay?.product).toBe("212 Card");
  expect(plan.pay?.ownCostOnReference).toBe(2); // the ROUTE, not the 0,5% tap
  expect(plan.pay?.savingOnReference).toBe(2);
});

test("bestPayAdvice returns nothing when neither side can be priced", () => {
  expect(bestPayAdvice([], [])).toBeNull();
  expect(payHeadline(null, [], "EUR")).toContain("euro");
});

/* ---------- cash: the winner is a proven zero, and a missing figure is named ---------- */

test("marketWithdrawOptions ranks the catalogue on CASH, and only where the price is proven", () => {
  const market = marketWithdrawOptions(CATALOGUE, []);
  // N26 Go's price list states a free foreign-currency withdrawal in words.
  expect(market[0].productId).toBe("n26-go-betaalpas");
  expect(market[0].costOnReference).toBe(0);
  // ING's own document prices it: € 3,50 + 1,40% on € 200.
  expect(market.find((o) => o.productId === "ing-betaalpas")?.costOnReference).toBe(6.3);
  // Revolut and the 212 Card say nothing about cash, so they are not offers.
  expect(market.some((o) => o.productId === "revolut-standard-betaalpas")).toBe(false);
  expect(market.some((o) => o.productId === "212-card")).toBe(false);
  // A card he holds is marked, so it can never be offered as something to open.
  const held = marketWithdrawOptions(CATALOGUE, [{ provider: "ING betaalpas", fxFeePct: 1.4 }]);
  expect(held.find((o) => o.productId === "ing-betaalpas")?.held).toBe(true);
});

test("the cash advice is the proven cheapest, and it names the cards whose price we do NOT have", () => {
  // His real situation: an ING betaalpas at € 3,50 + 1,40%, a Revolut with no
  // withdrawal row anywhere in its fee page, and the market's proven zero.
  const accounts = [
    acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 4000 }),
    acc({ key: "rev", bank: "Revolut", type: "Betaalrekening", balance: 100 }),
  ];
  const facts = upsertFacts(
    [],
    [fact("ING betaalpas", "fxFeePct", "1.4"), fact("Revolut betaalpas", "fxFeePct", "1")],
  );
  const plan = planTravel({
    accounts,
    txs: [],
    rates: [],
    facts,
    destination: "US",
    asOf: "2026-08-20",
    catalogue: CATALOGUE,
  });

  const a = plan.withdrawAdvice!;
  expect(a.product).toBe("N26 Go betaalpas");
  expect(a.held).toBe(false);
  expect(a.costOnReference).toBe(0);
  expect(a.ownProduct).toBe("ING betaalpas");
  expect(a.ownCostOnReference).toBe(6.3);
  expect(a.savingOnReference).toBe(6.3);
  // He believes Revolut is the winner. We cannot prove it either way, and a
  // figure nobody mentions reads as "there is no charge" — so it is named.
  expect(a.unpricedOwn).toEqual(["Revolut betaalpas"]);

  expect(plan.withdrawHeadline).toContain("N26 Go betaalpas");
  expect(plan.withdrawHeadline).toContain("ING betaalpas");
  expect(plan.withdrawHeadline).toContain("Revolut betaalpas");
  expect(plan.withdrawHeadline).not.toMatch(/gratis|kost je niets/i);
});

test("his own card still wins the cash advice when nothing proven beats it", () => {
  const accounts = [acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 4000 })];
  const facts = upsertFacts([], [fact("ING betaalpas", "fxFeePct", "1.4")]);
  const own = rankWithdrawOptions(rankSpendOptions(accounts, facts), CATALOGUE);
  // A market of one, and it is his.
  const market = marketWithdrawOptions(
    [CAT_ING_BETAALPAS],
    [{ provider: "ING betaalpas", fxFeePct: 1.4 }],
  );

  const a = bestWithdrawAdvice(own, market)!;
  expect(a.held).toBe(true);
  expect(a.product).toBe("ING betaalpas");
  expect(a.savingOnReference).toBeNull();
  expect(withdrawalHeadline(own, "USD", market)).toContain("in één keer meer");
});

/* GELIJKSPEL: DE KAART DIE HIJ AL HEEFT WINT — zijn beslissing van 20 augustus.
 *
 * Op de echte catalogus staan Trade Republic, 212 Card, N26 Standard en ING
 * Platinum allemaal op 0%. Iemand naar een nieuwe kaart sturen voor exact hetzelfde
 * tarief is advies dat niets oplevert en werk kost.
 */
/* DE ECHTE VERGELIJKER WORDT AANGEROEPEN, niet nagebouwd. Deze tests sorteerden
 * eerst met een met de hand gekopieerde sorteerregel, en dan test je je eigen
 * kopie: `compareCardOffers` kon stuk terwijl dit groen bleef. Erger nog, de kopie
 * liep achter — hij kende `tripCostCents` niet, dus precies het criterium dat er
 * op 21 augustus bijkwam werd hier niet getoetst. Vandaar dat de functie een eigen
 * export en een eigen invoertype heeft. */
describe("gelijkspel in de aanbevelingen", () => {
  const offer = (
    id: string,
    tripEur: number,
    held: boolean,
    conditional = false,
    tripCostKnown = true,
  ) => ({
    productId: id,
    tripCostCents: Math.round(tripEur * 100),
    tripCostKnown,
    conditional,
    held,
  });
  const first = (...offers: ReturnType<typeof offer>[]) =>
    [...offers].sort(compareCardOffers)[0].productId;

  test("bij dezelfde prijs staat zijn eigen kaart bovenaan", () => {
    expect(first(offer("nieuw", 0, false), offer("zijne", 0, true))).toBe("zijne");
  });

  test("maar een echt goedkopere kaart wint nog steeds van de zijne", () => {
    // Anders zou de aanbeveling nooit meer iets nieuws kunnen voorstellen.
    expect(first(offer("zijne", 14, true), offer("nieuw", 0, false))).toBe("nieuw");
  });

  test("en een onvoorwaardelijke 0% wint van zijn eigen 0% met een plafond", () => {
    expect(
      first(offer("zijne-met-plafond", 0, true, true), offer("nieuw-vrij", 0, false, false)),
    ).toBe("nieuw-vrij");
  });

  test("bij gelijke stand wint de prijs die we KUNNEN AANTONEN", () => {
    // Van een onbekende kaartprijs weten we alleen dat er nog iets af kan gaan,
    // dus het gelijke bedrag is bij hem een ondergrens en bij de ander een feit.
    expect(
      first(offer("onbekend", 0, false, false, false), offer("bewezen", 0, false, false, true)),
    ).toBe("bewezen");
  });

  test("en de kaartkosten beslissen: 0% opslag voor € 16,90 per maand verliest van 1% gratis", () => {
    // ZIJN ZIN, in één assert: "als een kaart 5 euro per maand kost en ons 3
    // oplevert gaan we er op achteruit." Op de opslag alleen won de duurste kaart.
    expect(first(offer("metal-0%-maar-16,90", 16.9, false), offer("gratis-1%", 10, false))).toBe(
      "gratis-1%",
    );
  });
});

/* ══════════════════════════════════════════ WAT DE KAART ZELF KOST
 *
 * Zijn opdracht van 21 augustus: "als een kaart 5 euro per maand kost en ons 3
 * oplevert gaan we er op achteruit." Elke rangschikking hierboven rekende aan de
 * OPBRENGST — een lagere opslag, een gratis opname — en niet aan wat het product
 * kost om te hebben.
 *
 * De rijen hieronder staan LETTERLIJK zo in docs/catalog/catalog.json, en dat is
 * hier geen stijlkeuze maar de kern van de zaak: de fout die dit blok bewaakt zit
 * juist in de MANIER waarop dat bestand een kaart van zijn pakket scheidt. Een
 * verzonnen catalogus met de prijs netjes op de kaartrij zou bewijzen dat de code
 * werkt op een bestand dat niet bestaat.
 */

/** De kaart draagt de OPSLAG (0%), niet de prijs. Let op de laatste zin van de
 *  voorwaarden: het bedrag van € 16,90 staat woordelijk in ditzelfde document —
 *  het stond dus nooit in een blinde vlek, het werd alleen niet gelezen. */
const CAT_N26_METAL_CARD: CatalogueEntryLike = {
  id: "n26-metal-betaalpas",
  product: "N26 Metal betaalpas",
  issuer: "N26 Bank AG; metal Mastercard Debit",
  kind: "betaalpas",
  fields: {
    fxFeePct: {
      value: 0,
      route: "agent",
      sourceUrl: "https://docs.n26.com/legal/13account-pricelist-en.pdf",
      checkedAt: "2026-06-26",
      conditionsKnown: true,
      conditions:
        "WORDING CAVEAT — the 0 is written as 'Free' / 'without foreign currency surcharge'; no numeral in the row. Metal costs '16.90 € per month (membership fee)'; a replacement Metal card is 45.00 €.",
    },
  },
};

/** ...en het PAKKET draagt de prijs. Een aparte rij, met een ander id en een
 *  ander `kind`. Dit is de scheiding waar `holdingCostsById` op stukliep. */
const CAT_N26_METAL_PLAN: CatalogueEntryLike = {
  id: "n26-metal",
  product: "N26 Metal",
  issuer: "N26 Bank AG",
  kind: "betaalrekening",
  fields: {
    accountFee: {
      value: 16.9,
      period: "maand",
      route: "provider-pdf",
      sourceUrl: "https://docs.n26.com/legal/13account-pricelist-en.pdf",
      checkedAt: "2026-06-26",
      conditionsKnown: true,
      conditions:
        "Membership fee. N26 kan korting geven bij vooruitbetaling per jaar of half jaar; de hoogte daarvan staat niet in de prijslijst.",
      // `CatalogValue` kent geen `period`, de accountFee-rij wel — `readAccountFee`
      // valideert hem apart. Vandaar de cast: het veld is echt, het type hier niet.
    } as unknown as import("./catalog.js").CatalogValue,
  },
};

/** Het pakket bij de N26 Go-kaart die hierboven al als fixture staat. */
const CAT_N26_GO_PLAN: CatalogueEntryLike = {
  id: "n26-go",
  product: "N26 Go",
  issuer: "N26 Bank AG",
  kind: "betaalrekening",
  fields: {
    accountFee: {
      value: 9.9,
      period: "maand",
      route: "provider-pdf",
      sourceUrl: "https://docs.n26.com/legal/13account-pricelist-en.pdf",
      checkedAt: "2026-06-26",
      conditionsKnown: true,
      conditions: "Membership fee. Dit is het abonnement dat vroeger 'N26 You' heette.",
    } as unknown as import("./catalog.js").CatalogValue,
  },
};

/** EEN UITGESPROKEN NUL, op de kaartrij zelf: 0% opslag én € 0,00 per maand. De
 *  tegenhanger die de vergelijking pas ergens over laat gaan. */
const CAT_TRADE_REPUBLIC: CatalogueEntryLike = {
  id: "trade-republic-betaalpas",
  product: "Trade Republic betaalpas",
  issuer: "Trade Republic Bank GmbH (Germany), Nederlandse vestiging Amsterdam; Visa debit",
  kind: "betaalpas",
  fields: {
    fxFeePct: {
      value: 0,
      route: "agent",
      sourceUrl: "https://traderepublic.com/nl-nl/kaart/_payload.json",
      checkedAt: "2026-05-11",
      conditionsKnown: true,
      conditions:
        "WORDING CAVEAT — the 0 is written as 'brengen wij geen extra omwisselkosten in rekening'; no numeral. Card carries no subscription fee.",
    },
    accountFee: {
      value: 0,
      period: "maand",
      route: "provider-page",
      sourceUrl: "https://traderepublic.com/nl-nl/kaart/_payload.json",
      checkedAt: "2025-09-10",
      conditionsKnown: true,
      conditions:
        "De pagina zegt 'Wij rekenen geen kosten voor onze betaalrekening'. Uitgesproken nul.",
    } as unknown as import("./catalog.js").CatalogValue,
  },
};

/** ING's pakketprijs. Hoort NIET bij "ING betaalpas": ING verkoopt die kaart in
 *  zeven pakketten van € 4,00 tot € 44,99, en dit is er één van (en nog een die
 *  je niet meer kunt openen). */
const CAT_ING_BETAALPAKKET: CatalogueEntryLike = {
  id: "ing-betaalpakket",
  product: "ING BetaalPakket",
  issuer: "ING Bank N.V.",
  kind: "betaalpakket",
  fields: {
    accountFee: {
      value: 6.85,
      period: "maand",
      route: "provider-pdf",
      sourceUrl:
        "https://assets.ing.com/ING_Kostenoverzicht-betaalproducten-particulieren_2023.pdf",
      checkedAt: "2026-06-15",
      conditionsKnown: true,
      conditions:
        "Niet meer te openen pakket; geldt alleen voor bestaande klanten. Prijs is voor de betaalrekening op één naam inclusief betaalpas.",
    } as unknown as import("./catalog.js").CatalogValue,
  },
};

/** De ABN-creditcardbijdrage, op zijn EIGEN rij. Mag nooit op de ABN-betaalpas
 *  landen: dat zijn twee producten met twee tarieven. */
const CAT_ABN_CREDITCARD_PRICED: CatalogueEntryLike = {
  ...CAT_ABN_CREDITCARD,
  fields: {
    ...CAT_ABN_CREDITCARD.fields,
    accountFee: {
      value: 2.55,
      period: "maand",
      route: "provider-pdf",
      sourceUrl: "https://www.icscards.nl/webdocuments/666/av-abn-amro",
      checkedAt: "2026-08-19",
      conditionsKnown: true,
      conditions: "Maandelijkse bijdrage voor de creditcard.",
    } as unknown as import("./catalog.js").CatalogValue,
  },
};

const CAT_ABN_BETAALPAS: CatalogueEntryLike = {
  id: "abn-amro-betaalpas",
  product: "ABN AMRO betaalpas",
  issuer: "ABN AMRO Bank N.V.",
  kind: "betaalpas",
  fields: {
    fxFeePct: {
      value: 1.2,
      route: "agent",
      sourceUrl: "https://assets.abnamro.com/informatiedocument-basispakket-betalen.pdf",
      checkedAt: "2026-01-01",
      conditionsKnown: true,
      conditions:
        "Geldt binnen het BasisPakket Betalen bij betalen met een betaalpas in vreemde valuta; per keer komt daar € 0,15 bovenop.",
    },
  },
};

/** EEN JAARKAART, en het enige product in de catalogus waar de eenheid het
 *  antwoord bepaalt: € 270 PER JAAR naast maandprijzen van € 2,55. */
const CAT_AMEX_BUSINESS_GOLD: CatalogueEntryLike = {
  id: "american-express-business-gold-card",
  product: "American Express Business Gold Card",
  issuer: "American Express (self-issued in NL; NOT ICS)",
  kind: "creditcard",
  fields: {
    fxFeePct: {
      value: 2.5,
      route: "agent",
      sourceUrl: "https://www.americanexpress.com/NL-Overeenkomst-Business-Card.pdf",
      checkedAt: "2023-03-15",
      conditionsKnown: true,
      conditions:
        "Wisselkoersopslag op het omgewisselde bedrag in euro bij transacties die niet in Euro zijn uitgevoerd.",
    },
    accountFee: {
      value: 270,
      period: "jaar",
      route: "provider-pdf",
      sourceUrl: "https://www.americanexpress.com/business-gold-card/actievoorwaarden.pdf",
      checkedAt: "2026-06-02",
      conditionsKnown: true,
      conditions: "Het jaarbedrag van € 270 staat op de Business Companion Gold-pagina.",
    } as unknown as import("./catalog.js").CatalogValue,
  },
};

describe("de prijs van de kaart staat vaak op een ANDERE catalogusrij", () => {
  test("de pakketrij levert de kaartprijs — anders is € 16,90 per maand een nul", () => {
    const offers = marketCardOffers([CAT_N26_METAL_CARD, CAT_N26_METAL_PLAN], [], 1);
    const metal = offers.find((o) => o.productId === "n26-metal-betaalpas")!;
    expect(metal.holdingCost.kind).toBe("known");
    // De EENHEID blijft die van het document. Een jaarbedrag van hem maken is
    // een factor twaalf, en dat is de fout die accountCosts.ts bewaakt.
    expect(metal.holdingCost).toMatchObject({
      kind: "known",
      why: "stated",
      amount: { cents: 1690, period: "maand" },
    });
    expect(metal.tripCostKnown).toBe(true);
    // 0% opslag op € 1.000 is niets; de reis kost dus precies één maandnota.
    expect(metal.tripCostCents).toBe(1690);
  });

  test("ZIJN ZIN: een kaart van € 16,90 per maand verliest van een kaart die niets kost", () => {
    // Beide 0% opslag. Op de opslag alleen was dit een gelijkspel dat door de
    // catalogusvolgorde werd beslist — en dan kon de kaart van € 16,90 bovenaan
    // komen. Nu niet meer.
    const offers = marketCardOffers(
      [CAT_N26_METAL_CARD, CAT_N26_METAL_PLAN, CAT_TRADE_REPUBLIC],
      [],
      1,
    );
    expect(offers.map((o) => o.productId)).toEqual([
      "trade-republic-betaalpas",
      "n26-metal-betaalpas",
    ]);
    expect(offers[0].tripCostCents).toBe(0);
    expect(offers[1].tripCostCents).toBe(1690);
  });

  test("een UITGESPROKEN nul is een bekende prijs, geen ontbrekende", () => {
    const [tr] = marketCardOffers([CAT_TRADE_REPUBLIC], [], 1);
    expect(tr.holdingCost).toMatchObject({ kind: "known", amount: { cents: 0 } });
    expect(tr.tripCostKnown).toBe(true); // niet "onbekend, dus achteraan"
  });

  test("een pakketnaam die alleen de BANK noemt wordt geweigerd", () => {
    // "ING betaalpas" ontdaan van zijn soortwoord is "ING", en dat is geen pakket
    // maar een bank. Zou dat matchen, dan kreeg de generieke ING-betaalpas de
    // € 6,85 van één van de zeven pakketten waarin ING hem verkoopt — een prijs
    // die voor de meeste ING-klanten niet klopt. Onbekend is dan het eerlijke
    // antwoord, ook al voelt het als een gemiste kans.
    const offers = marketCardOffers([CAT_ING_BETAALPAS, CAT_ING_BETAALPAKKET], [], 1);
    const pas = offers.find((o) => o.productId === "ing-betaalpas")!;
    expect(pas.holdingCost).toEqual({ kind: "unknown", reason: "no-source" });
    expect(pas.tripCostKnown).toBe(false);
    // ...en dan is de reistotaal alleen de opslag, dus een ONDERGRENS.
    expect(pas.tripCostCents).toBe(1400);
  });

  test("een creditcardbijdrage landt nooit op een betaalpas", () => {
    const offers = marketCardOffers([CAT_ABN_BETAALPAS, CAT_ABN_CREDITCARD_PRICED], [], 1);
    const pas = offers.find((o) => o.productId === "abn-amro-betaalpas")!;
    expect(pas.holdingCost.kind).toBe("unknown");
    // De creditcard houdt zijn eigen prijs wel, want die staat op zijn eigen rij.
    const card = offers.find((o) => o.productId === "abn-amro-creditcard")!;
    expect(card.holdingCost).toMatchObject({
      kind: "known",
      amount: { cents: 255, period: "maand" },
    });
  });

  test("de eigen rij gaat voor de pakketrij", () => {
    // Trade Republic draagt zijn nul op de kaartrij zelf. Zou een pakketrij hem
    // kunnen overschrijven, dan besliste de leesvolgorde de prijs.
    const [tr] = marketCardOffers([CAT_TRADE_REPUBLIC, CAT_N26_METAL_PLAN], [], 1);
    expect(tr.holdingCost).toMatchObject({ kind: "known", amount: { cents: 0 } });
  });
});

describe("een kaart die hij AL HEEFT kost hem marginaal niets", () => {
  const CAT = [CAT_N26_METAL_CARD, CAT_N26_METAL_PLAN, CAT_TRADE_REPUBLIC];

  test("de € 16,90 valt weg zodra hij de kaart heeft — die loopt toch al", () => {
    const offers = marketCardOffers(CAT, [{ provider: "N26 Metal betaalpas", fxFeePct: 0 }], 1);
    const metal = offers.find((o) => o.productId === "n26-metal-betaalpas")!;
    expect(metal.held).toBe(true);
    // Nul, en met de REDEN erbij: dezelfde nul in de rekensom en een heel ander
    // verhaal op het scherm dan een prijs die niemand noemt.
    expect(metal.holdingCost).toMatchObject({
      kind: "known",
      why: "already-held",
      amount: { cents: 0 },
    });
    expect(metal.tripCostCents).toBe(0);
  });

  test("...en daardoor vecht de gelijkspelregel niet met de kostenregel", () => {
    // Zonder het marginale onderscheid zou zijn eigen Metal (€ 16,90) verliezen
    // van elke kaart waarvan we de prijs niet kennen, en zou de app hem een kaart
    // laten openen om kosten te ontlopen die hij toch al maakt.
    const offers = marketCardOffers(CAT, [{ provider: "N26 Metal betaalpas", fxFeePct: 0 }], 1);
    const metal = offers.find((o) => o.productId === "n26-metal-betaalpas")!;
    expect(metal.tripCostKnown).toBe(true); // een bekende nul, dus regel 3 raakt hem niet
    expect(offers[0].held).toBe(true); // bij gelijke stand staat de zijne bovenaan
  });
});

describe("maand tegenover jaar, en de ondergrens van één periode", () => {
  test("een jaarkaart wordt PER JAAR afgerekend, ook op een reis van één maand", () => {
    const [amex] = marketCardOffers([CAT_AMEX_BUSINESS_GOLD], [], 1);
    // € 25 opslag (2,5% van € 1.000) + € 270 voor het hele jaar. Delen door twaalf
    // zou € 22,50 opleveren: een bedrag dat in geen enkel document staat en dat een
    // jaarkaart twaalf keer zo goedkoop maakt als hij is.
    expect(amex.tripCostCents).toBe(2500 + 27000);
  });

  test("twaalf maanden is nog steeds één jaarnota, dertien maanden zijn er twee", () => {
    expect(marketCardOffers([CAT_AMEX_BUSINESS_GOLD], [], 12)[0].tripCostCents).toBe(2500 + 27000);
    expect(marketCardOffers([CAT_AMEX_BUSINESS_GOLD], [], 13)[0].tripCostCents).toBe(2500 + 54000);
  });

  test("een reis van een week kost toch een hele maand kaart", () => {
    // De ondergrens. Minder dan één factureringsperiode kun je niet afnemen, en
    // een horizon die naar nul afrondt is precies de kostenpost die verdwijnt.
    for (const months of [0.25, 0, TRAVEL_TRIP_MONTHS]) {
      const [metal] = marketCardOffers([CAT_N26_METAL_CARD, CAT_N26_METAL_PLAN], [], months);
      expect(metal.tripCostCents).toBe(1690);
    }
  });

  test("twee maanden reizen zijn twee maandnota's", () => {
    const [metal] = marketCardOffers([CAT_N26_METAL_CARD, CAT_N26_METAL_PLAN], [], 2);
    expect(metal.tripCostCents).toBe(3380);
  });
});

describe("de aanbeveling zelf: netto, bruto, of geen aanbeveling", () => {
  const HIS = [acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 4000 })];
  const HIS_FACTS = upsertFacts([], [fact("ING betaalpas", "fxFeePct", "1.4")]);

  test("KOSTEN BEKEND en netto negatief: geen aanbeveling, en hij ziet het staan", () => {
    // Zijn ING kost € 14 opslag op € 1.000. N26 Metal rekent 0% opslag maar
    // € 16,90 per maand: dat is € 2,90 ACHTERUIT op een reis van een maand.
    const offers = marketCardOffers([CAT_N26_METAL_CARD, CAT_N26_METAL_PLAN], [], 1);
    const gain = offerSwitchGain(1.4, offers)!;
    expect(gain.savingCents).toBe(1400); // bruto: het verschil in opslag
    expect(gain.net.kind).toBe("no-recommendation");
    expect(gain.net.kind !== "gross-cost-unknown" && gain.net.netCents).toBe(-290);
    // Hij moet het kunnen ZIEN in plaats van uit te rekenen.
    expect(describeNetBenefit(gain.net)).toContain("Geen aanbeveling");
    expect(describeNetBenefit(gain.net)).toContain("achteruit");
  });

  test("...en dan blijft de aanbeveling zijn EIGEN kaart", () => {
    const plan = planTravel({
      accounts: HIS,
      txs: [],
      rates: [],
      facts: HIS_FACTS,
      destination: "US",
      asOf: "2026-08-21",
      catalogue: [CAT_N26_METAL_CARD, CAT_N26_METAL_PLAN],
      tripMonths: 1,
    });
    expect(plan.pay?.held).toBe(true);
    expect(plan.pay?.product).toBe("ING betaalpas");
    // Geen "open deze kaart" in de kop, want dat zou geld kosten.
    expect(plan.headline).not.toContain("N26 Metal");
  });

  test("maar over een half jaar wint diezelfde kaart WEL — de horizon beslist", () => {
    // Niets aan de kaart verandert; alleen de periode waarover we rekenen. Daarom
    // is de horizon een parameter en staat hij in het plan.
    const offers = marketCardOffers([CAT_N26_METAL_CARD, CAT_N26_METAL_PLAN], [], 1);
    expect(offerSwitchGain(14, offers)!.net.kind).toBe("net"); // 14% opslag = € 140 winst
  });

  test("KOSTEN ONBEKEND: het brutobedrag, en het woord netto valt NIET", () => {
    // ING PlatinumCard staat op 0% en heeft geen enkele pakketrij die bij zijn
    // naam past. Onbekend is geen nul: het bedrag komt door als BRUTO.
    const offers = marketCardOffers([CAT_ING_PLATINUM], [], 1);
    const gain = offerSwitchGain(1.4, offers)!;
    expect(gain.net.kind).toBe("gross-cost-unknown");
    expect(gain.net.kind === "gross-cost-unknown" && gain.net.grossCents).toBe(1400);
    const words = describeNetBenefit(gain.net);
    expect(words).not.toContain("netto");
    expect(words).toContain("geen nul");
  });

  test("en de kop zegt bij onbekende kosten dat er een gat zit, zonder 'netto'", () => {
    const plan = planTravel({
      accounts: HIS,
      txs: [],
      rates: [],
      facts: HIS_FACTS,
      destination: "US",
      asOf: "2026-08-21",
      catalogue: [CAT_ING_PLATINUM],
      tripMonths: 1,
    });
    expect(plan.pay?.held).toBe(false);
    expect(plan.pay?.netSavingOnReference).toBeNull(); // er is geen netto
    expect(plan.pay?.savingOnReference).toBe(14); // bruto wel
    expect(plan.headline).not.toContain("netto");
    expect(plan.headline).toContain("geen nul");
  });

  test("KOSTEN BEKEND en netto positief: dan mag het woord netto er staan", () => {
    // N26 Go kost € 9,90 per maand en scheelt € 14 opslag: € 4,10 over.
    const plan = planTravel({
      accounts: HIS,
      txs: [],
      rates: [],
      facts: HIS_FACTS,
      destination: "US",
      asOf: "2026-08-21",
      catalogue: [CAT_N26_GO, CAT_N26_GO_PLAN],
      tripMonths: 1,
    });
    expect(plan.pay?.held).toBe(false);
    expect(plan.pay?.netSavingOnReference).toBe(4.1);
    expect(plan.pay?.benefit?.kind).toBe("net");
    expect(plan.headline).toContain("€ 9,90");
    expect(plan.headline).toContain("€ 4,10");
    // DE PERIODE STAAT ERBIJ, want zonder haar is € 4,10 niet na te rekenen.
    expect(plan.headline).toContain("minstens één maand");
    expect(plan.tripMonths).toBe(1);
  });

  test("een bekende kaartprijs wordt ook genoemd als er niets is om tegen af te zetten", () => {
    // Hij heeft nog geen enkele opslag ingevuld, dus er is geen eigen route om
    // het voordeel tegen te meten en dus geen netto. De kaartprijs is dan wél
    // bekend, en die mag niet uit de zin verdwijnen: "dat kost je niets op
    // € 1.000" over een kaart van € 16,90 per maand is de misleiding waar deze
    // hele lane voor bestaat.
    const plan = planTravel({
      accounts: HIS,
      txs: [],
      rates: [],
      facts: [],
      destination: "US",
      asOf: "2026-08-21",
      catalogue: [CAT_N26_METAL_CARD, CAT_N26_METAL_PLAN],
      tripMonths: 1,
    });
    expect(plan.pay?.held).toBe(false);
    expect(plan.pay?.benefit).toBeNull(); // niets om te verrekenen
    expect(plan.pay?.holdingCost).toMatchObject({ kind: "known", amount: { cents: 1690 } });
    expect(plan.headline).toContain("€ 16,90");
    expect(plan.headline).not.toContain("netto");
  });
});

test("een kaart die niets kost krijgt geen rekensom over een periode", () => {
  // Op de echte catalogus is dit de meest voorkomende zin: Trade Republic en
  // 212 Card staan allebei op € 0,00 per maand. "kost zelf € 0,00 per maand en
  // dat betaal je minstens één maand" is waar en onleesbaar.
  const plan = planTravel({
    accounts: [acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 4000 })],
    txs: [],
    rates: [],
    facts: upsertFacts([], [fact("ING betaalpas", "fxFeePct", "1.4")]),
    destination: "US",
    asOf: "2026-08-21",
    catalogue: [CAT_TRADE_REPUBLIC],
    tripMonths: 6,
  });
  expect(plan.headline).toContain("kost zelf niets om aan te houden");
  expect(plan.headline).toContain("je houdt € 14,00 over");
  expect(plan.headline).not.toContain("€ 0,00 per maand");
  expect(plan.headline).not.toContain("6 maanden");
});
