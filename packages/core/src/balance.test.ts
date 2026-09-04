import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import {
  currentBalance,
  withCurrentBalances,
  isCardAccount,
  accountType,
  availableBalanceCents,
} from "./balance.js";
import { makeScheduledFlow } from "./scheduledFlows.js";

const acc = (key: string, balance: number | null, balanceDate?: string): Account => ({
  key,
  iban: key,
  name: key,
  bank: "",
  entity: "BV1",
  currency: "EUR",
  balance,
  balanceDate,
});
const tx = (key: string, date: string, amount: number): Tx => ({
  id: date + amount,
  accountKey: key,
  date,
  amount,
  currency: "EUR",
  counterparty: "",
  description: "",
  category: "",
  manual: false,
});

test("no balanceDate => balance returned as-is", () => {
  expect(currentBalance(acc("A", 100), [tx("A", "2026-07-01", -50)], "2026-08-01")).toBe(100);
});
test("rolls forward only txs strictly after balanceDate and <= asOf", () => {
  const txs = [
    tx("A", "2026-06-30", 999),
    tx("A", "2026-07-05", -20),
    tx("A", "2026-07-20", 5),
    tx("A", "2026-09-01", -1000),
  ];
  // balanceDate 2026-06-30: include 07-05 and 07-20 (not 06-30 itself, not 09-01 > asOf 08-01)
  expect(currentBalance(acc("A", 100, "2026-06-30"), txs, "2026-08-01")).toBe(85);
});
test("null balance stays null", () => {
  expect(
    currentBalance(acc("A", null, "2026-06-30"), [tx("A", "2026-07-05", -20)], "2026-08-01"),
  ).toBeNull();
});
test("only this account's txs count", () => {
  expect(
    currentBalance(acc("A", 100, "2026-06-30"), [tx("B", "2026-07-05", -20)], "2026-08-01"),
  ).toBe(100);
});
test("withCurrentBalances maps every account", () => {
  const out = withCurrentBalances(
    [acc("A", 100, "2026-06-30"), acc("B", null)],
    [tx("A", "2026-07-05", -20)],
    "2026-08-01",
  );
  expect(out[0].balance).toBe(80);
  expect(out[1].balance).toBeNull();
});

test("isCardAccount: Amex is a card (owed-balance stored negative), banks are not", () => {
  expect(isCardAccount(acc("A", 100))).toBe(false); // bank ""
  expect(isCardAccount({ ...acc("A", 100), bank: "American Express" })).toBe(true);
  expect(isCardAccount({ ...acc("A", 100), bank: "ING" })).toBe(false);
});

test("accountType: no type + Amex bank => smart default Creditcard", () => {
  expect(accountType({ ...acc("A", 100), bank: "American Express" })).toBe("Creditcard");
});
test("accountType: no type + other bank => smart default Betaalrekening", () => {
  expect(accountType({ ...acc("A", 100), bank: "ING" })).toBe("Betaalrekening");
});
test("accountType: explicit type wins over the smart default", () => {
  expect(accountType({ ...acc("A", 100), bank: "ING", type: "Spaarrekening" })).toBe(
    "Spaarrekening",
  );
});

test("accountType: no type + savings name => Spaarrekening (ING Oranje, Revolut Savings)", () => {
  expect(accountType({ ...acc("A", 100), name: "Oranje Spaarrekening", bank: "ING" })).toBe(
    "Spaarrekening",
  );
  expect(accountType({ ...acc("A", 100), name: "Savings", bank: "Revolut" })).toBe("Spaarrekening");
  expect(accountType({ ...acc("A", 100), name: "Betaalrekening", bank: "Revolut" })).toBe(
    "Betaalrekening",
  );
});

test("availableBalanceCents subtracts unpaid VAT reservations from the total", () => {
  const flows = [
    makeScheduledFlow({
      entity: "BV1",
      label: "BTW",
      sign: -1,
      amountCents: 45000,
      dueDate: "2026-05-01",
      source: "vat",
      status: "confirmed",
    }),
  ];
  expect(availableBalanceCents(1000, flows, "2026-04-01")).toBe(100000 - 45000); // €1000 - €450 = €550
  expect(availableBalanceCents(1000, [], "2026-04-01")).toBe(100000);
});

/* --- isCardAccount: which accounts read as a CREDIT card. The travel agent
 * looks up a different tariff for a creditcard than for a betaalpas, so a
 * wrong answer here is a wrong fee abroad, not a cosmetic label. --- */

test("isCardAccount recognises a credit card by name, not only American Express", () => {
  const acc = (bank: string, name = ""): Account =>
    ({ key: "k", iban: "", name, bank, entity: "e", currency: "EUR", balance: null }) as Account;

  expect(isCardAccount(acc("American Express"))).toBe(true);
  expect(isCardAccount(acc("ING", "ING Creditcard"))).toBe(true);
  expect(isCardAccount(acc("ABN AMRO", "Credit Card Gold"))).toBe(true);
  expect(isCardAccount(acc("", "Amex activity"))).toBe(true);

  // A debit card is not a credit card, however card-like its name is. Visa and
  // Mastercard both issue debit cards, and the Trading 212 "212 Card" IS one.
  expect(isCardAccount(acc("Trading 212", "212 Card"))).toBe(false);
  expect(isCardAccount(acc("ING", "Visa Debit"))).toBe(false);
  expect(isCardAccount(acc("bunq", "Mastercard betaalpas"))).toBe(false);
  expect(isCardAccount(acc("ING", "Betaalrekening"))).toBe(false);
});

test("accountType: a named credit card defaults to Creditcard, and an explicit type still wins", () => {
  const base = { key: "k", iban: "", entity: "e", currency: "EUR", balance: null };
  expect(accountType({ ...base, bank: "ING", name: "ING Creditcard" } as Account)).toBe(
    "Creditcard",
  );
  expect(accountType({ ...base, bank: "Trading 212", name: "212 Card" } as Account)).toBe(
    "Betaalrekening",
  );
  // the owner's own choice is never second-guessed
  expect(
    accountType({
      ...base,
      bank: "ING",
      name: "ING Creditcard",
      type: "Betaalrekening",
    } as Account),
  ).toBe("Betaalrekening");
});
