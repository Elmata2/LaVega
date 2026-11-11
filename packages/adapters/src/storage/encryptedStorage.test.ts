// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeAll, expect, test } from "vitest";
import { openDB } from "idb";
import type {
  Account,
  Bill,
  BillOccurrence,
  Merchant,
  TransferPair,
  Tx,
  Valuation,
  VaultDocument,
  ImportSession,
} from "@lavega/core";
import {
  AdvisorProfile,
  type ProfileRead,
  LOCAL_TENANT_ID,
  commitProfile,
  emptyPlanPreferences,
  emptyProfile,
  emptyProfileStore,
  encodeProfileStore,
} from "@lavega/core";
import type { CipherBlob } from "../crypto/vaultCrypto.js";
import {
  decryptJSON,
  deriveKey,
  encryptJSON,
  generateVaultKey,
  newSalt,
  PBKDF2_ITERATIONS,
  sealJSON,
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

const transferPair = (over: Partial<TransferPair> = {}): TransferPair => ({
  id: "pair-1",
  outflowTxId: "t-out",
  inflowTxId: "t-in",
  status: "confirmed",
  kind: "funds_movement",
  amountCents: 12500,
  currency: "EUR",
  createdAt: "2026-06-02",
  ...over,
});

test("transfers round-trip exactly; a legacy vault without the field reads []", async () => {
  globalThis.indexedDB = new IDBFactory();
  // A vault sealed before transfer records existed: no `transfers` field.
  const legacy = await sealJSON(KEY, { accounts: [], txs: [], rules: [] });
  const v = createEncryptedStorage("lavega-vault-test-transfers");
  await v.open(KEY, "user:a");
  expect(await v.getTransfers()).toEqual([]); // created vault, same default
  expect(await v.restore(legacy)).toBe(true); // legacy blob decrypts unchanged
  expect(await v.getTransfers()).toEqual([]);

  const confirmed = transferPair({
    id: "pair-confirmed",
    feeTxIds: ["fee-1"],
    decidedAt: "2026-06-03",
    evidence: { rank: "exact", dateDiffDays: 0, amountDeltaCents: 0, crossRate: null },
  });
  const rejected = transferPair({
    id: "pair-rejected",
    outflowTxId: "t-out-2",
    inflowTxId: "t-in-2",
    status: "rejected",
    kind: "cc_payment",
    amountCents: 5000,
    currency: "HUF",
    decidedAt: "2026-06-04",
    evidence: { rank: "fx", dateDiffDays: 4, amountDeltaCents: 120, crossRate: 390.5 },
  });
  await v.putTransfers([confirmed, rejected]);
  expect(await v.getTransfers()).toEqual([confirmed, rejected]);

  // The getter hands out a fresh array: mutating it cannot alter vault state.
  const read = await v.getTransfers();
  read.push(transferPair({ id: "pair-extra" }));
  expect(await v.getTransfers()).toEqual([confirmed, rejected]);

  // Survives a lock/unlock cycle — i.e. it really went through the sealed blob.
  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect(await v.getTransfers()).toEqual([confirmed, rejected]);
});

test("putTransfers replaces the whole list; get/put while locked throws", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-transfers-replace");
  await v.open(KEY, "user:a");
  const first = transferPair({ id: "pair-1" });
  const second = transferPair({ id: "pair-2", outflowTxId: "t-out-2", inflowTxId: "t-in-2" });
  await v.putTransfers([first, second]);
  await v.putTransfers([second]);
  expect(await v.getTransfers()).toEqual([second]); // replace-all, not upsert

  v.lock();
  await expect(v.getTransfers()).rejects.toBeTruthy();
  await expect(v.putTransfers([first])).rejects.toBeTruthy();
});

test("merchants round-trip exactly; a legacy vault without the field reads []", async () => {
  globalThis.indexedDB = new IDBFactory();
  const legacy = await sealJSON(KEY, { accounts: [], txs: [], rules: [] });
  const v = createEncryptedStorage("lavega-vault-test-merchants");
  await v.open(KEY, "user:a");
  expect(await v.getMerchants()).toEqual([]);
  expect(await v.restore(legacy)).toBe(true);
  expect(await v.getMerchants()).toEqual([]);

  const registry: Merchant[] = [
    { key: "ah", name: "Albert Heijn", aliases: ["AH", "ALBERT HEIJN"] },
    { key: "simyo", name: "Simyo", aliases: ["Simyo"] },
  ];
  await v.putMerchants(registry);
  expect(await v.getMerchants()).toEqual(registry);
  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect(await v.getMerchants()).toEqual(registry);
  await v.putMerchants([registry[0]]);
  expect(await v.getMerchants()).toEqual([registry[0]]); // replace-all
});

