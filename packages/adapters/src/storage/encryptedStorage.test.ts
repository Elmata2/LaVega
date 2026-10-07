// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeAll, expect, test } from "vitest";
import { openDB } from "idb";
import type { Account, Tx } from "@lavega/core";
import { LOCAL_TENANT_ID } from "@lavega/core";
import type { CipherBlob } from "../crypto/vaultCrypto.js";
import {
  deriveKey,
  encryptJSON,
  generateVaultKey,
  newSalt,
  PBKDF2_ITERATIONS,
} from "../crypto/vaultCrypto.js";
import { createEncryptedStorage } from "./encryptedStorage.js";

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
  amount: -5,
  currency: "EUR",
  counterparty: "",
  description: "",
  category: "",
  manual: false,
});

let KEY: CryptoKey;
let OTHER_KEY: CryptoKey;
beforeAll(async () => {
  KEY = await generateVaultKey();
  OTHER_KEY = await generateVaultKey();
});

/** A vault sealed with a vault password, the way LaVega stored it before
 *  accounts held the key, written where the old code wrote it. */
async function writePasswordVault(dbName: string, passphrase: string, data: unknown) {
  const salt = newSalt();
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const blob = await encryptJSON(key, salt, PBKDF2_ITERATIONS, data);
  const db = await openDB(dbName, 1, {
    upgrade(d) {
      d.createObjectStore("vault");
    },
  });
  await db.put("vault", blob, "blob");
  db.close();
  return blob;
}

test("open creates an empty vault once, then reopens it with the same key", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage();
  expect(await v.open(KEY, "user:a")).toBe("created");
  await v.putAccounts([acc("A")]);
  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect((await v.getAccounts()).map((a) => a.key)).toEqual(["A"]);
});

test("two owners in one browser never see each other's vault", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage();
  await v.open(KEY, "user:a");
  await v.putAccounts([acc("A")]);
  v.lock();
  expect(await v.open(OTHER_KEY, "user:b")).toBe("created");
  expect(await v.getAccounts()).toEqual([]);
});

test("a vault refuses a key that did not seal it", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage();
  await v.open(KEY, "user:a");
  v.lock();
  await expect(v.open(OTHER_KEY, "user:a")).rejects.toThrow();
});

test("put while locked throws", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage();
  await v.open(KEY, "user:a");
  v.lock();
  await expect(v.putAccounts([acc("A")])).rejects.toThrow();
});

test("the on-disk vault record is ciphertext — no plaintext account key leaks", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage();
  await v.open(KEY, "user:a");
  await v.putAccounts([acc("NL01INGB0009SECRET")]);
  const blob = v.export();
  expect(blob).toMatchObject({ v: 2, kdf: "account-key" });
  expect(JSON.stringify(blob).includes("SECRET")).toBe(false);
});

test("putRules replaces, putAccounts/putTxs upsert (parity with plaintext adapter)", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage();
  await v.open(KEY, "user:a");
  await v.putAccounts([acc("A", 1)]);
  await v.putAccounts([acc("A", 2), acc("B")]);
  expect((await v.getAccounts()).map((a) => [a.key, a.balance])).toEqual([
    ["A", 2],
    ["B", null],
  ]);
  await v.putTxs([tx("t1", "A")]);
  await v.putTxs([tx("t1", "A"), tx("t2", "B")]);
  expect((await v.getTxs()).map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  await v.putRules([{ match: "x", category: "c" } as never]);
  await v.putRules([]);
  expect(await v.getRules()).toEqual([]);
});

test("a password vault waits for its password, then moves under the owner's key", async () => {
  globalThis.indexedDB = new IDBFactory();
  await writePasswordVault("lavega-vault", "hunter2", {
    accounts: [acc("OLD")],
    txs: [],
    rules: [],
  });
  const v = createEncryptedStorage();
  expect(await v.open(KEY, "user:a")).toBe("password-vault");
  expect(await v.adoptPasswordVault("WRONG")).toBe(false);
  expect(await v.adoptPasswordVault("hunter2")).toBe(true);
  expect((await v.getAccounts()).map((a) => a.key)).toEqual(["OLD"]);
  // The password copy is gone and the owner's vault opens with the key alone.
  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect(await v.adoptPasswordVault("hunter2")).toBe(false);
});

