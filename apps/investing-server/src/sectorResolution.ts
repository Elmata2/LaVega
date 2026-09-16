import { buildSectorExposure, type SectorExposure } from "@lavega/core";
import type { SectorProfile } from "@lavega/adapters";
import type { SectorProfileStore } from "./inMemorySectorProfileStore.js";

/** What a symbol's sector is called when no stored profile answers for it.
 *  Never an entity name and never a guessed industry. */
export const UNKNOWN_SECTOR = "Unknown";

export type SectorProfileLookup = (symbol: string) => Promise<SectorProfile | null>;

export type SectorResolutionOptions = {
  store: SectorProfileStore;
  /** Provider fallback, persisted for next time. Omit it on read-only paths
   *  (the portfolio-agent snapshot): stored profiles only, no provider call
   *  and no store write. */
  fetchProfile?: SectorProfileLookup;
};

export type PortfolioSectors = {
  /** Upper-cased symbol to sector label, for every priced position. */
  sectorBySymbol: Map<string, string>;
  /** Value-weighted sector exposure over the same positions. */
  exposure: SectorExposure[];
};

/** The single sector-classification rule in the product. The risk-summary
 *  route and the portfolio agent both go through here, so a symbol can never
 *  be classified two ways — they differ only in whether a missing profile may
 *  be fetched. */
export async function resolvePortfolioSectors(
  positions: readonly { symbol: string; marketValue: number | null }[],
  options: SectorResolutionOptions,
): Promise<PortfolioSectors> {
  const sectorBySymbol = new Map<string, string>();
  for (const position of positions) {
    if (position.marketValue === null || position.marketValue <= 0) continue;
    const key = position.symbol.toUpperCase();
    if (sectorBySymbol.has(key)) continue;
    sectorBySymbol.set(key, await resolveSector(position.symbol, options));
  }
  return { sectorBySymbol, exposure: buildSectorExposure(positions, sectorBySymbol) };
}

async function resolveSector(
  symbol: string,
  { store, fetchProfile }: SectorResolutionOptions,
): Promise<string> {
  let profile = await store.get(symbol);
  if (!profile && fetchProfile) {
    try {
      profile = await fetchProfile(symbol);
      if (profile) await store.set(symbol, profile);
    } catch {
      profile = null;
    }
  }
  return profile?.sector ?? UNKNOWN_SECTOR;
}