test("an old vault gets the tx-state defaults in ONE save on first open", async () => {
  globalThis.indexedDB = new IDBFactory();
  // A vault sealed before WS1.6: rows have no state fields.
  const old = await sealJSON(KEY, {
    accounts: [],
    txs: [tx("t1", "A"), tx("t2", "A")],
    rules: [],
  });
  const v = createEncryptedStorage("lavega-vault-test-tx-states");
  await v.open(KEY, "user:a");
  expect(await v.restore(old)).toBe(true); // restore also runs the pass

  const migrated = await v.getTxs();
  expect(migrated[0]).toMatchObject({
    id: "t1",
    excluded: false,
    pending: false,
    notes: "",
    tags: [],
  });

  // The one save happened during the restore that adopted the old blob; the
  // next open must not re-seal it (a re-seal always changes the ciphertext).
  const afterMigration = JSON.stringify(v.export());
  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect(JSON.stringify(v.export())).toBe(afterMigration);
  expect(await v.getTxs()).toEqual(migrated);
});

test("a reopen of a vault with old rows runs the pass and writes once", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-tx-states-open");
  await v.open(KEY, "user:a");
  await v.putTxs([tx("t1", "A")]); // stored without state fields
  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect((await v.getTxs())[0]).toMatchObject({
    excluded: false,
    pending: false,
    notes: "",
    tags: [],
  });
  const afterMigration = JSON.stringify(v.export());
  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect(JSON.stringify(v.export())).toBe(afterMigration); // no second re-seal
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

const AT1 = "2026-10-22T10:00:00Z";
const AT2 = "2026-10-22T11:00:00Z";
const currentWorry = (r: ProfileRead): string | undefined =>
  r.kind === "ok" ? r.store.current.worries?.value : undefined;

const sampleProfile = (w: string): AdvisorProfile =>
  new AdvisorProfile({
    ...emptyProfile(),
    worries: { value: w, source: "stated", at: "2026-10-22" },
  });

test("legacy vault without a profile returns null; put then get round-trips; survives lock/open and restore", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-profile");
  await v.open(KEY, "user:a");
  expect(await v.getProfile()).toEqual({ kind: "absent" });

  const store = commitProfile(
    commitProfile(emptyProfileStore(), sampleProfile("one"), AT1),
    sampleProfile("two"),
    AT2,
  );
  await v.putProfile(store);
  const got = await v.getProfile();
  expect(got).toEqual({ kind: "ok", store });
  expect(got.kind === "ok" && got.store.current).toBeInstanceOf(AdvisorProfile);

  v.lock();
  await expect(v.getProfile()).rejects.toBeTruthy();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect(await v.getProfile()).toEqual({ kind: "ok", store });

  // back-up export/restore carries the profile and the other three sections
  await v.putSection("plan", { preferences: { at: "2026-10-22", value: "p" }, snapshots: {} });
  await v.putSection("learning", { c1: { at: "2026-10-22", value: 1 } });
  await v.appendEvents([{ id: "e1", kind: "plan", at: "2026-10-22" }]);
  const backup = v.export()!;
  const other = createEncryptedStorage("lavega-vault-test-profile-restored");
  await other.open(KEY, "user:a");
  expect(await other.restore(backup)).toBe(true);
  expect(await other.getProfile()).toEqual({ kind: "ok", store });
  expect((await other.getSection("plan")).preferences?.value).toBe("p");
  expect(await other.getSection("learning")).toEqual({ c1: { at: "2026-10-22", value: 1 } });
  expect((await other.getSection("events")).map((e) => e.id)).toEqual(["e1"]);
});

