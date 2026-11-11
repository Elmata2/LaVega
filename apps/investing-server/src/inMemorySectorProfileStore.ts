import type { FundSectorProfile, SectorProfile } from "@lavega/adapters";
import { GICS_SECTOR_LABELS, type GicsSectorLabel } from "@lavega/core";

const GICS_SECTOR_LABEL_SET = new Set<string>(GICS_SECTOR_LABELS);

function isValidFetchedAt(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** The taxonomy invariant (sectorTaxonomy.ts): every stored sector is a
 *  GICS_SECTOR_LABELS member or UNKNOWN_SECTOR. A fund weight fails this by
 *  naming an out-of-taxonomy sector or carrying a weight outside [0, 1]. */
export function isValidFundWeight(
  value: unknown,
): value is { sector: GicsSectorLabel; weight: number } {
  if (!value || typeof value !== "object") return false;
  const weight = value as { sector?: unknown; weight?: unknown };
  return (
    typeof weight.sector === "string" &&
    GICS_SECTOR_LABEL_SET.has(weight.sector) &&
    typeof weight.weight === "number" &&
    Number.isFinite(weight.weight) &&
    weight.weight >= 0 &&
    weight.weight <= 1
  );
}

/** Drops a fund's out-of-taxonomy or out-of-range weights instead of
 *  rejecting the whole profile — the dropped share falls into the residual,
 *  reported as Unknown. A malformed fetchedAt is dropped the same way, which
 *  is indistinguishable from a legacy record that never had one: both read
 *  back as stale and get re-fetched. A stock profile passes through
 *  unchanged. Every store applies this at its write boundary so no
 *  implementation can persist a sector outside the taxonomy. */
export function sanitizeSectorProfile(profile: SectorProfile): SectorProfile;
export function sanitizeSectorProfile(profile: StoredSectorProfile): SectorProfile | null;
export function sanitizeSectorProfile(profile: StoredSectorProfile): SectorProfile | null {
  /* A row that holds only a provider-attempt record has no profile. */
  if (profile.kind === "none") return null;
  /* The attempt time is bookkeeping for sectorResolution; callers of get()
   * never see it. */
  const { providerAttemptedAt: _attempt, ...rest } = profile;
  if (rest.kind !== "fund") return rest;
  const sanitized: FundSectorProfile = {
    ...rest,
    weights: rest.weights.filter(isValidFundWeight),
  };
  if (sanitized.fetchedAt !== undefined && !isValidFetchedAt(sanitized.fetchedAt))
    delete sanitized.fetchedAt;
  return sanitized;
}

/** What a store row can hold: a profile, or `kind: "none"` when only a
 *  provider attempt was recorded. Either may carry `providerAttemptedAt`,
 *  the ISO time of the last provider fetch that returned no profile. */
export type StoredSectorProfile = (SectorProfile | { kind: "none" }) & {
  providerAttemptedAt?: string;
};

/** The contract both the Node file-backed store (fileSectorProfileStore.ts)
 *  and this in-memory one implement. Lives here, not there, so app.ts can
 *  depend on the type without dragging in that file's node:path/jsonFileStore
 *  imports. */
export type SectorProfileStore = {
  get(symbol: string): Promise<SectorProfile | null>;
  set(symbol: string, profile: SectorProfile): Promise<void>;
  /** ISO time of the last provider fetch for this symbol that returned no profile. */
  lastProviderAttempt(symbol: string): Promise<string | null>;
  /** Records a provider fetch that returned no profile. Never alters a stored profile. */
  recordProviderAttempt(symbol: string, at: string): Promise<void>;
};

/** Non-persistent store for tests and the dev tier. Deliberately its own
 *  file: no Node import at all, so app.ts's default (`dependencies.sectorStore
 *  ?? createInMemorySectorProfileStore()`) stays Workers-portable even though
 *  index.ts wires in the Node-backed one for the real Docker runtime. */
export function createInMemorySectorProfileStore(): SectorProfileStore {
  const rows = new Map<string, StoredSectorProfile>();
  return {
    async get(symbol) {
      const row = rows.get(symbol.toUpperCase());
      return row ? sanitizeSectorProfile(row) : null;
    },
    async set(symbol, profile) {
      const key = symbol.toUpperCase();
      const sanitized = sanitizeSectorProfile(profile);
      /* Same non-overwrite guard as the Neon store: a provider row is never
       * displaced by an inferred one written after it. */
      const existing = rows.get(key);
      if (existing && "source" in existing && existing.source === "provider") {
        if (sanitized.source !== "provider") return;
      }
      /* A non-provider write keeps the attempt time, so an inference does not
       * make the next read fetch the symbol again. */
      const attemptedAt = existing?.providerAttemptedAt;
      rows.set(
        key,
        sanitized.source !== "provider" && attemptedAt !== undefined
          ? { ...sanitized, providerAttemptedAt: attemptedAt }
          : sanitized,
      );
    },
    async lastProviderAttempt(symbol) {
      return rows.get(symbol.toUpperCase())?.providerAttemptedAt ?? null;
    },
    async recordProviderAttempt(symbol, at) {
      const key = symbol.toUpperCase();
      rows.set(key, { ...(rows.get(key) ?? { kind: "none" as const }), providerAttemptedAt: at });
    },
  };
}
