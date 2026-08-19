import { Hono } from "hono";
import { emptyInvestingDashboard, type InvestingDashboardData } from "@lavega/core";
import { createProblemReporter, type ProblemReporter } from "./observability.js";
import { LocalKeySource, MarketDataRouter, createInMemoryPriceStore, createYahooPriceProvider, createFrankfurterFxProvider, createOpenFigiIdentifierProvider, syncPrices, type PriceProviderResult, type PriceStore, type YahooPriceRequest, type FxRequest, type FxProviderResult, type IdentifierRequest, type IdentifierProviderResult } from "@lavega/adapters";

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
type PriceDependencies = { store: PriceStore; provider: ReturnType<typeof createYahooPriceProvider>; fxProvider: ReturnType<typeof createFrankfurterFxProvider>; identifierProvider: ReturnType<typeof createOpenFigiIdentifierProvider>; brokerSync: (force: boolean) => Promise<{ outcomes: unknown[]; problems: string[] }>; brokerSyncStatus: () => BrokerSyncProgress; configureBroker: (input: BrokerCredentialInput) => Promise<void>; credentialStatus: () => Promise<BrokerVaultStatus>; unlockCredentials: (passphrase: string) => Promise<boolean>; problemReporter: ProblemReporter; dashboardReader: InvestingDashboardReader };
export function createApp(dependencies: Partial<PriceDependencies> = {}) {
  const store = dependencies.store ?? createInMemoryPriceStore();
  const provider = dependencies.provider ?? createYahooPriceProvider();
  const fxProvider = dependencies.fxProvider ?? createFrankfurterFxProvider();
  const identifierProvider = dependencies.identifierProvider ?? createOpenFigiIdentifierProvider();
  const brokerSync = dependencies.brokerSync ?? (async () => ({ outcomes: [], problems: [] }));
  const configureBroker = dependencies.configureBroker;
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
  investingApp.get("/api/brokers/sync/status", (c) => {
    if (!dependencies.brokerSyncStatus) return c.json({ problems: ["Broker synchronization status is not available"] }, 503);
    return c.json(dependencies.brokerSyncStatus());
  });
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
