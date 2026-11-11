import { openDB, type IDBPDatabase } from "idb";
import { Effect } from "effect";
import {
  budgetPeriodFromLimits,
  decodePlanState,
  decodeProfileStore,
  emptyPlanSection,
  carryUnknownKeys,
  encodeProfileStore,
  mergeEvents,
  migrateAccountTypes,
  migrateTxStates,
  normalizeValuation,
  billDecisionsOf,
} from "@lavega/core";
import type {
  AdvisorProfileStore,
  ProfileRead,
  LearningSection,
  PlanSection,
  SectionValue,
  VaultEvent,
  Account,
  Tx,
  Rule,
  ScheduledFlow,
  VatSettings,
  Invoice,
  RewardsBalance,
  LearnedFact,
  EntityProfile,
  BrokerCredentials,
  CredentialBroker,
  CredentialStore,
  N8nSettings,
  N8nAutoBooked,
  TransferPair,
  Merchant,
  BudgetPeriod,
  CategoryGroup,
  Bill,
  BillDecisions,
  BillOccurrence,
  Valuation,
  VaultDocument,
  ImportSession,
} from "@lavega/core";
import type { StorageAdapter } from "./StorageAdapter.js";
import { decryptJSON, deriveKey, openBytes, sealBytes, sealJSON } from "../crypto/vaultCrypto.js";
import type {
  AccountCipherBlob,
  BundleBlob,
  CipherBlob,
  PassphraseCipherBlob,
} from "../crypto/vaultCrypto.js";

const DEFAULT_DB_NAME = "lavega-vault";
const DB_VERSION = 2;
const STORE_NAME = "vault";
const RECORD_KEY = "blob";
/** The document BYTES live here, sealed, never in the vault blob: a document
 *  upload must not rewrite the whole vault ciphertext (issue #293). One record
 *  per document, keyed by its SHA-256. */
const DOCUMENT_STORE = "documents";

/**
 * What `open` found.
 *
 * - `opened`: this owner's vault exists and the key opened it.
 * - `created`: this owner had no vault in this browser; an empty one now exists.
 * - `password-vault`: this owner has no vault yet, but this browser holds one
 *   sealed with a vault password from before accounts held the key. Nothing is
 *   written until the owner adopts it (`adoptPasswordVault`) or sets it aside
 *   (`startFresh`).
 */
export type VaultOpenResult = "opened" | "created" | "password-vault";

type VaultData = {
  accounts: Account[];
  txs: Tx[];
  rules: Rule[];
  scheduledFlows?: ScheduledFlow[];
  vatSettings?: VatSettings[];
  invoices?: Invoice[];
  rewards?: RewardsBalance[];
  /** First-class transfer records (issue #282): the DECISIONS only — confirmed
   *  and rejected pairs. Suggestions are derived on read from the ledger, never
   *  stored. Additive optional field: a legacy vault decrypts without it. */
  transfers?: TransferPair[];
  /** The minimal merchant registry (issue #284): canonical key + display name +
   *  the raw spellings that resolve to it. Additive optional field, like
   *  `transfers`: a legacy vault decrypts without it and reads [] (unknown
   *  aliases are not invented; `labels.ts` then falls back to its token key). */
  merchants?: Merchant[];
  /** Bill series + their materialized occurrences (issue #286, WS2.1/WS2.3).
   *  Two additive optional fields; a legacy vault decrypts without them and
   *  reads []. Occurrences are generated lazily on unlock, and the pair is
   *  saved together so materialization is ONE vault write. */
  bills?: Bill[];
  billOccurrences?: BillOccurrence[];
  /** Paid-occurrence decisions (issue #287): allocations, marks, rejection
   *  memory and price-change history. Additive like `bills`; a legacy vault
   *  reads the empty section and the screen behaves exactly as #286. Written
   *  by `putBillPlan` together with the rows it closes, so a decision is ONE
   *  seal. */
  billDecisions?: BillDecisions;
  facts?: LearnedFact[];
  entityProfiles?: EntityProfile[];
  credentials?: BrokerCredentials[];
  /** His own n8n webhook/API credentials (settings.ts). Same treatment as
   *  `credentials` above: a live secret, encrypted at rest and gated by the
   *  vault passphrase like everything else here — not the plaintext
   *  localStorage it replaces. */
  n8nSettings?: N8nSettings;
  n8nAutoBooked?: N8nAutoBooked[];
  /** n8n rows still under review in apps/web (PendingInvoice[] / N8nNotice[] —
   *  those types live in apps/web/src/n8n.ts, which this package must not
   *  depend on, so they round-trip here as opaque JSON). The webhook that fed
   *  them already deleted its own copy, so once fetched this vault field is
   *  the only place they still exist until the owner confirms or discards
   *  each one. */
  n8nPendingInvoices?: unknown[];
  n8nPendingNotices?: unknown[];
  /** ECB history per non-EUR currency (isoDate -> units-per-1-EUR), merged
   *  across currencies. Lives in the vault (not refetched every load) so a
   *  euro figure already converted from a past date stays the same number
   *  offline, after the fact, or once the ECB has moved on. */
  fxHistory?: Record<string, Record<string, number>>;
  /** The adviser profile store in its encoded (plain JSON) form: re-decoded on
   *  every read so a blob from an older build is checked, never trusted. */
  profile?: unknown;
  /** The first undecodable profile blob a write replaced; kept so nothing the
   *  user entered is silently lost. */
  profileCorruptBackup?: unknown;
  plan?: PlanSection;
  /** Budget envelopes (issue #289): one row per initialized month, carrying the
   *  previous month's surplus. Additive optional field; a legacy vault decrypts
   *  without it and the open pass migrates `categoryLimits` into the first
   *  period (see `withMigratedBudgets`). */
  budgetPeriods?: BudgetPeriod[];
  /** The explicit category -> group map. Optional like `budgetPeriods`: absent
   *  means every category is its own top-level budget line. */
  categoryGroups?: CategoryGroup[];
  /** Dated absolute valuations (WS3.1, issue #291): one row per account per
   *  day, a hard reset the balance series replays from. Additive optional
   *  field; a legacy vault decrypts without it and reads []. */
  valuations?: Valuation[];
  /** Statement metadata (WS3.5, issue #293). The BYTES are not here: they are
   *  sealed in the separate `documents` object store under the same SHA-256.
   *  Additive optional field; a legacy vault decrypts without it and reads []. */
  documents?: VaultDocument[];
  /** Generic import sessions (WS3.6, issue #294): which rows one import
   *  created, so a revert removes exactly those. Additive optional field; a
   *  legacy vault decrypts without it and reads []. */
  importSessions?: ImportSession[];
  learning?: LearningSection;
  events?: VaultEvent[];
};

