// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import type { CipherBlob } from "../crypto/vaultCrypto.js";
import { createEncryptedStorage } from "./encryptedStorage.js";

const acc = (key: string, balance: number | null = null): Account =>
  ({ key, iban: key, name: key, bank: "", entity: "BV1", currency: "EUR", balance });

const tx = (id: string, accountKey: string): Tx =>
  ({ id, accountKey, date: "2026-06-01", amount: -5, currency: "EUR",
     counterparty: "", description: "", category: "", manual: false });

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
  await v.putAccounts([acc("A1", 9)]); // upsert A1 by key
  expect((await v.getAccounts()).find((a) => a.key === "A1")!.balance).toBe(9);
  expect(await v.getAccounts()).toHaveLength(2);

  // putTxs upserts by id
  const t = (id: string, amount: number): Tx => ({ id, accountKey: "A1", date: "2026-06-01", amount, currency: "EUR", counterparty: "", description: "", category: "", manual: false });
  await v.putTxs([t("x", 10), t("y", 20)]);
  await v.putTxs([t("x", 99)]); // upsert x
  expect((await v.getTxs()).find((tx) => tx.id === "x")!.amount).toBe(99);
  expect(await v.getTxs()).toHaveLength(2);

  // putRules replaces the whole set
  await v.putRules([{ id: "r1", match: "a", category: "X" }, { id: "r2", match: "b", category: "Y" }]);
  await v.putRules([{ id: "r2", match: "b", category: "Z" }]);
  const rules = await v.getRules();
  expect(rules).toHaveLength(1);
  expect(rules[0]).toMatchObject({ id: "r2", category: "Z" });
});

test("export -> restore round-trips onto a fresh vault instance (fresh-machine recovery)", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v1 = createEncryptedStorage();
  await v1.setup("hunter2");
  await v1.putAccounts([acc("A1", 1.98)]);
  const backupBlob = v1.export();
  expect(backupBlob).not.toBeNull();

  // Simulate a fresh machine: a brand new disk, a brand new vault instance.
  globalThis.indexedDB = new IDBFactory();
  const v2 = createEncryptedStorage();
  expect(await v2.status()).toBe("empty");

  const ok = await v2.restore(backupBlob!, "hunter2");
  expect(ok).toBe(true);
  expect(await v2.status()).toBe("unlocked");
  const accounts = await v2.getAccounts();
  expect(accounts).toHaveLength(1);
  expect(accounts[0]).toMatchObject({ key: "A1", balance: 1.98 });

  // And it's genuinely persisted, not just in memory.
  v2.lock();
  expect(await v2.unlock("hunter2")).toBe(true);
  expect(await v2.getAccounts()).toHaveLength(1);
});

test("restore replaces an existing (different) vault's data on success", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v1 = createEncryptedStorage();
  await v1.setup("backup-pw");
  await v1.putAccounts([acc("FROM-BACKUP", 5)]);
  const backupBlob = v1.export()!;

  const v2 = createEncryptedStorage("second-db");
  await v2.setup("current-pw");
  await v2.putAccounts([acc("CURRENT", 1)]);

  const ok = await v2.restore(backupBlob, "backup-pw");
  expect(ok).toBe(true);
  const accounts = await v2.getAccounts();
  expect(accounts).toHaveLength(1);
  expect(accounts[0]).toMatchObject({ key: "FROM-BACKUP", balance: 5 });
});

test("restore(wrong passphrase) => false; existing vault's data + on-disk blob stay intact", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage();
  await v.setup("current-pw");
  await v.putAccounts([acc("EXIST1", 42)]);
  const beforeBlob = v.export();

  const ok = await v.restore(beforeBlob!, "WRONG-PASSPHRASE");
  expect(ok).toBe(false);
  expect(await v.status()).toBe("unlocked"); // untouched — still the original, still unlocked
  const accounts = await v.getAccounts();
  expect(accounts).toHaveLength(1);
  expect(accounts[0]).toMatchObject({ key: "EXIST1", balance: 42 });
  expect(v.export()).toEqual(beforeBlob); // on-disk blob unchanged too
});

test("restore(malformed blob) => false; existing vault stays intact", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage();
  await v.setup("pw");
  await v.putAccounts([acc("EXIST1", 7)]);
  const beforeBlob = v.export();

  const malformed: CipherBlob = {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations: 210_000,
    salt: "!!!not-valid-base64!!!",
    iv: "!!!",
    ct: "!!!",
  };
  const ok = await v.restore(malformed, "pw");
  expect(ok).toBe(false);
  expect(await v.status()).toBe("unlocked");
  const accounts = await v.getAccounts();
  expect(accounts).toHaveLength(1);
  expect(accounts[0]).toMatchObject({ key: "EXIST1", balance: 7 });
  expect(v.export()).toEqual(beforeBlob);
});

test("restore(sub-floor iterations) => false; existing vault stays intact", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage();
  await v.setup("pw");
  await v.putAccounts([acc("EXIST1", 3)]);
  const beforeBlob = v.export()!;

  // A tampered blob claiming a tiny work factor must be rejected (deriveKey
  // throws below the PBKDF2 floor), not silently adopted.
  const tampered: CipherBlob = { ...beforeBlob, iterations: 1 };
  const ok = await v.restore(tampered, "pw");
  expect(ok).toBe(false);
  expect(await v.status()).toBe("unlocked");
  expect(v.export()).toEqual(beforeBlob);
});

