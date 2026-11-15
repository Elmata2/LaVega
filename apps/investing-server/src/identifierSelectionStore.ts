/** The owner's per-account switch for identifier candidate selection (Jev-03,
 *  issue #136), tenant-scoped and off by default. A set TYPESAFE_API_KEY alone
 *  must never turn this on: selection sends an instrument's identity (name,
 *  description, currency, ISIN) to an external model, so the decision to send
 *  that belongs to the account it is about. Mirrors the sector-inference
 *  switch (#135) deliberately. */
export type IdentifierSelectionSettingStore = {
  get(tenantId: string): Promise<boolean>;
  set(tenantId: string, enabled: boolean): Promise<void>;
};

export function createInMemoryIdentifierSelectionSettingStore(): IdentifierSelectionSettingStore {
  const settings = new Map<string, boolean>();
  return {
    async get(tenantId) {
      return settings.get(tenantId) ?? false;
    },
    async set(tenantId, enabled) {
      settings.set(tenantId, enabled);
    },
  };
}

/** The owner's own symbol choice for one ISIN: the most trusted tier of the
 *  resolution ladder, above the unambiguous provider answer and above any
 *  stored model selection. */
export type IdentifierOverride = { ticker: string; exchange?: string };
export type IdentifierOverrideMap = Record<string, IdentifierOverride>;

export type IdentifierOverrideStore = {
  get(tenantId: string): Promise<IdentifierOverrideMap>;
  set(tenantId: string, overrides: IdentifierOverrideMap): Promise<void>;
};

/** One ISIN can hold one override; more than this is not a portfolio, it is a
 *  mistake, and the route refuses instead of storing a runaway map. */
export const MAX_IDENTIFIER_OVERRIDES = 500;
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const TICKER = /^[A-Z0-9][A-Z0-9.\-^=]{0,19}$/;

/** Normalize an untrusted map: ISIN upper-cased and validated, ticker trimmed
 *  and upper-cased, an unknown row dropped rather than rejected. A ticker is
 *  the owner's own choice, so it is not checked against any provider. */
export function validateIdentifierOverrides(input: unknown): IdentifierOverrideMap {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: IdentifierOverrideMap = {};
  for (const [rawIsin, rawValue] of Object.entries(input as Record<string, unknown>).slice(
    0,
    MAX_IDENTIFIER_OVERRIDES,
  )) {
    const isin = rawIsin.trim().toUpperCase();
    if (!ISIN.test(isin)) continue;
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) continue;
    const value = rawValue as Record<string, unknown>;
    const ticker = typeof value.ticker === "string" ? value.ticker.trim().toUpperCase() : "";
    if (!TICKER.test(ticker)) continue;
    const exchange =
      typeof value.exchange === "string" && value.exchange.trim() !== ""
        ? value.exchange.trim().toUpperCase()
        : undefined;
    out[isin] = { ticker, ...(exchange !== undefined ? { exchange } : {}) };
  }
  return out;
}

export function createInMemoryIdentifierOverrideStore(): IdentifierOverrideStore {
  const overrides = new Map<string, IdentifierOverrideMap>();
  return {
    async get(tenantId) {
      return { ...overrides.get(tenantId) };
    },
    async set(tenantId, map) {
      overrides.set(tenantId, validateIdentifierOverrides(map));
    },
  };
}
