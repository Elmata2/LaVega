import { YahooHttpClient } from "./http.js";

const QUOTE_SUMMARY_URL = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/";

export type SectorProfile = { sector: string; industry: string };

type YahooAssetProfileResponse = {
  quoteSummary?: { result?: Array<{ assetProfile?: { sector?: string; industry?: string } }> };
};

/** Fetches sector + industry for one symbol via the shared crumb client. Returns null on any failure — never throws. */
export async function fetchYahooSectorProfile(symbol: string, client?: YahooHttpClient): Promise<SectorProfile | null> {
  try {
    const httpClient = client ?? new YahooHttpClient();
    const data = await httpClient.fetchJsonWithCrumb<YahooAssetProfileResponse>(`${QUOTE_SUMMARY_URL}${encodeURIComponent(symbol.toUpperCase())}?modules=assetProfile`);
    const profile = data.quoteSummary?.result?.[0]?.assetProfile;
    if (!profile?.sector && !profile?.industry) return null;
    return { sector: profile.sector ?? "Unknown", industry: profile.industry ?? "Unknown" };
  } catch {
    return null;
  }
}
