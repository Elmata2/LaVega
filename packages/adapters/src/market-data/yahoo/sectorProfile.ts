import { YahooHttpClient } from "./http.js";
import { getYahooSymbolsToTry } from "./symbols.js";
import { formatSectorWeightKey } from "@lavega/core";

const QUOTE_SUMMARY_URL = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/";
const MODULES = "quoteType,assetProfile,topHoldings";

export type ProviderStockSectorProfile = {
  kind: "stock";
  sector: string;
  industry: string;
  source: "provider";
};
/** Written only by sectorResolution.ts's classifier tier, never by this
 *  provider adapter. `sector` is a GICS label at "sector" specificity or a
 *  division label (Cyclical/Defensive/Sensitive) at "division" specificity
 *  — see SECTOR_TO_DIVISION in @lavega/core. */
export type InferredStockSectorProfile = {
  kind: "stock";
  sector: string;
  industry: string;
  source: "inferred";
  specificity: "sector" | "division";
  confidence: number;
  inferredAt: string;
};
export type StockSectorProfile = ProviderStockSectorProfile | InferredStockSectorProfile;
export type FundSectorProfile = {
  kind: "fund";
  weights: { sector: string; weight: number }[];
  source: "provider";
  /** ISO date the weights were last fetched from the provider. A fund
   *  rebalances quarterly, so sectorResolution.ts re-fetches a profile older
   *  than its refresh window instead of trusting it indefinitely. Absent on
   *  a stock profile and on any record written before this field existed. */
  fetchedAt?: string;
};
export type SectorProfile = StockSectorProfile | FundSectorProfile;

type YahooCombinedResponse = {
  quoteSummary?: {
    result?: Array<{
      quoteType?: { quoteType?: string };
      assetProfile?: { sector?: string; industry?: string };
      topHoldings?: { sectorWeightings?: Array<Record<string, { raw?: number }>> };
    }>;
  };
};

const FUND_QUOTE_TYPES = new Set(["ETF", "MUTUALFUND"]);

/** Fetches sector data for one symbol in one call. Returns null on any
 *  failure or when neither a stock sector nor fund weights answer — never
 *  throws. */
export async function fetchYahooSectorProfile(
  symbol: string,
  client?: YahooHttpClient,
): Promise<SectorProfile | null> {
  try {
    const httpClient = client ?? new YahooHttpClient();
    for (const candidate of sectorProfileCandidates(symbol)) {
      const data = await httpClient.fetchJsonWithCrumb<YahooCombinedResponse>(
        `${QUOTE_SUMMARY_URL}${encodeURIComponent(candidate)}?modules=${MODULES}`,
      );
      const result = data.quoteSummary?.result?.[0];
      if (!result) continue;
      const profile = toSectorProfile(result);
      if (profile) return profile;
    }
    return null;
  } catch {
    return null;
  }
}

function toSectorProfile(result: {
  quoteType?: { quoteType?: string };
  assetProfile?: { sector?: string; industry?: string };
  topHoldings?: { sectorWeightings?: Array<Record<string, { raw?: number }>> };
}): SectorProfile | null {
  if (FUND_QUOTE_TYPES.has(result.quoteType?.quoteType ?? "")) {
    const weightings = result.topHoldings?.sectorWeightings ?? [];
    const weights = weightings.flatMap((entry) => {
      const [key, value] = Object.entries(entry)[0] ?? [];
      const sector = key ? formatSectorWeightKey(key) : null;
      return sector && typeof value?.raw === "number" && value.raw > 0
        ? [{ sector, weight: value.raw }]
        : [];
    });
    // Present regardless of length: [] for a bond fund is a real, cacheable
    // answer ("no equity sectors"), never confused with "the lookup failed."
    return { kind: "fund", weights, source: "provider" };
  }
  const asset = result.assetProfile;
  if (!asset?.sector && !asset?.industry) return null;
  return {
    kind: "stock",
    sector: asset?.sector ?? "Unknown",
    industry: asset?.industry ?? "Unknown",
    source: "provider",
  };
}

function sectorProfileCandidates(symbol: string): string[] {
  return [...new Set(getYahooSymbolsToTry(symbol, "").map((candidate) => candidate.toUpperCase()))];
}