test("starting fresh leaves the password vault alone and is not asked again", async () => {
  globalThis.indexedDB = new IDBFactory();
  await writePasswordVault("lavega-vault", "hunter2", { accounts: [], txs: [], rules: [] });
  const v = createEncryptedStorage();
  expect(await v.open(KEY, "user:a")).toBe("password-vault");
  await v.startFresh();
  expect(await v.getAccounts()).toEqual([]);
  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
});

test("export -> restore round-trips onto another browser of the same owner", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v1 = createEncryptedStorage("first-browser");
  await v1.open(KEY, "user:a");
  await v1.putAccounts([acc("A")]);
  const backup = v1.export()!;
  const v2 = createEncryptedStorage("second-browser");
  await v2.open(KEY, "user:a");
  expect(await v2.restore(backup)).toBe(true);
  expect((await v2.getAccounts()).map((a) => a.key)).toEqual(["A"]);
  v2.lock();
  expect(await v2.open(KEY, "user:a")).toBe("opened");
  expect((await v2.getAccounts()).map((a) => a.key)).toEqual(["A"]);
});

test("a back-up from another account is refused and changes nothing", async () => {
  globalThis.indexedDB = new IDBFactory();
  const other = createEncryptedStorage("other");
  await other.open(OTHER_KEY, "user:b");
  await other.putAccounts([acc("B")]);
  const v = createEncryptedStorage();
  await v.open(KEY, "user:a");
  await v.putAccounts([acc("A")]);
  expect(await v.restore(other.export()!)).toBe(false);
  expect((await v.getAccounts()).map((a) => a.key)).toEqual(["A"]);
});

test("an old password back-up restores with its password, re-sealed under the key", async () => {
  globalThis.indexedDB = new IDBFactory();
  const old = await writePasswordVault("old-file", "backup-pw", {
    accounts: [acc("OLD")],
    txs: [],
    rules: [],
  });
  const v = createEncryptedStorage();
  await v.open(KEY, "user:a");
  expect(await v.restore(old, "WRONG")).toBe(false);
  expect(await v.restore(old)).toBe(false);
  expect(await v.restore(old, "backup-pw")).toBe(true);
  expect(v.export()).toMatchObject({ v: 2 });
  expect((await v.getAccounts()).map((a) => a.key)).toEqual(["OLD"]);
});

test("restore of a sub-floor-iterations file is refused", async () => {
  globalThis.indexedDB = new IDBFactory();
  const old = await writePasswordVault("old-file", "pw", { accounts: [], txs: [], rules: [] });
  const v = createEncryptedStorage();
  await v.open(KEY, "user:a");
  const tampered: CipherBlob = { ...old, iterations: 1 };
  expect(await v.restore(tampered, "pw")).toBe(false);
});

test("concurrent puts are serialized — the last write wins on disk", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage();
  await v.open(KEY, "user:a");
  await Promise.all([
    v.putAccounts([acc("A")]),
    v.putAccounts([acc("B")]),
    v.putTxs([tx("t1", "A")]),
  ]);
  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect((await v.getAccounts()).map((a) => a.key).sort()).toEqual(["A", "B"]);
  expect((await v.getTxs()).map((t) => t.id)).toEqual(["t1"]);
});

test("scheduledFlows + vatSettings round-trip; legacy vault defaults to empty", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createEncryptedStorage("lavega-vault-test-sf");
  await s.open(KEY, "user:a");
  expect(await s.getScheduledFlows()).toEqual([]); // default
  const flow = {
    id: "f1",
    entity: "BV1",
    label: "BTW",
    sign: -1 as const,
    amountCents: 1000,
    dueDate: "2026-05-01",
    source: "vat" as const,
    status: "confirmed" as const,
  };
  await s.putScheduledFlows([flow]);
  await s.putVatSettings([
    { entity: "BV1", frequency: "quarterly", defaultRatePct: 21, mixedRates: false },
  ]);
  expect(await s.getScheduledFlows()).toEqual([flow]);
  expect(await s.getVatSettings()).toHaveLength(1);
});

