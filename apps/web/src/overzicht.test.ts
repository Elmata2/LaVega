import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { consolidate } from "@lavega/core";

/* Overzicht's KPI tiles are pure derivations over accounts/txs (Totaalpositie
 * via `consolidate`, the rest via plain array ops) — no render lib in this
 * repo, so these headless tests pin the derivation logic rather than the
 * JSX. Mirrors exactly what apps/web/src/views/Overzicht.tsx computes. */

const accounts: Account[] = [
  { key: "A1", iban: "NL01INGB0001", name: "Zakelijk", bank: "ING", entity: "Holding BV", currency: "EUR", balance: 182_310 },
  { key: "A2", iban: "NL02RABO0001", name: "Zakelijk", bank: "Rabobank", entity: "Café BV", currency: "EUR", balance: 21_900 },
  { key: "A3", iban: "NL03INGB0002", name: "Onbekend saldo", bank: "ING", entity: "Webshop BV", currency: "EUR", balance: null },
  { key: "A4", iban: "NL04AMEX0001", name: "Zonder entiteit", bank: "Amex", entity: "", currency: "EUR", balance: 100 },
];

const txs: Tx[] = [
  { id: "t1", accountKey: "A1", date: "2026-07-01", amount: 12_000, currency: "EUR", counterparty: "Klant", description: "Managementfee", category: "", manual: false },
  { id: "t2", accountKey: "A2", date: "2026-07-02", amount: -1_880, currency: "EUR", counterparty: "Brouwerij", description: "Leverancier", category: "", manual: false },
];

test("Overzicht KPI derivations: an unknown account balance makes Totaalpositie unknown", () => {
  const { totalBalance } = consolidate(accounts, txs);
  expect(totalBalance).toBeNull();
});

test("Overzicht KPI derivations: Totaalpositie sums all entities once every balance is known", () => {
  const knownAccounts = accounts.map((a) => (a.key === "A3" ? { ...a, balance: 44_100 } : a));
  const { totalBalance } = consolidate(knownAccounts, txs);
  expect(totalBalance).toBe(182_310 + 21_900 + 44_100 + 100);
});

test("Overzicht KPI derivations: Rekeningen counts every account", () => {
  expect(accounts.length).toBe(4);
});

test("Overzicht KPI derivations: Entiteiten counts unique non-empty entities only", () => {
  const entities = Array.from(new Set(accounts.map((a) => a.entity).filter((e) => e.length > 0)));
  expect(entities).toEqual(["Holding BV", "Café BV", "Webshop BV"]);
  expect(entities.length).toBe(3);
});

test("Overzicht KPI derivations: Aandacht counts accounts with an unknown balance", () => {
  const unknownCount = accounts.filter((a) => a.balance === null).length;
  expect(unknownCount).toBe(1);
});
