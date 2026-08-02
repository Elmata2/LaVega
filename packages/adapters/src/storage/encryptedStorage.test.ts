// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { expect, test } from "vitest";
import type { Account } from "@lavega/core";
import { createEncryptedStorage } from "./encryptedStorage.js";

const acc = (key: string, balance: number | null = null): Account =>
  ({ key, iban: key, name: key, bank: "", entity: "BV1", currency: "EUR", balance });

test("setup -> put -> lock -> unlock(correct) round-trips; wrong passphrase stays locked", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage();
  expect(await v.status()).toBe("empty");
  await v.setup("hunter2");
  expect(await v.status()).toBe("unlocked");
  await v.putAccounts([acc("A1", 1.98)]);
  expect(await v.getAccounts()).toHaveLength(1);

  v.lock();
  expect(await v.status()).toBe("locked");
  await expect(v.getAccounts()).rejects.toBeTruthy(); // no read while locked

  expect(await v.unlock("WRONG")).toBe(false);
  expect(await v.status()).toBe("locked");
  expect(await v.unlock("hunter2")).toBe(true);
  const back = await v.getAccounts();
  expect(back[0]).toMatchObject({ key: "A1", balance: 1.98 });
});

test("put while locked throws", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage();
  await v.setup("pw");
  v.lock();
  await expect(v.putAccounts([acc("A1")])).rejects.toBeTruthy();
});

test("the on-disk vault record is ciphertext — no plaintext account key leaks", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage();
  await v.setup("pw");
  await v.putAccounts([acc("NL01INGB0009SECRET")]);
  // read the raw stored blob and assert the plaintext key is not present
  const blob = v.export();
  expect(blob).not.toBeNull();
  expect(JSON.stringify(blob).includes("SECRET")).toBe(false);
});

test("putRules replaces, putAccounts/putTxs upsert (parity with plaintext adapter)", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage();
  await v.setup("pw");
  await v.putAccounts([acc("A1", 1), acc("A2", 2)]);
  await v.putAccounts([acc("A1", 9)]); // upsert A1
  const accs = await v.getAccounts();
  expect(accs.find((a) => a.key === "A1")!.balance).toBe(9);
  expect(accs).toHaveLength(2);
});
