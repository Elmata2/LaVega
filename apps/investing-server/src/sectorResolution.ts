import {
  buildSectorCoverage,
  buildSectorExposure,
  GICS_SECTOR_LABELS,
  SECTOR_DIVISION_LABELS,
  type SectorCoverage,
  type SectorExposure,
  type SectorWeight,
  type SectorWeightSource,
} from "@lavega/core";
import type {
  FundSectorProfile,
  PriceStore,
  SectorProfile,
  StockSectorProfile,
} from "@lavega/adapters";
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
   *  and side-effect-free on its own. Safe to pass on a read-only path that
   *  also omits fetchProfile: with no provider call available, resolveWeights
   *  can only ever apply the correction directly, never fetch. When
   *  fetchProfile IS passed and the symbol has no cached profile yet,
   *  honoring an uncached correction still costs exactly one provider fetch
   *  first — a correction is the owner's word on a stock, never on a fund's
   *  whole look-through vector, so without a cached profile to tell the two
   *  apart, the fetch is what stops a fund from being masked by a stale
   *  correction forever. Outranks a provider or inferred profile once that
   *  check confirms the symbol isn't a fund; a cached fund always wins over
   *  the correction, fetch or not. */
  correction?: SectorCorrectionLookup;
  /** System One classification, persisted with source "inferred". Omit it
   *  on read-only paths and wherever consent or the enable setting say no —
   *  the same discipline fetchProfile already has. */
  classifier?: SectorClassifier;
  /** Whether an already-cached `source: "inferred"` profile may be shown to
   *  this tenant. The cache is global (no tenantId — sector_profiles has no
   *  RLS), so a symbol another tenant had classified stays cached forever;
   *  without this, a tenant who turned inference off (or never gave
   *  market-data consent) would still see that AI label. `false` degrades
   *  the profile to Unknown for display and coverage alike — the profile
   *  itself is never touched. Omitted or `true` shows it, so every existing
   *  caller that doesn't know about tenant settings (or doesn't need to)
   *  keeps today's behavior. */
  showInferred?: boolean;
  /** Maps a broker symbol to the Yahoo listing symbol price sync already
   *  proved it trades under (PriceStore.getCoverage's `listing`), so a
   *  renamed or SPAC-era broker code (T212's OAC_US_EQ for Hims & Hers) is
   *  looked up and cached under the same ticker (HIMS) prices already
   *  settled on, instead of re-guessing exchange suffixes off the stale
   *  broker code. A local/DB read, never a provider call, so it's safe to
   *  pass on a read-only path too. Returns null when prices have never
   *  resolved a listing for this symbol, in which case every lookup stays
   *  keyed by the broker symbol, unchanged from before this option existed. */
  resolveListing?: (symbol: string) => Promise<string | null>;
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
  /** Share of priced value that is provider-sourced, inferred, owner-corrected,
   *  or unknown, over the same positions. */
  coverage: SectorCoverage;
};

/** Every sector route's `resolveListing`: the Yahoo listing symbol price
 *  sync already proved a broker symbol trades under (PriceStore.getCoverage's
 *  `listing`), so a renamed or SPAC-era broker code is looked up under the
 *  same ticker prices settled on instead of the stale code. A local/DB read,
 *  never a provider call. Null when prices have never resolved a listing for
 *  this symbol. */
export async function resolveSectorListing(
  priceStore: PriceStore,
  tenantId: string,
  symbol: string,
): Promise<string | null> {
  return (await priceStore.getCoverage(tenantId, symbol))?.listing ?? null;
}

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
  return {
    sectorBySymbol,
    weightsBySymbol,
    exposure: buildSectorExposure(positions, weightsBySymbol),
    coverage: buildSectorCoverage(positions, weightsBySymbol),
  };
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
  {
    store,
    fetchProfile,
    correction,
    classifier,
    showInferred,
    resolveListing,
  }: SectorResolutionOptions,
): Promise<SectorWeight[]> {
  const { symbol } = position;
  /* The cache key for every profile read and write below. A broker symbol
   * that price sync has already resolved to a live Yahoo listing (a renamed
   * or SPAC-era code) is looked up and cached under that listing instead of
   * itself, so it shares a cache entry with every other holding of the same
   * instrument. Unresolved, it falls back to the broker symbol as before. */
  const lookupSymbol = (resolveListing ? await resolveListing(symbol) : null) ?? symbol;
  /* Read the cache, and ask for the correction, before deciding anything —
   * store.get is a local/DB read, not a provider call, so this costs nothing
   * a read-only path couldn't already afford. The correction stays keyed by
   * the broker symbol: it's the owner's word on the position as they see it
   * in the UI, not on whichever listing prices happened to resolve. */
  let profile = await store.get(lookupSymbol);
  const corrected = correction ? await correction(symbol) : null;

  const fresh =
    profile &&
    profile.source === "provider" &&
    !(profile.kind === "fund" && isStaleFundProfile(profile));
  if (!fresh && fetchProfile) {
    try {
      const fetched = await fetchProfile(lookupSymbol);
      if (fetched) {
        profile = stampFetchedAt(fetched);
        await store.set(lookupSymbol, profile);
      }
    } catch {
      /* keep whatever was already stored, if anything */
    }
  }
  /* A correction is only ever the owner's word on a stock. Applying it
   * before the cache could confirm the symbol isn't a fund is what let a
   * correction saved while the profile was still uncached mask a fund's
   * real weight vector forever (the fetch above never happens if this check
   * comes first). A cached-or-freshly-fetched fund always wins instead. */
  if (corrected && (!profile || profile.kind === "stock"))
    return [{ sector: corrected, weight: 1, source: "correction" }];

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
      await store.set(lookupSymbol, inferred);
    }
  }
  return profileToWeights(profile, showInferred);
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

function profileToWeights(profile: SectorProfile | null, showInferred?: boolean): SectorWeight[] {
  if (!profile) return [];
  if (profile.kind === "stock") {
    const resolved = resolvedStockSector(profile, { showInferred });
    return [{ sector: resolved.sector, weight: 1, source: resolved.source }];
  }
  return [...profile.weights]
    .sort((left, right) => right.weight - left.weight)
    .map((weight) => ({ ...weight, source: "provider" as const }));
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

/** What a stored stock profile resolves to, for both the coverage/exposure
 *  pipeline above and a direct per-position read (app.ts's GET
 *  .../sector). A cached no-match inference is stored with source
 *  "inferred" but sector UNKNOWN_SECTOR — not displayable — so both callers
 *  report it the same way: source "unknown", never a confident-looking
 *  "inferred" with nothing behind it. */
export function resolvedStockSector(
  profile: StockSectorProfile,
  options?: { showInferred?: boolean },
): { sector: string; source: SectorWeightSource; confidence?: number } {
  if (!isDisplayableStockSector(profile)) return { sector: UNKNOWN_SECTOR, source: "unknown" };
  /* An inferred label the tenant isn't allowed to see (inference off, or no
   * market-data consent) reads exactly like an unresolved symbol — never a
   * confident-looking sector, and never the classifier's answer leaking
   * across tenants through the global sector_profiles cache. */
  if (profile.source === "inferred" && options?.showInferred === false)
    return { sector: UNKNOWN_SECTOR, source: "unknown" };
  return profile.source === "inferred"
    ? { sector: profile.sector, source: "inferred", confidence: profile.confidence }
    : { sector: profile.sector, source: "provider" };
}
