import { FX_RATE_FALLBACK, parseFxRatePayload, crossRate, type FxRate } from "@lavega/core";
import type { Provider } from "../providerRouter.js";
import type { FxProviderResult, FxRequest } from "../lanes.js";
export type FxHttpClient = { fetchJson(url: string): Promise<unknown> };
export type FrankfurterFxProvider = Provider<FxRequest, FxProviderResult> & {
  getLatestRate(): Promise<{ rate: FxRate; problems: string[] }>;
  getHistoricalRates(from: string, to: string): Promise<{ rates: FxRate[]; problems: string[] }>;
};

const DEFAULT_TIMEOUT_MS = 5_000;

function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Frankfurter request timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function createFrankfurterFxProvider(
  input: { client?: FxHttpClient; now?: () => number; timeoutMs?: number } = {},
): FrankfurterFxProvider {
  let cached: { rate: FxRate; at: number } | null = null;
  let historicalCache: { from: string; to: string; rates: FxRate[]; at: number } | null = null;
  const now = input.now ?? Date.now;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchJson =
    input.client?.fetchJson ??
    (async (url: string) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`Frankfurter HTTP ${response.status}`);
      return response.json();
    });
  const loadRate = async (): Promise<FxRate> => {
    if (!cached) {
      const parsed = parseFxRatePayload(
        await within(fetchJson("https://api.frankfurter.dev/v1/latest?base=EUR"), timeoutMs),
      );
      if (!parsed) throw new Error("invalid Frankfurter response");
      cached = { rate: parsed, at: now() };
    }
    return cached.rate;
  };
  const getLatestRate = async (): Promise<{ rate: FxRate; problems: string[] }> => {
    try {
      return { rate: await loadRate(), problems: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        rate: cached?.rate ?? FX_RATE_FALLBACK,
        problems: [`Frankfurter FX request failed: ${message}`],
      };
    }
  };
  const getHistoricalRates = async (
    from: string,
    to: string,
  ): Promise<{ rates: FxRate[]; problems: string[] }> => {
    if (
      historicalCache &&
      historicalCache.from <= from &&
      historicalCache.to >= to &&
      now() - historicalCache.at < 24 * 60 * 60 * 1000
    )
      return { rates: historicalCache.rates, problems: [] };
    try {
      const parsed = await within(
        fetchJson(`https://api.frankfurter.dev/v1/${from}..${to}?base=EUR`),
        timeoutMs,
      );
      if (!parsed || typeof parsed !== "object") throw new Error("invalid Frankfurter response");
      const payload = parsed as Record<string, unknown>;
      if (payload.base !== "EUR" || !payload.rates || typeof payload.rates !== "object")
        throw new Error("invalid Frankfurter response");
      const rates = Object.entries(payload.rates as Record<string, unknown>)
        .map(([date, values]) => {
          const parsedRate = parseFxRatePayload({ base: "EUR", date, rates: values });
          return parsedRate;
        })
        .filter((rate): rate is FxRate => rate !== null)
        .sort((left, right) => left.date.localeCompare(right.date));
      if (rates.length === 0) throw new Error("invalid Frankfurter response");
      historicalCache = { from, to, rates, at: now() };
      return { rates, problems: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { rates: [], problems: [`Frankfurter historical FX request failed: ${message}`] };
    }
  };
  return {
    sourceKey: "frankfurter",
    priority: 10,
    getLatestRate,
    getHistoricalRates,
    async get(request) {
      try {
        return { rate: crossRate(request.from, request.to, await loadRate()), problems: [] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          return {
            rate: crossRate(request.from, request.to, FX_RATE_FALLBACK),
            problems: [`Frankfurter FX request failed: ${message}`],
          };
        } catch {
          return null;
        }
      }
    },
  };
}
