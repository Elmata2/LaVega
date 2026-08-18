import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { annualSpendCents, MIN_SPEND_DAYS } from "./returns.js";
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
