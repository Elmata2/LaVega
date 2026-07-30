import { expect, test } from "vitest";
import { mapEbTransaction, mapEbAccount, pickEbBalance, ebAccountKey } from "./enableBankingMap.js";

/* Synthetic Enable Banking JSON — shapes mirror the clean-room reference
 * server.mjs's ebMapTx/ebAccountKey and the /api/eb/sync balance-pick logic.
 * Field names (transaction_amount, credit_debit_indicator, remittance_information,
 * account_id, balance_type, balance_amount, ...) match Enable Banking's actual API. */

test("mapEbTransaction: DBIT -> negative amount, counterparty from creditor, booking_date preferred", () => {
  const tx = {
    transaction_amount: { amount: "12.34", currency: "EUR" },
    credit_debit_indicator: "DBIT",
    remittance_information: ["Albert Heijn", "Boodschappen"],
    creditor: { name: "Albert Heijn BV" },
    creditor_account: { iban: "NL01AHBV0001" },
    debtor: { name: "My Company" },
    booking_date: "2026-01-05",
    value_date: "2026-01-06",
    bank_transaction_code: { description: "Betaalautomaat" },
  };
  const result = mapEbTransaction(tx, "ACC1");

  expect(result.amount).toBe(-12.34);
  expect(result.currency).toBe("EUR");
  expect(result.counterparty).toBe("Albert Heijn BV");
  expect(result.date).toBe("2026-01-05");
  expect(result.description).toBe("Albert Heijn Boodschappen");
  expect(result.accountKey).toBe("ACC1");
  expect(result.category).toBe("");
  expect(result.manual).toBe(false);
});

test("mapEbTransaction: CRDT -> positive amount, counterparty from debtor, value_date fallback when no booking_date", () => {
  const tx = {
    transaction_amount: { amount: 2500, currency: "EUR" },
    credit_debit_indicator: "CRDT",
    remittance_information: ["Salaris", "Juli"],
    debtor: { name: "Werkgever BV" },
    value_date: "2026-01-31",
  };
  const result = mapEbTransaction(tx, "ACC1");

  expect(result.amount).toBe(2500);
  expect(result.counterparty).toBe("Werkgever BV");
  expect(result.date).toBe("2026-01-31");
  expect(result.description).toBe("Salaris Juli");
});

test("mapEbTransaction: missing remittance_information falls back to bank_transaction_code.description, counterparty falls back to IBAN", () => {
  const tx = {
    transaction_amount: { amount: 50, currency: "EUR" },
    credit_debit_indicator: "DBIT",
    bank_transaction_code: { description: "Betaalautomaat" },
    creditor_account: { iban: "NL02XXXX0002" },
    booking_date: "2026-02-01",
  };
  const result = mapEbTransaction(tx, "ACC1");

  expect(result.description).toBe("Betaalautomaat");
  expect(result.counterparty).toBe("NL02XXXX0002");
});

test("mapEbTransaction: multi-currency — transaction_amount.currency wins over fallbackCurrency", () => {
  const tx = {
    transaction_amount: { amount: 10, currency: "USD" },
    credit_debit_indicator: "CRDT",
    debtor: { name: "Foo" },
    booking_date: "2026-03-01",
  };
  expect(mapEbTransaction(tx, "ACC1", "EUR").currency).toBe("USD");
});

test("mapEbTransaction: multi-currency — missing transaction_amount.currency falls back to fallbackCurrency", () => {
  const tx = {
    transaction_amount: { amount: 10 },
    credit_debit_indicator: "CRDT",
    debtor: { name: "Foo" },
    booking_date: "2026-03-01",
  };
  expect(mapEbTransaction(tx, "ACC1", "USD").currency).toBe("USD");
});

test("mapEbTransaction: no currency and no fallback defaults to EUR", () => {
  const tx = {
    transaction_amount: { amount: 10 },
    credit_debit_indicator: "CRDT",
    debtor: { name: "Foo" },
    booking_date: "2026-03-01",
  };
  expect(mapEbTransaction(tx, "ACC1").currency).toBe("EUR");
});

test("pickEbBalance: prefers CLBD over the first entry", () => {
  const balances = [
    { balance_type: "XPCD", balance_amount: { amount: 999, currency: "EUR" } },
    { balance_type: "CLBD", balance_amount: { amount: 100, currency: "EUR" }, credit_debit_indicator: "CRDT" },
  ];
  expect(pickEbBalance(balances)).toBe(100);
});

test("pickEbBalance: falls back to the first entry when no CLBD/closingBooked present", () => {
  const balances = [
    { balance_type: "XPCD", balance_amount: { amount: 55, currency: "EUR" } },
    { balance_type: "OTHR", balance_amount: { amount: 77, currency: "EUR" } },
  ];
  expect(pickEbBalance(balances)).toBe(55);
});

test("pickEbBalance: DBIT balance is negated", () => {
  const balances = [
    { balance_type: "closingBooked", balance_amount: { amount: 42 }, credit_debit_indicator: "DBIT" },
  ];
  expect(pickEbBalance(balances)).toBe(-42);
});

test("pickEbBalance: empty or missing balances -> null", () => {
  expect(pickEbBalance([])).toBeNull();
  expect(pickEbBalance(undefined)).toBeNull();
});

test("ebAccountKey: prefers IBAN, then other.identification, then uid, then 'onbekend'", () => {
  expect(ebAccountKey({ account_id: { iban: "NL01ABCD0001" }, uid: "uid-1" })).toBe("NL01ABCD0001");
  expect(ebAccountKey({ account_id: { other: { identification: "OTHR-1" } }, uid: "uid-1" })).toBe("OTHR-1");
  expect(ebAccountKey({ uid: "uid-1" })).toBe("uid-1");
  expect(ebAccountKey({})).toBe("onbekend");
});

test("mapEbAccount: key/iban from account_id.iban, bank strips trailing country suffix, entity starts empty, balance passed through", () => {
  const account = mapEbAccount(
    { uid: "uid-123", account_id: { iban: "NL01ABCD0001" }, name: "Zakelijke rekening", currency: "EUR", aspsp: "ING (NL)" },
    1234.56,
  );

  expect(account.key).toBe("NL01ABCD0001");
  expect(account.iban).toBe("NL01ABCD0001");
  expect(account.name).toBe("Zakelijke rekening");
  expect(account.bank).toBe("ING");
  expect(account.entity).toBe("");
  expect(account.currency).toBe("EUR");
  expect(account.balance).toBe(1234.56);
});

test("mapEbAccount: no IBAN falls back to uid for key, iban/bank default to '', null balance passed through", () => {
  const account = mapEbAccount({ uid: "uid-999", name: "Spaarrekening", currency: "EUR" }, null);

  expect(account.key).toBe("uid-999");
  expect(account.iban).toBe("");
  expect(account.bank).toBe("");
  expect(account.balance).toBeNull();
});