test("an undecodable stored profile reads as corrupt; the next put keeps the old blob under profileCorruptBackup", async () => {
  globalThis.indexedDB = new IDBFactory();
  const bad = JSON.parse(JSON.stringify(encodeProfileStore(emptyProfileStore())));
  bad.current.risk = { score: 99, answers: {}, scaleId: "s", at: "2026-10-22" };
  const sealed = await sealJSON(KEY, { accounts: [], txs: [], rules: [], profile: bad });
  const v = createEncryptedStorage("lavega-vault-test-profile-bad");
  await v.open(KEY, "user:a");
  expect(await v.restore(sealed)).toBe(true);
  expect(await v.getProfile()).toEqual({ kind: "corrupt" });
  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect(await v.getProfile()).toEqual({ kind: "corrupt" });
  let raw = await decryptJSON<{ profile: unknown; profileCorruptBackup?: unknown }>(
    KEY,
    v.export()!,
  );
  expect(raw.profile).toEqual(bad);
  expect(raw.profileCorruptBackup).toBeUndefined();

  const fresh = commitProfile(emptyProfileStore(), sampleProfile("fresh"), AT1);
  await v.putProfile(fresh);
  expect(await v.getProfile()).toEqual({ kind: "ok", store: fresh });
  raw = await decryptJSON<{ profile: unknown; profileCorruptBackup?: unknown }>(KEY, v.export()!);
  expect(raw.profileCorruptBackup).toEqual(bad);
  // a second put does not overwrite the backup
  await v.putProfile(commitProfile(fresh, sampleProfile("later"), AT2));
  raw = await decryptJSON<{ profile: unknown; profileCorruptBackup?: unknown }>(KEY, v.export()!);
  expect(raw.profileCorruptBackup).toEqual(bad);
});

test("a profile with an unknown section from a newer build survives a get/put round trip", async () => {
  globalThis.indexedDB = new IDBFactory();
  const newer = JSON.parse(
    JSON.stringify(
      encodeProfileStore(commitProfile(emptyProfileStore(), sampleProfile("keep"), AT1)),
    ),
  );
  newer.current.insurance = { value: { monthlyCents: 4200 }, source: "stated", at: "2026-10-22" };
  newer.futureTop = { n: 1 };
  const sealed = await sealJSON(KEY, { accounts: [], txs: [], rules: [], profile: newer });
  const v = createEncryptedStorage("lavega-vault-test-profile-unknown");
  await v.open(KEY, "user:a");
  expect(await v.restore(sealed)).toBe(true);
  const read = await v.getProfile();
  expect(read.kind).toBe("ok");
  if (read.kind !== "ok") return;
  // An older build edits a known field and saves again.
  await v.putProfile(commitProfile(read.store, sampleProfile("edited"), AT2));
  const raw = await decryptJSON<{ profile: any }>(KEY, v.export()!);
  expect(raw.profile.current.insurance).toEqual(newer.current.insurance);
  expect(raw.profile.futureTop).toEqual({ n: 1 });
  expect(raw.profile.current.worries.value).toBe("edited");
  expect(currentWorry(await v.getProfile())).toBe("edited");
});

test("plan and learning are replace-all sections; events merge by union and are idempotent", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-sections");
  await v.open(KEY, "user:a");
  expect(await v.getSection("plan")).toEqual({ preferences: null, snapshots: {} });
  expect(await v.getSection("learning")).toEqual({});
  expect(await v.getSection("events")).toEqual([]);

  await v.appendEvents([
    { id: "1", kind: "plan", at: "2026-10-01" },
    { id: "2", kind: "from-the-future", at: "2026-10-02", extra: 1 },
  ]);
  await v.appendEvents([
    { id: "2", kind: "from-the-future", at: "2026-10-02", extra: 1 },
    { id: "3", kind: "plan", at: "2026-10-03" },
  ]);
  const events = await v.getSection("events");
  expect(events.map((e) => e.id)).toEqual(["1", "2", "3"]);
  expect(events[1]).toMatchObject({ kind: "from-the-future", extra: 1 });
  await v.appendEvents(events);
  expect(await v.getSection("events")).toEqual(events);

  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect(await v.getSection("events")).toEqual(events);
});

test("two rapid puts: the second wins (enqueueWrite ordering)", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-profile-race");
  await v.open(KEY, "user:a");
  const first = commitProfile(emptyProfileStore(), sampleProfile("first"), AT1);
  const second = commitProfile(emptyProfileStore(), sampleProfile("second"), AT2);
  await Promise.all([v.putProfile(first), v.putProfile(second)]);
  expect(currentWorry(await v.getProfile())).toBe("second");
  v.lock();
  await v.open(KEY, "user:a");
  expect(currentWorry(await v.getProfile())).toBe("second");
});

