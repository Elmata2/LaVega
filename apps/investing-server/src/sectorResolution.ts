import { buildSectorExposure, GICS_SECTOR_LABELS, type SectorExposure, type SectorWeight } from "@lavega/core";
import type { FundSectorProfile, SectorProfile } from "@lavega/adapters";
import type { SectorProfileStore } from "./inMemorySectorProfileStore.js";

/** What a symbol's sector is called when no stored profile answers for it,
 *  or when a stored sector string falls outside the GICS taxonomy. Never an
 *  entity name and never a guessed industry. */
export const UNKNOWN_SECTOR = "Unknown";

const GICS_SECTOR_LABEL_SET = new Set<string>(GICS_SECTOR_LABELS);

/** A fund's stored weight vector goes stale as the fund rebalances; a
 *  stock's headline sector rarely changes, so only fund profiles are
 *  re-fetched on this cadence. */
export const FUND_PROFILE_REFRESH_DAYS = 90;

export type SectorProfileLookup = (symbol: string) => Promise<SectorProfile | null>;

export type SectorResolutionOptions = {
  store: SectorProfileStore;
  /** Provider fallback, persisted for next time. Omit it on read-only paths
   *  (the portfolio-agent snapshot): stored profiles only, no provider call
   *  and no store write, and no re-fetch of a stale fund profile either. */
  fetchProfile?: SectorProfileLookup;
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
  positions: readonly { symbol: string; marketValue: number | null }[],
  options: SectorResolutionOptions,
): Promise<PortfolioSectors> {
  const sectorBySymbol = new Map<string, string>();
  const weightsBySymbol = new Map<string, SectorWeight[]>();
  const seen = new Set<string>();
  const pending: { key: string; symbol: string }[] = [];
  for (const position of positions) {
    if (position.marketValue === null || position.marketValue <= 0) continue;
    const key = position.symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push({ key, symbol: position.symbol });
  }
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(SECTOR_RESOLUTION_CONCURRENCY, pending.length) }, async () => {
      while (next < pending.length) {
        const item = pending[next++]!;
        const weights = await resolveWeights(item.symbol, options);
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
  symbol: string,
  { store, fetchProfile }: SectorResolutionOptions,
): Promise<SectorWeight[]> {
  const stored = await store.get(symbol);
  if (!fetchProfile) return profileToWeights(stored);
  const fresh = stored && !(stored.kind === "fund" && isStaleFundProfile(stored));
  if (fresh) return profileToWeights(stored);
  try {
    const fetched = await fetchProfile(symbol);
    if (!fetched) return profileToWeights(stored);
    const stamped = stampFetchedAt(fetched);
    await store.set(symbol, stamped);
    return profileToWeights(stamped);
  } catch {
    return profileToWeights(stored);
  }
}

function profileToWeights(profile: SectorProfile | null): SectorWeight[] {
  if (!profile) return [];
  if (profile.kind === "stock") {
    // Yahoo's sector string is free text; never let an arbitrary provider
    // value become a sector label outside the fixed GICS taxonomy.
    const sector = GICS_SECTOR_LABEL_SET.has(profile.sector) ? profile.sector : UNKNOWN_SECTOR;
    return [{ sector, weight: 1 }];
  }
  return [...profile.weights].sort((left, right) => right.weight - left.weight);
}
