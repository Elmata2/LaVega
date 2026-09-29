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

/** The 11 GICS sectors grouped into the classic three economic-sensitivity
 *  super-sectors (Cyclical / Defensive / Sensitive). Used only as the
 *  System One classifier's fallback label when its confidence in a specific
 *  sector is low — reported instead of discarding the answer, per issue #135
 *  ("the broad label is derivable from the narrow answer with no extra
 *  request"). This 3-way split isn't the only one in use across the industry
 *  (Fidelity's own public materials group Real Estate and Communication
 *  Services inconsistently across sources); it is a defensible first cut,
 *  not a verified-authoritative one — the confidence threshold below it is
 *  explicitly a placeholder to measure and tune, not a final number. */
export const SECTOR_TO_DIVISION: Record<GicsSectorLabel, "Cyclical" | "Defensive" | "Sensitive"> = {
  "Consumer Cyclical": "Cyclical",
  "Financial Services": "Cyclical",
  "Real Estate": "Cyclical",
  "Basic Materials": "Cyclical",
  "Consumer Defensive": "Defensive",
  Healthcare: "Defensive",
  Utilities: "Defensive",
  "Communication Services": "Sensitive",
  Energy: "Sensitive",
  Industrials: "Sensitive",
  Technology: "Sensitive",
};
