import type { Account, Tx } from "../model.js";

/** Fixture helpers shared by the advisor inference tests. */
let n = 0;
export const mkTx = (
  counterparty: string,
  date: string,
  amount: number,
  o: Partial<Tx> = {},
): Tx => ({
  id: `t${n++}`,
  accountKey: "A1",
  date,
  amount,
  currency: "EUR",
  counterparty,
  description: "",
  category: "",
  manual: false,
  ...o,
});

export const mkAccount = (key: string, o: Partial<Account> = {}): Account => ({
  key,
  iban: "",
  name: key,
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: null,
  ...o,
});

/** `count` monthly rows on the same day of month, starting 2026-01. */
export const monthly = (
  counterparty: string,
  amount: number,
  count: number,
  day = "05",
  o: Partial<Tx> = {},
): Tx[] =>
  Array.from({ length: count }, (_, i) =>
    mkTx(counterparty, `2026-${String(i + 1).padStart(2, "0")}-${day}`, amount, o),
  );
