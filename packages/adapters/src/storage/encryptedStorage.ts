import { openDB, type IDBPDatabase } from "idb";
import type { Account, Tx, Rule, ScheduledFlow, VatSettings, Invoice } from "@lavega/core";
import type { StorageAdapter } from "./StorageAdapter.js";
import { newSalt, deriveKey, encryptJSON, decryptJSON, PBKDF2_ITERATIONS } from "../crypto/vaultCrypto.js";
import type { CipherBlob } from "../crypto/vaultCrypto.js";

const DEFAULT_DB_NAME = "lavega-vault";
const DB_VERSION = 1;
const STORE_NAME = "vault";
const RECORD_KEY = "blob";

export type VaultStatus = "empty" | "locked" | "unlocked";

type VaultData = { accounts: Account[]; txs: Tx[]; rules: Rule[]; scheduledFlows?: ScheduledFlow[]; vatSettings?: VatSettings[]; invoices?: Invoice[] };

export interface VaultStorage extends StorageAdapter {
  status(): Promise<VaultStatus>;
  setup(passphrase: string, seed?: { accounts: Account[]; txs: Tx[]; rules: Rule[] }): Promise<void>;
  unlock(passphrase: string): Promise<boolean>; // false on wrong passphrase (never throws for that)
  lock(): void;
  export(): CipherBlob | null; // the current on-memory-encrypted blob (Task 5 downloads it); null if locked/empty
  // Adopt an imported CipherBlob (e.g. from a downloaded .lavega back-up) as
  // THE vault: derive the key from ITS OWN salt/iterations, verify it decrypts,
  // and only then write it to disk + swap in-memory state. False on wrong
  // passphrase / malformed / sub-floor iterations — current state untouched.
  restore(blob: CipherBlob, passphrase: string): Promise<boolean>;
  getScheduledFlows(): Promise<ScheduledFlow[]>;
  putScheduledFlows(f: ScheduledFlow[]): Promise<void>;
  getVatSettings(): Promise<VatSettings[]>;
  putVatSettings(s: VatSettings[]): Promise<void>;
  getInvoices(): Promise<Invoice[]>;
  putInvoices(i: Invoice[]): Promise<void>;
}

// Local base64 decode — not exported by vaultCrypto.ts (only its CipherBlob.salt
// string form is public). This is plain byte encoding, not crypto, so
// duplicating it here does not violate the "reuse Task-2 crypto" constraint.
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const LOCKED_ERROR = "kluis vergrendeld";

export function createEncryptedStorage(dbName: string = DEFAULT_DB_NAME): VaultStorage {
  // In-memory-only state. Never persisted. Dropped entirely on lock().
  let key: CryptoKey | null = null;
  let salt: Uint8Array | null = null;
  let data: VaultData | null = null;
  let blob: CipherBlob | null = null;

  function openVaultDb(): Promise<IDBPDatabase> {
    return openDB(dbName, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }

  async function readBlobFromDisk(): Promise<CipherBlob | null> {
    const db = await openVaultDb();
    const record = (await db.get(STORE_NAME, RECORD_KEY)) as CipherBlob | undefined;
    db.close(); // don't leak a connection per read (opened on every status/get/persist)
    return record ?? null;
  }

  async function writeBlobToDisk(b: CipherBlob): Promise<void> {
    const db = await openVaultDb();
    await db.put(STORE_NAME, b, RECORD_KEY);
    db.close();
  }

  // Re-encrypts the full in-memory data set with a fresh IV and overwrites
  // the single on-disk blob record. Ciphertext only ever leaves memory.
  async function persist(): Promise<void> {
    if (key == null || salt == null || data == null) throw new Error(LOCKED_ERROR);
    const fresh = await encryptJSON(key, salt, PBKDF2_ITERATIONS, data);
    await writeBlobToDisk(fresh);
    blob = fresh;
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
    async status(): Promise<VaultStatus> {
      const onDisk = await readBlobFromDisk();
      if (onDisk == null) return "empty";
      return key == null ? "locked" : "unlocked";
    },

    async setup(passphrase, seed): Promise<void> {
      const onDisk = await readBlobFromDisk();
      if (onDisk != null) throw new Error("kluis bestaat al");
      const freshSalt = newSalt();
      const freshKey = await deriveKey(passphrase, freshSalt, PBKDF2_ITERATIONS);
      const freshData: VaultData = seed ?? { accounts: [], txs: [], rules: [] };
      const freshBlob = await encryptJSON(freshKey, freshSalt, PBKDF2_ITERATIONS, freshData);
      await writeBlobToDisk(freshBlob);
      key = freshKey;
      salt = freshSalt;
      data = freshData;
      blob = freshBlob;
    },

    async unlock(passphrase): Promise<boolean> {
      try {
        const onDisk = await readBlobFromDisk();
        if (onDisk == null) return false;
        const candidateSalt = fromB64(onDisk.salt);
        const candidateKey = await deriveKey(passphrase, candidateSalt, onDisk.iterations);
        const decrypted = await decryptJSON<VaultData>(candidateKey, onDisk); // throws on GCM auth failure
        key = candidateKey;
        salt = candidateSalt;
        data = decrypted;
        blob = onDisk;
        return true;
      } catch {
        // Wrong passphrase, tampered blob, or sub-floor iterations: stay locked.
        return false;
      }
    },

    lock(): void {
      key = null;
      salt = null;
      data = null;
      // `blob` may stay cached — it is ciphertext, safe at rest. Simplest to
      // just reload it from disk (or re-populate it) on the next unlock/setup.
    },

    export(): CipherBlob | null {
      return blob;
    },

    async restore(imported: CipherBlob, passphrase: string): Promise<boolean> {
      try {
        // Verify OUTSIDE the write queue — this only reads the imported blob and
        // derives/decrypts, touching no vault state or disk.
        const importedSalt = fromB64(imported.salt);
        const candidateKey = await deriveKey(passphrase, importedSalt, imported.iterations); // throws below the PBKDF2 floor
        const decrypted = await decryptJSON<VaultData>(candidateKey, imported); // throws on wrong passphrase / tampered ciphertext
        // Verified — adopt atomically w.r.t. concurrent puts: the disk write +
        // state swap go through the SAME serialization queue as every mutator,
        // so a put's persist() that's still resolving (restore's PBKDF2 pass
        // takes real time) can't land after the swap and revert disk.
        await enqueueWrite(async () => {
          await writeBlobToDisk(imported);
          key = candidateKey;
          salt = importedSalt;
          data = decrypted;
          blob = imported;
        });
        return true;
      } catch {
        // Wrong passphrase, malformed blob, or sub-floor iterations: leave
        // any existing vault (in-memory state + on-disk blob) untouched.
        return false;
      }
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
  };
}