test("legacy categoryLimits migrate to the first budget period in ONE save; a reopen writes nothing", async () => {
  globalThis.indexedDB = new IDBFactory();
  // A vault from before WS2.9: the plan holds only the legacy category limits.
  const preferences = emptyPlanPreferences();
  (preferences.categoryLimits as Record<string, { cents: number; at: string }>)["Boodschappen"] = {
    cents: 40_000,
    at: "2026-10-01",
  };
  const legacy = await sealJSON(KEY, {
    accounts: [],
    txs: [],
    rules: [],
    plan: { preferences: { at: "2026-10-02", value: preferences }, snapshots: {} },
  });
  const v = createEncryptedStorage("lavega-vault-test-budgets");
  await v.open(KEY, "user:a");
  expect(await v.getBudgetPeriods()).toEqual([]);
  expect(await v.restore(legacy)).toBe(true); // restore runs the same pass

  const periods = await v.getBudgetPeriods();
  expect(periods).toEqual([
    {
      month: "2026-10",
      currency: "EUR",
      budgetedSpendingCents: 40_000,
      rollover: false,
      lines: [{ category: "Boodschappen", allocationCents: 40_000 }],
      billsReservedCents: null,
    },
  ]);
  // The legacy record is untouched: an older build still reads it.
  const plan = await v.getSection("plan");
  expect(plan.preferences?.value).toMatchObject({
    categoryLimits: { Boodschappen: { cents: 40_000 } },
  });

  // The pass wrote once, during the restore that adopted the old blob. A later
  // open must not re-seal it (a re-seal always changes the ciphertext).
  const afterMigration = JSON.stringify(v.export());
  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect(JSON.stringify(v.export())).toBe(afterMigration);
  expect(await v.getBudgetPeriods()).toEqual(periods);
});

test("budget periods and category groups round-trip; fields are optional", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-budget-roundtrip");
  await v.open(KEY, "user:a");
  const periods = [
    {
      month: "2026-10",
      currency: "EUR",
      budgetedSpendingCents: 50_000,
      rollover: true,
      lines: [{ category: "Boodschappen", allocationCents: 30_000, rollover: true }],
      billsReservedCents: null,
    },
  ];
  const groups = [{ name: "Huishouden", categories: ["Boodschappen"] }];
  await v.putBudgetPeriods(periods);
  await v.putCategoryGroups(groups);
  expect(await v.getBudgetPeriods()).toEqual(periods);
  expect(await v.getCategoryGroups()).toEqual(groups);
  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  expect(await v.getBudgetPeriods()).toEqual(periods);
  expect(await v.getCategoryGroups()).toEqual(groups);
});

const document = (sha256: string, overrides: Partial<VaultDocument> = {}): VaultDocument => ({
  id: sha256,
  sha256,
  filename: `${sha256}.pdf`,
  mime: "application/pdf",
  byteSize: 8,
  kind: "statement",
  source: "manual-upload",
  uploadedAt: "2026-11-11",
  periodFrom: "2026-10-01",
  periodTo: "2026-10-31",
  currency: "EUR",
  accountKey: null,
  suggestedAccountKey: null,
  matchConfidence: null,
  accountLast4: null,
  institutionHint: null,
  accountNameHint: null,
  openingBalanceCents: null,
  closingBalanceCents: null,
  reviewStatus: "unmatched",
  metadataSources: [],
  ...overrides,
});

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

test("document bytes live in their own store: one record per SHA-256, no vault rewrite", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createEncryptedStorage("lavega-vault-test-documents");
  await s.open(KEY, "user:a");
  expect(await s.getDocuments()).toEqual([]);
  expect(await s.listDocumentBytes()).toEqual([]);

  await s.putDocuments([document("aaa")]);
  await s.putDocumentBytes("aaa", bytesOf("PDF-a"));
  // The same bytes twice is ONE record.
  await s.putDocumentBytes("aaa", bytesOf("PDF-a"));
  expect(await s.listDocumentBytes()).toEqual(["aaa"]);
  expect(await s.hasDocumentBytes("aaa")).toBe(true);
  expect(textOf((await s.getDocumentBytes("aaa"))!)).toBe("PDF-a");

  // The vault ciphertext is untouched by a document write: the blob before and
  // after a document upload is the same record object (no persist ran).
  const before = s.export();
  await s.putDocumentBytes("bbb", bytesOf("PDF-b"));
  expect(s.export()).toBe(before);

  s.lock();
  expect(await s.open(KEY, "user:a")).toBe("opened");
  expect(await s.getDocuments()).toEqual([document("aaa")]);
  expect(await s.listDocumentBytes()).toEqual(["aaa", "bbb"]);
  expect(textOf((await s.getDocumentBytes("bbb"))!)).toBe("PDF-b");

  await s.deleteDocumentBytes("bbb");
  expect(await s.listDocumentBytes()).toEqual(["aaa"]);
  expect(await s.getDocumentBytes("bbb")).toBeNull();
});

