import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { annualSpendCents, CONFIDENT_SPEND_DAYS, MAX_SPEND_GAP_DAYS, MIN_SPEND_DAYS } from "./returns.js";
import { ownAccounts } from "./views.js";

const acc = (over: Partial<Account>): Account =>
  ({ key: "k", iban: "", name: "Rekening", bank: "ING", entity: "BV1",
     currency: "EUR", balance: 1000, ...over });

const tx = (over: Partial<Tx>): Tx =>
  ({ id: "t", accountKey: "k", date: "2026-08-01", amount: -100, currency: "EUR",
     counterparty: "Albert Heijn", description: "", category: "", manual: false, ...over });

test("a credit card's spend base is EXACT: every outflow on it is card spend", () => {
  const card = acc({ key: "amex", bank: "American Express", type: "Creditcard" });
  // 180 days of history, €900 out in total -> €1.825 per year.
  const txs = [
    tx({ id: "a", accountKey: "amex", date: "2026-03-01", amount: -300 }),
    tx({ id: "b", accountKey: "amex", date: "2026-06-01", amount: -300 }),
    tx({ id: "c", accountKey: "amex", date: "2026-08-27", amount: -300 }),
  ];
  const base = annualSpendCents(card, txs, [], undefined, "2026-08-27");

  expect(base.kind).toBe("exact");
  expect(base.observedDays).toBe(179);
  expect(base.perYearCents).toBe(Math.round((90_000 * 365) / 179));
});

test("a payment account's spend base is an UPPER BOUND — the export cannot tell a card payment from a direct debit", () => {
  const pay = acc({ key: "ing", type: "Betaalrekening" });
  const txs = [
    tx({ id: "a", accountKey: "ing", date: "2026-03-01", amount: -300 }),
    tx({ id: "b", accountKey: "ing", date: "2026-08-27", amount: -300 }),
  ];
  expect(annualSpendCents(pay, txs, [], undefined, "2026-08-27").kind).toBe("upper-bound");
});

test("money moved to your own account is not spending", () => {
  const pay = acc({ key: "ing", type: "Betaalrekening" });
  const savings = acc({ key: "NL01INGB0002222222", iban: "NL01INGB0002222222", name: "Spaar" });
  // Built by core's own builder: the internal shape of byKey is not a fixture's
  // business, and a hand-rolled one silently stops matching if it changes.
  const own = ownAccounts([pay, savings]);
  const txs = [
    tx({ id: "a", accountKey: "ing", date: "2026-03-01", amount: -300 }),
    tx({ id: "b", accountKey: "ing", date: "2026-08-27", amount: -5000,
         counterparty: "NL01INGB0002222222", description: "naar spaarrekening" }),
  ];
  const base = annualSpendCents(pay, txs, [], own, "2026-08-27");

  // Only the €300 counts; the €5.000 sweep is an own transfer.
  expect(base.perYearCents).toBe(Math.round((30_000 * 365) / 179));
});

test("too little history yields UNKNOWN, never a projection from three weeks", () => {
  const pay = acc({ key: "ing", type: "Betaalrekening" });
  const txs = [
    tx({ id: "a", accountKey: "ing", date: "2026-08-10", amount: -300 }),
    tx({ id: "b", accountKey: "ing", date: "2026-08-27", amount: -300 }),
  ];
  const base = annualSpendCents(pay, txs, [], undefined, "2026-08-27");

  expect(base.observedDays).toBeLessThan(MIN_SPEND_DAYS);
  expect(base.kind).toBe("unknown");
  expect(base.perYearCents).toBeNull();
});

test("money coming IN is not spending, and an account with no outflow is unknown", () => {
  const pay = acc({ key: "ing", type: "Betaalrekening" });
  const txs = [
    tx({ id: "a", accountKey: "ing", date: "2026-03-01", amount: 2500 }),
    tx({ id: "b", accountKey: "ing", date: "2026-08-27", amount: 2500 }),
  ];
  expect(annualSpendCents(pay, txs, [], undefined, "2026-08-27").perYearCents).toBeNull();
});

test("an account nothing has flowed through for two years is UNKNOWN, not a live spend base", () => {
  // Six months of real, long-enough history — that ended two years ago. An
  // annual figure off this would win a ranking against an account he actually
  // uses, which is the wrong answer with a measurement's face on it.
  const card = acc({ key: "amex", bank: "American Express", type: "Creditcard" });
  const txs = [
    tx({ id: "a", accountKey: "amex", date: "2024-03-01", amount: -300 }),
    tx({ id: "b", accountKey: "amex", date: "2024-08-27", amount: -300 }),
  ];
  const base = annualSpendCents(card, txs, [], undefined, "2026-08-18");

  expect(base.observedDays).toBeGreaterThan(MIN_SPEND_DAYS);
  expect(base.kind).toBe("unknown");
  expect(base.perYearCents).toBeNull();
});

