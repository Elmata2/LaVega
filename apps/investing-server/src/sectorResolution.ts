import {
  buildSectorExposure,
  GICS_SECTOR_LABELS,
  SECTOR_DIVISION_LABELS,
  type SectorExposure,
  type SectorWeight,
} from "@lavega/core";
import type { FundSectorProfile, SectorProfile, StockSectorProfile } from "@lavega/adapters";
import type { SectorProfileStore } from "./inMemorySectorProfileStore.js";
import type { SectorClassifier } from "./sectorClassifier.js";

/** What a symbol's sector is called when no stored profile answers for it,
 *  a stored sector string falls outside the taxonomy, or the classifier
 *  found no match at all. Never an entity name and never a guessed
 *  industry. */
export const UNKNOWN_SECTOR = "Unknown";

const GICS_SECTOR_LABEL_SET = new Set<string>(GICS_SECTOR_LABELS);
const SECTOR_DIVISION_LABEL_SET = new Set<string>(SECTOR_DIVISION_LABELS);

/** A fund's stored weight vector goes stale as the fund rebalances; a
 *  stock's headline sector rarely changes, so only fund profiles are
 *  re-fetched on this cadence. */
export const FUND_PROFILE_REFRESH_DAYS = 90;

export type SectorProfileLookup = (symbol: string) => Promise<SectorProfile | null>;
export type SectorCorrectionLookup = (symbol: string) => Promise<string | null>;

export type SectorResolutionOptions = {
  store: SectorProfileStore;
  /** Provider fallback, persisted for next time. Omit it on read-only paths
   *  (the portfolio-agent snapshot): stored profiles only, no provider call
   *  and no store write, and no re-fetch of a stale fund profile either. */
  fetchProfile?: SectorProfileLookup;
  /** The owner's own override for this symbol — a preferences read, cheap
   *  and side-effect-free. Always safe to pass, including on read-only
   *  paths: it never calls a provider and never writes to the sector store.
   *  Outranks a provider profile and a classifier inference alike. */
  correction?: SectorCorrectionLookup;
  /** System One classification, persisted with source "inferred". Omit it
   *  on read-only paths and wherever consent or the enable setting say no —
   *  the same discipline fetchProfile already has. */
  classifier?: SectorClassifier;
};

export type PortfolioSectors = {
  /** Upper-cased symbol to one headline sector: a stock's own sector, or a
   *  fund's single largest-weight sector. For display where one label fits. */
  sectorBySymbol: Map<string, string>;
  /** Upper-cased symbol to its full resolved weight vector, before the
   *  residual-folding buildSectorExposure applies. */
  weightsBySymbol: Map<string, SectorWeight[]>;
  /** Value-weighted sector exposure over the same positions. */
  exposure: SectorExposure[];
};

/** Bounded fan-out to the sector-profile provider (a single upstream host,
 *  fc.yahoo.com / query2.finance.yahoo.com): high enough that ~200 distinct
 *  portfolio symbols don't serialize their latency, low enough not to
 *  hammer one host with a request burst. */
const SECTOR_RESOLUTION_CONCURRENCY = 8;

/** The single sector-classification rule in the product. The risk-summary
 *  route and the portfolio agent both go through here, so a symbol can never
 *  be classified two ways — they differ only in whether a missing or stale
 *  profile may be fetched. */
export async function resolvePortfolioSectors(
  positions: readonly { symbol: string; marketValue: number | null; description?: string }[],
  options: SectorResolutionOptions,
): Promise<PortfolioSectors> {
  const sectorBySymbol = new Map<string, string>();
  const weightsBySymbol = new Map<string, SectorWeight[]>();
  const seen = new Set<string>();
  const pending: { key: string; symbol: string; description?: string }[] = [];
  for (const position of positions) {
    if (position.marketValue === null || position.marketValue <= 0) continue;
    const key = position.symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push({ key, symbol: position.symbol, description: position.description });
  }
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(SECTOR_RESOLUTION_CONCURRENCY, pending.length) }, async () => {
      while (next < pending.length) {
        const item = pending[next++]!;
        const weights = await resolveWeights(item, options);
        weightsBySymbol.set(item.key, weights);
        sectorBySymbol.set(item.key, weights[0]?.sector ?? UNKNOWN_SECTOR);
      }
    }),
  );
  return { sectorBySymbol, weightsBySymbol, exposure: buildSectorExposure(positions, weightsBySymbol) };
}