test("a full bundle carries the vault AND the documents, and restores both into a fresh store", async () => {
  globalThis.indexedDB = new IDBFactory();
  const source = createEncryptedStorage("lavega-vault-test-bundle-source");
  await source.open(KEY, "user:a");
  await source.putAccounts([acc("A", 1200)]);
  await source.putDocuments([document("sha-1"), document("sha-2")]);
  await source.putDocumentBytes("sha-1", bytesOf("bytes-one"));
  await source.putDocumentBytes("sha-2", bytesOf("bytes-two"));
  const bundle = await source.exportBundle();
  expect(bundle?.v).toBe(3);
  expect(source.export()).toMatchObject({ v: 2 }); // the vault-only blob is unchanged
  source.lock();

  // A FRESH browser profile: a new IndexedDB factory and a different owner DB.
  globalThis.indexedDB = new IDBFactory();
  const fresh = createEncryptedStorage("lavega-vault-test-bundle-fresh");
  expect(await fresh.open(KEY, "user:a")).toBe("created");
  expect(await fresh.getDocuments()).toEqual([]);
  expect(await fresh.restore(bundle!)).toBe(true);
  expect((await fresh.getAccounts())[0]?.balance).toBe(1200);
  expect((await fresh.getDocuments()).map((d) => d.id)).toEqual(["sha-1", "sha-2"]);
  expect(textOf((await fresh.getDocumentBytes("sha-1"))!)).toBe("bytes-one");
  expect(textOf((await fresh.getDocumentBytes("sha-2"))!)).toBe("bytes-two");

  // And a wrong key still refuses the bundle, leaving the fresh vault as it was.
  globalThis.indexedDB = new IDBFactory();
  const other = createEncryptedStorage("lavega-vault-test-bundle-other");
  await other.open(OTHER_KEY, "user:b");
  expect(await other.restore(bundle!)).toBe(false);
  expect(await other.getDocuments()).toEqual([]);
});

test("erase removes metadata AND bytes; startFresh clears both stores", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createEncryptedStorage("lavega-vault-test-erase");
  await s.open(KEY, "user:a");
  await s.putDocuments([document("sha-1"), document("sha-2")]);
  await s.putDocumentBytes("sha-1", bytesOf("one"));
  await s.putDocumentBytes("sha-2", bytesOf("two"));

  expect(await s.eraseDocuments()).toBe(2);
  expect(await s.getDocuments()).toEqual([]);
  expect(await s.listDocumentBytes()).toEqual([]);
  // The erase survives a reopen: neither store kept a row.
  s.lock();
  await s.open(KEY, "user:a");
  expect(await s.getDocuments()).toEqual([]);
  expect(await s.listDocumentBytes()).toEqual([]);

  await s.putDocuments([document("sha-3")]);
  await s.putDocumentBytes("sha-3", bytesOf("three"));
  await s.startFresh();
  expect(await s.getDocuments()).toEqual([]);
  expect(await s.listDocumentBytes()).toEqual([]);
});

test("a vault-only (v2) restore clears the document store instead of orphaning bytes", async () => {
  globalThis.indexedDB = new IDBFactory();
  const source = createEncryptedStorage("lavega-vault-test-v2-source");
  await source.open(KEY, "user:a");
  await source.putAccounts([acc("A", 500)]);
  const vaultOnly = source.export()!; // v2: no documents in this format
  source.lock();

  globalThis.indexedDB = new IDBFactory();
  const target = createEncryptedStorage("lavega-vault-test-v2-target");
  await target.open(KEY, "user:a");
  await target.putDocuments([document("oud")]);
  await target.putDocumentBytes("oud", bytesOf("old"));
  expect(await target.restore(vaultOnly)).toBe(true);
  expect((await target.getAccounts())[0]?.balance).toBe(500);
  // The replaced vault's documents are gone, not pointing at nothing.
  expect(await target.getDocuments()).toEqual([]);
  expect(await target.listDocumentBytes()).toEqual([]);
});