test("invoices round-trip; legacy vault defaults to []", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createEncryptedStorage("lavega-vault-test-inv");
  await s.open(KEY, "user:a");
  expect(await s.getInvoices()).toEqual([]);
  const invoice = {
    id: "i1",
    entity: "BV1",
    direction: "out" as const,
    counterparty: "X",
    issueDate: "2026-08-01",
    dueDate: "2026-09-01",
    amount: 100,
    currency: "EUR",
    status: "expected" as const,
    sourceType: "manual" as const,
  };
  await s.putInvoices([invoice]);
  expect(await s.getInvoices()).toEqual([invoice]);
});

test("rewards round-trip; legacy vault defaults to []", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createEncryptedStorage("lavega-vault-test-rewards");
  await s.open(KEY, "user:a");
  expect(await s.getRewards()).toEqual([]);
  const reward = {
    id: "amex",
    program: "American Express Membership Rewards",
    points: 10000,
    updatedAt: "2026-06-01",
  };
  await s.putRewards([reward]);
  expect(await s.getRewards()).toEqual([reward]);
});

test("deleteAccount / deleteTxs remove only their rows (parity with plaintext adapter)", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-delete");
  await v.open(KEY, "user:a");
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
  await v.open(KEY, "user:a");
  await v.putAccounts([acc("A", 1), acc("B", 2)]);
  await v.putTxs([tx("a1", "A"), tx("b1", "B")]);
  await v.deleteAccount("A");
  await v.deleteTxs(["a1"]);

  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect((await v.getAccounts()).map((a) => a.key)).toEqual(["B"]);
  expect((await v.getTxs()).map((t) => t.id)).toEqual(["b1"]);
});

test("a delete racing a put is serialized — neither reverts the other", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-delete-race");
  await v.open(KEY, "user:a");
  await v.putAccounts([acc("A", 1)]);
  await v.putTxs([tx("a1", "A"), tx("a2", "A")]);

  // Fire concurrently: without the write queue one persist() could land last
  // with a stale snapshot and resurrect the deleted tx.
  await Promise.all([v.deleteTxs(["a1"]), v.putTxs([tx("a3", "A")])]);

  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect((await v.getTxs()).map((t) => t.id).sort()).toEqual(["a2", "a3"]);
});

test("delete while locked throws", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-delete-locked");
  await v.open(KEY, "user:a");
  v.lock();
  await expect(v.deleteAccount("A")).rejects.toBeTruthy();
  await expect(v.deleteTxs(["a1"])).rejects.toBeTruthy();
});

test("learned facts round-trip and survive lock/unlock; legacy vault defaults to []", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-facts");
  await v.open(KEY, "user:a");
  expect(await v.getFacts()).toEqual([]); // legacy/new vault
  const learned = {
    id: "f1",
    agent: "travel",
    subject: "Trading 212",
    key: "fxFeePct",
    value: "0",
    source: "agent" as const,
    updatedAt: "2026-08-13",
  };
  await v.putFacts([learned]);
  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect(await v.getFacts()).toEqual([learned]); // a correction must outlive the session
});

test("entityProfiles round-trip; legacy vault defaults to [] and stays decryptable", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createEncryptedStorage("lavega-vault-test-entities");
  await s.open(KEY, "user:a");
  expect(await s.getEntityProfiles()).toEqual([]); // a vault written before item 4
  const profiles = [
    { entity: "BV1", scope: "business" as const },
    { entity: "Privé", scope: "personal" as const },
  ];
  await s.putEntityProfiles(profiles);
  expect(await s.getEntityProfiles()).toEqual(profiles);

  // Survives a lock/unlock cycle — i.e. it really went through the encrypted blob.
  s.lock();
  expect(await s.open(KEY, "user:a")).toBe("opened");
  expect(await s.getEntityProfiles()).toEqual(profiles);
  expect(await s.getAccounts()).toEqual([]); // nothing else disturbed
});

test("a stale-tracked rewards balance round-trips with its interval and snooze", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createEncryptedStorage("lavega-vault-test-tracking");
  await s.open(KEY, "user:a");
  const reward = {
    id: "amex",
    program: "American Express Membership Rewards",
    points: 240000,
    updatedAt: "2026-01-10",
    intervalDays: 30,
    snoozedUntil: "2026-09-01",
  };
  await s.putRewards([reward]);
  s.lock();
  expect(await s.open(KEY, "user:a")).toBe("opened");
  expect(await s.getRewards()).toEqual([reward]);
});

