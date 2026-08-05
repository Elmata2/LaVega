/* FX rate service. GET /api/fx/rate serves this. Fetches ECB mid-market rates
 * (base EUR) from Frankfurter — public data, NO user data is sent. 6h in-memory
 * cache; on any failure serves the last good result, else the bundled snapshot.
 * The client derives any from->to cross rate locally via crossRate(). */
import type { FxRate } from "@lavega/core";
import { FX_RATE_FALLBACK, parseFxRatePayload } from "@lavega/core";

const SOURCE_URL = "https://api.frankfurter.dev/v1/latest?base=EUR";
const TTL_MS = 6 * 60 * 60 * 1000;

let cache: { payload: FxRate; at: number } | null = null;

export async function getFxRate(): Promise<FxRate> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.payload;
  try {
    const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const parsed = parseFxRatePayload(await res.json());
      if (parsed) {
        cache = { payload: parsed, at: Date.now() };
        return parsed;
      }
    }
  } catch {
    /* fall through to last-good / static */
  }
  if (cache) return cache.payload;
  return FX_RATE_FALLBACK;
}