test("an ordinary import lag is not staleness: the boundary is MAX_SPEND_GAP_DAYS", () => {
  const pay = acc({ key: "ing", type: "Betaalrekening" });
  const upTo = (last: string) =>
    annualSpendCents(
      pay,
      [
        tx({ id: "a", accountKey: "ing", date: "2026-01-01", amount: -300 }),
        tx({ id: "b", accountKey: "ing", date: last, amount: -300 }),
      ],
      [],
      undefined,
      "2026-08-18",
    );

  expect(MAX_SPEND_GAP_DAYS).toBe(90);
  expect(upTo("2026-05-20").perYearCents).not.toBeNull(); // exactly 90 days back
  expect(upTo("2026-05-19").perYearCents).toBeNull(); // one day too old
  expect(upTo("2026-05-19").kind).toBe("unknown");
});

import { accountReturns } from "./returns.js";
import { makeFact } from "./facts.js";
import { TRAVEL_AGENT } from "./travel.js";

const cashbackFact = (subject: string, value: string) =>
  makeFact({ agent: TRAVEL_AGENT, subject, key: "cashbackPct", value,
             source: "agent", updatedAt: "2026-08-18" });

test("cashback is read from the product fact, and a card without one stays UNKNOWN", () => {
  const t212 = acc({ key: "t212", bank: "Trading 212", type: "Betaalrekening", balance: 20_000 });
  const ing = acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 5_000 });
  const facts = [cashbackFact("Trading 212 betaalpas", "1.5")];

  const out = accountReturns([t212, ing], [], [], undefined, facts, [], "2026-08-18");
  const byKey = Object.fromEntries(out.map((r) => [r.account.key, r]));

  expect(byKey.t212.cashbackPct).toBe(1.5);
  // ING has no cashback fact. It is NOT 0% — nobody said so.
  expect(byKey.ing.cashbackPct).toBeNull();
});

test("the balance rate keeps the source it came from, and cents are integers", () => {
  const savings = acc({ key: "spaar", bank: "Trading 212", name: "Spaar",
                        type: "Spaarrekening", balance: 20_000, interestRate: 3.5 });
  const out = accountReturns([savings], [], [], undefined, [], [], "2026-08-18");

  expect(out[0].savingsPct).toBe(3.5);
  expect(out[0].savingsSource).toBe("manual"); // he typed it; nothing may overrule that
  expect(out[0].balanceCents).toBe(2_000_000);
});

test("an account with no saldo reports zero cents rather than guessing one", () => {
  const unknown = acc({ key: "x", balance: null });
  expect(accountReturns([unknown], [], [], undefined, [], [], "2026-08-18")[0].balanceCents).toBe(0);
});

test("a caller who passes no own-accounts set still does not count a sweep as spending", () => {
  // accountReturns is handed the accounts themselves, so it can build the own
  // set the exclusion needs. Without this, a €5.000 move to his own savings is
  // spend on the paying account - and on a payment account that inflated base
  // is what the cashback percentage multiplies.
  const pay = acc({ key: "ing", iban: "NL01INGB0001111111", type: "Betaalrekening" });
  const savings = acc({ key: "spaar", iban: "NL01INGB0002222222", name: "Spaar" });
  const txs = [
    tx({ id: "a", accountKey: "ing", date: "2026-03-01", amount: -300 }),
    tx({ id: "b", accountKey: "ing", date: "2026-08-27", amount: -5000,
         counterparty: "NL01INGB0002222222", description: "naar spaarrekening" }),
  ];

  const out = accountReturns([pay, savings], txs, [], undefined, [], [], "2026-08-27");
  const ing = out.find((r) => r.account.key === "ing");

  expect(ing?.spend.perYearCents).toBe(Math.round((30_000 * 365) / 179));
  expect(ing?.spend.kind).toBe("upper-bound");
});

import { optimiseReturns } from "./returns.js";

