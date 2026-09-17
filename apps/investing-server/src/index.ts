import {
  app,
  createApp,
  type BrokerCredentialInput,
  type BrokerHistoryProgress,
  type BrokerSyncProgress,
  type InvestingDashboardReader,
} from "./app.js";
import {
  createFileAgentRunStore,
  type AgentRunRecord,
  type AgentRunStore,
} from "./fileAgentRunStore.js";
import {
  createPortfolioAgentTools,
  getPortfolioAgent,
  listPortfolioAgents,
  runPortfolioAgent,
  type PortfolioAgentId,
  type PortfolioAgentInsight,
  type RunPortfolioAgentOptions,
} from "./portfolioAgent.js";
import { createProblemReporter } from "./observability.js";
import {
  buildInvestingDashboard,
  type BenchmarkSelectionStore,
  type InvestingDashboardData,
} from "@lavega/core";
import {
  createBrokerDataCache,
  createCredentialsAwareBrokerAdapters,
  createFrankfurterFxProvider,
  createInMemoryBenchmarkSelectionStore,
  SCHEDULED_BROKERS,
  syncScheduledBrokers,
  type BrokerSyncOperationStore,
  type PriceStore,
  type ScheduledSyncResult,
  type Trading212DiagnosticEvent,
} from "@lavega/adapters";
import { createFileCredentialStore } from "./fileCredentialStore.js";
import {
  createRuntimeCredentialStore,
  credentialsArePerTenant,
  runtimeDatabase,
  type RuntimeCredentialStore as RuntimeCredentialStoreType,
} from "./credentialStore.js";
import {
  createNeonAgentRunStore,
  createNeonBrokerSyncStateStore,
  createNeonPriceSyncProgressStore,
} from "./neonStores.js";
import {
  createFileBrokerSyncStateStore,
  runtimeBrokerSyncStateFile,
} from "./fileBrokerSyncStateStore.js";
import {
  createInMemoryMarketDataConsentStore,
  type MarketDataConsentStore,
} from "./marketDataConsent.js";
import { createFileSectorProfileStore, runtimeSectorStoreFile } from "./fileSectorProfileStore.js";
import {
  createDevFixtureBrokerData,
  createDevFixtureFxProvider,
  createDevFixturePriceBars,
} from "./devFixture.js";
import {
  createInMemoryPriceSyncProgressStore,
  discoverPriceSyncTargets,
} from "./priceOrchestrator.js";
import { readPriceBars } from "./priceReader.js";

export { app };

const LOCAL_TENANT_ID = "local";
const DASHBOARD_CACHE_TTL_MS = 15_000;

function environment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

type RuntimeCredentialStore = RuntimeCredentialStoreType;

export function createRuntimeBrokerCredentialSetup(
  credentials: RuntimeCredentialStore,
  onUnlocked?: () => void | Promise<void>,
  tenantId: string = LOCAL_TENANT_ID,
) {
  return async (input: BrokerCredentialInput): Promise<void> => {
    const status = await credentials.status();
    if (status === "empty") await credentials.setup(input.passphrase ?? "");
    else if (!(await credentials.unlock(input.passphrase ?? "")))
      throw new Error("Vault passphrase is incorrect");
    await onUnlocked?.();
    if (input.broker === "ibkr") {
      await credentials.putCredentials({
        broker: "ibkr",
        tenantId,
        token: input.token,
        queryId: input.queryId!,
      });
    } else {
      await credentials.putCredentials({
        broker: "trading212",
        tenantId,
        token: input.token,
        secret: input.secret!,
      });
    }
  };
}

/* No process-local dedupe: the claim in the store is what stops two runs, and
 * it holds across instances and restarts, which a promise in one process never
 * did. */
export function createRuntimeBrokerSync(
  onCompleted?: (result: ScheduledSyncResult) => void | Promise<void>,
  credentials = createFileCredentialStore(),
  operations: BrokerSyncOperationStore = createFileBrokerSyncStateStore(),
  onTrading212Diagnostic?: (event: Trading212DiagnosticEvent) => void,
  tenantId: string = LOCAL_TENANT_ID,
): (force: boolean, deadlineMs?: number) => Promise<ScheduledSyncResult> {
  const entity = environment("LAVEGA_INVESTING_ENTITY") ?? "personal";
  const adapters = createCredentialsAwareBrokerAdapters({
    credentials,
    tenantId,
    onTrading212Diagnostic,
  });
  return async (force, deadlineMs) => {
    const result = await syncScheduledBrokers({
      adapters,
      credentials,
      operations,
      tenantId,
      entity,
      force,
      deadlineMs,
    });
    await onCompleted?.(result);
    return result;
  };
}

