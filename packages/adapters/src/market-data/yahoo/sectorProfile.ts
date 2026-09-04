import { YahooHttpClient } from "./http.js";
import { getYahooSymbolsToTry } from "./symbols.js";

const QUOTE_SUMMARY_URL = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/";

export type SectorProfile = { sector: string; industry: string };

type YahooAssetProfileResponse = {
  quoteSummary?: { result?: Array<{ assetProfile?: { sector?: string; industry?: string } }> };
};

/** Fetches sector + industry for one symbol via the shared crumb client. Returns null on any failure — never throws. */
export async function fetchYahooSectorProfile(
  symbol: string,
  client?: YahooHttpClient,
): Promise<SectorProfile | null> {
  try {
    const httpClient = client ?? new YahooHttpClient();
    for (const candidate of sectorProfileCandidates(symbol)) {
      const data = await httpClient.fetchJsonWithCrumb<YahooAssetProfileResponse>(
        `${QUOTE_SUMMARY_URL}${encodeURIComponent(candidate)}?modules=assetProfile`,
      );
      const profile = data.quoteSummary?.result?.[0]?.assetProfile;
      if (!profile?.sector && !profile?.industry) continue;
      return { sector: profile.sector ?? "Unknown", industry: profile.industry ?? "Unknown" };
    }
    return null;
  } catch {
    return null;
  }
}

function sectorProfileCandidates(symbol: string): string[] {
  return [...new Set(getYahooSymbolsToTry(symbol, "").map((candidate) => candidate.toUpperCase()))];
}