test("his own case: two actions on two bases, not one blended rate", () => {
  // Trading 212: 3,5% on balance and 1,5% cashback. ING: 1,5% and 0%.
  const t212 = acc({ key: "t212", bank: "Trading 212", type: "Betaalrekening",
                     balance: 0, interestRate: 3.5 });
  const ing = acc({ key: "ing", bank: "ING", type: "Betaalrekening",
                    balance: 20_000, interestRate: 1.5 });
  const facts = [cashbackFact("Trading 212 betaalpas", "1.5"), cashbackFact("ING betaalpas", "0")];
  // A year of ING spending at €2.500/month.
  const txs = Array.from({ length: 12 }, (_, i) =>
    tx({ id: "s" + i, accountKey: "ing", amount: -2500,
         date: `2025-${String(i + 1).padStart(2, "0")}-15` }));

  const { actions } = optimiseReturns(
    accountReturns([t212, ing], txs, [], undefined, facts, [], "2026-01-15"),
  );

  const move = actions.find((a) => a.kind === "move-balance");
  const route = actions.find((a) => a.kind === "route-spending");

  // €20.000 × (3,5% − 1,5%) = €400/jaar
  expect(move?.gainPerYearCents).toBe(40_000);
  expect(move?.from.key).toBe("ing");
  expect(move?.to.key).toBe("t212");

  // Spending stays on its own base and is flagged as an upper bound.
  expect(route?.from.key).toBe("ing");
  expect(route?.to.key).toBe("t212");
  expect(route?.approximate).toBe(true);
  expect(route!.gainPerYearCents).toBeGreaterThan(0);

  // Biggest first.
  expect(actions[0].gainPerYearCents).toBeGreaterThanOrEqual(actions[1].gainPerYearCents);
});

test("an unknown side produces a GAP, never an action", () => {
  const t212 = acc({ key: "t212", bank: "Trading 212", type: "Betaalrekening", balance: 0 });
  const ing = acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 20_000, interestRate: 1.5 });
  // No cashback fact for either, and no rate for T212.
  const { actions, gaps } = optimiseReturns(
    accountReturns([t212, ing], [], [], undefined, [], [], "2026-08-18"),
  );

  expect(actions.find((a) => a.kind === "route-spending")).toBeUndefined();
  expect(gaps.map((g) => g.product)).toContain("Trading 212 betaalpas");
  expect(gaps.every((g) => g.missing === "cashbackPct" || g.missing === "savingsPct")).toBe(true);
});

test("no action when the winner is the account already holding the money", () => {
  const best = acc({ key: "t212", bank: "Trading 212", balance: 20_000, interestRate: 3.5 });
  const { actions } = optimiseReturns(
    accountReturns([best], [], [], undefined, [], [], "2026-08-18"),
  );
  expect(actions.find((a) => a.kind === "move-balance")).toBeUndefined();
});

/* --- What the review found once the arithmetic was trusted ---------------- *
 * The euros were right; what they were MADE OF was not. Four defects, each
 * reproduced before it was fixed: a savings account being asked for a card's
 * cashback, the same question printed once per account, spending routed to
 * something you cannot pay with, and a balance moved into another currency. */

test("a savings account is never asked what its cashback is", () => {
  // productOf() calls everything that is not a credit card a "betaalpas", so a
  // Spaarrekening used to emit {"Bunq betaalpas", "cashbackPct"} — a fabricated
  // product name carrying a question about a card that does not exist.
  const spaar = acc({ key: "bunq-s", bank: "Bunq", name: "Spaar", type: "Spaarrekening", balance: 20_000 });
  const { gaps } = optimiseReturns(accountReturns([spaar], [], [], undefined, [], [], "2026-08-18"));

  expect(gaps.filter((g) => g.missing === "cashbackPct")).toEqual([]);
  // Its RATE is a fair question, and the gap names the account it was found on
  // rather than a product this account never had.
  expect(gaps.map((g) => [g.missing, g.account.key])).toEqual([["savingsPct", "bunq-s"]]);
});

test("one cashback question per product, not one per account", () => {
  const a1 = acc({ key: "ing1", name: "Betaalrekening", balance: 1000 });
  const a2 = acc({ key: "ing2", name: "Tweede rekening", balance: 1000 });
  const { gaps } = optimiseReturns(accountReturns([a1, a2], [], [], undefined, [], [], "2026-08-18"));

  // The fact is the PRODUCT's: answering it once moves both accounts, so asking
  // twice is the same question printed twice.
  expect(gaps.filter((g) => g.missing === "cashbackPct").map((g) => g.product)).toEqual(["ING betaalpas"]);
});

