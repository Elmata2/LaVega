import { Hono } from "hono";
import {
  emptyInvestingDashboard,
  GICS_SECTOR_LABELS,
  LOCAL_TENANT_ID,
  buildHistoricalRisk,
  validateBenchmarkSymbols,
  validateInvestingLayout,
  type BenchmarkInstrument,
  type BenchmarkSelectionStore,
  type InvestingDashboardData,
  type InvestingLayoutStore,
} from "@lavega/core";
import { createProblemReporter, type ProblemReporter } from "./observability.js";
import {
  LocalKeySource,
  createInMemoryBenchmarkSelectionStore,
  createInMemoryInvestingLayoutStore,
  createInMemoryPriceStore,
  createYahooPriceProvider,
  createFrankfurterFxProvider,
  createOpenFigiIdentifierProvider,
  firstProviderResult,
  hasProblems,
  searchYahooBenchmarks,
  syncPrices,
  type PriceStore,
  type ScheduledBroker,
  type YahooPriceRequest,
} from "@lavega/adapters";
import {
  createInMemoryPriceSyncProgressStore,
  createPriceOrchestrator,
  priceSyncDeadlineMs,
  type PriceSyncProgress,
  type PriceSyncProgressStore,
  type PriceSyncTarget,
} from "./priceOrchestrator.js";
import {
  createInMemoryMarketDataConsentStore,
  YAHOO_DISCLOSURE_VERSION,
  type MarketDataConsentStore,
} from "./marketDataConsent.js";
import {
  createInMemoryPersonalNetWorthStore,
  type PersonalNetWorthStore,
} from "./personalNetWorthStore.js";
import { fetchYahooSectorProfile, YahooHttpClient, type SectorProfile } from "@lavega/adapters";
import {
  createInMemorySectorProfileStore,
  type SectorProfileStore,
} from "./inMemorySectorProfileStore.js";
import {
  resolvePortfolioSectors,
  resolvedStockSector,
  UNKNOWN_SECTOR,
} from "./sectorResolution.js";
import type { SectorClassifier } from "./sectorClassifier.js";
import {
  createInMemorySectorCorrectionStore,
  type SectorCorrectionStore,
} from "./sectorCorrectionStore.js";
import {
  createInMemorySectorInferenceSettingStore,
  type SectorInferenceSettingStore,
} from "./sectorInferenceSetting.js";
import { createServerTiming, type ServerTiming } from "./serverTiming.js";

/** Bounds one /sectors/infer call to this many classifier invocations, so a
 *  portfolio with many unknown symbols can't run one request past a
 *  serverless deadline — the client re-calls for what's left. */
const SECTOR_INFERENCE_BATCH_SIZE = 10;

/** Bounds the `exclude` list a caller may send: a page session's own
 *  accumulated failed symbols, never an unbounded client-supplied array. */
const MAX_SECTOR_INFERENCE_EXCLUDE = 200;

export type InvestingDashboardReader = (input: {
  symbol?: string;
  timing?: ServerTiming;
}) => Promise<InvestingDashboardData>;
export type BrokerCredentialInput = {
  broker: "ibkr" | "trading212";
  token: string;
  queryId?: string;
  secret?: string;
  passphrase?: string;
};
/** Whether the vault behind this runtime is unlocked by a passphrase the user types. */
export type PassphraseMode = "required" | "unused";
export type BrokerSyncProgress = {
  status: "idle" | "running" | "waiting" | "completed" | "problem";
  pages: number;
  ordersRead: number;
  positionsRead: number;
  waitUntil: string | null;
  remaining: number | null;
  updatedAt: string | null;
  message: string | null;
  /** Read back from the durable sync state, so it survives the serverless
   *  invocation that the counters above do not. Without it a mounted deployment
   *  can only ever report "idle" and never says whether history finished. */
  history: BrokerHistoryProgress | null;
};

/** Per broker, whether each paginated history ran to its last page. */
export type BrokerHistoryProgress = Record<
  ScheduledBroker,
  {
    lastSyncedAt: string | null;
    retryAfter: string | null;
    ordersComplete: boolean;
    transactionsComplete: boolean;
    dividendsComplete: boolean;
  }
