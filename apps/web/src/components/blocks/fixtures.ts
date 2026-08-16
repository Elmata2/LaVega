import type { Account, Alert, EntityForecast, OwnAccounts, Rule, ScheduledFlow, Tx } from "@lavega/core";
import { ownAccounts } from "@lavega/core";

/* Shared props for the block render tests.
 *
 * Every block takes only props, so a fixture set is all a test needs — no
 * store, no App, no DOM. Kept in one file so the blocks are exercised against
 * the SAME data and their numbers stay comparable. */

export const ASOF = "2026-08-16";

export const accounts: Account[] = [
  { key: "A1", iban: "NL01INGB0001", name: "Zakelijk", bank: "ING", entity: "Holding BV", currency: "EUR", balance: 182_310 },
  { key: "A2", iban: "NL02RABO0001", name: "Zakelijk", bank: "Rabobank", entity: "Café BV", currency: "EUR", balance: 21_900 },
  { key: "A3", iban: "NL03INGB0002", name: "Zonder saldo", bank: "ING", entity: "Webshop BV", currency: "EUR", balance: null },
];

export const txs: Tx[] = [
  { id: "t1", accountKey: "A1", date: "2026-06-04", amount: 12_000, currency: "EUR", counterparty: "Klant BV", description: "Managementfee juni", category: "", manual: false },
  { id: "t2", accountKey: "A1", date: "2026-06-09", amount: -420.5, currency: "EUR", counterparty: "Albert Heijn", description: "Boodschappen", category: "", manual: false },
  { id: "t3", accountKey: "A2", date: "2026-07-02", amount: -1_880, currency: "EUR", counterparty: "Brouwerij", description: "Leverancier", category: "Inkoop", manual: true },
  { id: "t4", accountKey: "A1", date: "2026-07-05", amount: 9_500, currency: "EUR", counterparty: "Klant BV", description: "Managementfee juli", category: "", manual: false },
  { id: "t5", accountKey: "A2", date: "2026-08-03", amount: -250, currency: "EUR", counterparty: "Vattenfall", description: "Energie augustus", category: "", manual: false },
  { id: "t6", accountKey: "A1", date: "2026-08-11", amount: -1_100, currency: "EUR", counterparty: "Brouwerij", description: "Leverancier", category: "Inkoop", manual: true },
];

export const rules: Rule[] = [{ id: "r1", match: "Vattenfall", category: "Energie" }];

export const own: OwnAccounts = ownAccounts(accounts);

export const scheduledFlows: ScheduledFlow[] = [
  { id: "s1", entity: "Holding BV", label: "BTW Q2 2026", sign: -1, amountCents: 412_500, dueDate: "2026-07-31", source: "vat", status: "confirmed" },
  { id: "s2", entity: "Café BV", label: "Factuur Klant BV", sign: 1, amountCents: 120_000, dueDate: "2026-08-28", source: "invoice", status: "expected" },
  { id: "s3", entity: "Holding BV", label: "BTW Q3 2026", sign: -1, amountCents: 380_000, dueDate: "2026-10-31", source: "vat", status: "expected" },
  { id: "s4", entity: "Holding BV", label: "Al betaald", sign: -1, amountCents: 100_000, dueDate: "2026-05-31", source: "vat", status: "paid" },
];

export const alerts: Alert[] = [
  { id: "al1", severity: "critical", title: "Tekort verwacht in week 6", detail: "Verwacht saldo € 1.200 onder je buffer." },
  { id: "al2", severity: "info", title: "1 rekening zonder saldo", detail: "Vul het saldo in bij Rekeningen." },
];

/** A small but complete forecast, written out rather than computed so the
 *  block test asserts on the block, not on the forecast engine. */
export const forecast: EntityForecast = {
  scope: "geconsolideerd",
  asOf: ASOF,
  horizonDays: 91,
  openingCents: 20_421_000,
  points: [
    { date: "2026-08-23", projectedClosingCents: 20_100_000, lowerCents: 19_800_000, upperCents: 20_400_000 },
    { date: "2026-08-30", projectedClosingCents: 19_600_000, lowerCents: 19_100_000, upperCents: 20_100_000 },
    { date: "2026-09-06", projectedClosingCents: 19_050_000, lowerCents: 18_300_000, upperCents: 19_800_000 },
  ],
  shortfall: null,
  streams: [],
  drivers: [],
};