test("spending is never routed to an account you cannot pay with", () => {
  // Same productOf() collapsing: a Trading 212 Spaarrekening inherits the
  // "Trading 212 betaalpas" cashback fact and used to win the ranking, which
  // read as "pay for your groceries with your savings account".
  const spaar = acc({ key: "t212s", bank: "Trading 212", name: "Spaar", type: "Spaarrekening", balance: 0 });
  const ing = acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 20_000, interestRate: 1.5 });
  const facts = [cashbackFact("Trading 212 betaalpas", "1.5"), cashbackFact("ING betaalpas", "0")];
  const txs = Array.from({ length: 12 }, (_, i) =>
    tx({ id: "s" + i, accountKey: "ing", amount: -2500,
         date: `2025-${String(i + 1).padStart(2, "0")}-15` }));

  const { actions } = optimiseReturns(
    accountReturns([spaar, ing], txs, [], undefined, facts, [], "2026-01-15"),
  );
  expect(actions.find((a) => a.kind === "route-spending")).toBeUndefined();
});

test("money is never moved into another currency", () => {
  // A conversion sits between the €20.000 and the 4,5%, so the gain cannot be
  // redone against a statement — and no FX cost appears anywhere in it.
  const usd = acc({ key: "wise", bank: "Wise", name: "USD saldo", type: "Spaarrekening",
                    currency: "USD", balance: 0, interestRate: 4.5 });
  const ing = acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 20_000, interestRate: 1.5 });

  const { actions } = optimiseReturns(accountReturns([usd, ing], [], [], undefined, [], [], "2026-08-18"));
  expect(actions.find((a) => a.kind === "move-balance")).toBeUndefined();
});

test("an action carries where each rate came from, so no assumption prints as a fact", () => {
  // ING has no rente typed in, so resolveAccountRate ASSUMES 0%. That number
  // drives the euros; the action has to admit where it came from.
  const ing = acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 20_000 });
  const t212 = acc({ key: "t212", bank: "Trading 212", type: "Betaalrekening", balance: 0, interestRate: 3.5 });

  const { actions } = optimiseReturns(accountReturns([ing, t212], [], [], undefined, [], [], "2026-08-18"));
  const move = actions.find((a) => a.kind === "move-balance");

  expect(move?.fromSource).toBe("assumed");
  expect(move?.toSource).toBe("manual");
});

/* --- "exact" answers WHICH outflows count, not how well the year is known.
 * A credit card with two transactions 61 days apart was printing a six-fold
 * extrapolation with no hedge, because only the upper-bound axis was checked. --- */

test("a credit card stretched from two months is hedged, even though its kind is exact", () => {
  const card = acc({ key: "amex", bank: "American Express", type: "Creditcard", balance: 0 });
  const txs = [
    tx({ id: "a", accountKey: "amex", date: "2026-06-27", amount: -8000, counterparty: "Vliegtickets" }),
    tx({ id: "b", accountKey: "amex", date: "2026-08-27", amount: -10 }),
  ];
  const base = annualSpendCents(card, txs, [], undefined, "2026-08-27");

  expect(base.kind).toBe("exact");        // every outflow on a card IS card spend
  expect(base.extrapolated).toBe(true);   // ...but 61 days is not a year
  expect(base.observedDays).toBeLessThan(CONFIDENT_SPEND_DAYS);
});

test("a full year on the same card is not hedged", () => {
  const card = acc({ key: "amex", bank: "American Express", type: "Creditcard", balance: 0 });
  const txs = Array.from({ length: 12 }, (_, i) =>
    tx({ id: "m" + i, accountKey: "amex", amount: -500,
         date: `2025-${String(i + 1).padStart(2, "0")}-15` }));
  const base = annualSpendCents(card, txs, [], undefined, "2026-01-15");

  expect(base.kind).toBe("exact");
  expect(base.extrapolated).toBe(false);
});

test("the hedge reaches the action, so the screen cannot state a figure it cannot support", () => {
  const card = acc({ key: "amex", bank: "American Express", type: "Creditcard", balance: 0 });
  const ing = acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 0 });
  const facts = [cashbackFact("American Express creditcard", "0"), cashbackFact("ING betaalpas", "1.5")];
  const txs = [
    tx({ id: "a", accountKey: "amex", date: "2026-06-27", amount: -8000, counterparty: "Vliegtickets" }),
    tx({ id: "b", accountKey: "amex", date: "2026-08-27", amount: -10 }),
  ];

  const { actions } = optimiseReturns(
    accountReturns([card, ing], txs, [], undefined, facts, [], "2026-08-27"),
  );
  const route = actions.find((a) => a.kind === "route-spending");

  expect(route?.approximate).toBe(true);
});
