import { Hono } from "hono";
import { LocalKeySource, MarketDataRouter, createInMemoryPriceStore, createYahooPriceProvider, createMemoryYahooConsentStore, createFrankfurterFxProvider, createOpenFigiIdentifierProvider, type YahooConsentStore, syncPrices, type PriceProviderResult, type PriceStore, type YahooPriceRequest, type FxRequest, type FxProviderResult, type IdentifierRequest, type IdentifierProviderResult, hasYahooFinanceRequestConsent } from "@lavega/adapters";

type PriceDependencies = { store: PriceStore; provider: ReturnType<typeof createYahooPriceProvider>; consentStore: YahooConsentStore; fxProvider: ReturnType<typeof createFrankfurterFxProvider>; identifierProvider: ReturnType<typeof createOpenFigiIdentifierProvider> };
export function createApp(dependencies: Partial<PriceDependencies> = {}) {
  const store = dependencies.store ?? createInMemoryPriceStore();
  const consent = dependencies.consentStore ?? createMemoryYahooConsentStore();
  const provider = dependencies.provider ?? createYahooPriceProvider({ consent });
  const fxProvider = dependencies.fxProvider ?? createFrankfurterFxProvider();
  const identifierProvider = dependencies.identifierProvider ?? createOpenFigiIdentifierProvider();
  const router = new MarketDataRouter<YahooPriceRequest, PriceProviderResult, FxRequest, FxProviderResult, IdentifierRequest, IdentifierProviderResult>({ price: [provider], fx: [fxProvider], identifier: [identifierProvider] });
  const investingApp = new Hono();
  investingApp.get("/health", (c) => c.json({ ok: true, service: "investing-server" }));
  investingApp.get("/api/config/status", (c) => { const keys = new LocalKeySource(); return c.json({ keys: { llm: keys.getStatus("llm"), marketData: keys.getStatus("market-data") } }); });
  investingApp.get("/api/market-data/fx", async (c) => { const from = c.req.query("from")?.trim().toUpperCase(); const to = c.req.query("to")?.trim().toUpperCase(); if (!from || !to) return c.json({ rate: null, problems: ["from and to currencies are required"] }, 400); const result = await router.getFx({ from, to }); if (!result) return c.json({ rate: null, problems: ["No FX provider returned data"] }, 503); return c.json({ ...result.value, source: result.sourceKey }); });
  investingApp.get("/api/market-data/identifier", async (c) => { const isin = c.req.query("isin")?.trim().toUpperCase(); if (!isin) return c.json({ match: null, problems: ["isin is required"] }, 400); const result = await router.mapIdentifier({ isin }); if (!result) return c.json({ match: null, problems: ["No identifier provider returned data"] }, 503); return c.json({ ...result.value, source: result.sourceKey }); });
  investingApp.get("/api/market-data/consent", (c) => c.json({ accepted: consent.hasConsent(), disclosure: "Yahoo Finance is niet officieel. De dienst kan zonder waarschuwing stoppen of verzoeken beperken. De voorwaarden beperken geautomatiseerd en commercieel gebruik. LaVega gebruikt Yahoo alleen voor lokaal of zelf gehost persoonlijk gebruik." }));
  investingApp.post("/api/market-data/consent", async (c) => { const body: { accepted?: boolean } = await c.req.json().catch(() => ({})); if (body.accepted !== true) return c.json({ accepted: false, problem: "Consent must be explicitly accepted" }, 400); consent.recordConsent(); return c.json({ accepted: true }); });
  investingApp.post("/api/prices/sync", async (c) => {
    if (hasYahooFinanceRequestConsent(c.req.raw)) consent.recordConsent();
    if (!consent.hasConsent()) return c.json({ bars: [], fetched: [], problems: ["Yahoo Finance disclosure consent required"] }, 412);
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
