import type { Provider } from "../providerRouter.js";
import type { IdentifierProviderResult, IdentifierRequest } from "../lanes.js";
type OpenFigiClient = { postJson(url: string, body: unknown): Promise<unknown> };

/** Unauthenticated OpenFIGI budget is 25 requests/min; stay under it regardless
 *  of how fast the caller paces symbols. */
const MIN_INTERVAL_MS = 2_500;
const MAX_ATTEMPTS = 5;

export function createOpenFigiIdentifierProvider(input: { client?: OpenFigiClient; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Provider<IdentifierRequest, IdentifierProviderResult> {
  const cache = new Map<string, IdentifierProviderResult>();
  const postJson = input.client?.postJson ?? (async (url: string, body: unknown) => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) {
      const error = new Error(`OpenFIGI HTTP ${response.status}`) as Error & { status?: number; retryAfterMs?: number };
      error.status = response.status;
      const retryAfter = Number(response.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = retryAfter * 1_000;
      throw error;
    }
    return response.json();
  });
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastRequestAt = 0;

  const requestWithBudget = async (body: unknown): Promise<unknown> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const wait = lastRequestAt + MIN_INTERVAL_MS - now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = now();
      try {
        return await postJson("https://api.openfigi.com/v3/mapping", body);
      } catch (error) {
        lastError = error;
        const status = (error as { status?: number }).status;
        // Rate limit or transient provider issue: back off and retry. Honor
        // Retry-After when present, otherwise exponential backoff.
        if (status !== 429 && (status === undefined || status < 500)) break;
        const retryAfterMs = (error as { retryAfterMs?: number }).retryAfterMs;
        await sleep(retryAfterMs ?? Math.min(60_000, 5_000 * attempt));
      }
    }
    throw lastError;
  };

  return { sourceKey: "openfigi", priority: 10, async get(request) {
    const isin = request.isin.trim().toUpperCase();
    const known = cache.get(isin);
    if (known) return known;
    try {
      const raw = await requestWithBudget([{ idType: "ID_ISIN", idValue: isin }]);
      const first = Array.isArray(raw) ? raw[0] : null;
      const data = first && typeof first === "object" ? (first as { data?: unknown }).data : null;
      const item = Array.isArray(data) && data[0] && typeof data[0] === "object" ? data[0] as Record<string, unknown> : null;
      if (!item || typeof item.ticker !== "string") throw new Error("ISIN not found");
      const result = { match: { isin, ticker: item.ticker, ...(typeof item.exchCode === "string" ? { exchange: item.exchCode } : {}), ...(typeof item.name === "string" ? { name: item.name } : {}) }, problems: [] };
      cache.set(isin, result);
      return result;
    } catch (error) {
      // Failures are not cached: a rate-limited ISIN must resolve on a later run.
      return { match: { isin, ticker: "" }, problems: [`OpenFIGI identifier request failed: ${error instanceof Error ? error.message : String(error)}`] };
    }
  } };
}