>;
export type InvestingHealth = {
  status: "ok" | "degraded" | "down";
  storage: "neon" | "file";
  checks: {
    database: "ok" | "not-configured" | "down";
    migrationLedger: "ok" | "not-applicable" | "down";
    /** Whether Postgres itself keeps tenants apart: a role that bypasses RLS
     *  leaves only application code between one user's rows and another's. */
    tenantIsolation: "enforced" | "not-applicable" | "down";
    vault: "ok" | "empty" | "locked" | "down";
    trading212Credentials: "configured" | "missing" | "down";
    trading212Sync: "fresh" | "stale" | "never" | "problem" | "down";
    snapshot: "loaded" | "empty" | "down";
  };
  trading212: { lastSyncedAt: string | null; positions: number };
};
type BrokerVaultStatus = "empty" | "locked" | "unlocked";
type BrokerReadability = Record<"ibkr" | "trading212", "empty" | "readable" | "unreadable">;
type PriceDependencies = {
  store: PriceStore;
  provider: ReturnType<typeof createYahooPriceProvider>;
  fxProvider: ReturnType<typeof createFrankfurterFxProvider>;
  identifierProvider: ReturnType<typeof createOpenFigiIdentifierProvider>;
  benchmarkSelectionStore: BenchmarkSelectionStore;
  investingLayoutStore: InvestingLayoutStore;
  benchmarkSearch: (
    query: string,
  ) => Promise<{ results: BenchmarkInstrument[]; fallback: boolean; problems: string[] }>;
  brokerSync: (
    force: boolean,
    deadlineMs?: number,
    rebuildOrders?: boolean,
  ) => Promise<{ outcomes: unknown[]; problems: string[] }>;
  brokerSyncStatus: () => BrokerSyncProgress | Promise<BrokerSyncProgress>;
  priceSyncTargets: (tenantId: string) => Promise<PriceSyncTarget[]> | PriceSyncTarget[];
  priceSyncPaceMs: number;
  priceSyncBenchmarkRecheckEveryMs: number;
  priceSyncProgressStore: PriceSyncProgressStore;
  priceSyncDeadline: () => number | undefined;
  configureBroker: (input: BrokerCredentialInput) => Promise<void>;
  credentialStatus: () => Promise<BrokerVaultStatus>;
  brokerReadability: () => Promise<BrokerReadability | undefined>;
  unlockCredentials: (passphrase: string) => Promise<boolean>;
  problemReporter: ProblemReporter;
  dashboardReader: InvestingDashboardReader;
  onPriceDataChanged: () => void;
  marketDataConsentStore: MarketDataConsentStore;
  personalNetWorthStore: PersonalNetWorthStore;
  sectorProfile: (symbol: string) => Promise<SectorProfile | null>;
  sectorStore: SectorProfileStore;
  sectorCorrectionStore: SectorCorrectionStore;
  sectorInferenceSettingStore: SectorInferenceSettingStore;
  sectorClassifier?: SectorClassifier;
  resolveTenantId: () => string | Promise<string>;
  passphraseMode: () => PassphraseMode;
  healthCheck: () => Promise<InvestingHealth>;
};
export function createApp(dependencies: Partial<PriceDependencies> = {}) {
  const store = dependencies.store ?? createInMemoryPriceStore();
  const provider = dependencies.provider ?? createYahooPriceProvider();
  const fxProvider = dependencies.fxProvider ?? createFrankfurterFxProvider();
  const identifierProvider = dependencies.identifierProvider ?? createOpenFigiIdentifierProvider();
  const brokerSync = dependencies.brokerSync ?? (async () => ({ outcomes: [], problems: [] }));
  const configureBroker = dependencies.configureBroker;
  const problemReporter = dependencies.problemReporter ?? createProblemReporter();
  const dashboardReader = dependencies.dashboardReader ?? (async () => emptyInvestingDashboard());
  const benchmarkSelectionStore =
    dependencies.benchmarkSelectionStore ?? createInMemoryBenchmarkSelectionStore();
  const investingLayoutStore =
    dependencies.investingLayoutStore ?? createInMemoryInvestingLayoutStore();
  const benchmarkSearch =
    dependencies.benchmarkSearch ?? ((query: string) => searchYahooBenchmarks(query));
  const marketDataConsentStore =
    dependencies.marketDataConsentStore ?? createInMemoryMarketDataConsentStore();
  const personalNetWorthStore =
    dependencies.personalNetWorthStore ?? createInMemoryPersonalNetWorthStore();
  /* One client per running server process, not per symbol: its crumb and
   * cookie are negotiated once (see YahooHttpClient.ensureCrumb) and reused,
   * instead of every cache-miss symbol paying its own crumb negotiation. */
  const sectorHttpClient = new YahooHttpClient();
  const sectorProfile =
    dependencies.sectorProfile ??
    ((symbol: string) => fetchYahooSectorProfile(symbol, sectorHttpClient));
  const sectorStore = dependencies.sectorStore ?? createInMemorySectorProfileStore();
  const sectorCorrectionStore =
    dependencies.sectorCorrectionStore ?? createInMemorySectorCorrectionStore();
  const sectorInferenceSettingStore =
    dependencies.sectorInferenceSettingStore ?? createInMemorySectorInferenceSettingStore();
  /* Who the request belongs to. Standalone and local runs have a single tenant;
   * mounted behind the personal server this resolves to the signed-in user. */
  const resolveTenantId = dependencies.resolveTenantId ?? (() => LOCAL_TENANT_ID);
  /* The file vault derives its key from a passphrase, so it needs one. A vault
   * the server holds the key to has nothing to ask for. */
  const passphraseMode = dependencies.passphraseMode ?? (() => "required" as const);
  const priceProviders = [provider];
  const fxProviders = [fxProvider];
  const identifierProviders = [identifierProvider];
  const mapIdentifier = (request: { isin: string }) =>
    firstProviderResult(identifierProviders, request, undefined, hasProblems);
  /* One invocation's worth of time. Anchored where the request starts, so a
   * route that already spent the host budget on a broker sync hands the price
   * run a deadline that has passed and it pauses instead of overrunning. */
  const priceSyncDeadline =
    dependencies.priceSyncDeadline ??
    (() => priceSyncDeadlineMs((name) => process.env[name]?.trim() || undefined));
  const priceOrchestrator = createPriceOrchestrator({
    discover: dependencies.priceSyncTargets ?? (() => []),
    paceMs: dependencies.priceSyncPaceMs,
    benchmarkRecheckEveryMs: dependencies.priceSyncBenchmarkRecheckEveryMs,
    progressStore: dependencies.priceSyncProgressStore ?? createInMemoryPriceSyncProgressStore(),
    sync: async (target, tenantId) => {
      let request: Omit<YahooPriceRequest, "from" | "to"> & {
        today?: string;
        backfillFrom?: string;
      } = target;
      let identifierProblems: string[] = [];
      if (target.isin) {
        const identifier = await mapIdentifier({ isin: target.isin });
        if (
          identifier &&
          identifier.value.problems.length === 0 &&
          identifier.value.match.ticker &&
          identifier.value.match.exchange
        ) {
          request = {
            ...target,
            ticker: identifier.value.match.ticker,
            exchange: identifier.value.match.exchange,
          };
        } else {
          identifierProblems = identifier?.value.problems ?? ["Could not resolve ISIN"];
        }
      }
      const result = await syncPrices({ store, tenantId, priceProviders, request });
      if (result.fetched) dependencies.onPriceDataChanged?.();
      return result.problems.length === 0
        ? result
        : { ...result, problems: [...identifierProblems, ...result.problems] };
    },
  });
  const investingApp = new Hono();
  const hasYahooConsent = async (tenantId: string) =>
    (await marketDataConsentStore.get(tenantId)).accepted;
  const runPriceSyncIfConsented = async (tenantId: string, deadline: number | undefined) => {
    if (await hasYahooConsent(tenantId)) return priceOrchestrator.run(tenantId, deadline);
  };
  const visiblePriceProgress = (progress: PriceSyncProgress): PriceSyncProgress => {
    const visible = { ...progress };
    delete visible.leaseId;
    return visible;
  };
  /* A run that stopped on the budget is not finished, and the caller is the
   * one who can continue it. 202 is that difference, stated in the status
   * line rather than only in the body. */
  const priceSyncStatusCode = (progress: PriceSyncProgress) =>
    progress.status === "completed" || progress.status === "problem" ? 200 : 202;
  /* Twice, on purpose. `/health` is what a container health check and the
   * standalone server ask for; `/api/investing/health` is the same answer on a
   * path the mount forwards, because everything outside /api/ belongs to the
   * SPA there and never reaches this app. */
  const health = (c: { json: (body: unknown) => Response }) =>
    c.json({ ok: true, service: "investing-server" });
  investingApp.get("/health", health);
  investingApp.get("/api/investing/health", health);
  investingApp.get("/api/investing/health/detail", async (c) => {
    if (!dependencies.healthCheck)
      return c.json({ problems: ["Detailed health is not available"] }, 503);
    try {
      const report = await dependencies.healthCheck();
      return c.json(report, report.status === "ok" ? 200 : 503);
    } catch {
      return c.json({ problems: ["Detailed health check failed"] }, 503);
    }
  });
  /* This app never mounts real auth (single local tenant, no session).
   * apps/server signals that with 503 on /api/auth/* when DATABASE_URL /
   * BETTER_AUTH_SECRET are unset; match that here so investing-web's
   * RequireAuth renders unguarded on standalone instead of reading the
   * default Hono 404 as "anonymous" and redirecting to /sign-in. */
  investingApp.all("/api/auth/*", (c) =>
    c.json({ message: "Authentication is not configured" }, 503),
  );
  investingApp.get("/api/investing/summary", async (c) => {
    try {
      const range = c.req.query("range") ?? "1Y";
      if (range !== "6M" && range !== "1Y" && range !== "All")
        return c.json({ message: "Invalid risk range" }, 400);
      const data = await dashboardReader({});
      const benchmark = c.req.query("benchmark");
      if (benchmark && !data.benchmarks.some((item) => item.symbol === benchmark))
        return c.json({ message: "Select a configured benchmark" }, 400);
      const priced = data.positions.filter(
        (position): position is typeof position & { marketValue: number } =>
          position.marketValue !== null && position.marketValue > 0,
      );
      const totalValue = priced.reduce((sum, position) => sum + position.marketValue, 0);
      const topPositions = [...priced]
        .sort((left, right) => right.marketValue - left.marketValue)
        .slice(0, 5)
        .map((position) => ({
          symbol: position.symbol,
          weight: totalValue > 0 ? position.marketValue / totalValue : 0,
          ...(position.description ? { description: position.description } : {}),
        }));
      /* Same classification rule as the portfolio-agent snapshot, which
       * passes no fetchProfile. This route keeps the fetch-and-persist
       * fallback; only the resolution itself is shared. Without consent,
       * omit fetchProfile entirely: resolvePortfolioSectors still answers
       * from cached profiles, it just never calls Yahoo for a fresh one.
       * classifier is never passed here: classification runs off this
       * critical path, only from POST /api/investing/sectors/infer. */
      const tenantId = await resolveTenantId();
      const consented = await hasYahooConsent(tenantId);
      /* A cached inferred profile is a global fact (no tenantId on
       * sector_profiles), so it's visible here only when this tenant has
       * both consented to Yahoo/AI data use and turned inference on —
       * otherwise it displays as Unknown, same as never having been
       * classified (I1, #135 final review). Two cheap reads, no network. */
      const inferenceEnabled = await sectorInferenceSettingStore.get(tenantId);
      const corrections = await sectorCorrectionStore.getAll(tenantId);
      const { exposure, coverage } = await resolvePortfolioSectors(data.positions, {
        store: sectorStore,
        correction: async (symbol) => corrections[symbol.toUpperCase()] ?? null,
        showInferred: consented && inferenceEnabled,
        ...(consented ? { fetchProfile: sectorProfile } : {}),
      });
      return c.json({
        ...buildHistoricalRisk(data, range, benchmark),
        sectors: exposure,
        sectorCoverage: coverage,
        topPositions,
        composition: {
          pricedHoldings: priced.length,
          missingHoldings: data.positions.filter((position) => position.marketValue === null)
            .length,
          estimatedHoldings: data.positions.filter(
            (position) => position.priceStatus === "forward-filled",
          ).length,
        },
      });
    } catch {
      return c.json({ problems: ["Portfolio summary could not be assembled"] }, 503);
    }
  });
  investingApp.get("/api/investing/positions/:symbol/sector", async (c) => {
    const symbol = c.req.param("symbol");
    const tenantId = await resolveTenantId();
    /* Same precedence as resolveWeights: read the cached profile before the
     * correction, so a fund always wins. Read-only — no fetchProfile, no
     * classifier, no store write. */
    const profile = await sectorStore.get(symbol);
    if (profile?.kind === "fund")
      return c.json({ kind: "fund" as const, sector: null, source: "provider" as const });
    const corrected = await sectorCorrectionStore.get(tenantId, symbol);
    if (corrected)
      return c.json({ kind: "stock" as const, sector: corrected, source: "correction" as const });
    if (!profile)
      return c.json({
        kind: "unknown" as const,
        sector: UNKNOWN_SECTOR,
        source: "unknown" as const,
      });
    /* Same visibility rule as the summary route (I1, #135 final review): an
     * inferred profile this tenant isn't allowed to see reads as Unknown. */
    const consented = await hasYahooConsent(tenantId);
    const inferenceEnabled = await sectorInferenceSettingStore.get(tenantId);
    const resolved = resolvedStockSector(profile, { showInferred: consented && inferenceEnabled });
    return c.json({
      kind: "stock" as const,
      sector: resolved.sector,
      source: resolved.source,
      ...(resolved.confidence !== undefined ? { confidence: resolved.confidence } : {}),
    });
  });
  investingApp.put("/api/investing/positions/:symbol/sector", async (c) => {
    const symbol = c.req.param("symbol");
    const body: { sector?: unknown } = await c.req.json().catch(() => ({}));
    if (typeof body.sector !== "string" || !GICS_SECTOR_LABELS.includes(body.sector as never))
      return c.json({ message: "sector must be one of the GICS sector labels" }, 400);
    const profile = await sectorStore.get(symbol);
    if (profile?.kind === "fund")
      return c.json(
        { message: "A fund's sector is its look-through weight vector, not a single correction" },
        422,
      );
    await sectorCorrectionStore.set(await resolveTenantId(), symbol, body.sector);
    return c.body(null, 204);
  });
  investingApp.delete("/api/investing/positions/:symbol/sector", async (c) => {
    await sectorCorrectionStore.clear(await resolveTenantId(), c.req.param("symbol"));
    return c.body(null, 204);
  });
  investingApp.get("/api/investing/sector-inference", async (c) =>
    c.json({
      enabled: await sectorInferenceSettingStore.get(await resolveTenantId()),
      /* The switch is per-tenant, but a classifier is per-deployment (a
       * configured TypeSafe key). Without this the Profile page could let
       * an owner turn inference "on" on a server that can never run it. */
      available: dependencies.sectorClassifier !== undefined,
    }),
  );
  investingApp.put("/api/investing/sector-inference", async (c) => {
    const body: { enabled?: unknown } = await c.req.json().catch(() => ({}));
    if (typeof body.enabled !== "boolean")
      return c.json({ message: "enabled must be boolean" }, 400);
    await sectorInferenceSettingStore.set(await resolveTenantId(), body.enabled);
    return c.json({ enabled: body.enabled });
  });
  investingApp.post("/api/investing/sectors/infer", async (c) => {
    const tenantId = await resolveTenantId();
    if (!(await hasYahooConsent(tenantId)))
      return c.json({ problems: ["Yahoo Finance consent required"] }, 428);
    if (!(await sectorInferenceSettingStore.get(tenantId)))
      return c.json({ problems: ["Sector inference is not enabled"] }, 428);
    if (!dependencies.sectorClassifier)
      return c.json({ classified: 0, failed: 0, failedSymbols: [], remaining: 0 });
    const body: { exclude?: unknown } = await c.req.json().catch(() => ({}));
    let excluded = new Set<string>();
    if (body.exclude !== undefined) {
      if (
        !Array.isArray(body.exclude) ||
        !body.exclude.every((symbol) => typeof symbol === "string")
      )
        return c.json({ problems: ["exclude must be a string array"] }, 400);
      excluded = new Set(
        body.exclude.slice(0, MAX_SECTOR_INFERENCE_EXCLUDE).map((symbol) => symbol.toUpperCase()),
      );
    }
    const data = await dashboardReader({});
    const priced = data.positions.filter(
      (position): position is typeof position & { marketValue: number } =>
        position.marketValue !== null && position.marketValue > 0,
    );
    const corrections = await sectorCorrectionStore.getAll(tenantId);
    const seen = new Set<string>();
    const candidates: typeof priced = [];
    for (const position of priced) {
      const key = position.symbol.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      /* A symbol the caller already saw fail this page session (the client
       * fills `exclude` with it) is skipped so the same head-of-line
       * candidates aren't retried forever ahead of ones that might succeed. */
      if (excluded.has(key)) continue;
      if (corrections[key]) continue;
      if (await sectorStore.get(position.symbol)) continue;
      candidates.push(position);
    }
    const batch = candidates.slice(0, SECTOR_INFERENCE_BATCH_SIZE);
    /* classified counts symbols actually cached this round (classified or
     * no-match), never batch.length — a classifier failure leaves the
     * symbol uncached, and reporting it as classified anyway is what let
     * the client refresh forever on the same always-failing symbols
     * (#135 final review, C1). */
    const cachedThisRound = new Set<string>();
    const trackingStore: SectorProfileStore = {
      get: (symbol) => sectorStore.get(symbol),
      async set(symbol, profile) {
        cachedThisRound.add(symbol.toUpperCase());
        await sectorStore.set(symbol, profile);
      },
    };
    await resolvePortfolioSectors(batch, {
      store: trackingStore,
      classifier: dependencies.sectorClassifier,
    });
    const failedSymbols = batch
      .map((position) => position.symbol.toUpperCase())
      .filter((symbol) => !cachedThisRound.has(symbol));
    return c.json({
      classified: cachedThisRound.size,
      failed: failedSymbols.length,
      failedSymbols,
      remaining: candidates.length - batch.length,
    });
  });
  investingApp.get("/api/investing/dashboard", async (c) => {
    const timing = createServerTiming();
    try {
      const symbol = c.req.query("symbol")?.trim() || undefined;
      const dashboard = await timing.measure("total", () => dashboardReader({ symbol, timing }));
      c.header("Server-Timing", timing.header());
      if (!dependencies.brokerReadability) return c.json(dashboard);
      try {
        const readability = await dependencies.brokerReadability();
        const unreadable = (["ibkr", "trading212"] as const).filter(
          (broker) => readability?.[broker] === "unreadable",
        );
        return c.json({
          ...dashboard,
          problems: [
            ...dashboard.problems,
            ...unreadable.map(
              (broker) =>
                `${broker === "ibkr" ? "IBKR" : "Trading 212"} credentials cannot be read. Reconnect broker to restore data.`,
            ),
          ],
        });
      } catch {
        return c.json({
          ...dashboard,
          problems: [
            ...dashboard.problems,
            "Broker connection status could not be checked. Showing available data.",
          ],
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dashboard data could not be loaded";
      problemReporter({ source: "dashboard-read", problems: [message] });
      c.header("Server-Timing", timing.header());
      return c.json({
        ...emptyInvestingDashboard(),
        problems: ["Dashboard data could not be loaded"],
      });
    }
  });
  investingApp.get("/api/investing/benchmarks", async (c) =>
    c.json(await benchmarkSelectionStore.get(await resolveTenantId())),
  );
  investingApp.put("/api/investing/benchmarks", async (c) => {
    const body: { symbols?: unknown } = await c.req.json<{ symbols?: unknown }>().catch(() => ({}));
    const symbols = body.symbols;
    if (!Array.isArray(symbols) || !symbols.every((symbol: unknown) => typeof symbol === "string"))
      return c.json({ problems: ["symbols must be a string array"] }, 400);
    try {
      const tenantId = await resolveTenantId();
      const selection = { tenantId, symbols: validateBenchmarkSymbols(symbols as string[]) };
      await benchmarkSelectionStore.set(selection);
      return c.json(selection);
    } catch (error) {
      return c.json(
        { problems: [error instanceof Error ? error.message : "Benchmark selection is invalid"] },
        400,
      );
    }
  });
  investingApp.get("/api/investing/benchmarks/search", async (c) => {
    const query = c.req.query("q")?.trim() ?? "";
    if (!(await hasYahooConsent(await resolveTenantId())))
      return c.json({ consentRequired: true, problems: ["Yahoo Finance consent required"] }, 428);
    return c.json(await benchmarkSearch(query));
  });
  investingApp.get("/api/investing/layout", async (c) =>
    c.json(await investingLayoutStore.get(await resolveTenantId())),
  );
  investingApp.put("/api/investing/layout", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return c.json({ problems: ["layout must be a JSON object"] }, 400);
    const layout = validateInvestingLayout(body);
    const tenantId = await resolveTenantId();
    await investingLayoutStore.set({ tenantId, ...layout });
    return c.json(layout);
  });
  /* The owner's opt-in Personal totals, read-only here — Personal owns the
   * only write, through apps/server's PUT/DELETE /api/personal/net-worth-total.
   * Deliberately outside the cached dashboard: it is one small per-user table,
   * cheap to read fresh on every request, and folding it into the dashboard's
   * cache/version machinery would risk a stale total surviving a new one. */
  investingApp.get("/api/investing/personal-net-worth", async (c) =>
    c.json({ totals: await personalNetWorthStore.list(await resolveTenantId()) }),
  );
  investingApp.get("/api/market-data/consent", async (c) =>
    c.json(await marketDataConsentStore.get(await resolveTenantId())),
  );
  investingApp.put("/api/market-data/consent", async (c) => {
    const body: { accepted?: unknown } = await c.req
      .json<{ accepted?: unknown }>()
      .catch(() => ({}));
    if (typeof body.accepted !== "boolean")
      return c.json({ problems: ["accepted must be boolean"] }, 400);
    const tenantId = await resolveTenantId();
    const decision = {
      tenantId,
      accepted: body.accepted,
      decidedAt: new Date().toISOString(),
      disclosureVersion: YAHOO_DISCLOSURE_VERSION,
    };
    await marketDataConsentStore.set(decision);
    return c.json(decision);
  });
  investingApp.get("/api/config/status", (c) => {
    const keys = new LocalKeySource();
    return c.json({
      keys: { llm: keys.getStatus("llm"), marketData: keys.getStatus("market-data") },
    });
  });
  investingApp.get("/api/brokers/sync/status", async (c) => {
    if (!dependencies.brokerSyncStatus)
      return c.json({ problems: ["Broker synchronization status is not available"] }, 503);
    return c.json(await dependencies.brokerSyncStatus());
  });
  investingApp.post("/api/brokers/sync", async (c) => {
    const deadline = priceSyncDeadline();
    try {
      const result = await brokerSync(
        c.req.query("force") === "true",
        deadline,
        c.req.query("rebuildOrders") === "true",
      );
      problemReporter({ source: "broker-sync", problems: result.problems });
      /* Awaited, not detached. Work started after the response is not
       * guaranteed to run at all on a serverless host, which is how prices
       * went months without a bar while every call looked successful. */
      await runPriceSyncIfConsented(await resolveTenantId(), deadline);
      return c.json(result);
    } catch {
      const result = { outcomes: [], problems: ["Broker synchronization failed"] };
      problemReporter({ source: "broker-sync", problems: result.problems });
      return c.json(result, 503);
    }
  });
  investingApp.post("/api/brokers/credentials", async (c) => {
    if (!configureBroker)
      return c.json(
        { problems: ["Broker credentials are not available in this server mode"] },
        503,
      );
    const body: Partial<BrokerCredentialInput> = await c.req
      .json<Partial<BrokerCredentialInput>>()
      .catch(() => ({}) as Partial<BrokerCredentialInput>);
    const broker = body.broker;
    if (broker !== "ibkr" && broker !== "trading212")
      return c.json({ problems: ["broker must be ibkr or trading212"] }, 400);
    if (!body.token?.trim()) return c.json({ problems: ["token is required"] }, 400);
    if (passphraseMode() === "required" && !body.passphrase?.trim())
      return c.json({ problems: ["passphrase is required"] }, 400);
    if (broker === "ibkr" && !body.queryId?.trim())
      return c.json({ problems: ["queryId is required for ibkr"] }, 400);
    /* TRADING 212 GEBRUIKT EEN SLEUTELPAAR, en dat is hier eerder verkeerd
     * gelezen. Hun documentatie is er eenduidig over: "You must provide your
     * API Key as the username and your API Secret as the password, formatted
     * as an HTTP Basic Authentication header."
     *
     * Deze eis stond er dus terecht. Hij is één ronde lang weggehaald op de
     * aanname dat Trading 212 één credential uitgeeft — die aanname was fout,
     * en het gevolg was erger dan de oorspronkelijke wrijving: je kon opslaan
     * met een leeg geheim, wat `base64("key:")` oplevert, en dat kan per
     * definitie nooit authenticeren. Een 401 waar het formulier zelf de oorzaak
     * van was. */
    if (broker === "trading212" && !body.secret?.trim())
      return c.json({ problems: ["secret is required for trading212"] }, 400);
    try {
      await configureBroker({
        broker,
        token: body.token.trim(),
        queryId: body.queryId?.trim(),
        secret: body.secret?.trim(),
        passphrase: body.passphrase?.trim(),
      });
      return new Response(null, { status: 204 });
    } catch {
      return c.json({ problems: ["Broker credentials could not be stored"] }, 500);
    }
  });
  investingApp.get("/api/brokers/credentials/status", async (c) => {
    if (!dependencies.credentialStatus)
      return c.json({ problems: ["Broker credential vault is not available"] }, 503);
    try {
      return c.json({
        status: await dependencies.credentialStatus(),
        passphrase: passphraseMode(),
        ...(dependencies.brokerReadability
          ? { brokers: await dependencies.brokerReadability() }
          : {}),
      });
    } catch {
      return c.json({ problems: ["Broker credential vault status could not be read"] }, 500);
    }
  });
  investingApp.post("/api/brokers/credentials/unlock", async (c) => {
    if (!dependencies.unlockCredentials)
      return c.json({ problems: ["Broker credential vault is not available"] }, 503);
    const body: { passphrase?: string } = await c.req
      .json<{ passphrase?: string }>()
      .catch(() => ({}));
    const passphrase = body.passphrase?.trim();
    if (!passphrase) return c.json({ problems: ["passphrase is required"] }, 400);
    try {
      if (!(await dependencies.unlockCredentials(passphrase)))
        return c.json({ problems: ["Vault could not be unlocked"] }, 401);
      return new Response(null, { status: 204 });
    } catch {
      return c.json({ problems: ["Vault could not be unlocked"] }, 500);
    }
  });
  investingApp.delete("/api/prices/cache", async (c) => {
    await store.purgeAll();
    dependencies.onPriceDataChanged?.();
    return c.json({ deleted: true });
  });
  investingApp.get("/api/prices/sync/status", async (c) =>
    c.json(visiblePriceProgress(await priceOrchestrator.status(await resolveTenantId()))),
  );
  investingApp.get("/api/market-data/fx", async (c) => {
    const from = c.req.query("from")?.trim().toUpperCase();
    const to = c.req.query("to")?.trim().toUpperCase();
    if (!from || !to)
      return c.json({ rate: null, problems: ["from and to currencies are required"] }, 400);
    const result = await firstProviderResult(fxProviders, { from, to }, undefined, hasProblems);
    if (!result) return c.json({ rate: null, problems: ["No FX provider returned data"] }, 503);
    return c.json({ ...result.value, source: result.sourceKey });
  });
  investingApp.get("/api/market-data/identifier", async (c) => {
    const isin = c.req.query("isin")?.trim().toUpperCase();
    if (!isin) return c.json({ match: null, problems: ["isin is required"] }, 400);
    const result = await mapIdentifier({ isin });
    if (!result)
      return c.json({ match: null, problems: ["No identifier provider returned data"] }, 503);
    return c.json({ ...result.value, source: result.sourceKey });
  });
  investingApp.post("/api/prices/sync", async (c) => {
    const tenantId = await resolveTenantId();
    if (!(await hasYahooConsent(tenantId)))
      return c.json({ consentRequired: true, problems: ["Yahoo Finance consent required"] }, 428);
    const progress = await priceOrchestrator.run(tenantId, priceSyncDeadline());
    return c.json(visiblePriceProgress(progress), priceSyncStatusCode(progress));
  });
  return investingApp;
}
export const app = createApp();
