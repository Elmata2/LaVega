import { FX_RATE_FALLBACK, parseFxRatePayload, crossRate, type FxRate } from "@lavega/core";
import type { Provider } from "../providerRouter.js";
import type { FxProviderResult, FxRequest } from "../lanes.js";
export type FxHttpClient = { fetchJson(url: string): Promise<unknown> };
export function createFrankfurterFxProvider(input: { client?: FxHttpClient; now?: () => number } = {}): Provider<FxRequest, FxProviderResult> {
  let cached: { rate: FxRate; at: number } | null = null; const now = input.now ?? Date.now;
  const fetchJson = input.client?.fetchJson ?? (async (url: string) => { const response = await fetch(url); if (!response.ok) throw new Error(`Frankfurter HTTP ${response.status}`); return response.json(); });
  return { sourceKey: "frankfurter", priority: 10, async get(request) {
    try { if (!cached) { const parsed = parseFxRatePayload(await fetchJson("https://api.frankfurter.dev/v1/latest?base=EUR")); if (!parsed) throw new Error("invalid Frankfurter response"); cached = { rate: parsed, at: now() }; } return { rate: crossRate(request.from, request.to, cached.rate), problems: [] }; }
    catch (error) { const message = error instanceof Error ? error.message : String(error); const rate = cached?.rate ?? FX_RATE_FALLBACK; try { return { rate: crossRate(request.from, request.to, rate), problems: [`Frankfurter FX request failed: ${message}`] }; } catch { return { rate: 0, problems: [`Frankfurter has no rate for ${request.from} to ${request.to}`] }; } }
  } };
}