export type PortfolioAgentRunner = (
  options: RunPortfolioAgentOptions & { prompt: string },
) => Promise<PortfolioAgentInsight | string>;
export type RuntimeAppOptions = {
  priceStore: PriceStore;
  resolveTenantId?: () => string | Promise<string>;
  benchmarkSelectionStore?: BenchmarkSelectionStore;
  benchmarkSymbols?: (tenantId: string) => Promise<string[]> | string[];
  marketDataConsentStore?: MarketDataConsentStore;
  agentRunStore?: AgentRunStore;
  runAgent?: PortfolioAgentRunner;
};

export type RuntimeApp = ReturnType<typeof createApp> & {
  runPortfolioAgentOnce: (
    agentId?: PortfolioAgentId,
    model?: string,
    prompt?: string,
  ) => Promise<AgentRunRecord>;
};

const PORTFOLIO_AGENT_PROMPT = [
  "You are the portfolio health assistant of a personal investing dashboard.",
  "Use the read-only tools to look at the current positions, prices and total portfolio value, then summarize the portfolio's health in at most five sentences:",
  "total value, largest position, and anything that looks off such as missing prices or empty broker data.",
].join(" ");

function normalizePortfolioAgentInsight(
  value: PortfolioAgentInsight | string,
  agentId: PortfolioAgentId,
): PortfolioAgentInsight {
  if (typeof value !== "string") return value;
  const agent = getPortfolioAgent(agentId);
  return {
    agentId: agent.id,
    displayName: agent.displayName,
    signal: "neutral",
    confidence: 0,
    summary: value,
    reasoning: value,
    insights: [],
    model: "injected",
    snapshotHash: "",
  };
}

/* The merge rules and the snapshot shape live with the sync that produces
 * them. The runtime keeps the name it has always exported. */
export { createBrokerDataCache as createRuntimeBrokerDataCache };

