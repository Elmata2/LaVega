/** Tenant used by local-only investing storage. Hosted implementations supply
 * their real tenant identifier through the same interface. */
export const LOCAL_TENANT_ID = "local";

export type IbkrCredentials = {
  broker: "ibkr";
  tenantId: string;
  token: string;
  queryId: string;
};

/** Trading 212 calls these two values an API key and secret for Basic auth. */
export type Trading212Credentials = {
  broker: "trading212";
  tenantId: string;
  token: string;
  secret: string;
};

export type BrokerCredentials = IbkrCredentials | Trading212Credentials;
export type CredentialBroker = BrokerCredentials["broker"];

/** Narrow credential seam. Implementations must not expose credentials while locked. */
export interface CredentialStore {
  getCredentials<T extends CredentialBroker>(tenantId: string, broker: T): Promise<Extract<BrokerCredentials, { broker: T }> | null>;
  putCredentials(credentials: BrokerCredentials): Promise<void>;
}

export type KeyName = "llm" | "market-data";

export type KeyStatus = {
  name: KeyName;
  envVar: string;
  configured: boolean;
  missingMessage: string | null;
};

/** Server-side secret seam. Implementations must never send key values to clients. */
export interface KeySource {
  getKey(name: KeyName): string | null;
  getStatus(name: KeyName): KeyStatus;
}
