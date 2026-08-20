import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrokerCredentials, CredentialBroker, CredentialStore } from "@lavega/core";
import type { RuntimeBrokerDataSnapshot } from "./runtimeBrokerData.js";
import { decryptJSON, deriveKey, encryptJSON, newSalt, PBKDF2_ITERATIONS, type CipherBlob } from "@lavega/adapters";

export type ServerVaultStatus = "empty" | "locked" | "unlocked";

// Re-exported so existing importers are untouched; defined in
// runtimeBrokerData.ts so a type-only importer does not have to reach through
// this file's fs imports. See that file for why.
export type { RuntimeBrokerDataSnapshot } from "./runtimeBrokerData.js";

type VaultData = { credentials: BrokerCredentials[]; brokerData?: RuntimeBrokerDataSnapshot };

export function runtimeCredentialFile(): string {
  const fromEnv = process.env.LAVEGA_VAULT_FILE?.trim();
  if (fromEnv) return fromEnv;
  return existsSync("/data") ? "/data/credentials.json" : join(process.cwd(), ".lavega", "credentials.json");
}

/** Encrypted credential store for the Node runtime. IndexedDB only exists in browsers. */
export function createFileCredentialStore(filePath = runtimeCredentialFile()): CredentialStore & {
  status(): Promise<ServerVaultStatus>;
  setup(passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<boolean>;
  lock(): void;
  getBrokerData(): Promise<RuntimeBrokerDataSnapshot>;
  putBrokerData(snapshot: RuntimeBrokerDataSnapshot): Promise<void>;
} {
  let key: CryptoKey | null = null;
  let data: VaultData | null = null;
  let writeQueue = Promise.resolve();

  const readBlob = async (): Promise<CipherBlob | null> => {
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as CipherBlob;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  };

  const writeBlob = async (blob: CipherBlob): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(blob), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, filePath);
  };

  const queue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(operation, operation);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  let salt: Uint8Array | null = null;
  const save = () => queue(async () => {
    if (!key || !salt || !data) throw new Error("kluis vergrendeld");
    await writeBlob(await encryptJSON(key, salt, PBKDF2_ITERATIONS, data));
  });

  return {
    async status() {
      return (await readBlob()) == null ? "empty" : key == null ? "locked" : "unlocked";
    },
    async setup(passphrase) {
      if (await readBlob()) throw new Error("kluis bestaat al");
      salt = newSalt();
      key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
      data = { credentials: [] };
      await save();
    },
    async unlock(passphrase) {
      try {
        const blob = await readBlob();
        if (!blob) return false;
        const candidateSalt = Uint8Array.from(Buffer.from(blob.salt, "base64"));
        const candidateKey = await deriveKey(passphrase, candidateSalt, blob.iterations);
        const decrypted = await decryptJSON<VaultData>(candidateKey, blob);
        key = candidateKey;
        salt = candidateSalt;
        data = decrypted;
        return true;
      } catch {
        return false;
      }
    },
    lock() {
      key = null;
      salt = null;
      data = null;
    },
    async getCredentials<T extends CredentialBroker>(tenantId: string, broker: T) {
      if (data == null && await readBlob() != null) throw new Error("credential vault is locked");
      const match = data?.credentials.find((item) => item.tenantId === tenantId && item.broker === broker);
      return (match ?? null) as Extract<BrokerCredentials, { broker: T }> | null;
    },
    putCredentials(credentials) {
      return queue(async () => {
        if (!key || !salt || !data) throw new Error("kluis vergrendeld");
        data = { ...data, credentials: [...data.credentials.filter((item) => item.tenantId !== credentials.tenantId || item.broker !== credentials.broker), credentials] };
        await writeBlob(await encryptJSON(key, salt, PBKDF2_ITERATIONS, data));
      });
    },
    async getBrokerData() {
      if (!data) throw new Error("credential vault is locked");
      return structuredClone(data.brokerData ?? {});
    },
    putBrokerData(snapshot) {
      return queue(async () => {
        if (!key || !salt || !data) throw new Error("kluis vergrendeld");
        data = { ...data, brokerData: structuredClone(snapshot) };
        await writeBlob(await encryptJSON(key, salt, PBKDF2_ITERATIONS, data));
      });
    },
  };
}
