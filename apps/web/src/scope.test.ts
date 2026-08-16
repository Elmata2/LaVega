import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { Account, EntityProfile, ScheduledFlow, Tx } from "@lavega/core";
import { accountsInScope } from "@lavega/core";
import { SCOPE_LABELS, SCOPE_ORDER, entityOptionsFor, flowsForScope, txsForAccounts } from "./scope.js";

/* The Persoonlijk | Zakelijk switch: what the shell actually filters when it is
 * flipped. The classification itself is core's (entities.ts) — these prove the
 * shell applies it to all three lists it hands down, and that the per-company
 * entity scope keeps working underneath. */

const account = (key: string, entity: string): Account =>
  ({ key, iban: key, name: key, bank: "ING", entity, currency: "EUR", balance: 100 }) as Account;

const tx = (id: string, accountKey: string): Tx =>
  ({
    id,
    accountKey,
    date: "2026-08-01",
    amount: -10,
    currency: "EUR",
    counterparty: "x",
    description: "x",
    category: "",
    manual: false,
  }) as Tx;

const flow = (id: string, entity: string): ScheduledFlow => ({
  id,
  entity,
  label: "btw",
  sign: -1,
  amountCents: 1000,
  dueDate: "2026-10-31",
  source: "vat",
  status: "expected",
});

const accounts = [account("prive", "Privé"), account("bv1", "BV1"), account("bv2", "BV2")];
// Only BV1 is classified; BV2 and Privé fall to core's personal default.
const profiles: EntityProfile[] = [{ entity: "BV1", scope: "business" }];

test("the switch reads Persoonlijk | Zakelijk, in that order", () => {
  expect(SCOPE_ORDER.map((s) => SCOPE_LABELS[s])).toEqual(["Persoonlijk", "Zakelijk"]);
});

test("switching to zakelijk shows the classified entity's accounts and nothing else", () => {
  expect(accountsInScope(accounts, "business", profiles).map((a) => a.key)).toEqual(["bv1"]);
});

test("switching to persoonlijk shows everything not classified as a company", () => {
  expect(accountsInScope(accounts, "personal", profiles).map((a) => a.key)).toEqual(["prive", "bv2"]);
});

test("a transaction follows its account's half — never its own", () => {
  const txs = [tx("t1", "prive"), tx("t2", "bv1"), tx("t3", "bv2")];
  const business = accountsInScope(accounts, "business", profiles);
  const personal = accountsInScope(accounts, "personal", profiles);
  expect(txsForAccounts(business, txs).map((t) => t.id)).toEqual(["t2"]);
  expect(txsForAccounts(personal, txs).map((t) => t.id)).toEqual(["t1", "t3"]);
});

test("a company's VAT reservation never surfaces while you look at your private money", () => {
  const flows = [flow("f1", "Privé"), flow("f2", "BV1")];
  expect(flowsForScope(flows, "personal", profiles).map((f) => f.id)).toEqual(["f1"]);
  expect(flowsForScope(flows, "business", profiles).map((f) => f.id)).toEqual(["f2"]);
});

test("the entity scope the views still receive is built from the half in view", () => {
  // Belasting's per-BV modules and Transacties' company filter read this list.
  expect(entityOptionsFor(accountsInScope(accounts, "business", profiles))).toEqual(["BV1"]);
  expect(entityOptionsFor(accountsInScope(accounts, "personal", profiles))).toEqual(["Privé", "BV2"]);
});

test("an unclassified vault opens on the half that holds everything it has", () => {
  // No profiles at all: core's default is personal, so nothing is hidden on a
  // first run and nothing is silently promoted to zakelijk.
  expect(accountsInScope(accounts, "personal", []).map((a) => a.key)).toEqual(["prive", "bv1", "bv2"]);
  expect(accountsInScope(accounts, "business", [])).toEqual([]);
});

test("the shell scopes on the classification, not on a second axis of its own", () => {
  const src = readFileSync(new URL("./scope.ts", import.meta.url), "utf8");
  expect(src).toContain('from "@lavega/core"');
  expect(src).toContain("entityScope(f.entity, profiles)");
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  expect(app).toContain("accountsInScope(accounts, scope, entityProfiles)");
  // The classification is persisted in the vault, not invented per session.
  expect(app).toContain("storage.putEntityProfiles(profiles)");
  expect(app).toContain("storage.getEntityProfiles()");
});