test("n8n settings round-trip, are absent while locked, and restore with the vault", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-n8n-settings");
  await v.open(KEY, "user:a");
  expect(await v.getN8nSettings()).toEqual({}); // never set

  const settings = {
    baseUrl: "https://n8n.example",
    apiKey: "n8n-api-key-secret",
    invoiceUrl: "https://n8n.example/webhook/lavega-facturen",
    invoiceToken: "webhook-token-secret",
  };
  await v.putN8nSettings(settings);
  expect(await v.getN8nSettings()).toEqual(settings);

  const backup = v.export();
  expect(backup).not.toBeNull();
  expect(JSON.stringify(backup)).not.toContain("n8n-api-key-secret");
  expect(JSON.stringify(backup)).not.toContain("webhook-token-secret");

  v.lock();
  await expect(v.getN8nSettings()).rejects.toBeTruthy();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect(await v.getN8nSettings()).toEqual(settings);

  const restored = createEncryptedStorage("lavega-vault-test-n8n-settings-restored");
  await restored.open(KEY, "user:a");
  expect(await restored.restore(backup!)).toBe(true);
  expect(await restored.getN8nSettings()).toEqual(settings);
});

test("auto-booked invoices round-trip and survive lock/unlock; legacy vault defaults to []", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-n8n-autobooked");
  await v.open(KEY, "user:a");
  expect(await v.getAutoBookedInvoices()).toEqual([]);

  const entry = { invoiceId: "i1", messageId: "msg-1", subject: "Factuur juli" };
  await v.putAutoBookedInvoices([entry]);
  expect(await v.getAutoBookedInvoices()).toEqual([entry]);

  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect(await v.getAutoBookedInvoices()).toEqual([entry]);
});

test("fx history round-trips, defaults to {} on a legacy vault, and survives lock/unlock", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-fx-history");
  await v.open(KEY, "user:a");
  expect(await v.getFxHistory()).toEqual({});

  const history = { HUF: { "2026-08-01": 390.5, "2026-08-02": 391.2 } };
  await v.putFxHistory(history);
  expect(await v.getFxHistory()).toEqual(history);

  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect(await v.getFxHistory()).toEqual(history);
});

test("fx history get/put while locked throws", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-fx-history-locked");
  await v.open(KEY, "user:a");
  v.lock();
  await expect(v.getFxHistory()).rejects.toBeTruthy();
  await expect(v.putFxHistory({ HUF: { "2026-08-01": 390.5 } })).rejects.toBeTruthy();
});

test("broker credentials stay encrypted, are absent while locked, and restore with the vault", async () => {
  globalThis.indexedDB = new IDBFactory();
  const source = createEncryptedStorage("lavega-vault-test-credentials-source");
  await source.open(KEY, "user:a");
  const ibkr = {
    broker: "ibkr" as const,
    tenantId: LOCAL_TENANT_ID,
    token: "flex-token-secret",
    queryId: "987654",
  };
  const trading212 = {
    broker: "trading212" as const,
    tenantId: LOCAL_TENANT_ID,
    token: "t212-key",
    secret: "t212-secret",
  };

  expect(await source.getCredentials(LOCAL_TENANT_ID, "ibkr")).toBeNull();
  await source.putCredentials(ibkr);
  await source.putCredentials(trading212);
  expect(await source.getCredentials(LOCAL_TENANT_ID, "ibkr")).toEqual(ibkr);
  expect(await source.getCredentials(LOCAL_TENANT_ID, "trading212")).toEqual(trading212);

  const backup = source.export();
  expect(backup).not.toBeNull();
  expect(JSON.stringify(backup)).not.toContain("flex-token-secret");
  expect(JSON.stringify(backup)).not.toContain("t212-secret");

  source.lock();
  expect(await source.getCredentials(LOCAL_TENANT_ID, "ibkr")).toBeNull();
  expect(await source.getCredentials(LOCAL_TENANT_ID, "trading212")).toBeNull();
  expect(await source.open(KEY, "user:a")).toBe("opened");
  expect(await source.getCredentials(LOCAL_TENANT_ID, "ibkr")).toEqual(ibkr);

  const restored = createEncryptedStorage("lavega-vault-test-credentials-restored");
  await restored.open(KEY, "user:a");
  expect(await restored.restore(backup!)).toBe(true);
  expect(await restored.getCredentials(LOCAL_TENANT_ID, "trading212")).toEqual(trading212);
});