export interface VaultStorage extends StorageAdapter, CredentialStore {
  /** Open this owner's vault with its key (docs/adr/0009-account-held-vault-key.md).
   *  `owner` names the browser database, so two accounts that sign in on the
   *  same browser never read or overwrite each other's vault. */
  open(key: CryptoKey, owner: string): Promise<VaultOpenResult>;
  /** Re-seal the password vault `open` reported under the owner's key, then
   *  delete the password-sealed copy. False on a wrong password; nothing changes. */
  adoptPasswordVault(passphrase: string): Promise<boolean>;
  /** Leave the password vault where it is and start this owner with an empty one. */
  startFresh(): Promise<void>;
  lock(): void;
  export(): CipherBlob | null; // the current sealed blob (Back-up downloads it); null before open
  /** Adopt a back-up file as THE vault, re-sealed under the owner's key. A file
   *  from before accounts held the key needs its vault password. False on a
   *  wrong password or a file another key sealed; current state untouched. */
  restore(blob: CipherBlob, passphrase?: string): Promise<boolean>;
  getScheduledFlows(): Promise<ScheduledFlow[]>;
  putScheduledFlows(f: ScheduledFlow[]): Promise<void>;
  getVatSettings(): Promise<VatSettings[]>;
  putVatSettings(s: VatSettings[]): Promise<void>;
  getInvoices(): Promise<Invoice[]>;
  putInvoices(i: Invoice[]): Promise<void>;
  getRewards(): Promise<RewardsBalance[]>;
  putRewards(r: RewardsBalance[]): Promise<void>;
  /** Stored transfer decisions; a legacy vault has none and reads []. */
  getTransfers(): Promise<TransferPair[]>;
  putTransfers(p: TransferPair[]): Promise<void>;
  /** Stored budget envelopes, oldest month first; a legacy vault reads []. */
  getBudgetPeriods(): Promise<BudgetPeriod[]>;
  putBudgetPeriods(periods: BudgetPeriod[]): Promise<void>;
  /** The category-group map; a legacy vault reads []. */
  getCategoryGroups(): Promise<CategoryGroup[]>;
  putCategoryGroups(groups: CategoryGroup[]): Promise<void>;
  /** Dated absolute valuations, oldest first; a legacy vault reads []. */
  getValuations(): Promise<Valuation[]>;
  /** Replace-all: a merge or delete rewrites the whole list in one save, so a
   *  valuation can never point at an account the vault no longer holds. */
  putValuations(valuations: Valuation[]): Promise<void>;
  /** Statement metadata, one row per document (identity = SHA-256). A legacy
   *  vault reads []. The bytes are NOT in the vault blob. */
  getDocuments(): Promise<VaultDocument[]>;
  putDocuments(documents: VaultDocument[]): Promise<void>;
  /** Seal and store one document's bytes under its SHA-256. Storing the same
   *  hash twice is one record, never two. */
  putDocumentBytes(sha256: string, bytes: Uint8Array): Promise<void>;
  getDocumentBytes(sha256: string): Promise<Uint8Array | null>;
  hasDocumentBytes(sha256: string): Promise<boolean>;
  deleteDocumentBytes(sha256: string): Promise<void>;
  listDocumentBytes(): Promise<string[]>;
  /** Erase every sealed byte without touching the vault. */
  deleteAllDocumentBytes(): Promise<void>;
  /** The full back-up bundle (v3): vault data AND sealed document bytes sealed
   *  together under the vault key. Null before open. */
  exportBundle(): Promise<BundleBlob | null>;
  /** Erase all document metadata and all sealed bytes in one pass (issue #293
   *  acceptance: erase removes BOTH). Returns how many documents were erased. */
  eraseDocuments(): Promise<number>;
  /** Generic import sessions, oldest first; a legacy vault reads []. */
  getImportSessions(): Promise<ImportSession[]>;
  /** Replace-all: a revert rewrites the list in one save. */
  putImportSessions(sessions: ImportSession[]): Promise<void>;
  /** The owner's merchant aliases; a legacy vault has none and reads []. */
  getMerchants(): Promise<Merchant[]>;
  putMerchants(m: Merchant[]): Promise<void>;
  /** Bill series and their occurrences; a legacy vault has neither and reads [].
   *  Saved together: materialization and a schedule edit each rewrite the pair
   *  in one persist, so the vault never holds a series without its rows. */
  getBills(): Promise<Bill[]>;
  getBillOccurrences(): Promise<BillOccurrence[]>;
  /** The bills sidecar. A legacy vault has none and reads the empty section. */
  getBillDecisions(): Promise<BillDecisions>;
  /** Save series, rows AND the decisions that closed some of them in one
   *  persist. `decisions` omitted keeps what the vault already holds, so a
   *  schedule edit or a lazy materialization never drops a payment decision. */
  putBillPlan(
    bills: Bill[],
    occurrences: BillOccurrence[],
    decisions?: BillDecisions,
  ): Promise<void>;
  getFacts(): Promise<LearnedFact[]>;
  putFacts(f: LearnedFact[]): Promise<void>;
  getN8nSettings(): Promise<N8nSettings>;
  putN8nSettings(settings: N8nSettings): Promise<void>;
  getAutoBookedInvoices(): Promise<N8nAutoBooked[]>;
  putAutoBookedInvoices(list: N8nAutoBooked[]): Promise<void>;
  getPendingInvoices(): Promise<unknown[]>;
  putPendingInvoices(list: unknown[]): Promise<void>;
  getPendingNotices(): Promise<unknown[]>;
  putPendingNotices(list: unknown[]): Promise<void>;
  getFxHistory(): Promise<Record<string, Record<string, number>>>;
  putFxHistory(h: Record<string, Record<string, number>>): Promise<void>;
  /** `absent` on a legacy vault; `corrupt` when a stored blob no longer decodes
   *  (the blob stays in place; a later putProfile moves it to a backup key). */
  getProfile(): Promise<ProfileRead>;
  putProfile(s: AdvisorProfileStore): Promise<void>;
  /** Replace-all for `plan` and `learning`; events go through appendEvents. */
  getSection<N extends "plan" | "learning" | "events">(name: N): Promise<SectionValue[N]>;
  putSection<N extends "plan" | "learning">(name: N, value: SectionValue[N]): Promise<void>;
  /** Union by event id with what is already stored; idempotent. */
  appendEvents(events: readonly VaultEvent[]): Promise<void>;
}

