import { expect, test } from "vitest";
import { parseMt940 } from "./mt940.js";

const MT940 = [
  ":20:STARTUMS",
  ":25:NL91ABNA0417164300",
  ":28C:00001/001",
  ":60F:C260101EUR1000,00",
  ":61:2601020102D75,50NTRFNONREF",
  ":86:/NAME/Albert Heijn/REMI/Boodschappen betaalpas",
  ":61:2601030103C2500,00NTRFNONREF",
  ":86:/NAME/Werkgever BV/REMI/Salaris januari",
  ":62F:C260103EUR3424,50",
  ":64:C260103EUR3424,50",
].join("\n");

test("MT940: parses txs with DBIT->negative / CRDT->positive, ISO dates, and the :62F: closing balance", () => {
  const { accounts, txs } = parseMt940(MT940);

  expect(txs).toHaveLength(2);
  expect(txs[0]).toMatchObject({
    date: "2026-01-02", amount: -75.5, counterparty: "Albert Heijn",
    description: "Boodschappen betaalpas", currency: "EUR", accountKey: "NL91ABNA0417164300",
  });
  expect(txs[1]).toMatchObject({
    date: "2026-01-03", amount: 2500, counterparty: "Werkgever BV", description: "Salaris januari",
  });

  expect(accounts).toHaveLength(1);
  expect(accounts[0]).toMatchObject({
    key: "NL91ABNA0417164300", iban: "NL91ABNA0417164300", bank: "ABN AMRO",
    entity: "", balance: 3424.5, // real closing balance from :62F:, not null
  });
});

test("MT940: a debit :61: line yields a negative amount", () => {
  const { txs } = parseMt940(MT940);
  expect(txs[0].amount).toBeLessThan(0);
  expect(txs[1].amount).toBeGreaterThan(0);
});

test("MT940: the parsed account's balanceDate is the last (max) :61: tx date in the block", () => {
  const { accounts } = parseMt940(MT940);
  expect(accounts[0].balanceDate).toBe("2026-01-03");
});