test("a version-1 database upgrades in place and gains the document store", async () => {
  globalThis.indexedDB = new IDBFactory();
  const dbName = "lavega-vault-test-upgrade";
  // A vault sealed with a password, written by the pre-account-key build.
  await writePasswordVault(dbName, "geheim", { accounts: [acc("A", 10)], txs: [], rules: [] });
  const s = createEncryptedStorage(dbName);
  expect(await s.open(KEY, "user:a")).toBe("password-vault");
  expect(await s.adoptPasswordVault("geheim")).toBe(true);
  expect((await s.getAccounts())[0]?.balance).toBe(10);
  // The upgrade created the document store beside the vault blob.
  await s.putDocumentBytes("nieuw", bytesOf("bytes"));
  expect(await s.hasDocumentBytes("nieuw")).toBe(true);
  s.lock();
  expect(await s.open(KEY, "user:a")).toBe("opened");
  expect(await s.hasDocumentBytes("nieuw")).toBe(true);
});

test("valuations round-trip; a legacy vault defaults to [] and a rewrite is replace-all", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createEncryptedStorage("lavega-vault-test-valuations");
  await s.open(KEY, "user:a");
  expect(await s.getValuations()).toEqual([]); // legacy vault default

  const valuation: Valuation = {
    id: "A|2026-11-05",
    accountKey: "A",
    date: "2026-11-05",
    amountCents: 42_000_000,
    currency: "EUR",
    kind: "reconciliation",
    source: "manual",
    createdAt: "2026-11-11",
  };
  await s.putValuations([valuation]);
  expect(await s.getValuations()).toEqual([valuation]);

  // Replace-all: a merge/delete rewrites the whole list, so a removed row can
  // never come back from a stale snapshot.
  await s.putValuations([]);
  expect(await s.getValuations()).toEqual([]);
  await s.putValuations([valuation]);
  s.lock();
  expect(await s.open(KEY, "user:a")).toBe("opened");
  expect(await s.getValuations()).toEqual([valuation]);
});

test("import sessions round-trip; a legacy vault defaults to [] and a rewrite is replace-all", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createEncryptedStorage("lavega-vault-test-import-sessions");
  await s.open(KEY, "user:a");
  expect(await s.getImportSessions()).toEqual([]); // legacy vault default
  const session: ImportSession = {
    id: "import-1",
    documentId: "sha",
    filename: "export.csv",
    accountKey: "A",
    format: "generic-csv",
    importedAt: "2026-11-11",
    txIds: ["t1", "t2"],
    rowsRead: 3,
    rowsImported: 2,
    duplicatesSkipped: 0,
    rowsRejected: 1,
  };
  await s.putImportSessions([session]);
  expect(await s.getImportSessions()).toEqual([session]);
  // Replace-all: a revert rewrites the list, so a removed session cannot return
  // from a stale snapshot.
  await s.putImportSessions([]);
  expect(await s.getImportSessions()).toEqual([]);
  await s.putImportSessions([session]);
  s.lock();
  expect(await s.open(KEY, "user:a")).toBe("opened");
  expect(await s.getImportSessions()).toEqual([session]);
});

test("opening a vault migrates a known account-type spelling once", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createEncryptedStorage("lavega-vault-test-types");
  await s.open(KEY, "user:a");
  await s.putAccounts([{ ...acc("A"), type: "Savings" }]);
  s.lock();
  expect(await s.open(KEY, "user:a")).toBe("opened");
  expect((await s.getAccounts())[0]?.type).toBe("Spaarrekening");
  // Canonical already: a second open changes nothing.
  s.lock();
  expect(await s.open(KEY, "user:a")).toBe("opened");
  expect((await s.getAccounts())[0]?.type).toBe("Spaarrekening");
});

