import { Hono } from "hono";
import { emptyInvestingDashboard, LOCAL_TENANT_ID, validateBenchmarkSymbols, type BenchmarkInstrument, type BenchmarkSelectionStore, type InvestingDashboardData } from "@lavega/core";
import { createProblemReporter, type ProblemReporter } from "./observability.js";
import { LocalKeySource, createInMemoryBenchmarkSelectionStore, createInMemoryPriceStore, createYahooPriceProvider, createFrankfurterFxProvider, createOpenFigiIdentifierProvider, firstProviderResult, hasProblems, searchYahooBenchmarks, syncPrices, type PriceStore, type YahooPriceRequest } from "@lavega/adapters";
import { createPriceOrchestrator, type PriceSyncTarget } from "./priceOrchestrator.js";
import { createInMemoryMarketDataConsentStore, YAHOO_DISCLOSURE_VERSION, type MarketDataConsentStore } from "./marketDataConsent.js";

export type InvestingDashboardReader = (input: { symbol?: string }) => Promise<InvestingDashboardData>;
export type BrokerCredentialInput = { broker: "ibkr" | "trading212"; token: string; queryId?: string; secret?: string; passphrase: string };
export type BrokerSyncProgress = {
  status: "idle" | "running" | "waiting" | "completed" | "problem";
  pages: number;
  ordersRead: number;
  positionsRead: number;
  waitUntil: string | null;
  remaining: number | null;
  updatedAt: string | null;
  message: string | null;
};
type BrokerVaultStatus = "empty" | "locked" | "unlocked";
type PriceDependencies = { store: PriceStore; provider: ReturnType<typeof createYahooPriceProvider>; fxProvider: ReturnType<typeof createFrankfurterFxProvider>; identifierProvider: ReturnType<typeof createOpenFigiIdentifierProvider>; benchmarkSelectionStore: BenchmarkSelectionStore; benchmarkSearch: (query: string) => Promise<{ results: BenchmarkInstrument[]; fallback: boolean; problems: string[] }>; brokerSync: (force: boolean) => Promise<{ outcomes: unknown[]; problems: string[] }>; brokerSyncStatus: () => BrokerSyncProgress; priceSyncTargets: (tenantId: string) => Promise<PriceSyncTarget[]> | PriceSyncTarget[]; priceSyncPaceMs: number; configureBroker: (input: BrokerCredentialInput) => Promise<void>; credentialStatus: () => Promise<BrokerVaultStatus>; unlockCredentials: (passphrase: string) => Promise<boolean>; problemReporter: ProblemReporter; dashboardReader: InvestingDashboardReader; onPriceDataChanged: () => void; marketDataConsentStore: MarketDataConsentStore };
export function createApp(dependencies: Partial<PriceDependencies> = {}) {
  const store = dependencies.store ?? createInMemoryPriceStore();
  const provider = dependencies.provider ?? createYahooPriceProvider();
  const fxProvider = dependencies.fxProvider ?? createFrankfurterFxProvider();
  const identifierProvider = dependencies.identifierProvider ?? createOpenFigiIdentifierProvider();
  const brokerSync = dependencies.brokerSync ?? (async () => ({ outcomes: [], problems: [] }));
  const configureBroker = dependencies.configureBroker;
  const problemReporter = dependencies.problemReporter ?? createProblemReporter();
  const dashboardReader = dependencies.dashboardReader ?? (async () => emptyInvestingDashboard());
  const benchmarkSelectionStore = dependencies.benchmarkSelectionStore ?? createInMemoryBenchmarkSelectionStore();
  const benchmarkSearch = dependencies.benchmarkSearch ?? ((query: string) => searchYahooBenchmarks(query));
  const marketDataConsentStore = dependencies.marketDataConsentStore ?? createInMemoryMarketDataConsentStore();
  const priceProviders = [provider];
  const fxProviders = [fxProvider];
  const identifierProviders = [identifierProvider];
  const mapIdentifier = (request: { isin: string }) => firstProviderResult(identifierProviders, request, undefined, hasProblems);
  const priceOrchestrator = createPriceOrchestrator({
    discover: dependencies.priceSyncTargets ?? (() => []),
    paceMs: dependencies.priceSyncPaceMs,
    sync: async (target) => {
      let request: Omit<YahooPriceRequest, "from" | "to"> & { today?: string; backfillFrom?: string } = target;
      if (target.isin) {
        const identifier = await mapIdentifier({ isin: target.isin });
        if (!identifier || identifier.value.problems.length || !identifier.value.match.ticker || !identifier.value.match.exchange) {
          return { bars: [], fetched: false, problems: identifier?.value.problems ?? ["Could not resolve ISIN"] };
        }
        request = { ...target, ticker: identifier.value.match.ticker, exchange: identifier.value.match.exchange };
      }
      const result = await syncPrices({ store, tenantId: LOCAL_TENANT_ID, priceProviders, request });
      if (result.fetched) dependencies.onPriceDataChanged?.();
      return result;
    },
  });
  const investingApp = new Hono();
  const hasYahooConsent = async () => (await marketDataConsentStore.get("local")).accepted;
  const runPriceSyncIfConsented = async () => {
    if (await hasYahooConsent()) return priceOrchestrator.run("local");
  };
  investingApp.get("/health", (c) => c.json({ ok: true, service: "investing-server" }));
  investingApp.get("/api/investing/dashboard", async (c) => {
    try {
      return c.json(await dashboardReader({ symbol: c.req.query("symbol")?.trim() || undefined }));
    } catch {
      return c.json({ ...emptyInvestingDashboard(), problems: ["Dashboardgegevens konden niet worden geladen"] }, 503);
    }
  });
  investingApp.get("/api/investing/benchmarks", async (c) => c.json(await benchmarkSelectionStore.get("local")));
  investingApp.put("/api/investing/benchmarks", async (c) => {
    const body: { symbols?: unknown } = await c.req.json<{ symbols?: unknown }>().catch(() => ({}));
    const symbols = body.symbols;
    if (!Array.isArray(symbols) || !symbols.every((symbol: unknown) => typeof symbol === "string")) return c.json({ problems: ["symbols must be a string array"] }, 400);
    try {
      const selection = { tenantId: "local", symbols: validateBenchmarkSymbols(symbols as string[]) };
      await benchmarkSelectionStore.set(selection);
      void runPriceSyncIfConsented();
      return c.json(selection);
    } catch (error) {
      return c.json({ problems: [error instanceof Error ? error.message : "Benchmark selection is invalid"] }, 400);
    }
  });
  investingApp.get("/api/investing/benchmarks/search", async (c) => {
    const query = c.req.query("q")?.trim() ?? "";
    if (!(await hasYahooConsent())) return c.json({ consentRequired: true, problems: ["Yahoo Finance-toestemming vereist"] }, 428);
    return c.json(await benchmarkSearch(query));
  });
  investingApp.get("/api/market-data/consent", async (c) => c.json(await marketDataConsentStore.get("local")));
  investingApp.put("/api/market-data/consent", async (c) => {
    const body: { accepted?: unknown } = await c.req.json<{ accepted?: unknown }>().catch(() => ({}));
    if (typeof body.accepted !== "boolean") return c.json({ problems: ["accepted must be boolean"] }, 400);
    const decision = { tenantId: "local", accepted: body.accepted, decidedAt: new Date().toISOString(), disclosureVersion: YAHOO_DISCLOSURE_VERSION };
    await marketDataConsentStore.set(decision);
    if (decision.accepted) void priceOrchestrator.run("local");
    return c.json(decision);
  });
  investingApp.get("/api/config/status", (c) => { const keys = new LocalKeySource(); return c.json({ keys: { llm: keys.getStatus("llm"), marketData: keys.getStatus("market-data") } }); });
  investingApp.get("/api/brokers/sync/status", (c) => {
    if (!dependencies.brokerSyncStatus) return c.json({ problems: ["Broker synchronization status is not available"] }, 503);
    return c.json(dependencies.brokerSyncStatus());
  });
  investingApp.post("/api/brokers/sync", async (c) => {
    try {
      const result = await brokerSync(c.req.query("force") === "true");
      problemReporter({ source: "broker-sync", problems: result.problems });
      void runPriceSyncIfConsented();
      return c.json(result);
    } catch {
      const result = { outcomes: [], problems: ["Broker synchronization failed"] };
      problemReporter({ source: "broker-sync", problems: result.problems });
      return c.json(result, 503);
    }
  });
  investingApp.post("/api/brokers/credentials", async (c) => {
    if (!configureBroker) return c.json({ problems: ["Broker credentials are not available in this server mode"] }, 503);
    const body: Partial<BrokerCredentialInput> = await c.req.json<Partial<BrokerCredentialInput>>().catch(() => ({} as Partial<BrokerCredentialInput>));
    const broker = body.broker;
    if (broker !== "ibkr" && broker !== "trading212") return c.json({ problems: ["broker must be ibkr or trading212"] }, 400);
    if (!body.token?.trim() || !body.passphrase?.trim()) return c.json({ problems: ["token and passphrase are required"] }, 400);
    if (broker === "ibkr" && !body.queryId?.trim()) return c.json({ problems: ["queryId is required for ibkr"] }, 400);
    if (broker === "trading212" && !body.secret?.trim()) return c.json({ problems: ["secret is required for trading212"] }, 400);
    try {
      await configureBroker({ broker, token: body.token.trim(), queryId: body.queryId?.trim(), secret: body.secret?.trim(), passphrase: body.passphrase.trim() });
      return new Response(null, { status: 204 });
    } catch {
      return c.json({ problems: ["Broker credentials could not be stored"] }, 500);
    }
  });
  investingApp.get("/api/brokers/credentials/status", async (c) => {
    if (!dependencies.credentialStatus) return c.json({ problems: ["Broker credential vault is not available"] }, 503);
    try {
      return c.json({ status: await dependencies.credentialStatus() });
    } catch {
      return c.json({ problems: ["Broker credential vault status could not be read"] }, 500);
    }
  });
  investingApp.post("/api/brokers/credentials/unlock", async (c) => {
    if (!dependencies.unlockCredentials) return c.json({ problems: ["Broker credential vault is not available"] }, 503);
    const body: { passphrase?: string } = await c.req.json<{ passphrase?: string }>().catch(() => ({}));
    const passphrase = body.passphrase?.trim();
    if (!passphrase) return c.json({ problems: ["passphrase is required"] }, 400);
    try {
      if (!(await dependencies.unlockCredentials(passphrase))) return c.json({ problems: ["Vault could not be unlocked"] }, 401);
      return new Response(null, { status: 204 });
    } catch {
      return c.json({ problems: ["Vault could not be unlocked"] }, 500);
    }
  });
  investingApp.delete("/api/prices/cache", async (c) => { await store.purgeAll(); dependencies.onPriceDataChanged?.(); return c.json({ deleted: true }); });
  investingApp.get("/api/prices/sync/status", (c) => c.json(priceOrchestrator.status("local")));
  investingApp.get("/api/market-data/fx", async (c) => { const from = c.req.query("from")?.trim().toUpperCase(); const to = c.req.query("to")?.trim().toUpperCase(); if (!from || !to) return c.json({ rate: null, problems: ["from and to currencies are required"] }, 400); const result = await firstProviderResult(fxProviders, { from, to }, undefined, hasProblems); if (!result) return c.json({ rate: null, problems: ["No FX provider returned data"] }, 503); return c.json({ ...result.value, source: result.sourceKey }); });
  investingApp.get("/api/market-data/identifier", async (c) => { const isin = c.req.query("isin")?.trim().toUpperCase(); if (!isin) return c.json({ match: null, problems: ["isin is required"] }, 400); const result = await mapIdentifier({ isin }); if (!result) return c.json({ match: null, problems: ["No identifier provider returned data"] }, 503); return c.json({ ...result.value, source: result.sourceKey }); });
  investingApp.post("/api/prices/sync", async (c) => {
    if (!(await hasYahooConsent())) return c.json({ consentRequired: true, problems: ["Yahoo Finance-toestemming vereist"] }, 428);
    void priceOrchestrator.run("local");
    return c.json(priceOrchestrator.status("local"), 202);
  });
  return investingApp;
}
export const app = createApp();
