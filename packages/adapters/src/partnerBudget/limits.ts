/**
 * The one table of partner request limits, and the only way to build a key.
 *
 * A key is `partner:endpoint`. The scope says whose budget it is: `account`
 * keys are per broker credential, `shared` keys are one budget for every user
 * of the deployment (our egress IP is what the partner counts).
 *
 * Sources: Trading 212 public OpenAPI, read 2026-11-10 (repo docs said 6 per
 * minute for order history; the OpenAPI says 20). The IBKR value is a
 * conservative seed that is not verified against IBKR documentation.
 */
export const PARTNER_LIMITS = {
  "trading212:positions": { scope: "account", intervalMs: 1_000 },
  "trading212:account-summary": { scope: "account", intervalMs: 5_000 },
  "trading212:history-orders": { scope: "account", intervalMs: 3_000 },
  "trading212:history-transactions": { scope: "account", intervalMs: 3_000 },
  "trading212:history-dividends": { scope: "account", intervalMs: 3_000 },
  "ibkr:flex": { scope: "account", intervalMs: 6_000 },
  /** Chart, search, quoteSummary and crumb requests share this one key. */
  "yahoo:any": { scope: "shared", intervalMs: 300 },
  "openfigi:mapping": { scope: "shared", intervalMs: 2_500 },
} as const satisfies Record<string, { scope: "account" | "shared"; intervalMs: number }>;

export type PartnerLimitName = keyof typeof PARTNER_LIMITS;
type NamesWithScope<S extends "account" | "shared"> = {
  [K in PartnerLimitName]: (typeof PARTNER_LIMITS)[K]["scope"] extends S ? K : never;
}[PartnerLimitName];
export type AccountLimitName = NamesWithScope<"account">;
export type SharedLimitName = NamesWithScope<"shared">;

export const SHARED_SCOPE_ID = "shared";
const ACCOUNT_SCOPE_ID_PATTERN = /^[0-9a-f]{16}$/;

declare const accountScopeBrand: unique symbol;
/** 16 hex characters. Only `accountScopeId` makes one, so no credential can be passed by mistake. */
export type AccountScopeId = string & { readonly [accountScopeBrand]: true };

export type PartnerKey = { partner: string; endpoint: string; scopeId: string };

/**
 * Scope id for a broker credential: the first 16 hex characters of its
 * SHA-256. The credential itself is never stored or sent.
 *
 * Web Crypto hashes asynchronously, so this returns a promise.
 */
export async function accountScopeId(secret: string): Promise<AccountScopeId> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const hex = Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return hex as AccountScopeId;
}

/** Builds a key for one of the listed limits. Any other name fails typecheck. */
export function partnerKey(name: SharedLimitName): PartnerKey;
export function partnerKey(name: AccountLimitName, scopeId: AccountScopeId): PartnerKey;
export function partnerKey(name: PartnerLimitName, scopeId?: string): PartnerKey {
  const [partner, endpoint] = name.split(":") as [string, string];
  if (PARTNER_LIMITS[name].scope === "shared") {
    return { partner, endpoint, scopeId: SHARED_SCOPE_ID };
  }
  if (scopeId === undefined || !ACCOUNT_SCOPE_ID_PATTERN.test(scopeId)) {
    throw new Error(`Partner key ${name} needs an account scope id from accountScopeId()`);
  }
  return { partner, endpoint, scopeId };
}

/** The table interval for a key, or undefined when the key is not in the table. */
export function tableIntervalMs(key: PartnerKey): number | undefined {
  const name = `${key.partner}:${key.endpoint}`;
  return Object.hasOwn(PARTNER_LIMITS, name)
    ? PARTNER_LIMITS[name as PartnerLimitName].intervalMs
    : undefined;
}