test("bills + occurrences round-trip in one save; legacy vault defaults to []", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createEncryptedStorage("lavega-vault-test-bills");
  await s.open(KEY, "user:a");
  expect(await s.getBills()).toEqual([]); // default
  expect(await s.getBillOccurrences()).toEqual([]);

  const bill: Bill = {
    id: "b1",
    name: "Huur",
    type: "bill",
    status: "active",
    direction: "out",
    amountCents: 98_500,
    amountStrategy: "fixed",
    currency: "EUR",
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 1 }],
    anchorDate: "2026-11-01",
    weekendAdjust: "none",
    endMode: "never",
    tags: [],
  };
  const occurrence: BillOccurrence = {
    id: "b1|2026-11-01",
    billId: "b1",
    originalDueOn: "2026-11-01",
    dueOn: "2026-11-01",
    currency: "EUR",
    expectedAmountCents: null,
    status: "scheduled",
  };
  await s.putBillPlan([bill], [occurrence]);
  expect(await s.getBills()).toEqual([bill]);
  expect(await s.getBillOccurrences()).toEqual([occurrence]);

  // Re-open: both survive the seal/unseal cycle in the same section pair.
  s.lock();
  expect(await s.open(KEY, "user:a")).toBe("opened");
  expect((await s.getBills())[0].id).toBe("b1");
  expect((await s.getBillOccurrences())[0].id).toBe("b1|2026-11-01");
});

test("bill decisions ride in the same putBillPlan save and survive without one", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = createEncryptedStorage("lavega-vault-test-bill-decisions");
  await s.open(KEY, "user:a");
  expect(await s.getBillDecisions()).toEqual({
    matches: [],
    marks: [],
    rejections: [],
    priceChanges: [],
  });

  const decisions = {
    matches: [
      {
        id: "m1",
        occurrenceId: "b1|2026-11-01",
        billId: "b1",
        txId: "t1",
        amountCents: 98_500,
        currency: "EUR",
        source: "auto" as const,
        confidence: 0.95,
        decidedAt: "2026-11-11",
      },
    ],
    marks: [
      {
        occurrenceId: "b1|2026-12-01",
        billId: "b1",
        paidOn: "2026-11-11",
        amountCents: 98_500,
        currency: "EUR",
        markedAt: "2026-11-11",
      },
    ],
    rejections: [
      { billId: "b1", txId: "t9", occurrenceId: "b1|2027-01-01", rejectedAt: "2026-11-11" },
    ],
    priceChanges: [
      {
        billId: "b1",
        effectiveOn: "2026-11-01",
        oldAmountCents: 95_000,
        newAmountCents: 98_500,
        currency: "EUR",
        detectedAt: "2026-11-11",
        source: "auto" as const,
      },
    ],
  };
  await s.putBillPlan([], [], decisions);
  expect(await s.getBillDecisions()).toEqual(decisions);

  // A later save without a decisions argument (a schedule edit, a lazy
  // materialization) must not forget them.
  await s.putBillPlan([], []);
  expect(await s.getBillDecisions()).toEqual(decisions);

  // Mutating the getter's copy cannot change vault state.
  const read = await s.getBillDecisions();
  read.matches.push({ ...decisions.matches[0], id: "m2" });
  expect((await s.getBillDecisions()).matches).toHaveLength(1);

  s.lock();
  expect(await s.open(KEY, "user:a")).toBe("opened");
  expect(await s.getBillDecisions()).toEqual(decisions);
});

test("assistant approvals and memories round-trip across lock/unlock; legacy vault reads empty", async () => {
  globalThis.indexedDB = new IDBFactory();
  const v = createEncryptedStorage("lavega-vault-test-assistant");
  await v.open(KEY, "user:a");
  expect(await v.getAssistant()).toEqual({ approvals: [], memories: [] }); // legacy/new vault

  const state = {
    approvals: [
      {
        id: "approval-1",
        tool: "remember_preference" as const,
        payload: { subject: "lengte", valueId: "kort" },
        decision: "approved" as const,
        decidedAt: "2026-11-11T10:00:00.000Z",
        createdAt: "2026-11-11T09:59:00.000Z",
      },
    ],
    memories: [
      {
        id: "assistant-memory-lengte",
        subject: "lengte" as const,
        valueId: "kort",
        createdAt: "2026-11-11T10:00:00.000Z",
      },
    ],
  };
  await v.putAssistant(state);
  v.lock();
  expect(await v.open(KEY, "user:a")).toBe("opened");
  // The decision must survive the reload the owner experiences.
  expect(await v.getAssistant()).toEqual(state);
});
