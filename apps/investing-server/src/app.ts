import { Hono } from "hono";
import { emptyInvestingDashboard, type InvestingDashboardData } from "@lavega/core";
import { createProblemReporter, type ProblemReporter } from "./observability.js";
import { LocalKeySource, MarketDataRouter, createInMemoryPriceStore, createYahooPriceProvider, createFrankfurterFxProvider, createOpenFigiIdentifierProvider, syncPrices, type PriceProviderResult, type PriceStore, type YahooPriceRequest, type FxRequest, type FxProviderResult, type IdentifierRequest, type IdentifierProviderResult } from "@lavega/adapters";

export type InvestingDashboardReader = (input: { symbol?: string }) => Promise<InvestingDashboardData>;
type PriceDependencies = { store: PriceStore; provider: ReturnType<typeof createYahooPriceProvider>; fxProvider: ReturnType<typeof createFrankfurterFxProvider>; identifierProvider: ReturnType<typeof createOpenFigiIdentifierProvider>; brokerSync: (force: boolean) => Promise<{ outcomes: unknown[]; problems: string[] }>; problemReporter: ProblemReporter; dashboardReader: InvestingDashboardReader };
export function createApp(dependencies: Partial<PriceDependencies> = {}) {
  const store = dependencies.store ?? createInMemoryPriceStore();
  const provider = dependencies.provider ?? createYahooPriceProvider();
  const fxProvider = dependencies.fxProvider ?? createFrankfurterFxProvider();
  const identifierProvider = dependencies.identifierProvider ?? createOpenFigiIdentifierProvider();
  const brokerSync = dependencies.brokerSync ?? (async () => ({ outcomes: [], problems: [] }));
  const problemReporter = dependencies.problemReporter ?? createProblemReporter();
  const dashboardReader = dependencies.dashboardReader ?? (async () => emptyInvestingDashboard());
  const router = new MarketDataRouter<YahooPriceRequest, PriceProviderResult, FxRequest, FxProviderResult, IdentifierRequest, IdentifierProviderResult>({ price: [provider], fx: [fxProvider], identifier: [identifierProvider] });
  const investingApp = new Hono();
  investingApp.get("/health", (c) => c.json({ ok: true, service: "investing-server" }));
  investingApp.get("/api/investing/dashboard", async (c) => {
    try {
      return c.json(await dashboardReader({ symbol: c.req.query("symbol")?.trim() || undefined }));
    } catch {
      return c.json({ ...emptyInvestingDashboard(), problems: ["Dashboardgegevens konden niet worden geladen"] }, 503);
    }
  });
  investingApp.get("/api/config/status", (c) => { const keys = new LocalKeySource(); return c.json({ keys: { llm: keys.getStatus("llm"), marketData: keys.getStatus("market-data") } }); });
  investingApp.post("/api/brokers/sync", async (c) => {
    try {
      const result = await brokerSync(c.req.query("force") === "true");
      problemReporter({ source: "broker-sync", problems: result.problems });
      return c.json(result);
    } catch {
      const result = { outcomes: [], problems: ["Broker synchronization failed"] };
      problemReporter({ source: "broker-sync", problems: result.problems });
      return c.json(result, 503);
    }
  });
  investingApp.delete("/api/prices/cache", async (c) => { await store.purgeAll(); return c.json({ deleted: true }); });
  investingApp.get("/api/market-data/fx", async (c) => { const from = c.req.query("from")?.trim().toUpperCase(); const to = c.req.query("to")?.trim().toUpperCase(); if (!from || !to) return c.json({ rate: null, problems: ["from and to currencies are required"] }, 400); const result = await router.getFx({ from, to }); if (!result) return c.json({ rate: null, problems: ["No FX provider returned data"] }, 503); return c.json({ ...result.value, source: result.sourceKey }); });
  investingApp.get("/api/market-data/identifier", async (c) => { const isin = c.req.query("isin")?.trim().toUpperCase(); if (!isin) return c.json({ match: null, problems: ["isin is required"] }, 400); const result = await router.mapIdentifier({ isin }); if (!result) return c.json({ match: null, problems: ["No identifier provider returned data"] }, 503); return c.json({ ...result.value, source: result.sourceKey }); });
  investingApp.post("/api/prices/sync", async (c) => {
    const body = await c.req.json<{ symbols?: Array<Partial<Omit<YahooPriceRequest, "from" | "to">> & { isin?: string }>; today?: string }>().catch(() => ({ symbols: undefined, today: undefined }));
    const requested = body.symbols ?? [];
    const resolved = await Promise.all(requested.map(async (request) => {
      if (request.symbol && request.ticker && request.exchange) return { request: request as Omit<YahooPriceRequest, "from" | "to">, problems: [] as string[] };
      if (!request.isin) return { request: request as Omit<YahooPriceRequest, "from" | "to">, problems: ["symbol, ticker, and exchange are required unless isin is provided"] };
      const identifier = await router.mapIdentifier({ isin: request.isin });
      if (!identifier || identifier.value.problems.length || !identifier.value.match.ticker || !identifier.value.match.exchange) return { request: request as Omit<YahooPriceRequest, "from" | "to">, problems: identifier?.value.problems ?? ["Could not resolve ISIN"] };
    const match = identifier.value.match;
      return { request: { ...request, symbol: request.symbol ?? match.ticker, ticker: request.ticker ?? match.ticker, exchange: request.exchange ?? match.exchange } as Omit<YahooPriceRequest, "from" | "to">, problems: [] as string[] };
    }));
    const results = await Promise.all(resolved.map((item) => item.problems.length ? { bars: [], fetched: false, problems: item.problems } : syncPrices({ store, router, request: { ...item.request, today: body.today ?? new Date().toISOString().slice(0, 10) } })));
    return c.json({ bars: results.flatMap((result) => result.bars), fetched: results.flatMap((result, index) => result.fetched ? [requested[index]?.symbol].filter((symbol): symbol is string => Boolean(symbol)) : []), problems: results.flatMap((result) => result.problems) });
  });
  return investingApp;
}
export const app = createApp();
