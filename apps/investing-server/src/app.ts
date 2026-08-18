import { Hono } from "hono";
import {
  LocalKeySource,
  MarketDataRouter,
  createInMemoryPriceStore,
  createYahooPriceProvider,
  createMemoryYahooConsentStore,
  type YahooConsentStore,
  syncPrices,
  type PriceProviderResult,
  type PriceStore,
  type YahooPriceRequest,
} from "@lavega/adapters";

type PriceDependencies = { store: PriceStore; provider: ReturnType<typeof createYahooPriceProvider>; consentStore: YahooConsentStore };

export function createApp(dependencies?: Partial<PriceDependencies>) {
  const store = dependencies?.store ?? createInMemoryPriceStore();
  const consent = dependencies?.consentStore ?? createMemoryYahooConsentStore();
  const provider = dependencies?.provider ?? createYahooPriceProvider({ consent });
  const router = new MarketDataRouter<YahooPriceRequest, PriceProviderResult, never, never, never, never>({ price: [provider], fx: [], identifier: [] });
  const investingApp = new Hono();

  investingApp.get("/health", (c) => c.json({ ok: true, service: "investing-server" }));
  investingApp.get("/api/config/status", (c) => {
    const keys = new LocalKeySource();
    return c.json({ keys: { llm: keys.getStatus("llm"), marketData: keys.getStatus("market-data") } });
  });
  investingApp.get("/api/market-data/consent", (c) => c.json({ accepted: consent.hasConsent(), disclosure: "Yahoo Finance is niet officieel. De dienst kan zonder waarschuwing stoppen of verzoeken beperken. De voorwaarden beperken geautomatiseerd en commercieel gebruik. LaVega gebruikt Yahoo alleen voor lokaal of zelf gehost persoonlijk gebruik." }));
  investingApp.post("/api/market-data/consent", async (c) => {
    const body: { accepted?: boolean } = await c.req.json<{ accepted?: boolean }>().catch(() => ({ accepted: undefined }));
    if (body.accepted !== true) return c.json({ accepted: false, problem: "Consent must be explicitly accepted" }, 400);
    consent.recordConsent();
    return c.json({ accepted: true });
  });
  investingApp.post("/api/prices/sync", async (c) => {
    if (!consent.hasConsent()) return c.json({ bars: [], fetched: [], problems: ["Yahoo Finance disclosure consent required"] }, 412);
    const body: { symbols?: Array<Omit<YahooPriceRequest, "from" | "to">>; today?: string } = await c.req.json<{ symbols?: Array<Omit<YahooPriceRequest, "from" | "to">>; today?: string }>().catch(() => ({ symbols: undefined, today: undefined }));
    const instruments = body.symbols ?? [];
    const results = await Promise.all(instruments.map((request) => syncPrices({
      store,
      router,
      request: { ...request, today: body.today ?? new Date().toISOString().slice(0, 10) },
    })));
    return c.json({ bars: results.flatMap((result) => result.bars), fetched: results.flatMap((result, index) => result.fetched ? [instruments[index]?.symbol].filter((symbol): symbol is string => Boolean(symbol)) : []), problems: results.flatMap((result) => result.problems) });
  });
  return investingApp;
}

export const app = createApp();
