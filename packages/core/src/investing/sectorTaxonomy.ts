/** The 11 GICS sectors, in Yahoo's own snake_case key order, Title-Cased.
 *  Every sector string the app ever stores or displays — a fund's look-through
 *  weight, a stock's provider-reported sector, or (Phase 2) a System One
 *  inference — must be one of these or UNKNOWN_SECTOR (sectorResolution.ts).
 *  One list, because two independently-typed copies is how "private" once
 *  became a sector (see portfolioAgent.ts's renderPortfolioSnapshot comment). */
export const GICS_SECTOR_LABELS = [
  "Technology",
  "Financial Services",
  "Healthcare",
  "Consumer Cyclical",
  "Consumer Defensive",
  "Communication Services",
  "Industrials",
  "Energy",
  "Utilities",
  "Basic Materials",
  "Real Estate",
] as const;

export type GicsSectorLabel = (typeof GICS_SECTOR_LABELS)[number];

const SNAKE_KEY_TO_LABEL: Record<string, GicsSectorLabel> = {
  technology: "Technology",
  financial_services: "Financial Services",
  healthcare: "Healthcare",
  consumer_cyclical: "Consumer Cyclical",
  consumer_defensive: "Consumer Defensive",
  communication_services: "Communication Services",
  industrials: "Industrials",
  energy: "Energy",
  utilities: "Utilities",
  basic_materials: "Basic Materials",
  realestate: "Real Estate",
};

/** Yahoo's `sectorWeightings` key (snake_case, `realestate` with no
 *  underscore) to the app's display label. Returns `null` for a key Yahoo
 *  hasn't published before — callers drop that bucket's weight rather than
 *  inventing a 12th sector. */
export function formatSectorWeightKey(key: string): GicsSectorLabel | null {
  return SNAKE_KEY_TO_LABEL[key] ?? null;
}
