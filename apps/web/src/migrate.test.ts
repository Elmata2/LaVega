// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { expect, test, beforeEach } from "vitest";
import type { Account, Tx, Rule } from "@lavega/core";
import { createIndexedDbStorage, createEncryptedStorage } from "@lavega/adapters";
import { hasLegacyData, migrateToVault } from "./migrate.js";

const acc = (key: string, balance: number | null = null): Account => ({
  key,
  iban: key,
  name: key,
  bank: "",
  entity: "BV1",
  currency: "EUR",
  balance,
});
const tx = (id: string, accountKey: string): Tx => ({
  id,
  accountKey,
  date: "2026-06-01",
  amount: 12.34,
  currency: "EUR",
  counterparty: "Test",
  description: "",
  category: "",
  manual: false,
});
const rule = (id: string): Rule => ({ id, match: "test", category: "Diversen" });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

async function seedLegacy() {
  const legacy = createIndexedDbStorage();
  await legacy.putAccounts([acc("A1", 100), acc("A2", 200)]);
  await legacy.putTxs([tx("t1", "A1"), tx("t2", "A2")]);
  await legacy.putRules([rule("r1")]);
}

test("hasLegacyData is false on an empty legacy DB, true once seeded", async () => {
  expect(await hasLegacyData()).toBe(false);
  await seedLegacy();
  expect(await hasLegacyData()).toBe(true);
});

test("migrateToVault: seeds the vault, verifies, then deletes the plaintext DB", async () => {
  await seedLegacy();
  const vault = createEncryptedStorage();

  await migrateToVault(vault, "hunter2");

  // The vault (already unlocked from setup+re-verify) holds the migrated data.
  expect(await vault.getAccounts()).toHaveLength(2);
  expect(await vault.getTxs()).toHaveLength(2);
  expect(await vault.getRules()).toHaveLength(1);

  // A wrong passphrase cannot unlock the migrated vault.
  vault.lock();
  expect(await vault.unlock("WRONG")).toBe(false);
  expect(await vault.unlock("hunter2")).toBe(true);
  expect(await vault.getAccounts()).toHaveLength(2);

  // The legacy plaintext DB is gone/empty afterward.
  expect(await hasLegacyData()).toBe(false);
  const legacyAfter = createIndexedDbStorage();
  expect(await legacyAfter.getAccounts()).toHaveLength(0);
  expect(await legacyAfter.getRules()).toHaveLength(0);
});

test("failure before verification (setup throws): legacy DB is NOT deleted", async () => {
  await seedLegacy();
  const vault = createEncryptedStorage();
  // Pre-set-up the vault so the migration's vault.setup() call throws
  // ("kluis bestaat al") before any verification step runs.
  await vault.setup("already-set-up");

  await expect(migrateToVault(vault, "hunter2")).rejects.toThrow();

  // Safety invariant: plaintext must remain fully intact.
  expect(await hasLegacyData()).toBe(true);
  const legacy = createIndexedDbStorage();
  expect(await legacy.getAccounts()).toHaveLength(2);
  expect(await legacy.getTxs()).toHaveLength(2);
  expect(await legacy.getRules()).toHaveLength(1);
});
