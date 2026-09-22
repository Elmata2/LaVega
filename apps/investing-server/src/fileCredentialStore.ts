import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BrokerCredentials, CredentialBroker, CredentialStore } from "@lavega/core";
import type { RuntimeBrokerDataSnapshot } from "./runtimeBrokerData.js";
import {
  decryptJSON,
  deriveKey,
  encryptJSON,
  newSalt,
  PBKDF2_ITERATIONS,
  type CipherBlob,
} from "@lavega/adapters";
import { runtimeDataFile } from "./jsonFileStore.js";

export type ServerVaultStatus = "empty" | "locked" | "unlocked";

// Re-exported so existing importers are untouched; defined in
// runtimeBrokerData.ts so a type-only importer does not have to reach through
// this file's fs imports. See that file for why.
export type { RuntimeBrokerDataSnapshot } from "./runtimeBrokerData.js";

type VaultData = { credentials: BrokerCredentials[]; brokerData?: RuntimeBrokerDataSnapshot };

export function runtimeCredentialFile(): string {
  return runtimeDataFile("LAVEGA_VAULT_FILE", "credentials.json");
}

/** Encrypted credential store for the Node runtime. IndexedDB only exists in browsers. */
export function createFileCredentialStore(
  filePath = runtimeCredentialFile(),
  fileSystem: Pick<
    typeof import("node:fs/promises"),
    "mkdir" | "readFile" | "rename" | "writeFile"
  > = {
    mkdir,
    readFile,
    rename,
    writeFile,
  },
): CredentialStore & {
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
  let lockGeneration = 0;

  const readBlob = async (): Promise<CipherBlob | null> => {
    try {
      return JSON.parse(await fileSystem.readFile(filePath, "utf8")) as CipherBlob;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  };

  const writeBlob = async (blob: CipherBlob): Promise<void> => {
    await fileSystem.mkdir(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    await fileSystem.writeFile(temporaryPath, JSON.stringify(blob), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fileSystem.rename(temporaryPath, filePath);
  };

  const queue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(operation, operation);
    writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  let salt: Uint8Array | null = null;
  return {
    async status() {
      return queue(async () =>
        (await readBlob()) == null ? "empty" : key == null ? "locked" : "unlocked",
      );
    },
    async setup(passphrase) {
      await queue(async () => {
        if (await readBlob()) throw new Error("credential vault already exists");
        const generation = lockGeneration;
        const nextSalt = newSalt();
        const nextKey = await deriveKey(passphrase, nextSalt, PBKDF2_ITERATIONS);
        const nextData: VaultData = { credentials: [] };
        if (generation !== lockGeneration) throw new Error("credential vault is locked");
        await writeBlob(await encryptJSON(nextKey, nextSalt, PBKDF2_ITERATIONS, nextData));
        if (generation === lockGeneration) {
          salt = nextSalt;
          key = nextKey;
          data = nextData;
        }
      });
    },
    async unlock(passphrase) {
      return queue(async () => {
        const generation = lockGeneration;
        try {
          const blob = await readBlob();
          if (!blob) return false;
          const candidateSalt = Uint8Array.from(Buffer.from(blob.salt, "base64"));
          const candidateKey = await deriveKey(passphrase, candidateSalt, blob.iterations);
          const decrypted = await decryptJSON<VaultData>(candidateKey, blob);
          if (generation !== lockGeneration) return false;
          key = candidateKey;
          salt = candidateSalt;
          data = decrypted;
          return true;
        } catch {
          return false;
        }
      });
    },
    lock() {
      lockGeneration++;
      key = null;
      salt = null;
      data = null;
    },
    async getCredentials<T extends CredentialBroker>(tenantId: string, broker: T) {
      if (data == null && (await readBlob()) != null) throw new Error("credential vault is locked");
      const match = data?.credentials.find(
        (item) => item.tenantId === tenantId && item.broker === broker,
      );
      return (match ? structuredClone(match) : null) as Extract<
        BrokerCredentials,
        { broker: T }
      > | null;
    },
    putCredentials(credentials) {
      const credentialValue = structuredClone(credentials);
      return queue(async () => {
        if (!key || !salt || !data) throw new Error("credential vault is locked");
        const generation = lockGeneration;
        const next: VaultData = {
          ...data,
          credentials: [
            ...data.credentials.filter(
              (item) =>
                item.tenantId !== credentialValue.tenantId ||
                item.broker !== credentialValue.broker,
            ),
            credentialValue,
          ],
        };
        await writeBlob(await encryptJSON(key, salt, PBKDF2_ITERATIONS, next));
        if (generation === lockGeneration) data = next;
      });
    },
    async getBrokerData() {
      if (!data) throw new Error("credential vault is locked");
      return structuredClone(data.brokerData ?? {});
    },
    putBrokerData(snapshot) {
      return queue(async () => {
        if (!key || !salt || !data) throw new Error("credential vault is locked");
        const generation = lockGeneration;
        const next = { ...data, brokerData: structuredClone(snapshot) };
        await writeBlob(await encryptJSON(key, salt, PBKDF2_ITERATIONS, next));
        if (generation === lockGeneration) data = next;
      });
    },
  };
}