export async function createRuntimeApp(options: RuntimeAppOptions) {
  const dsn = process.env.SENTRY_DSN;
  const priceStore = options.priceStore;
  const benchmarkSelectionStore =
    options.benchmarkSelectionStore ?? createInMemoryBenchmarkSelectionStore();
  const marketDataConsentStore =
    options.marketDataConsentStore ?? createInMemoryMarketDataConsentStore();
  const devFixtureEnabled = environment("INVESTING_DEV_FIXTURE") === "1";
  const fxProvider = devFixtureEnabled
    ? createDevFixtureFxProvider()
    : createFrankfurterFxProvider();
  let priceDataVersion = 0;
  const onPriceDataChanged = () => {
    priceDataVersion += 1;
  };
  const resolveTenantId = options.resolveTenantId ?? (() => LOCAL_TENANT_ID);
  const database = runtimeDatabase();
  const agentRunStore =
    options.agentRunStore ??
    (database ? createNeonAgentRunStore(database, resolveTenantId) : createFileAgentRunStore());
  /* Progress belongs next to the data on a hosted deployment, where the status
   * poll and the run that answers it are different instances. A local process
   * is both, so memory is the whole truth there. */
  const priceSyncProgressStore = database
    ? createNeonPriceSyncProgressStore(database)
    : createInMemoryPriceSyncProgressStore();
  const tenantSyncStateFile = (tenantId: string) => {
    const base = runtimeBrokerSyncStateFile();
    return tenantId === LOCAL_TENANT_ID
      ? base
      : base.replace(/\.json$/, `.${encodeURIComponent(tenantId)}.json`);
  };

  /* Everything below used to be built once per process. That was correct while
   * there was one vault on disk and one user in front of it. Now the credential
   * store is per user, so the caches over it have to be too: a shared broker
   * data cache would serve the first signed-in user's positions to the second. */
  const buildTenantRuntime = async (tenantId: string) => {
    let syncProgress: BrokerSyncProgress = {
      status: "idle",
      pages: 0,
      ordersRead: 0,
      positionsRead: 0,
      waitUntil: null,
      remaining: null,
      updatedAt: null,
      message: null,
      history: null,
    };
    const credentials = createRuntimeCredentialStore(tenantId);
    const startupPassphrase = environment("LAVEGA_VAULT_PASSPHRASE");
    if (startupPassphrase && (await credentials.status()) === "locked")
      await credentials.unlock(startupPassphrase);
    const brokerData = createBrokerDataCache(
      (await credentials.status()) === "unlocked" ? await credentials.getBrokerData() : {},
    );
    if (devFixtureEnabled) {
      brokerData.restore(createDevFixtureBrokerData());
      await priceStore.upsert(tenantId, createDevFixturePriceBars());
      onPriceDataChanged();
    }
    let brokerDataReadAt = Date.now();
    let brokerDataRefresh: Promise<void> | null = null;
    const restoreBrokerData = async () => {
      brokerData.restore(await credentials.getBrokerData());
      brokerDataReadAt = Date.now();
    };
    const refreshBrokerData = async () => {
      if (!database || devFixtureEnabled || Date.now() - brokerDataReadAt < DASHBOARD_CACHE_TTL_MS)
        return;
      if (syncProgress.status === "running" || syncProgress.status === "waiting") return;
      if (brokerDataRefresh) return brokerDataRefresh;
      const version = brokerData.read().dataVersion;
      const refresh = (async () => {
        const snapshot = await credentials.getBrokerData();
        if (
          brokerData.read().dataVersion === version &&
          syncProgress.status !== "running" &&
          syncProgress.status !== "waiting"
        ) {
          brokerData.restore(snapshot);
          brokerDataReadAt = Date.now();
        }
      })();
      brokerDataRefresh = refresh;
      try {
        await refresh;
      } finally {
        if (brokerDataRefresh === refresh) brokerDataRefresh = null;
      }
    };
    const updateProgress = (event: Trading212DiagnosticEvent) => {
      const updatedAt = new Date().toISOString();
      if (event.type === "history-page") {
        syncProgress = {
          ...syncProgress,
          status: "running",
          pages: event.page,
          ordersRead: event.ordersRead,
          waitUntil: null,
          updatedAt,
          message: event.hasNext ? "Order history is loading" : "Order history is complete",
        };
      } else if (event.type === "cash-history-page") {
        syncProgress = {
          ...syncProgress,
          status: "running",
          updatedAt,
          message: `${event.history === "transactions" ? "Cash transaction" : "Dividend"} history ${event.hasNext ? "is loading" : "is complete"}`,
        };
      } else if (event.type === "wait") {
        syncProgress = {
          ...syncProgress,
          status: "waiting",
          waitUntil: new Date(Date.now() + event.waitMs).toISOString(),
          remaining: 0,
          updatedAt,
          message: "Waiting for new Trading 212 API capacity",
        };
      } else if (event.type === "positions") {
        syncProgress = {
          ...syncProgress,
          status: "running",
          positionsRead: event.count,
          updatedAt,
          message: "Positions are loaded",
        };
      } else {
        syncProgress = {
          ...syncProgress,
          status: "running",
          remaining: event.remaining,
          updatedAt,
          message:
            event.status === 429
              ? "Trading 212 rate limit response received"
              : syncProgress.message,
        };
      }
    };
    /* Sync state is per tenant even though it holds no personal data: one
     * shared store would let one user's run clear another's rate-limit cooldown. */
    const syncStateStore = database
      ? createNeonBrokerSyncStateStore(database, tenantId)
      : createFileBrokerSyncStateStore(tenantSyncStateFile(tenantId), {
          read: () => credentials.getBrokerData(),
          write: (snapshot) => credentials.putBrokerData(snapshot),
        });
    const readHistoryProgress = async (): Promise<BrokerHistoryProgress> => {
      const entries = await Promise.all(
        SCHEDULED_BROKERS.map(async (broker) => {
          const state = await syncStateStore.get(broker);
          const resume = state.resume ?? {};
          return [
            broker,
            {
              lastSyncedAt: state.lastSyncedAt,
              retryAfter: state.retryAfter ?? null,
              /* No resume cursor at all means nothing is half-read: either the last
               * run finished every page or none has run yet, and lastSyncedAt tells
               * those apart. */
              ordersComplete: resume.ordersComplete ?? resume.ordersNextPagePath == null,
              transactionsComplete:
                resume.transactionsComplete ?? resume.transactionsNextPagePath == null,
              dividendsComplete: resume.dividendsComplete ?? resume.dividendsNextPagePath == null,
            },
          ] as const;
        }),
      );
      return Object.fromEntries(entries) as BrokerHistoryProgress;
    };
    const scheduledBrokerSync = createRuntimeBrokerSync(
      /* The run stored what it read, so this only mirrors the stored data into
       * the cache. Reading, merging and writing it here is what let two
       * instances overwrite each other. */
      async (result) => {
        brokerData.apply({ outcomes: [], problems: result.problems });
        if (Object.keys(result.committed).length === 0) return;
        brokerData.restore({ ...brokerData.snapshot(), ...result.committed });
        brokerDataReadAt = Date.now();
      },
      credentials,
      syncStateStore,
      updateProgress,
      tenantId,
    );
    const brokerSync = async (force: boolean, deadlineMs?: number) => {
      if (devFixtureEnabled) {
        syncProgress = {
          status: "completed",
          pages: 0,
          ordersRead: 0,
          positionsRead: 0,
          waitUntil: null,
          remaining: null,
          updatedAt: new Date().toISOString(),
          message: "Dev fixture data active — real broker sync skipped",
          history: syncProgress.history,
        };
        return { outcomes: [], problems: [], committed: {} };
      }
      if (syncProgress.status !== "running" && syncProgress.status !== "waiting") {
        syncProgress = {
          status: "running",
          pages: 0,
          ordersRead: 0,
          positionsRead: 0,
          waitUntil: null,
          remaining: null,
          updatedAt: new Date().toISOString(),
          message: "Broker synchronization started",
          history: syncProgress.history,
        };
      }
      try {
        const result = await scheduledBrokerSync(force, deadlineMs);
        const trading212Problem = result.problems.find((problem) =>
          problem.startsWith("trading212:"),
        );
        syncProgress = {
          ...syncProgress,
          status: trading212Problem ? "problem" : "completed",
          waitUntil: null,
          updatedAt: new Date().toISOString(),
          message: trading212Problem ?? "Trading 212 synchronization completed",
        };
        return result;
      } catch (error) {
        syncProgress = {
          ...syncProgress,
          status: "problem",
          waitUntil: null,
          updatedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : "Broker synchronization failed",
        };
        throw error;
      }
    };
    const dashboardCache = new Map<
      string,
      { version: number; storedAt: number; data: InvestingDashboardData }
    >();
    const dashboardReader = async ({ symbol }: { symbol?: string }) => {
      const refreshProblems: string[] = [];
      try {
        await refreshBrokerData();
      } catch (error) {
        const snapshot = brokerData.read();
        if (
          snapshot.positions.length +
            snapshot.trades.length +
            snapshot.dividends.length +
            snapshot.cashBalances.length +
            snapshot.cashFlows.length ===
          0
        )
          throw error;
        refreshProblems.push("Broker data could not be refreshed. Showing the last loaded data.");
      }
      const { positions, trades, dividends, cashBalances, cashFlows, problems, dataVersion } =
        brokerData.read();
      const version = dataVersion + priceDataVersion;
      const selectedBenchmarks = options.benchmarkSymbols
        ? await options.benchmarkSymbols(tenantId)
        : (await benchmarkSelectionStore.get(tenantId)).symbols;
      const cacheKey = `${symbol?.trim().toUpperCase() ?? ""}\u0000${selectedBenchmarks.join("\u0000")}`;
      const cached = dashboardCache.get(cacheKey);
      if (refreshProblems.length > 0 && cached?.version === version)
        return { ...cached.data, problems: [...cached.data.problems, ...refreshProblems] };
      if (cached?.version === version && Date.now() - cached.storedAt < DASHBOARD_CACHE_TTL_MS)
        return cached.data;
      const symbols = [
        ...new Set([
          ...positions.map((position) => position.symbol),
          ...trades.map((trade) => trade.symbol),
        ]),
      ];
      const prices = await readPriceBars(priceStore, tenantId, symbols);
      const benches = await readPriceBars(priceStore, tenantId, selectedBenchmarks);
      const priceProblems =
        prices.failed + benches.failed > 0 ? ["Price data could not be fully loaded"] : [];
      const today = new Date().toISOString().slice(0, 10);
      const historyDates = [
        ...positions.map((position) => position.asOf),
        ...trades.map((trade) => trade.date),
        ...dividends.map((dividend) => dividend.date),
        ...cashBalances.map((balance) => balance.asOf),
        ...cashFlows.map((flow) => flow.date),
        ...prices.bars.map((bar) => bar.date),
      ].filter((date) => date <= today);
      const historyFrom = historyDates.sort()[0] ?? today;
      const [latestFx, historicalFx] = await Promise.all([
        fxProvider
          .getLatestRate()
          .catch(() => ({ rate: undefined, problems: ["FX rate could not be loaded"] })),
        fxProvider
          .getHistoricalRates(historyFrom, today)
          .catch(() => ({ rates: [], problems: ["Historical FX could not be loaded"] })),
      ]);
      const data = buildInvestingDashboard({
        positions,
        trades,
        dividends,
        cashBalances,
        cashFlows,
        priceBars: prices.bars,
        benchmarkBars: benches.bars,
        benchmarkInstruments: selectedBenchmarks.map((benchmark) => ({
          symbol: benchmark,
          name: benchmark,
          exchange: "Yahoo Finance",
          currency: benches.bars.find((bar) => bar.symbol === benchmark)?.currency ?? "EUR",
        })),
        presentationCurrency: "EUR",
        fxRates: [...historicalFx.rates, ...(latestFx.rate ? [latestFx.rate] : [])],
        selectedSymbol: symbol,
        problems: [
          ...problems,
          ...refreshProblems,
          ...priceProblems,
          ...latestFx.problems,
          ...historicalFx.problems,
        ],
        dataVersion: version,
      });
      if (refreshProblems.length === 0)
        dashboardCache.set(cacheKey, { version, storedAt: Date.now(), data });
      return data;
    };
    const agentInFlight = new Map<string, Promise<AgentRunRecord>>();
    const runPortfolioAgentOnce = async (
      agentId?: PortfolioAgentId,
      model?: string,
      prompt: string = PORTFOLIO_AGENT_PROMPT,
    ): Promise<AgentRunRecord> => {
      const agent = getPortfolioAgent(agentId);
      const runKey = `${agent.id}\u0000${model?.trim() ?? ""}\u0000${prompt}`;
      const inFlight = agentInFlight.get(runKey);
      if (inFlight) return inFlight;
      const record: AgentRunRecord = {
        id: crypto.randomUUID(),
        agentId: agent.id,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        status: "running",
        summary: null,
        error: null,
      };
      void agentRunStore.put(record);
      const run = (async () => {
        try {
          if ((await credentials.status()) === "unlocked") await restoreBrokerData();
          const dashboard = await dashboardReader({});
          const insight = options.runAgent
            ? await options.runAgent({
                agentId: agent.id,
                dashboard,
                model,
                prompt,
                tools: createPortfolioAgentTools({
                  readBrokerData: () => brokerData.read(),
                  priceStore,
                }),
              })
            : await runPortfolioAgent({ agentId: agent.id, dashboard, model, prompt });
          const normalized = normalizePortfolioAgentInsight(insight, agent.id);
          const done: AgentRunRecord = {
            ...record,
            finishedAt: new Date().toISOString(),
            status: "done",
            summary: normalized.summary,
            result: normalized,
          };
          await agentRunStore.put(done);
          return done;
        } catch (error) {
          const failed: AgentRunRecord = {
            ...record,
            finishedAt: new Date().toISOString(),
            status: "error",
            error: error instanceof Error ? error.message : "Portfolio agent run failed",
          };
          await agentRunStore.put(failed);
          throw error;
        }
      })();
      agentInFlight.set(runKey, run);
      try {
        return await run;
      } finally {
        if (agentInFlight.get(runKey) === run) agentInFlight.delete(runKey);
      }
    };
    return {
      brokerSync,
      brokerSyncStatus: async () => ({ ...syncProgress, history: await readHistoryProgress() }),
      configureBroker: createRuntimeBrokerCredentialSetup(credentials, restoreBrokerData, tenantId),
      credentialStatus: () => credentials.status(),
      unlockCredentials: async (passphrase: string) => {
        const unlocked = await credentials.unlock(passphrase);
        if (unlocked) await restoreBrokerData();
        return unlocked;
      },
      dashboardReader,
      priceSyncTargets: async () => {
        const { positions, trades } = brokerData.read();
        const benchmarkSymbols = options.benchmarkSymbols
          ? await options.benchmarkSymbols(tenantId)
          : (await benchmarkSelectionStore.get(tenantId)).symbols;
        return discoverPriceSyncTargets({ positions, trades, benchmarkSymbols });
      },
      runPortfolioAgentOnce,
    };
  };

  const tenantRuntimes = new Map<string, Promise<Awaited<ReturnType<typeof buildTenantRuntime>>>>();
  const tenantRuntime = (tenantId: string) => {
    let runtime = tenantRuntimes.get(tenantId);
    if (!runtime) {
      runtime = buildTenantRuntime(tenantId);
      tenantRuntimes.set(tenantId, runtime);
      // A build that fails must not be cached as this tenant's runtime forever.
      void runtime.catch(() => tenantRuntimes.delete(tenantId));
    }
    return runtime;
  };
  const currentRuntime = async () => tenantRuntime(await resolveTenantId());

  /* Built eagerly so a single-tenant runtime still fails loudly at startup
   * rather than on the first request, exactly as it did before. */
  if (!credentialsArePerTenant()) await tenantRuntime(LOCAL_TENANT_ID);

  const credentialDependencies = {
    configureBroker: async (input: BrokerCredentialInput) =>
      (await currentRuntime()).configureBroker(input),
    credentialStatus: async () => (await currentRuntime()).credentialStatus(),
    unlockCredentials: async (passphrase: string) =>
      (await currentRuntime()).unlockCredentials(passphrase),
    brokerSyncStatus: async () => (await currentRuntime()).brokerSyncStatus(),
    passphraseMode: () => (credentialsArePerTenant() ? ("unused" as const) : ("required" as const)),
    priceSyncTargets: async (tenantId: string) =>
      (await tenantRuntime(tenantId)).priceSyncTargets(),
  };
  const brokerSync = async (force: boolean, deadlineMs?: number) =>
    (await currentRuntime()).brokerSync(force, deadlineMs);
  const dashboardReader: InvestingDashboardReader = async ({ symbol }) =>
    (await currentRuntime()).dashboardReader({ symbol });
  const runPortfolioAgentOnce = async (
    agentId?: PortfolioAgentId,
    model?: string,
    prompt?: string,
  ): Promise<AgentRunRecord> =>
    (await currentRuntime()).runPortfolioAgentOnce(agentId, model, prompt);

  const withPortfolioAgentRoute = (honoApp: ReturnType<typeof createApp>): RuntimeApp => {
    honoApp.get("/api/agents/portfolio", (c) =>
      c.json({
        agents: listPortfolioAgents().map(({ systemPrompt: _systemPrompt, ...agent }) => agent),
      }),
    );
    honoApp.post("/api/agents/portfolio/run", async (c) => {
      const body: { agentId?: unknown; model?: unknown; prompt?: unknown } = await c.req
        .json<{ agentId?: unknown; model?: unknown; prompt?: unknown }>()
        .catch(() => ({}));
      const agentId =
        typeof body.agentId === "string" ? getPortfolioAgent(body.agentId).id : undefined;
      const model =
        typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
      const prompt =
        typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : undefined;
      try {
        const run = await runPortfolioAgentOnce(agentId, model, prompt);
        return c.json({ summary: run.summary, result: run.result ?? null });
      } catch (error) {
        return c.json(
          { problems: [error instanceof Error ? error.message : "Portfolio agent run failed"] },
          502,
        );
      }
    });
    return Object.assign(honoApp, { runPortfolioAgentOnce });
  };
  const sectorDependencies = {
    sectorStore: createFileSectorProfileStore(runtimeSectorStoreFile()),
  };
  if (!dsn)
    return withPortfolioAgentRoute(
      createApp({
        brokerSync,
        ...credentialDependencies,
        ...sectorDependencies,
        resolveTenantId: options.resolveTenantId,
        store: priceStore,
        fxProvider,
        benchmarkSelectionStore,
        marketDataConsentStore,
        dashboardReader,
        onPriceDataChanged,
        priceSyncProgressStore,
      }),
    );
  const sentry = await import("@sentry/node");
  sentry.init({ dsn, environment: process.env.NODE_ENV });
  return withPortfolioAgentRoute(
    createApp({
      brokerSync,
      ...credentialDependencies,
      ...sectorDependencies,
      resolveTenantId: options.resolveTenantId,
      store: priceStore,
      fxProvider,
      benchmarkSelectionStore,
      marketDataConsentStore,
      dashboardReader,
      onPriceDataChanged,
      priceSyncProgressStore,
      problemReporter: createProblemReporter({ dsn, sentry }),
    }),
  );
}
