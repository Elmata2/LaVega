/* ONE LIST OF BROKERS AND WHAT EACH SUPPORTS.
 *
 * Every union of broker ids in the app used to be hand-written: the credential
 * brokers were spelled out one by one in the server routes, the snapshot map,
 * the credential store and the web settings form. Adding a broker meant finding
 * all of them, and a forgotten one failed quietly — a broker the snapshot
 * dropped, or one the credential form still offered.
 *
 * This table is the only place a broker is declared. The capability flags are
 * `as const`, so the derived types below turn a capability into a closed set:
 * `CredentialBroker` has no `degiro`, because DeGiro has no API and no login
 * (issue #25). A new credential broker widens that type and typecheck names
 * every place that must now handle it, instead of leaving a silent fallback.
 *
 * DeGiro is the first import-only broker: the user exports files from the
 * DeGiro website, LaVega parses them and never logs in.
 */

export const BROKERS = {
  ibkr: {
    label: "Interactive Brokers",
    /** How a problem line names the broker when the sentence is short. */
    shortLabel: "IBKR",
    credentials: true,
    scheduled: true,
    fileImport: false,
  },
  trading212: {
    label: "Trading 212",
    shortLabel: "Trading 212",
    credentials: true,
    scheduled: true,
    fileImport: false,
  },
  /* Import-only: files exported by the user, no credentials, no sync. */
  degiro: {
    label: "DeGiro",
    shortLabel: "DeGiro",
    credentials: false,
    scheduled: false,
    fileImport: true,
  },
} as const;

export type BrokerId = keyof typeof BROKERS;
export type BrokerDefinition = (typeof BROKERS)[BrokerId];
export type BrokerCapability = "credentials" | "scheduled" | "fileImport";

/** The brokers for which one capability is `true`, as a closed type. */
type BrokerIdsWith<Capability extends BrokerCapability> = {
  [Id in BrokerId]: (typeof BROKERS)[Id][Capability] extends true ? Id : never;
}[BrokerId];

/** Brokers whose API LaVega can poll on a schedule. */
export type ScheduledBroker = BrokerIdsWith<"scheduled">;
/** Brokers whose credentials the vault stores. */
export type CredentialBroker = BrokerIdsWith<"credentials">;
/** Brokers whose export files LaVega can import. */
export type FileImportBroker = BrokerIdsWith<"fileImport">;

export const BROKER_IDS = Object.keys(BROKERS) as readonly BrokerId[];

function idsWith<Capability extends BrokerCapability>(
  capability: Capability,
): BrokerIdsWith<Capability>[] {
  return BROKER_IDS.filter((id): id is BrokerIdsWith<Capability> => BROKERS[id][capability]);
}

/** Ordered by the table above, so callers that show or sync brokers keep a
 *  stable order without sorting on a label. */
export const SCHEDULED_BROKERS: readonly ScheduledBroker[] = idsWith("scheduled");
export const CREDENTIAL_BROKERS: readonly CredentialBroker[] = idsWith("credentials");
export const FILE_IMPORT_BROKERS: readonly FileImportBroker[] = idsWith("fileImport");

export function isBrokerId(value: unknown): value is BrokerId {
  return typeof value === "string" && Object.hasOwn(BROKERS, value);
}

export function isCredentialBroker(value: unknown): value is CredentialBroker {
  return isBrokerId(value) && BROKERS[value].credentials;
}

/** The full name of a broker, as the settings screen writes it. */
export function brokerLabel(id: BrokerId): string {
  return BROKERS[id].label;
}

/** The short name, for a sentence that already names the broker once and would
 *  otherwise read "Interactive Brokers: Interactive Brokers credentials". */
export function brokerShortLabel(id: BrokerId): string {
  return BROKERS[id].shortLabel;
}
