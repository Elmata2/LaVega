import { BROKER_IDS, CREDENTIAL_BROKERS, isCredentialBroker } from "@lavega/core";
import type { BrokerCredentials, BrokerId, CredentialBroker, CredentialStore } from "@lavega/core";
import type { BrokerAccountSnapshot } from "@lavega/adapters";
import { UnreadableBrokerCredentialsError, type EncryptedBrokerRepository } from "@lavega/database";
import type { RuntimeBrokerDataSnapshot } from "./runtimeBrokerData.js";
import type { ServerVaultStatus } from "./fileCredentialStore.js";

type BrokerSnapshot = NonNullable<RuntimeBrokerDataSnapshot[BrokerId]>;
export type BrokerReadability = Record<CredentialBroker, "empty" | "readable" | "unreadable">;

/**
 * Broker credentials in Neon, encrypted with the server's own key.
 *
 * The file store derives its key from a passphrase the user types, so nothing
 * can be read while the vault is locked. That cannot survive here: a hosted
 * runtime has no long-lived process to hold an unlocked key, and scheduled
 * broker synchronization has to run with nobody present. So the row is
 * encrypted with LAVEGA_ENCRYPTION_KEY (see `@lavega/database`), which the
 * server always has — `setup`, `unlock` and `lock` therefore have nothing to
 * do, and a vault that holds a row is always "unlocked".
 *
 * The passphrase the API still asks for consequently protects nothing here.
 * The route keeps requiring it so the client contract is unchanged; the
 * screens that call it need their own change before they can claim otherwise.
 */
export function createNeonCredentialStore(
  repository: EncryptedBrokerRepository,
  tenantId: string,
): CredentialStore & {
  status(): Promise<ServerVaultStatus>;
  setup(passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<boolean>;
  lock(): void;
  getBrokerData(): Promise<RuntimeBrokerDataSnapshot | null>;
  putBrokerData(snapshot: RuntimeBrokerDataSnapshot): Promise<void>;
  putBrokerSnapshot(broker: BrokerId, snapshot: BrokerAccountSnapshot): Promise<void>;
  brokerReadability(): Promise<BrokerReadability>;
} {
  /* The repository is already bound to one user and RLS enforces that boundary
   * in Neon. This second check is here to fail loudly if a caller ever passes
   * the wrong tenant, rather than quietly reading the bound one's row. */
  const sameTenant = (candidate: string) => {
    if (candidate !== tenantId) throw new Error("Credential vault belongs to another tenant");
  };
  const brokerReadability = async (): Promise<BrokerReadability> => {
    const brokers = {} as BrokerReadability;
    for (const broker of CREDENTIAL_BROKERS) {
      try {
        brokers[broker] = (await repository.get(broker)) ? "readable" : "empty";
      } catch (error) {
        if (!(error instanceof UnreadableBrokerCredentialsError)) throw error;
        brokers[broker] = "unreadable";
      }
    }
    return brokers;
  };

  return {
    async status() {
      const brokers = await brokerReadability();
      return Object.values(brokers).some((state) => state !== "empty") ? "unlocked" : "empty";
    },
    brokerReadability,
    async setup() {
      // The server key needs no ceremony; the first putCredentials creates the row.
    },
    async unlock() {
      return true;
    },
    lock() {
      // Nothing is held in memory to forget.
    },
    async getCredentials<T extends CredentialBroker>(candidateTenantId: string, broker: T) {
      sameTenant(candidateTenantId);
      const row = await repository.get<Extract<BrokerCredentials, { broker: T }>>(broker);
      return row?.credentials ?? null;
    },
    async putCredentials(credentials: BrokerCredentials) {
      sameTenant(credentials.tenantId);
      await repository.put(credentials.broker, credentials);
    },
    async getBrokerData() {
      const stored = await repository.snapshots();
      if (!stored) return null;
      const snapshot: RuntimeBrokerDataSnapshot = {};
      for (const broker of BROKER_IDS)
        if (stored[broker]) snapshot[broker] = stored[broker] as BrokerSnapshot;
      return snapshot;
    },
    async putBrokerData(snapshot: RuntimeBrokerDataSnapshot) {
      for (const broker of BROKER_IDS) {
        const brokerSnapshot = snapshot[broker];
        if (!brokerSnapshot) continue;
        if (!isCredentialBroker(broker)) {
          /* An import-only broker has no connection to read a generation from;
           * its snapshot-only row is the whole record. */
          await repository.putSnapshotOnly(broker, brokerSnapshot);
          continue;
        }
        /* Broker data without a configured broker is stale state from a
         * removed connection, so it is dropped rather than resurrected. */
        const row = await repository.get(broker);
        if (!row) continue;
        /* Written on its own, against the connection it was read from. Writing
         * it through `put` carried the credential blob along, which reverted a
         * reconnect that landed while the sync was running. */
        await repository.putSnapshot(broker, brokerSnapshot, row.credentialGeneration);
      }
    },
    async putBrokerSnapshot(broker, snapshot) {
      if (isCredentialBroker(broker))
        throw new Error("A credential broker's snapshot is written by its sync");
      if (!(await repository.putSnapshotOnly(broker, snapshot)))
        throw new Error("The credential vault row changed while the import was running");
    },
  };
}
