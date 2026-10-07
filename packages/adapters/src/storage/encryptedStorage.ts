import { openDB, type IDBPDatabase } from "idb";
import type {
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
} from "@lavega/core";
import type { StorageAdapter } from "./StorageAdapter.js";
import { deriveKey, decryptJSON, sealJSON } from "../crypto/vaultCrypto.js";
import type { AccountCipherBlob, CipherBlob, PassphraseCipherBlob } from "../crypto/vaultCrypto.js";

const DEFAULT_DB_NAME = "lavega-vault";
const DB_VERSION = 1;
const STORE_NAME = "vault";
const RECORD_KEY = "blob";

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
      },
    });
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
        data = await decryptJSON<VaultData>(ownerKey, onDisk);
        blob = onDisk;
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
      await enqueueWrite(() => adopt(opened));
      // Only once the re-sealed copy is on disk is the password copy redundant.
      await deleteBlobFromDisk(dbName);
      return true;
    },

    async startFresh(): Promise<void> {
      await enqueueWrite(() => adopt({ accounts: [], txs: [], rules: [] }));
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
      let decrypted: VaultData;
      try {
        // Verify OUTSIDE the write queue — this only reads the imported blob.
        decrypted =
          imported.v === 2
            ? await decryptJSON<VaultData>(key, imported)
            : await openPasswordBlob<VaultData>(imported, passphrase ?? "");
      } catch {
        // Wrong passphrase, another account's file, malformed blob, or
        // sub-floor iterations: leave the current vault untouched.
        return false;
      }
      // Through the same queue as every mutator, so a put still resolving
      // cannot land after the swap and revert disk.
      await enqueueWrite(() => adopt(decrypted));
      return true;
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
