import { expect, test } from "vitest";
import type { Account } from "./model.js";
import { countryCurrency, rankSpendOptions, planTravel, TRAVEL_AGENT } from "./travel.js";
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
    fact("Trading 212", "fxFeePct", "0"),
    fact("Trading 212", "cashbackPct", "1"), // net -1% — pays you to use it
    fact("ING", "fxFeePct", "1.2"),
    // American Express deliberately unknown
  ]);
  const ranked = rankSpendOptions(CARDS, facts);
  expect(ranked.map((o) => o.provider)).toEqual(["Trading 212", "ING", "American Express"]);
  expect(ranked[0].netCostPct).toBe(-1);
  expect(ranked[2].known).toBe(false);
  expect(ranked[2].netCostPct).toBeNull(); // never assumed free
});

test("an unknown card does not outrank a known cheap one even at 0% cashback", () => {
  const facts = upsertFacts([], [fact("ING", "fxFeePct", "0")]);
  const ranked = rankSpendOptions(CARDS, facts);
  expect(ranked[0].provider).toBe("ING");
  expect(ranked.filter((o) => o.known)).toHaveLength(1);
});

test("planTravel combines the three answers for a non-euro destination", () => {
  const facts = upsertFacts([], [
    fact("Trading 212", "fxFeePct", "0"),
    fact("Trading 212", "cashbackPct", "1"),
    fact("Trading 212", "transferFreeViaIdeal", "1"),
    fact("ING", "fxFeePct", "1.2"),
  ]);
  const plan = planTravel({ accounts: CARDS, txs: [], rates: [], facts, destination: "US", asOf: "2026-08-13" });

  expect(plan.currency).toBe("USD");
  expect(plan.spend[0].provider).toBe("Trading 212"); // pay with this
  expect(plan.convert.toProvider).toBe("Trading 212"); // move money here
  expect(plan.convert.fromProvider).toBe("ING"); // out of the fullest payment account
  expect(plan.convert.method).toBe("iDEAL");
  expect(plan.convert.note).toContain("gratis");
  expect(plan.unknownProviders).toEqual(["American Express"]);
});

test("planTravel skips conversion advice entirely for a euro destination", () => {
  const facts = upsertFacts([], [fact("Trading 212", "fxFeePct", "0")]);
  const plan = planTravel({ accounts: CARDS, txs: [], rates: [], facts, destination: "ES", asOf: "2026-08-13" });
  expect(plan.currency).toBe("EUR");
  expect(plan.convert.method).toBeNull();
  expect(plan.convert.note).toContain("euro");
});

test("planTravel says what it needs when no card terms are known yet", () => {
  const plan = planTravel({ accounts: CARDS, txs: [], rates: [], facts: [], destination: "US", asOf: "2026-08-13" });
  expect(plan.spend.every((o) => !o.known)).toBe(true);
  expect(plan.convert.note).toContain("ververs");
  expect(plan.unknownProviders.sort()).toEqual(["American Express", "ING", "Trading 212"]);
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
  expect(plan.spend.map((o) => o.provider).sort()).toEqual(["ABN AMRO", "American Express", "ING"]);
  expect(plan.spend.find((o) => o.provider === "ING")!.accounts).toHaveLength(2);
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
  expect(plan.spend.map((o) => o.provider)).toEqual(["Revolut"]);
});
