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
  AssistantState,
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
  /** The personal assistant thin slice (WS5.8, issue #301): append-only
   *  approval events and the memories an approval wrote. Additive optional
   *  field, like `facts`: a legacy vault decrypts without it and reads the
   *  empty state. Nothing here ever leaves the browser. */
  assistant?: AssistantState;
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
  /** Delete THIS owner's whole browser database (sealed vault and documents)
   *  and lock. First tells every other tab/instance holding the same database to
   *  drop its in-memory vault and stop writing (otherwise its next save would
   *  re-create the database with the old data), waits `settleMs` for that, and
   *  waits for queued writes. Rejects with `VaultDestroyError` ("blocked" when
   *  another connection keeps the database open past `timeoutMs`; the browser
   *  then keeps the delete pending and finishes it when that connection
   *  closes). Never touches the legacy password vault (`dbName`) or another
   *  owner's database. */
  destroyVault(options?: { timeoutMs?: number; settleMs?: number }): Promise<void>;
  /** Called when ANOTHER tab/instance destroys the vault this one has open.
   *  "locked": the delete is starting; this instance dropped its copy and refuses
   *  writes, and the page must NOT reload yet. "destroyed": the delete succeeded,
   *  reload now. "stalled": no success came in time (or the delete failed), so
   *  tell the user and offer a reload. Returns an unsubscribe. */
  onVaultDestroyed(listener: (phase: VaultDestroyPhase) => void): () => void;
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
  /** The assistant's approval events and approved memories; a legacy vault
   *  reads the empty state. One replace-all save per decision. */
  getAssistant(): Promise<AssistantState>;
  putAssistant(state: AssistantState): Promise<void>;
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

export type VaultDestroyPhase = "locked" | "destroyed" | "stalled";

/** Messages between tabs of this origin. `db` is the owner database name. */
type DestroyMessage = { type: "destroying" | "destroyed" | "failed"; db: string };

/** A short-lived localStorage marker, written before the delete and removed after,
 *  so a tab that (re)opens during the window waits instead of reading the old
 *  blob. It also doubles as the signal where BroadcastChannel is absent. */
const MARKER_KEY = "lavega.vaultDestroying";
const DESTROYED_KEY = "lavega.vaultDestroyed";
/** A marker older than this is a crashed delete, not a running one. */
const MARKER_STALE_MS = 20_000;
/** The longest `open` waits for a live marker to clear. */
const MARKER_WAIT_MS = 10_000;
/** A locked tab waits this long for "destroyed" before it says so. */
const STALL_MS = 12_000;

function marker(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** "live": a reset of `name` is running. "stale": a marker older than
 *  MARKER_STALE_MS, or one stamped in the future (a clock set backwards): it
 *  cannot be a running delete. */
function markerState(name: string): "none" | "live" | "stale" {
  try {
    const raw = marker()?.getItem(MARKER_KEY);
    if (!raw) return "none";
    const parsed = JSON.parse(raw) as { db?: unknown; at?: unknown };
    if (typeof parsed.at !== "number") return "stale";
    const age = Date.now() - parsed.at;
    if (age < 0 || age >= MARKER_STALE_MS) return "stale";
    return parsed.db === name ? "live" : "none";
  } catch {
    return "none";
  }
}

function removeMarker(): void {
  try {
    marker()?.removeItem(MARKER_KEY);
  } catch {
    /* best effort */
  }
}

/** The cap is above the sender's own worst case (250 ms settle + 5 s delete
 *  timeout + queue), so a live marker normally clears before it is reached. */
async function waitForResetWindow(name: string, maxMs: number): Promise<void> {
  if (markerState(name) === "stale") return removeMarker();
  const deadline = Date.now() + maxMs;
  let waited = false;
  while (markerState(name) === "live" && Date.now() < deadline) {
    waited = true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // Waited out the whole cap (the sender died or is stuck): do not cost the next open a wait.
  if (waited && markerState(name) !== "none") removeMarker();
}

const DESTROY_TIMEOUT_MS = 5000;
const DESTROY_SETTLE_MS = 250;
const RESET_CHANNEL = "lavega-vault-destroyed";

/** Why a vault could not be destroyed; the UI maps it to copy in its own language. */
export class VaultDestroyError extends Error {
  constructor(
    readonly reason: "blocked" | "locked" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "VaultDestroyError";
  }
}

/** `indexedDB.deleteDatabase` never fails on a blocker: it waits, silently, until
 *  every other connection closes. Waiting forever is not an answer for a reset,
 *  so a block that lasts `timeoutMs` is a failure the caller can report. */
function deleteDatabase(name: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve();
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(new VaultDestroyError("failed", request.error?.message ?? "delete failed"));
    };
    request.onblocked = () => {
      timer ??= setTimeout(
        () => reject(new VaultDestroyError("blocked", "delete blocked by another connection")),
        timeoutMs,
      );
    };
  });
}