function isStaleFundProfile(profile: FundSectorProfile): boolean {
  if (profile.fetchedAt === undefined) return true;
  const fetchedAtMs = Date.parse(profile.fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) return true;
  return Date.now() - fetchedAtMs > FUND_PROFILE_REFRESH_DAYS * 24 * 60 * 60 * 1000;
}

/** Stamped only on a fund: that is the only kind sectorResolution ever
 *  re-fetches for staleness, so it is the only kind that needs a clock. */
function stampFetchedAt(profile: SectorProfile): SectorProfile {
  return profile.kind === "fund" ? { ...profile, fetchedAt: new Date().toISOString() } : profile;
}

async function resolveWeights(
  position: { symbol: string; description?: string },
  { store, fetchProfile, correction, classifier }: SectorResolutionOptions,
): Promise<SectorWeight[]> {
  const { symbol } = position;
  const corrected = correction ? await correction(symbol) : null;
  if (corrected) return [{ sector: corrected, weight: 1 }];

  let profile = await store.get(symbol);
  const fresh = profile && profile.source === "provider" && !(profile.kind === "fund" && isStaleFundProfile(profile));
  if (!fresh && fetchProfile) {
    try {
      const fetched = await fetchProfile(symbol);
      if (fetched) {
        profile = stampFetchedAt(fetched);
        await store.set(symbol, profile);
      }
    } catch {
      /* keep whatever was already stored, if anything */
    }
  }
  if (!profile && classifier) {
    let classification: Awaited<ReturnType<SectorClassifier>> | undefined;
    try {
      classification = await classifier({ symbol, description: position.description });
    } catch {
      /* treated the same as { kind: "failed" }: cache nothing, retry later */
    }
    const inferred = classificationToProfile(classification);
    if (inferred) {
      profile = inferred;
      await store.set(symbol, inferred);
    }
  }
  return profileToWeights(profile);
}

/** `classified` becomes a cacheable inferred profile at whatever specificity
 *  the classifier reported. `no-match` becomes a cacheable inferred Unknown,
 *  so the same symbol isn't re-asked on every resolution. `failed` (a
 *  provider error, timeout, budget refusal, or malformed answer) is never
 *  cached — it must be retried on a later pass, not frozen as Unknown. An
 *  undefined classification (an unimplemented test double, or any classifier
 *  that breaks its own return contract) is treated the same as `failed`. */
function classificationToProfile(
  classification: Awaited<ReturnType<SectorClassifier>> | undefined,
): StockSectorProfile | null {
  if (!classification || classification.kind === "failed") return null;
  const inferredAt = new Date().toISOString();
  if (classification.kind === "no-match")
    return {
      kind: "stock",
      sector: UNKNOWN_SECTOR,
      industry: "Unknown",
      source: "inferred",
      specificity: "sector",
      confidence: 0,
      inferredAt,
    };
  return {
    kind: "stock",
    sector: classification.sector,
    industry: "Unknown",
    source: "inferred",
    specificity: classification.specificity,
    confidence: classification.confidence,
    inferredAt,
  };
}

function profileToWeights(profile: SectorProfile | null): SectorWeight[] {
  if (!profile) return [];
  if (profile.kind === "stock") {
    const sector = isDisplayableStockSector(profile) ? profile.sector : UNKNOWN_SECTOR;
    return [{ sector, weight: 1 }];
  }
  return [...profile.weights].sort((left, right) => right.weight - left.weight);
}

/** A stock's sector is only ever a GICS label or, when the profile is
 *  inferred, one of the three broader divisions the classifier falls back
 *  to at low confidence. Neither Yahoo's free-text sector nor the
 *  classifier's own answer is trusted past this check — never let an
 *  arbitrary value become a sector label outside the fixed taxonomy. */
function isDisplayableStockSector(profile: StockSectorProfile): boolean {
  if (GICS_SECTOR_LABEL_SET.has(profile.sector)) return true;
  return profile.source === "inferred" && SECTOR_DIVISION_LABEL_SET.has(profile.sector);
}
