import { expect, test } from "vitest";
import type { Account } from "@lavega/core";
import { saveBalance } from "./saveBalance";

const acc = (over: Partial<Account>): Account => ({
  key: "k",
  iban: "",
  name: "Card",
  bank: "American Express",
  entity: "P",
  currency: "EUR",
  balance: null,
  ...over,
});
const ok = () => {
  const writes: Account[][] = [];
  return { writes, store: { putAccounts: async (a: Account[]) => void writes.push(a) } };
};

test("a credit card's typed amount is stored as a debt; a debit one as typed", async () => {
  const { store } = ok();
  expect((await saveBalance(store, acc({}), "250", "2026-11-16"))!.balance).toBe(-250);
  expect(
    (await saveBalance(
      store,
      acc({ bank: "Trading 212", name: "212 Card" }),
      "250,50",
      "2026-11-16",
    ))!.balance,
  ).toBe(250.5);
});

test("zero stores 0, not -0, and renders without a minus", async () => {
  const { store } = ok();
  for (const v of ["0", "0,00"]) {
    const b = (await saveBalance(store, acc({}), v, "2026-11-16"))!.balance!;
    expect(Object.is(b, 0)).toBe(true);
    expect(`${b}`).toBe("0");
  }
});

test("a rejected write rejects and returns nothing to show", async () => {
  const store = { putAccounts: async () => Promise.reject(new Error("disk full")) };
  await expect(saveBalance(store, acc({}), "250", "2026-11-16")).rejects.toThrow("disk full");
});

test("garbage writes nothing; blank clears to unknown", async () => {
  const { store, writes } = ok();
  expect(await saveBalance(store, acc({}), "abc", "2026-11-16")).toBeNull();
  expect(writes).toHaveLength(0);
  const cleared = (await saveBalance(
    store,
    acc({ balance: -5, balanceDate: "x" }),
    " ",
    "2026-11-16",
  ))!;
  expect(cleared.balance).toBeNull();
  expect(cleared.balanceDate).toBeUndefined();
});