type VaultState =
  | { kind: "locked" }
  | { kind: "password-vault"; key: CryptoKey; ownerDb: string }
  | {
      kind: "unlocked";
      key: CryptoKey;
      ownerDb: string;
      data: VaultData;
      blob: AccountCipherBlob;
    }
  | { kind: "destroying"; lockedDb: string; stallTimer: ReturnType<typeof setTimeout> }
  | { kind: "destroyed" }
  | { kind: "stalled" };

export function createEncryptedStorage(dbName: string = DEFAULT_DB_NAME): VaultStorage {
  // In-memory-only state machine. Never persisted. Dropped entirely on lock().
  // `dbName` itself holds only a legacy password vault from before accounts held the key.
  let state: VaultState = { kind: "locked" };

  const destroyedListeners = new Set<(phase: VaultDestroyPhase) => void>();
  const tell = (phase: VaultDestroyPhase) => {
    for (const listener of destroyedListeners) listener(phase);
  };
  const clearStallTimer = () => {
    if (state.kind === "destroying") clearTimeout(state.stallTimer);
  };
  const requireUnlocked = (): Extract<VaultState, { kind: "unlocked" }> => {
    if (state.kind !== "unlocked") throw new Error(LOCKED_ERROR);
    return state;
  };

  /* Other tabs/instances of this origin, in two phases. "destroying": an
   * instance holding that database locks AT ONCE and synchronously (key, data,
   * blob and name dropped, so no later save can re-create it) but does not
   * reload: a reload could re-open the old vault before the delete runs.
   * "destroyed" (after the delete succeeded) is what makes it reload; if that
   * never comes the listener hears "stalled". `unref` keeps a Node test process
   * from waiting on the channel or the timer. Where BroadcastChannel is absent
   * the same messages travel as `storage` events on the marker keys. */
  function onDestroyMessage(message: DestroyMessage) {
    if (message.type === "destroying") {
      if (
        (state.kind !== "unlocked" && state.kind !== "password-vault") ||
        message.db !== state.ownerDb
      ) {
        return;
      }
      const db = state.ownerDb;
      const stallTimer = setTimeout(() => {
        if (state.kind === "destroying" && state.lockedDb === db) {
          state = { kind: "stalled" };
          tell("stalled");
        }
      }, STALL_MS);
      (stallTimer as unknown as { unref?: () => void }).unref?.();
      state = { kind: "destroying", lockedDb: db, stallTimer };
      tell("locked");
      return;
    }
    if (state.kind !== "destroying" || message.db !== state.lockedDb) return;
    clearTimeout(state.stallTimer);
    if (message.type === "destroyed") {
      state = { kind: "destroyed" };
      tell("destroyed");
    } else {
      state = { kind: "stalled" };
      tell("stalled");
    }
  }
  /* A constructor that throws (blocked, sandboxed, unsupported) must never stop
   * the vault from opening: no channel, and the `storage`-event fallback below. */
  let channel: BroadcastChannel | null = null;
  try {
    channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(RESET_CHANNEL);
    (channel as unknown as { unref?: () => void } | null)?.unref?.();
  } catch {
    channel = null;
  }
  if (channel) {
    channel.onmessage = (event: MessageEvent) => onDestroyMessage(event.data as DestroyMessage);
  } else if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("storage", (event: StorageEvent) => {
      try {
        if (event.key === MARKER_KEY && event.newValue) {
          const parsed = JSON.parse(event.newValue) as { db?: string };
          if (parsed.db) onDestroyMessage({ type: "destroying", db: parsed.db });
        } else if (event.key === DESTROYED_KEY && event.newValue) {
          const parsed = JSON.parse(event.newValue) as { db?: string; ok?: boolean };
          if (parsed.db)
            onDestroyMessage({ type: parsed.ok === false ? "failed" : "destroyed", db: parsed.db });
        }
      } catch {
        /* a foreign or garbled value is not ours */
      }
    });
  }

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

  async function withDocumentStoreFor<T>(
    targetDb: string,
    mode: "readonly" | "readwrite",
    run: (store: {
      put(value: unknown, key: string): Promise<unknown>;
      get(key: string): Promise<unknown>;
      delete(key: string): Promise<unknown>;
      getAllKeys(): Promise<unknown[]>;
      clear(): Promise<unknown>;
    }) => Promise<T> | T,
  ): Promise<T> {
    const db = await openVaultDb(targetDb);
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
    const { ownerDb } = requireUnlocked();
    return withDocumentStoreFor(ownerDb, mode, run);
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
  async function sealAndWrite(
    expectedKey: CryptoKey,
    expectedDb: string,
    next: VaultData,
  ): Promise<void> {
    const fresh = await sealJSON(expectedKey, next);
    // Another tab may have locked this instance while it sealed; never write to
    // a database named from an absent owner, and never to one being destroyed.
    if (
      (state.kind !== "unlocked" && state.kind !== "password-vault") ||
      state.ownerDb !== expectedDb ||
      state.key !== expectedKey
    ) {
      throw new Error(LOCKED_ERROR);
    }
    await writeBlobToDisk(expectedDb, fresh);
    if (
      (state.kind !== "unlocked" && state.kind !== "password-vault") ||
      state.ownerDb !== expectedDb ||
      state.key !== expectedKey
    ) {
      throw new Error(LOCKED_ERROR);
    }
    state = { kind: "unlocked", key: expectedKey, ownerDb: expectedDb, data: next, blob: fresh };
  }

  async function adopt(next: VaultData): Promise<void> {
    if (state.kind !== "unlocked" && state.kind !== "password-vault") {
      throw new Error(LOCKED_ERROR);
    }
    await sealAndWrite(state.key, state.ownerDb, next);
  }

  function updateUnlocked(mutate: (current: VaultData) => VaultData): Promise<void> {
    return enqueueWrite(async () => {
      const current = requireUnlocked();
      const next = mutate(current.data);
      await sealAndWrite(current.key, current.ownerDb, next);
    });
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
      // A reset of this very vault may be mid-flight in another tab: do not read
      // the old blob it is about to delete (bounded; a stale marker is ignored).
      await waitForResetWindow(name, MARKER_WAIT_MS);
      const onDisk = await readBlobFromDisk(name);
      clearStallTimer();
      state = { kind: "locked" };
      if (onDisk?.v === 2) {
        // Throws if another key sealed it. That is not a state to paper over:
        // the key is per account and never replaced.
        const opened = await decryptJSON<VaultData>(ownerKey, onDisk);
        const migrated = withMigrations(opened);
        state = {
          kind: "unlocked",
          key: ownerKey,
          ownerDb: name,
          data: migrated.vault,
          blob: onDisk,
        };
        // Exactly one save for the whole vault, and only when this open was the
        // one that upgraded an old row (WS1.6). A re-open writes nothing.
        if (migrated.changed) {
          await enqueueWrite(() => sealAndWrite(ownerKey, name, migrated.vault));
        }
        return "opened";
      }
      if (await passwordVault()) {
        state = { kind: "password-vault", key: ownerKey, ownerDb: name };
        return "password-vault";
      }
      state = { kind: "password-vault", key: ownerKey, ownerDb: name };
      await enqueueWrite(() => adopt({ accounts: [], txs: [], rules: [] }));
      return "created";
    },

    async adoptPasswordVault(passphrase): Promise<boolean> {
      if (state.kind !== "password-vault") return false;
      const legacy = await passwordVault();
      if (legacy == null) return false;
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
        if (state.kind !== "password-vault" && state.kind !== "unlocked") {
          throw new Error(LOCKED_ERROR);
        }
        // A fresh vault must not leave the previous vault's sealed documents
        // behind: bytes nothing points at are still the owner's data.
        await withDocumentStoreFor(state.ownerDb, "readwrite", (store) => store.clear());
        await adopt({ accounts: [], txs: [], rules: [] });
      });
    },

    async destroyVault(options = {}): Promise<void> {
      const { timeoutMs = DESTROY_TIMEOUT_MS, settleMs = DESTROY_SETTLE_MS } = options;
      if (state.kind !== "unlocked" && state.kind !== "password-vault") {
        throw new VaultDestroyError("locked", LOCKED_ERROR);
      }
      const name = state.ownerDb;
      const store = marker();
      const announce = (type: DestroyMessage["type"]) => {
        try {
          channel?.postMessage({ type, db: name });
        } catch {
          /* the marker and the storage event still reach the other tabs */
        }
      };
      try {
        store?.setItem(MARKER_KEY, JSON.stringify({ db: name, at: Date.now() }));
      } catch {
        /* no marker: the channel still tells the other tabs */
      }
      announce("destroying");
      if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
      try {
        // Behind the write queue, so a save in flight cannot recreate the database.
        await enqueueWrite(async () => {
          if (
            (state.kind !== "unlocked" && state.kind !== "password-vault") ||
            state.ownerDb !== name
          ) {
            throw new VaultDestroyError("locked", LOCKED_ERROR);
          }
          // From here this instance never writes again, success or not: after a
          // blocked delete the browser still finishes it later.
          clearStallTimer();
          state = { kind: "locked" };
          await deleteDatabase(name, timeoutMs);
          state = { kind: "destroyed" };
        });
      } catch (error) {
        try {
          store?.removeItem(MARKER_KEY);
          store?.setItem(DESTROYED_KEY, JSON.stringify({ db: name, ok: false, at: Date.now() }));
        } catch {
          /* best effort */
        }
        announce("failed");
        throw error;
      }
      try {
        store?.removeItem(MARKER_KEY);
        store?.setItem(DESTROYED_KEY, JSON.stringify({ db: name, ok: true, at: Date.now() }));
      } catch {
        /* best effort */
      }
      announce("destroyed");
    },

    onVaultDestroyed(listener: (phase: VaultDestroyPhase) => void): () => void {
      destroyedListeners.add(listener);
      return () => destroyedListeners.delete(listener);
    },

    lock(): void {
      clearStallTimer();
      state = { kind: "locked" };
    },

    export(): CipherBlob | null {
      return state.kind === "unlocked" ? state.blob : null;
    },

    async restore(imported: CipherBlob, passphrase?: string): Promise<boolean> {
      if (state.kind !== "unlocked") return false;
      const { key: currentKey, ownerDb: currentDb } = state;
      // Verify OUTSIDE the write queue — this only reads the imported blob.
      let vault: VaultData;
      let documents: Array<{ sha256: string; blob: AccountCipherBlob }> = [];
      let carriesDocuments = false;
      try {
        if (imported.v === 3) {
          const bundle = await decryptJSON<{
            vault: VaultData;
            documents: Array<{ sha256: string; blob: AccountCipherBlob }>;
          }>(currentKey, imported);
          vault = bundle.vault;
          documents = Array.isArray(bundle.documents) ? bundle.documents : [];
          carriesDocuments = true;
        } else if (imported.v === 2) {
          vault = await decryptJSON<VaultData>(currentKey, imported);
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
        if (state.kind !== "unlocked" || state.ownerDb !== currentDb || state.key !== currentKey) {
          throw new Error(LOCKED_ERROR);
        }
        await withDocumentStoreFor(currentDb, "readwrite", (store) => store.clear());
        if (carriesDocuments) {
          // The bundle carries the already-sealed bytes; restoring them writes
          // the same ciphertext, never a re-encryption with a fresh IV.
          await withDocumentStoreFor(currentDb, "readwrite", async (store) => {
            for (const doc of documents) await store.put(doc.blob, doc.sha256);
          });
        }
        await adopt(withMigrations(vault).vault);
      });
      return true;
    },

    async exportBundle(): Promise<BundleBlob | null> {
      if (state.kind !== "unlocked") return null;
      const { key: currentKey, data: currentData } = state;
      const documents = await withDocumentStore("readonly", async (store) => {
        const keys = (await store.getAllKeys()) as string[];
        const out: Array<{ sha256: string; blob: AccountCipherBlob }> = [];
        for (const sha256 of keys) {
          const docBlob = (await store.get(sha256)) as AccountCipherBlob | undefined;
          if (docBlob != null) out.push({ sha256, blob: docBlob });
        }
        return out;
      });
      const sealed = await sealJSON(currentKey, { vault: currentData, documents });
      return { v: 3, kdf: "account-key", iv: sealed.iv, ct: sealed.ct };
    },

    async getDocuments(): Promise<VaultDocument[]> {
      return [...(requireUnlocked().data.documents ?? [])];
    },
    putDocuments(documents: VaultDocument[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, documents: [...documents] }));
    },
    async getImportSessions(): Promise<ImportSession[]> {
      return [...(requireUnlocked().data.importSessions ?? [])];
    },
    putImportSessions(sessions: ImportSession[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, importSessions: [...sessions] }));
    },
    async putDocumentBytes(sha256: string, bytes: Uint8Array): Promise<void> {
      // Sealed with the same vault key as everything else (ADR 0009): the store
      // never holds plaintext bytes.
      const { key: currentKey } = requireUnlocked();
      const docBlob = await sealBytes(currentKey, bytes);
      await withDocumentStore("readwrite", (store) => store.put(docBlob, sha256));
    },
    async getDocumentBytes(sha256: string): Promise<Uint8Array | null> {
      const { key: currentKey } = requireUnlocked();
      const docBlob = (await withDocumentStore("readonly", (store) => store.get(sha256))) as
        | AccountCipherBlob
        | null
        | undefined;
      if (docBlob == null) return null;
      return openBytes(currentKey, docBlob);
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
      await updateUnlocked((data) => ({ ...data, documents: [] }));
      return documents.length;
    },

    async getAccounts(): Promise<Account[]> {
      return [...requireUnlocked().data.accounts];
    },
    putAccounts(a: Account[]): Promise<void> {
      return updateUnlocked((data) => {
        const byKey = new Map(data.accounts.map((acc) => [acc.key, acc]));
        for (const acc of a) byKey.set(acc.key, acc);
        return { ...data, accounts: [...byKey.values()] };
      });
    },

    async getTxs(): Promise<Tx[]> {
      return [...requireUnlocked().data.txs];
    },
    putTxs(t: Tx[]): Promise<void> {
      return updateUnlocked((data) => {
        const byId = new Map(data.txs.map((tx) => [tx.id, tx]));
        for (const tx of t) byId.set(tx.id, tx);
        return { ...data, txs: [...byId.values()] };
      });
    },

    // Removal primitives — parity with createIndexedDbStorage. Through
    // enqueueWrite like every mutator: a delete resolving out of order must not
    // let a stale snapshot's persist() revert the blob (and bring the row back).
    // `accountKey` (not `key`) — a `key` param would shadow the vault CryptoKey.
    deleteAccount(accountKey: string): Promise<void> {
      return updateUnlocked((data) => ({
        ...data,
        accounts: data.accounts.filter((a) => a.key !== accountKey),
      }));
    },
    deleteTxs(ids: string[]): Promise<void> {
      return updateUnlocked((data) => {
        const drop = new Set(ids);
        return { ...data, txs: data.txs.filter((t) => !drop.has(t.id)) };
      });
    },

    async getRules(): Promise<Rule[]> {
      return [...requireUnlocked().data.rules];
    },
    // Replace-all: mirrors createIndexedDbStorage's putRules semantics.
    putRules(rules: Rule[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, rules: [...rules] }));
    },

    // scheduledFlows/vatSettings are optional VaultData fields — a legacy vault
    // decrypts without them, so getters default to []. Replace-all, like putRules.
    async getScheduledFlows(): Promise<ScheduledFlow[]> {
      return [...(requireUnlocked().data.scheduledFlows ?? [])];
    },
    putScheduledFlows(f: ScheduledFlow[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, scheduledFlows: [...f] }));
    },
    async getVatSettings(): Promise<VatSettings[]> {
      return [...(requireUnlocked().data.vatSettings ?? [])];
    },
    putVatSettings(s: VatSettings[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, vatSettings: [...s] }));
    },
    // invoices is also an optional VaultData field — a legacy vault decrypts
    // without it, so the getter defaults to []. Replace-all, like putScheduledFlows.
    async getInvoices(): Promise<Invoice[]> {
      return [...(requireUnlocked().data.invoices ?? [])];
    },
    putInvoices(i: Invoice[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, invoices: [...i] }));
    },
    // rewards is also an optional VaultData field — a legacy vault decrypts
    // without it, so the getter defaults to []. Replace-all, like putScheduledFlows.
    async getRewards(): Promise<RewardsBalance[]> {
      return [...(requireUnlocked().data.rewards ?? [])];
    },
    putRewards(r: RewardsBalance[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, rewards: [...r] }));
    },
    // transfers is also an optional VaultData field — a legacy vault decrypts
    // without it, so the getter defaults to []. Replace-all, like putRewards.
    // Only decisions are stored; a fresh import can invalidate a suggestion,
    // so suggestions stay derived and never become stale vault state.
    async getTransfers(): Promise<TransferPair[]> {
      return [...(requireUnlocked().data.transfers ?? [])];
    },
    putTransfers(p: TransferPair[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, transfers: [...p] }));
    },
    // Budget envelopes (issue #289): replace-all, additive optional fields. A
    // vault written before this reads [] and the plan falls back to the legacy
    // `categoryLimits` (see `budgetPeriodsOf` in @lavega/core).
    async getBudgetPeriods(): Promise<BudgetPeriod[]> {
      return structuredClone(requireUnlocked().data.budgetPeriods ?? []);
    },
    putBudgetPeriods(periods: BudgetPeriod[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, budgetPeriods: structuredClone(periods) }));
    },
    async getCategoryGroups(): Promise<CategoryGroup[]> {
      return structuredClone(requireUnlocked().data.categoryGroups ?? []);
    },
    putCategoryGroups(groups: CategoryGroup[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, categoryGroups: structuredClone(groups) }));
    },
    // Bills and occurrences are the same additive optional field shape:
    // replace-all, read [] on a legacy vault. They are written by ONE mutator
    // because the generator's output (rows) only makes sense with its series,
    // and the unlock pass must not pay two seals for one materialization.
    async getBills(): Promise<Bill[]> {
      return [...(requireUnlocked().data.bills ?? [])];
    },
    async getBillOccurrences(): Promise<BillOccurrence[]> {
      return [...(requireUnlocked().data.billOccurrences ?? [])];
    },
    async getBillDecisions(): Promise<BillDecisions> {
      return structuredClone(billDecisionsOf(requireUnlocked().data.billDecisions));
    },
    putBillPlan(
      bills: Bill[],
      occurrences: BillOccurrence[],
      decisions?: BillDecisions,
    ): Promise<void> {
      return updateUnlocked((data) => ({
        ...data,
        bills: [...bills],
        billOccurrences: [...occurrences],
        // Undefined keeps the stored decisions: a schedule edit or a
        // materialization must not silently forget which rows were paid.
        billDecisions: structuredClone(decisions ?? billDecisionsOf(data.billDecisions)),
      }));
    },
    // merchants is the same additive optional field shape: replace-all, and a
    // legacy vault reads [] so `labels.ts` falls back to its token key.
    async getValuations(): Promise<Valuation[]> {
      return [...(requireUnlocked().data.valuations ?? [])];
    },
    putValuations(valuations: Valuation[]): Promise<void> {
      return updateUnlocked((data) => ({
        ...data,
        valuations: valuations.map(normalizeValuation),
      }));
    },

    async getMerchants(): Promise<Merchant[]> {
      return [...(requireUnlocked().data.merchants ?? [])];
    },
    putMerchants(m: Merchant[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, merchants: [...m] }));
    },

    // Privé/zakelijk per entity (item 4). Additive optional field, replace-all,
    // legacy vault => [] => every entity is personal, which is the default the
    // feature asks for anyway. No migration: nothing existing is rewritten.
    async getEntityProfiles(): Promise<EntityProfile[]> {
      return [...(requireUnlocked().data.entityProfiles ?? [])];
    },
    putEntityProfiles(profiles: EntityProfile[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, entityProfiles: [...profiles] }));
    },

    // What the agents have learned (and what the owner corrected). Same additive
    // optional field + replace-all shape as the rest; a legacy vault has none.
    async getFacts(): Promise<LearnedFact[]> {
      return [...(requireUnlocked().data.facts ?? [])];
    },
    putFacts(f: LearnedFact[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, facts: [...f] }));
    },

    // The personal assistant's approval events and approved memories
    // (WS5.8, issue #301). Same additive optional field + replace-all shape as
    // facts above; a legacy vault reads the empty state, so the panel starts
    // with no timeline rather than a fabricated one.
    async getAssistant(): Promise<AssistantState> {
      const assistant = requireUnlocked().data.assistant;
      return {
        approvals: [...(assistant?.approvals ?? [])],
        memories: [...(assistant?.memories ?? [])],
      };
    },
    putAssistant(next: AssistantState): Promise<void> {
      return updateUnlocked((data) => ({
        ...data,
        assistant: { approvals: [...next.approvals], memories: [...next.memories] },
      }));
    },

    // His n8n webhook/API credentials (settings.ts). Additive optional field,
    // replace-all — same shape as entityProfiles/facts above. A legacy vault
    // decrypts without it, so the getter defaults to {}: "never set", not "".
    async getN8nSettings(): Promise<N8nSettings> {
      return { ...requireUnlocked().data.n8nSettings };
    },
    putN8nSettings(settings: N8nSettings): Promise<void> {
      return updateUnlocked((data) => ({ ...data, n8nSettings: { ...settings } }));
    },

    // Invoices that booked themselves from the n8n queue (n8n.ts). The `Invoice`
    // record itself carries `autoBooked: true`; this list is only the fallback
    // for rows booked before that field existed, kept alive the same way.
    async getAutoBookedInvoices(): Promise<N8nAutoBooked[]> {
      return [...(requireUnlocked().data.n8nAutoBooked ?? [])];
    },
    putAutoBookedInvoices(list: N8nAutoBooked[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, n8nAutoBooked: [...list] }));
    },

    // Rows apps/web is still reviewing from the n8n queue (n8n.ts). Same
    // replace-all shape as getAutoBookedInvoices/putAutoBookedInvoices above —
    // opaque JSON here because this package cannot import apps/web's types.
    async getPendingInvoices(): Promise<unknown[]> {
      return [...(requireUnlocked().data.n8nPendingInvoices ?? [])];
    },
    putPendingInvoices(list: unknown[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, n8nPendingInvoices: [...list] }));
    },
    async getPendingNotices(): Promise<unknown[]> {
      return [...(requireUnlocked().data.n8nPendingNotices ?? [])];
    },
    putPendingNotices(list: unknown[]): Promise<void> {
      return updateUnlocked((data) => ({ ...data, n8nPendingNotices: [...list] }));
    },

    // fxHistory is also an optional VaultData field — a legacy vault decrypts
    // without it, so the getter defaults to {}. Replace-all, like n8nSettings.
    async getFxHistory(): Promise<Record<string, Record<string, number>>> {
      return { ...requireUnlocked().data.fxHistory };
    },
    putFxHistory(h: Record<string, Record<string, number>>): Promise<void> {
      return updateUnlocked((data) => ({ ...data, fxHistory: { ...h } }));
    },

    // The adviser profile and the three sections that sit beside it. All are
    // optional VaultData fields, so a legacy vault decrypts without them.
    async getProfile(): Promise<ProfileRead> {
      return readProfile(requireUnlocked().data.profile);
    },
    putProfile(store: AdvisorProfileStore): Promise<void> {
      return updateUnlocked((data) => {
        const previous = readProfile(data.profile);
        const encoded = encodeProfileStore(store);
        return previous.kind === "corrupt"
          ? {
              ...data,
              profile: encoded,
              profileCorruptBackup: data.profileCorruptBackup ?? data.profile,
            }
          : { ...data, profile: carryUnknownKeys(data.profile, encoded) };
      });
    },
    async getSection<N extends "plan" | "learning" | "events">(name: N): Promise<SectionValue[N]> {
      const data = requireUnlocked().data;
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
      return updateUnlocked((data) => ({ ...data, [name]: structuredClone(value) }));
    },
    appendEvents(events: readonly VaultEvent[]): Promise<void> {
      return updateUnlocked((data) => ({
        ...data,
        events: mergeEvents(data.events ?? [], events),
      }));
    },

    async getCredentials<T extends CredentialBroker>(
      tenantId: string,
      broker: T,
    ): Promise<Extract<BrokerCredentials, { broker: T }> | null> {
      // Credential reads are deliberately different from ordinary vault reads:
      // locked state is an absent secret, not an error-producing data path.
      if (state.kind !== "unlocked") return null;
      const credentials = state.data.credentials?.find(
        (item) => item.tenantId === tenantId && item.broker === broker,
      );
      return credentials == null
        ? null
        : (credentials as Extract<BrokerCredentials, { broker: T }>);
    },
    putCredentials(credentials: BrokerCredentials): Promise<void> {
      return updateUnlocked((data) => {
        const existing = data.credentials ?? [];
        const withoutCurrent = existing.filter(
          (item) => item.tenantId !== credentials.tenantId || item.broker !== credentials.broker,
        );
        return { ...data, credentials: [...withoutCurrent, credentials] };
      });
    },
  };
}