test("concurrent puts are serialized — neither write reverts the other", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage();
  await v.setup("pw");
  const t = (id: string): Tx => ({ id, accountKey: "A1", date: "2026-06-01", amount: 1, currency: "EUR", counterparty: "", description: "", category: "", manual: false });
  // Fire two writes without awaiting between them; the write-queue must serialize
  // so a stale snapshot's encrypt can't land last and drop the other's data.
  await Promise.all([v.putAccounts([acc("A1", 5)]), v.putTxs([t("x")])]);
  expect(await v.getAccounts()).toHaveLength(1);
  expect(await v.getTxs()).toHaveLength(1);
  // And it survives a lock/unlock reload (persisted, not just in memory)
  v.lock();
  expect(await v.unlock("pw")).toBe(true);
  expect(await v.getAccounts()).toHaveLength(1);
  expect(await v.getTxs()).toHaveLength(1);
});

test("concurrent put + restore: restore's adopt is serialized after in-flight puts (memory == disk)", async () => {
  globalThis.indexedDB = new IDBFactory();
  // A back-up from a separate source vault.
  const src = createEncryptedStorage("src-db");
  await src.setup("imported-pw");
  await src.putAccounts([acc("IMPORTED", 100)]);
  const backup = src.export()!;

  const v = createEncryptedStorage();
  await v.setup("current-pw");
  await v.putAccounts([acc("CURRENT", 1)]);

  // Fire a put and a restore concurrently. The put enqueues synchronously; the
  // restore only enqueues its adopt after its (slow) verify, so the adopt runs
  // last and the vault becomes the imported one — consistently on disk, not
  // clobbered by the in-flight put.
  await Promise.all([v.putAccounts([acc("CURRENT2", 2)]), v.restore(backup, "imported-pw")]);

  v.lock();
  expect(await v.unlock("imported-pw")).toBe(true); // disk holds the imported blob
  const accs = await v.getAccounts();
  expect(accs).toHaveLength(1);
  expect(accs[0]).toMatchObject({ key: "IMPORTED", balance: 100 });
});

test("scheduledFlows + vatSettings round-trip; legacy vault defaults to empty", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createEncryptedStorage("lavega-vault-test-sf");
  await s.setup("pw");
  expect(await s.getScheduledFlows()).toEqual([]); // default
  const flow = { id: "f1", entity: "BV1", label: "BTW", sign: -1 as const, amountCents: 1000, dueDate: "2026-05-01", source: "vat" as const, status: "confirmed" as const };
  await s.putScheduledFlows([flow]);
  await s.putVatSettings([{ entity: "BV1", frequency: "quarterly", defaultRatePct: 21, mixedRates: false }]);
  expect(await s.getScheduledFlows()).toEqual([flow]);
  expect(await s.getVatSettings()).toHaveLength(1);
});

test("invoices round-trip; legacy vault defaults to []", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createEncryptedStorage("lavega-vault-test-inv");
  await s.setup("pw");
  expect(await s.getInvoices()).toEqual([]);
  const invoice = { id: "i1", entity: "BV1", direction: "out" as const, counterparty: "X", issueDate: "2026-08-01", dueDate: "2026-09-01", amount: 100, currency: "EUR", status: "expected" as const, sourceType: "manual" as const };
  await s.putInvoices([invoice]);
  expect(await s.getInvoices()).toEqual([invoice]);
});

test("rewards round-trip; legacy vault defaults to []", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createEncryptedStorage("lavega-vault-test-rewards");
  await s.setup("pw");
  expect(await s.getRewards()).toEqual([]);
  const reward = { id: "amex", program: "American Express Membership Rewards", points: 10000, updatedAt: "2026-06-01" };
  await s.putRewards([reward]);
  expect(await s.getRewards()).toEqual([reward]);
});

test("deleteAccount / deleteTxs remove only their rows (parity with plaintext adapter)", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-delete");
  await v.setup("pw");
  await v.putAccounts([acc("A", 1), acc("B", 2)]);
  await v.putTxs([tx("a1", "A"), tx("a2", "A"), tx("b1", "B")]);

  await v.deleteAccount("A");
  expect((await v.getAccounts()).map((a) => a.key)).toEqual(["B"]);
  expect(await v.getTxs()).toHaveLength(3); // txs untouched — the caller decides

  await v.deleteTxs(["a1", "nope"]); // unknown id is a no-op
  expect((await v.getTxs()).map((t) => t.id).sort()).toEqual(["a2", "b1"]);

  await v.deleteAccount("GONE"); // absent account is a no-op
  expect(await v.getAccounts()).toHaveLength(1);
});

test("deletes survive lock/unlock — they are persisted, not just in-memory", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-delete-persist");
  await v.setup("pw");
  await v.putAccounts([acc("A", 1), acc("B", 2)]);
  await v.putTxs([tx("a1", "A"), tx("b1", "B")]);
  await v.deleteAccount("A");
  await v.deleteTxs(["a1"]);

  v.lock();
  expect(await v.unlock("pw")).toBe(true);
  expect((await v.getAccounts()).map((a) => a.key)).toEqual(["B"]);
  expect((await v.getTxs()).map((t) => t.id)).toEqual(["b1"]);
});

test("a delete racing a put is serialized — neither reverts the other", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-delete-race");
  await v.setup("pw");
  await v.putAccounts([acc("A", 1)]);
  await v.putTxs([tx("a1", "A"), tx("a2", "A")]);

  // Fire concurrently: without the write queue one persist() could land last
  // with a stale snapshot and resurrect the deleted tx.
  await Promise.all([v.deleteTxs(["a1"]), v.putTxs([tx("a3", "A")])]);

  v.lock();
  expect(await v.unlock("pw")).toBe(true);
  expect((await v.getTxs()).map((t) => t.id).sort()).toEqual(["a2", "a3"]);
});

test("delete while locked throws", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-delete-locked");
  await v.setup("pw");
  v.lock();
  await expect(v.deleteAccount("A")).rejects.toBeTruthy();
  await expect(v.deleteTxs(["a1"])).rejects.toBeTruthy();
});
