import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { currentBalance, withCurrentBalances, isCardAccount, accountType } from "./balance.js";

const acc = (key: string, balance: number | null, balanceDate?: string): Account =>
  ({ key, iban: key, name: key, bank: "", entity: "BV1", currency: "EUR", balance, balanceDate });
const tx = (key: string, date: string, amount: number): Tx =>
  ({ id: date + amount, accountKey: key, date, amount, currency: "EUR", counterparty: "", description: "", category: "", manual: false });

test("no balanceDate => balance returned as-is", () => {
  expect(currentBalance(acc("A", 100), [tx("A", "2026-07-01", -50)], "2026-08-01")).toBe(100);
});
test("rolls forward only txs strictly after balanceDate and <= asOf", () => {
  const txs = [tx("A", "2026-06-30", 999), tx("A", "2026-07-05", -20), tx("A", "2026-07-20", 5), tx("A", "2026-09-01", -1000)];
  // balanceDate 2026-06-30: include 07-05 and 07-20 (not 06-30 itself, not 09-01 > asOf 08-01)
  expect(currentBalance(acc("A", 100, "2026-06-30"), txs, "2026-08-01")).toBe(85);
});
test("null balance stays null", () => {
  expect(currentBalance(acc("A", null, "2026-06-30"), [tx("A", "2026-07-05", -20)], "2026-08-01")).toBeNull();
});
test("only this account's txs count", () => {
  expect(currentBalance(acc("A", 100, "2026-06-30"), [tx("B", "2026-07-05", -20)], "2026-08-01")).toBe(100);
});
test("withCurrentBalances maps every account", () => {
  const out = withCurrentBalances([acc("A", 100, "2026-06-30"), acc("B", null)], [tx("A", "2026-07-05", -20)], "2026-08-01");
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
  expect(accountType({ ...acc("A", 100), bank: "ING", type: "Spaarrekening" })).toBe("Spaarrekening");
});