// Local base64 decode — not exported by vaultCrypto.ts. Plain byte encoding,
// not crypto.
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function openPasswordBlob<T>(blob: PassphraseCipherBlob, passphrase: string): Promise<T> {
  const candidateKey = await deriveKey(passphrase, fromB64(blob.salt), blob.iterations); // throws below the PBKDF2 floor
  return decryptJSON<T>(candidateKey, blob); // throws on wrong passphrase / tampered ciphertext
}

const LOCKED_ERROR = "kluis vergrendeld";

function readProfile(raw: unknown): ProfileRead {
  if (raw == null) return { kind: "absent" };
  return Effect.runSync(
    decodeProfileStore(raw).pipe(
      Effect.map((store): ProfileRead => ({ kind: "ok", store })),
      Effect.catchTag("ProfileDecodeError", () => Effect.succeed<ProfileRead>({ kind: "corrupt" })),
    ),
  );
}

export function createEncryptedStorage(dbName: string = DEFAULT_DB_NAME): VaultStorage {
  // In-memory-only state. Never persisted. Dropped entirely on lock().
  let key: CryptoKey | null = null;
  let data: VaultData | null = null;
  let blob: AccountCipherBlob | null = null;
  // The open owner's database. `dbName` itself holds only a password vault
  // from before accounts held the key.
  let ownerDb: string | null = null;

  function openVaultDb(name: string): Promise<IDBPDatabase> {
    return openDB(name, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        // Version 1 databases upgrade in place: the vault blob stays where it
        // is and the document store is added beside it.
        if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
          db.createObjectStore(DOCUMENT_STORE);
        }
      },
    });
  }

  /** One short-lived connection per document operation, the same pattern the
   *  blob read/write helpers use. A document write never touches the vault
   *  ciphertext, which is the whole reason the store exists. */
  async function withDocumentStore<T>(
    mode: "readonly" | "readwrite",
    run: (store: {
      put(value: unknown, key: string): Promise<unknown>;
      get(key: string): Promise<unknown>;
      delete(key: string): Promise<unknown>;
      getAllKeys(): Promise<unknown[]>;
      clear(): Promise<unknown>;
    }) => Promise<T> | T,
  ): Promise<T> {
    if (ownerDb == null) throw new Error(LOCKED_ERROR);
    const db = await openVaultDb(ownerDb);
    try {
      const tx = db.transaction(DOCUMENT_STORE, mode);
      const result = await run(
        tx.store as unknown as {
          put(value: unknown, key: string): Promise<unknown>;
          get(key: string): Promise<unknown>;
          delete(key: string): Promise<unknown>;
          getAllKeys(): Promise<unknown[]>;
          clear(): Promise<unknown>;
        },
      );
      await tx.done;
      return result;
    } finally {
      db.close();
    }
  }

  async function readBlobFromDisk(name: string): Promise<CipherBlob | null> {
    const db = await openVaultDb(name);
    const record = (await db.get(STORE_NAME, RECORD_KEY)) as CipherBlob | undefined;
    db.close(); // don't leak a connection per read
    return record ?? null;
  }

  async function writeBlobToDisk(name: string, b: CipherBlob): Promise<void> {
    const db = await openVaultDb(name);
    await db.put(STORE_NAME, b, RECORD_KEY);
    db.close();
  }

  async function deleteBlobFromDisk(name: string): Promise<void> {
    const db = await openVaultDb(name);
    await db.delete(STORE_NAME, RECORD_KEY);
    db.close();
  }

  async function passwordVault(): Promise<PassphraseCipherBlob | null> {
    const legacy = await readBlobFromDisk(dbName);
    return legacy?.v === 1 ? legacy : null;
  }

  // Re-encrypts the full in-memory data set with a fresh IV and overwrites
  // the single on-disk blob record. Ciphertext only ever leaves memory.
  async function persist(): Promise<void> {
    if (key == null || data == null || ownerDb == null) throw new Error(LOCKED_ERROR);
    const fresh = await sealJSON(key, data);
    await writeBlobToDisk(ownerDb, fresh);
    blob = fresh;
  }

  async function adopt(next: VaultData): Promise<void> {
    data = next;
    await persist();
  }

  // Serialize every write: each put's read-mutate-encrypt-write runs atomically
  // relative to the others. Without this, two overlapping puts could each
  // snapshot `data`, and if the earlier one's encrypt/IndexedDB write resolves
  // LAST it would silently revert the on-disk blob to a stale snapshot — real
  // data-loss risk for a vault. WebCrypto runs off-thread in browsers, so
  // resolution order under concurrency isn't guaranteed; this queue makes it so.
  let writeChain: Promise<unknown> = Promise.resolve();
  function enqueueWrite<T>(op: () => Promise<T>): Promise<T> {
    const run = writeChain.then(op, op); // run regardless of the prior write's outcome
    writeChain = run.catch(() => {}); // keep the chain alive after a rejection
    return run;
  }

  /** The single tx-state migration pass (issue #284). Called on every path that
   *  adopts an EXISTING vault, never on a fresh one. It returns the same object
   *  when nothing is missing, which is what keeps the pass to one write: after
   *  the first open every row has all four fields, so no later open re-seals. */
  function withMigratedTxStates(vault: VaultData): { vault: VaultData; changed: boolean } {
    const migrated = migrateTxStates(vault.txs ?? []);
    return migrated.changed
      ? { vault: { ...vault, txs: migrated.txs }, changed: true }
      : { vault, changed: false };
  }

  /** The WS2.9 budget migration: the first stored period is built from the
   *  legacy `categoryLimits`, once. After the field exists this returns the
   *  same object, so the pass costs one write in total and a later open writes
   *  nothing. A plan section that does not decode is left alone: its limits
   *  stay readable and no guess is written. */
  function withMigratedBudgets(vault: VaultData): { vault: VaultData; changed: boolean } {
    if (vault.budgetPeriods !== undefined) return { vault, changed: false };
    let limits: Record<string, { cents: number; at: string }>;
    try {
      limits = decodePlanState(vault.plan).preferences.categoryLimits;
    } catch {
      return { vault, changed: false };
    }
    const first = budgetPeriodFromLimits(limits);
    return first === null
      ? { vault, changed: false }
      : { vault: { ...vault, budgetPeriods: [first] }, changed: true };
  }

  /** The WS3.1 account-type migration: known spellings become the canonical
   *  Dutch strings once. An unknown value is left alone (it already reads as
   *  "other"), so the pass never renames data it does not understand. */
  function withMigratedAccountTypes(vault: VaultData): { vault: VaultData; changed: boolean } {
    const migrated = migrateAccountTypes(vault.accounts ?? []);
    return migrated.changed
      ? { vault: { ...vault, accounts: migrated.accounts }, changed: true }
      : { vault, changed: false };
  }

  /** Every open-time migration pass, so an old vault still re-seals once. */
  function withMigrations(vault: VaultData): { vault: VaultData; changed: boolean } {
    const types = withMigratedAccountTypes(vault);
    const tx = withMigratedTxStates(types.vault);
    const budget = withMigratedBudgets(tx.vault);
    return {
      vault: budget.vault,
      changed: types.changed || tx.changed || budget.changed,
    };
  }

  return {
    async open(ownerKey, owner): Promise<VaultOpenResult> {
      if (!owner.trim()) throw new Error("vault owner is required");
      const name = `${dbName}:${owner}`;
      const onDisk = await readBlobFromDisk(name);
      key = ownerKey;
      ownerDb = name;
      data = null;
      blob = null;
      if (onDisk?.v === 2) {
        // Throws if another key sealed it. That is not a state to paper over:
        // the key is per account and never replaced.
        const opened = await decryptJSON<VaultData>(ownerKey, onDisk);
        const migrated = withMigrations(opened);
        data = migrated.vault;
        blob = onDisk;
        // Exactly one save for the whole vault, and only when this open was the
        // one that upgraded an old row (WS1.6). A re-open writes nothing.
        if (migrated.changed) await enqueueWrite(() => persist());
        return "opened";
      }
      if (await passwordVault()) return "password-vault";
      await enqueueWrite(() => adopt({ accounts: [], txs: [], rules: [] }));
      return "created";
    },

    async adoptPasswordVault(passphrase): Promise<boolean> {
      const legacy = await passwordVault();
      if (legacy == null || key == null) return false;
      let opened: VaultData;
      try {
        opened = await openPasswordBlob<VaultData>(legacy, passphrase);
      } catch {
        return false; // wrong passphrase, tampered blob, or sub-floor iterations
      }
      await enqueueWrite(() => adopt(withMigrations(opened).vault));
      // Only once the re-sealed copy is on disk is the password copy redundant.
      await deleteBlobFromDisk(dbName);
      return true;
    },

    async startFresh(): Promise<void> {
      await enqueueWrite(async () => {
        // A fresh vault must not leave the previous vault's sealed documents
        // behind: bytes nothing points at are still the owner's data.
        await withDocumentStore("readwrite", (store) => store.clear());
        await adopt({ accounts: [], txs: [], rules: [] });
      });
    },

    lock(): void {
      key = null;
      data = null;
      ownerDb = null;
    },

    export(): CipherBlob | null {
      return blob;
    },

    async restore(imported: CipherBlob, passphrase?: string): Promise<boolean> {
      if (key == null) return false;
      // Verify OUTSIDE the write queue — this only reads the imported blob.
      let vault: VaultData;
      let documents: Array<{ sha256: string; blob: AccountCipherBlob }> = [];
      let carriesDocuments = false;
      try {
        if (imported.v === 3) {
          const bundle = await decryptJSON<{
            vault: VaultData;
            documents: Array<{ sha256: string; blob: AccountCipherBlob }>;
          }>(key, imported);
          vault = bundle.vault;
          documents = Array.isArray(bundle.documents) ? bundle.documents : [];
          carriesDocuments = true;
        } else if (imported.v === 2) {
          vault = await decryptJSON<VaultData>(key, imported);
        } else {
          vault = await openPasswordBlob<VaultData>(imported, passphrase ?? "");
        }
      } catch {
        // Wrong passphrase, another account's file, malformed bundle, or
        // sub-floor iterations: leave the current vault untouched.
        return false;
      }
      // Through the same queue as every mutator, so a put still resolving
      // cannot land after the swap and revert disk. A v1/v2 file cannot carry
      // documents, so restoring one CLEARS the document store: metadata from
      // the replaced vault would otherwise point at bytes nothing can vouch
      // for.
      await enqueueWrite(async () => {
        await withDocumentStore("readwrite", (store) => store.clear());
        if (carriesDocuments) {
          // The bundle carries the already-sealed bytes; restoring them writes
          // the same ciphertext, never a re-encryption with a fresh IV.
          await withDocumentStore("readwrite", async (store) => {
            for (const doc of documents) await store.put(doc.blob, doc.sha256);
          });
        }
        await adopt(withMigrations(vault).vault);
      });
      return true;
    },

    async exportBundle(): Promise<BundleBlob | null> {
      if (key == null || data == null) return null;
      const documents = await withDocumentStore("readonly", async (store) => {
        const keys = (await store.getAllKeys()) as string[];
        const out: Array<{ sha256: string; blob: AccountCipherBlob }> = [];
        for (const sha256 of keys) {
          const blob = (await store.get(sha256)) as AccountCipherBlob | undefined;
          if (blob != null) out.push({ sha256, blob });
        }
        return out;
      });
      const sealed = await sealJSON(key, { vault: data, documents });
      return { v: 3, kdf: "account-key", iv: sealed.iv, ct: sealed.ct };
    },

    async getDocuments(): Promise<VaultDocument[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.documents ?? [])];
    },
    putDocuments(documents: VaultDocument[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, documents: [...documents] };
        await persist();
      });
    },
    async getImportSessions(): Promise<ImportSession[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.importSessions ?? [])];
    },
    putImportSessions(sessions: ImportSession[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, importSessions: [...sessions] };
        await persist();
      });
    },
    async putDocumentBytes(sha256: string, bytes: Uint8Array): Promise<void> {
      // Sealed with the same vault key as everything else (ADR 0009): the store
      // never holds plaintext bytes.
      if (key == null) throw new Error(LOCKED_ERROR);
      const blob = await sealBytes(key, bytes);
      await withDocumentStore("readwrite", (store) => store.put(blob, sha256));
    },
    async getDocumentBytes(sha256: string): Promise<Uint8Array | null> {
      if (key == null) throw new Error(LOCKED_ERROR);
      const blob = (await withDocumentStore("readonly", (store) => store.get(sha256))) as
        | AccountCipherBlob
        | null
        | undefined;
      if (blob == null) return null;
      return openBytes(key, blob);
    },
    async hasDocumentBytes(sha256: string): Promise<boolean> {
      return (await withDocumentStore("readonly", (store) => store.get(sha256))) != null;
    },
    async deleteDocumentBytes(sha256: string): Promise<void> {
      await withDocumentStore("readwrite", (store) => store.delete(sha256));
    },
    listDocumentBytes(): Promise<string[]> {
      return withDocumentStore("readonly", async (store) => {
        const keys = (await store.getAllKeys()) as string[];
        return keys.sort();
      });
    },
    async deleteAllDocumentBytes(): Promise<void> {
      await withDocumentStore("readwrite", (store) => store.clear());
    },
    async eraseDocuments(): Promise<number> {
      const documents = await this.getDocuments();
      await withDocumentStore("readwrite", (store) => store.clear());
      await enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, documents: [] };
        await persist();
      });
      return documents.length;
    },

    async getAccounts(): Promise<Account[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...data.accounts];
    },
    putAccounts(a: Account[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        const byKey = new Map(data.accounts.map((acc) => [acc.key, acc]));
        for (const acc of a) byKey.set(acc.key, acc);
        data = { ...data, accounts: [...byKey.values()] };
        await persist();
      });
    },

    async getTxs(): Promise<Tx[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...data.txs];
    },
    putTxs(t: Tx[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        const byId = new Map(data.txs.map((tx) => [tx.id, tx]));
        for (const tx of t) byId.set(tx.id, tx);
        data = { ...data, txs: [...byId.values()] };
        await persist();
      });
    },

    // Removal primitives — parity with createIndexedDbStorage. Through
    // enqueueWrite like every mutator: a delete resolving out of order must not
    // let a stale snapshot's persist() revert the blob (and bring the row back).
    // `accountKey` (not `key`) — a `key` param would shadow the vault CryptoKey.
    deleteAccount(accountKey: string): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, accounts: data.accounts.filter((a) => a.key !== accountKey) };
        await persist();
      });
    },
    deleteTxs(ids: string[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        const drop = new Set(ids);
        data = { ...data, txs: data.txs.filter((t) => !drop.has(t.id)) };
        await persist();
      });
    },

    async getRules(): Promise<Rule[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...data.rules];
    },
    // Replace-all: mirrors createIndexedDbStorage's putRules semantics.
    putRules(rules: Rule[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, rules: [...rules] };
        await persist();
      });
    },

    // scheduledFlows/vatSettings are optional VaultData fields — a legacy vault
    // decrypts without them, so getters default to []. Replace-all, like putRules.
    async getScheduledFlows(): Promise<ScheduledFlow[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.scheduledFlows ?? [])];
    },
    putScheduledFlows(f: ScheduledFlow[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, scheduledFlows: [...f] };
        await persist();
      });
    },
    async getVatSettings(): Promise<VatSettings[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.vatSettings ?? [])];
    },
    putVatSettings(s: VatSettings[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, vatSettings: [...s] };
        await persist();
      });
    },
    // invoices is also an optional VaultData field — a legacy vault decrypts
    // without it, so the getter defaults to []. Replace-all, like putScheduledFlows.
    async getInvoices(): Promise<Invoice[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.invoices ?? [])];
    },
    putInvoices(i: Invoice[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, invoices: [...i] };
        await persist();
      });
    },
    // rewards is also an optional VaultData field — a legacy vault decrypts
    // without it, so the getter defaults to []. Replace-all, like putScheduledFlows.
    async getRewards(): Promise<RewardsBalance[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.rewards ?? [])];
    },
    putRewards(r: RewardsBalance[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, rewards: [...r] };
        await persist();
      });
    },
    // transfers is also an optional VaultData field — a legacy vault decrypts
    // without it, so the getter defaults to []. Replace-all, like putRewards.
    // Only decisions are stored; a fresh import can invalidate a suggestion,
    // so suggestions stay derived and never become stale vault state.
    async getTransfers(): Promise<TransferPair[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.transfers ?? [])];
    },
    putTransfers(p: TransferPair[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, transfers: [...p] };
        await persist();
      });
    },
    // Budget envelopes (issue #289): replace-all, additive optional fields. A
    // vault written before this reads [] and the plan falls back to the legacy
    // `categoryLimits` (see `budgetPeriodsOf` in @lavega/core).
    async getBudgetPeriods(): Promise<BudgetPeriod[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return structuredClone(data.budgetPeriods ?? []);
    },
    putBudgetPeriods(periods: BudgetPeriod[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, budgetPeriods: structuredClone(periods) };
        await persist();
      });
    },
    async getCategoryGroups(): Promise<CategoryGroup[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return structuredClone(data.categoryGroups ?? []);
    },
    putCategoryGroups(groups: CategoryGroup[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, categoryGroups: structuredClone(groups) };
        await persist();
      });
    },
    // Bills and occurrences are the same additive optional field shape:
    // replace-all, read [] on a legacy vault. They are written by ONE mutator
    // because the generator's output (rows) only makes sense with its series,
    // and the unlock pass must not pay two seals for one materialization.
    async getBills(): Promise<Bill[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.bills ?? [])];
    },
    async getBillOccurrences(): Promise<BillOccurrence[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.billOccurrences ?? [])];
    },
    async getBillDecisions(): Promise<BillDecisions> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return structuredClone(billDecisionsOf(data.billDecisions));
    },
    putBillPlan(
      bills: Bill[],
      occurrences: BillOccurrence[],
      decisions?: BillDecisions,
    ): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = {
          ...data,
          bills: [...bills],
          billOccurrences: [...occurrences],
          // Undefined keeps the stored decisions: a schedule edit or a
          // materialization must not silently forget which rows were paid.
          billDecisions: structuredClone(decisions ?? billDecisionsOf(data.billDecisions)),
        };
        await persist();
      });
    },
    // merchants is the same additive optional field shape: replace-all, and a
    // legacy vault reads [] so `labels.ts` falls back to its token key.
    async getValuations(): Promise<Valuation[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.valuations ?? [])];
    },
    putValuations(valuations: Valuation[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, valuations: valuations.map(normalizeValuation) };
        await persist();
      });
    },

    async getMerchants(): Promise<Merchant[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.merchants ?? [])];
    },
    putMerchants(m: Merchant[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, merchants: [...m] };
        await persist();
      });
    },

    // Privé/zakelijk per entity (item 4). Additive optional field, replace-all,
    // legacy vault => [] => every entity is personal, which is the default the
    // feature asks for anyway. No migration: nothing existing is rewritten.
    async getEntityProfiles(): Promise<EntityProfile[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.entityProfiles ?? [])];
    },
    putEntityProfiles(profiles: EntityProfile[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, entityProfiles: [...profiles] };
        await persist();
      });
    },

    // What the agents have learned (and what the owner corrected). Same additive
    // optional field + replace-all shape as the rest; a legacy vault has none.
    async getFacts(): Promise<LearnedFact[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.facts ?? [])];
    },
    putFacts(f: LearnedFact[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, facts: [...f] };
        await persist();
      });
    },

    // His n8n webhook/API credentials (settings.ts). Additive optional field,
    // replace-all — same shape as entityProfiles/facts above. A legacy vault
    // decrypts without it, so the getter defaults to {}: "never set", not "".
    async getN8nSettings(): Promise<N8nSettings> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return { ...data.n8nSettings };
    },
    putN8nSettings(settings: N8nSettings): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, n8nSettings: { ...settings } };
        await persist();
      });
    },

    // Invoices that booked themselves from the n8n queue (n8n.ts). The `Invoice`
    // record itself carries `autoBooked: true`; this list is only the fallback
    // for rows booked before that field existed, kept alive the same way.
    async getAutoBookedInvoices(): Promise<N8nAutoBooked[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.n8nAutoBooked ?? [])];
    },
    putAutoBookedInvoices(list: N8nAutoBooked[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, n8nAutoBooked: [...list] };
        await persist();
      });
    },

    // Rows apps/web is still reviewing from the n8n queue (n8n.ts). Same
    // replace-all shape as getAutoBookedInvoices/putAutoBookedInvoices above —
    // opaque JSON here because this package cannot import apps/web's types.
    async getPendingInvoices(): Promise<unknown[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.n8nPendingInvoices ?? [])];
    },
    putPendingInvoices(list: unknown[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, n8nPendingInvoices: [...list] };
        await persist();
      });
    },
    async getPendingNotices(): Promise<unknown[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.n8nPendingNotices ?? [])];
    },
    putPendingNotices(list: unknown[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, n8nPendingNotices: [...list] };
        await persist();
      });
    },

    // fxHistory is also an optional VaultData field — a legacy vault decrypts
    // without it, so the getter defaults to {}. Replace-all, like n8nSettings.
    async getFxHistory(): Promise<Record<string, Record<string, number>>> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return { ...data.fxHistory };
    },
    putFxHistory(h: Record<string, Record<string, number>>): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, fxHistory: { ...h } };
        await persist();
      });
    },

    // The adviser profile and the three sections that sit beside it. All are
    // optional VaultData fields, so a legacy vault decrypts without them.
    async getProfile(): Promise<ProfileRead> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return readProfile(data.profile);
    },
    putProfile(store: AdvisorProfileStore): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        const previous = readProfile(data.profile);
        const encoded = encodeProfileStore(store);
        data =
          previous.kind === "corrupt"
            ? {
                ...data,
                profile: encoded,
                profileCorruptBackup: data.profileCorruptBackup ?? data.profile,
              }
            : { ...data, profile: carryUnknownKeys(data.profile, encoded) };
        await persist();
      });
    },
    async getSection<N extends "plan" | "learning" | "events">(name: N): Promise<SectionValue[N]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      // One cast: the three branches each return their own section type.
      const value =
        name === "plan"
          ? (data.plan ?? emptyPlanSection())
          : name === "learning"
            ? (data.learning ?? {})
            : (data.events ?? []);
      return structuredClone(value) as SectionValue[N];
    },
    putSection<N extends "plan" | "learning">(name: N, value: SectionValue[N]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, [name]: structuredClone(value) };
        await persist();
      });
    },
    appendEvents(events: readonly VaultEvent[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, events: mergeEvents(data.events ?? [], events) };
        await persist();
      });
    },

    async getCredentials<T extends CredentialBroker>(
      tenantId: string,
      broker: T,
    ): Promise<Extract<BrokerCredentials, { broker: T }> | null> {
      // Credential reads are deliberately different from ordinary vault reads:
      // locked state is an absent secret, not an error-producing data path.
      if (data == null) return null;
      const credentials = data.credentials?.find(
        (item) => item.tenantId === tenantId && item.broker === broker,
      );
      return credentials == null
        ? null
        : (credentials as Extract<BrokerCredentials, { broker: T }>);
    },
    putCredentials(credentials: BrokerCredentials): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        const existing = data.credentials ?? [];
        const withoutCurrent = existing.filter(
          (item) => item.tenantId !== credentials.tenantId || item.broker !== credentials.broker,
        );
        data = { ...data, credentials: [...withoutCurrent, credentials] };
        await persist();
      });
    },
  };
}
