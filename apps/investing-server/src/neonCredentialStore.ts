import type { BrokerCredentials, CredentialBroker, CredentialStore } from "@lavega/core";
import type { EncryptedBrokerRepository } from "@lavega/database";
import type { RuntimeBrokerDataSnapshot } from "./runtimeBrokerData.js";
import type { ServerVaultStatus } from "./fileCredentialStore.js";

const BROKERS: readonly CredentialBroker[] = ["ibkr", "trading212"];

type BrokerSnapshot = NonNullable<RuntimeBrokerDataSnapshot[CredentialBroker]>;

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
  getBrokerData(): Promise<RuntimeBrokerDataSnapshot>;
  putBrokerData(snapshot: RuntimeBrokerDataSnapshot): Promise<void>;
} {
  /* The repository is already bound to one user and RLS enforces that boundary
   * in Neon. This second check is here to fail loudly if a caller ever passes
   * the wrong tenant, rather than quietly reading the bound one's row. */
  const sameTenant = (candidate: string) => {
    if (candidate !== tenantId) throw new Error("Credential vault belongs to another tenant");
  };

  return {
    async status() {
      for (const broker of BROKERS) {
        try {
          if (await repository.get(broker)) return "unlocked";
        } catch {
          return "empty";
        }
      }
      return "empty";
    },
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
      const snapshot: RuntimeBrokerDataSnapshot = {};
      for (const broker of BROKERS) {
        const row = await repository.get(broker);
        if (row?.snapshot) snapshot[broker] = row.snapshot as BrokerSnapshot;
      }
      return snapshot;
    },
    async putBrokerData(snapshot: RuntimeBrokerDataSnapshot) {
      for (const broker of BROKERS) {
        const brokerSnapshot = snapshot[broker];
        if (!brokerSnapshot) continue;
        /* A snapshot row cannot exist without credentials — the table requires
         * them. Broker data without a configured broker is stale state from a
         * removed connection, so it is dropped rather than resurrected. */
        const row = await repository.get(broker);
        if (!row) continue;
        await repository.put(broker, row.credentials, brokerSnapshot);
      }
    },
  };
}
