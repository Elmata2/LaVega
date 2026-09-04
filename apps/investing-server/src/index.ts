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
  type CashBalance,
  type CashFlow,
  type Dividend,
  type InvestingDashboardData,
  type Position,
  type Trade,
} from "@lavega/core";
import {
  cashBalancesComplete,
  createCredentialsAwareBrokerAdapters,
  createFrankfurterFxProvider,
  createInMemoryBenchmarkSelectionStore,
  historyPending,
  positionsComplete,
  SCHEDULED_BROKERS,
  syncScheduledBrokers,
  tradesComplete,
  type BrokerSyncStateStore,
  type PriceStore,
  type ScheduledSyncResult,
  type Trading212DiagnosticEvent,
} from "@lavega/adapters";
import {
  createFileCredentialStore,
  type RuntimeBrokerDataSnapshot,
} from "./fileCredentialStore.js";
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

export { app };

const LOCAL_TENANT_ID = "local";

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

export function createRuntimeBrokerSync(
  onCompleted?: (result: ScheduledSyncResult) => void | Promise<void>,
  credentials = createFileCredentialStore(),
  state: BrokerSyncStateStore = createFileBrokerSyncStateStore(),
  onTrading212Diagnostic?: (event: Trading212DiagnosticEvent) => void,
  tenantId: string = LOCAL_TENANT_ID,
): (force: boolean) => Promise<ScheduledSyncResult> {
  let inFlight: Promise<ScheduledSyncResult> | null = null;
  const entity = environment("LAVEGA_INVESTING_ENTITY") ?? "personal";
  const adapters = createCredentialsAwareBrokerAdapters({
    credentials,
    tenantId,
    onTrading212Diagnostic,
  });
  return async (force) => {
    if (inFlight) return inFlight;
    const run = syncScheduledBrokers({
      adapters,
      credentials,
      state,
      tenantId,
      entity,
      force,
    }).then(async (result) => {
      await onCompleted?.(result);
      return result;
    });
    inFlight = run;
    try {
      return await run;
    } finally {
      if (inFlight === run) inFlight = null;
    }
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
  runPortfolioAgentOnce: (agentId?: PortfolioAgentId, model?: string) => Promise<AgentRunRecord>;
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

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

/** Neon pool max is 5. Parallel getRange per symbol exhausts it and the dashboard
 *  route then returns emptyInvestingDashboard even when broker rows are in cache. */
const PRICE_BAR_READ_CONCURRENCY = 3;

async function readPriceBars(priceStore: PriceStore, tenantId: string, symbols: readonly string[]) {
  const bars: Awaited<ReturnType<PriceStore["getRange"]>> = [];
  let failed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PRICE_BAR_READ_CONCURRENCY, symbols.length) }, async () => {
      while (next < symbols.length) {
        const symbol = symbols[next++];
        if (!symbol) return;
        try {
          bars.push(...(await priceStore.getRange(tenantId, symbol)));
        } catch {
          failed += 1;
        }
      }
    }),
  );
  return { bars, failed };
}

export function createRuntimeBrokerDataCache(initial: RuntimeBrokerDataSnapshot = {}) {
  const positionsByBroker = new Map<string, Position[]>();
  const tradesByBroker = new Map<string, Trade[]>();
  const dividendsByBroker = new Map<string, Dividend[]>();
  const cashBalancesByBroker = new Map<string, CashBalance[]>();
  const cashFlowsByBroker = new Map<string, CashFlow[]>();
  let problems: string[] = [];
  let dataVersion = 0;

  const restore = (snapshot: RuntimeBrokerDataSnapshot) => {
    positionsByBroker.clear();
    tradesByBroker.clear();
    dividendsByBroker.clear();
    cashBalancesByBroker.clear();
    cashFlowsByBroker.clear();
    for (const [broker, data] of Object.entries(snapshot)) {
      if (!data) continue;
      positionsByBroker.set(broker, structuredClone(data.positions));
      tradesByBroker.set(broker, structuredClone(data.trades));
      dividendsByBroker.set(broker, structuredClone(data.dividends ?? []));
      cashBalancesByBroker.set(broker, structuredClone(data.cashBalances ?? []));
      cashFlowsByBroker.set(broker, structuredClone(data.cashFlows ?? []));
    }
    dataVersion += 1;
  };
  restore(initial);

  return {
    apply(result: ScheduledSyncResult) {
      for (const outcome of result.outcomes) {
        // Partial results with problems still carry fresh broker data; discarding
        // them left the vault stale while the UI showed only the problem.
        if (outcome.result === null) continue;
        const incoming = outcome.result;
        const complete = tradesComplete(incoming) && !historyPending(incoming.resume);
        // Holdings can fail independently of order history (different T212
        // budgets). An empty positions array on that failure must not replace
        // last-good rows, or the dashboard goes blank after a "completed" history.
        if (
          incoming.positions.length > 0 ||
          (complete && positionsComplete(incoming)) ||
          !positionsByBroker.has(outcome.broker)
        ) {
          positionsByBroker.set(outcome.broker, incoming.positions);
        }
        const mappedTrades = incoming.trades.map((trade, index) => ({
          ...trade,
          id: `${outcome.broker}:${trade.brokerTradeId ?? index}`,
        }));
        // A truncated trade history must not wipe good stored trades. A first
        // truncated run (empty vault) must still keep the pages it did read,
        // or a Vercel time-limit stop would persist nothing.
        if (complete) tradesByBroker.set(outcome.broker, mappedTrades);
        else if (mappedTrades.length > 0)
          tradesByBroker.set(
            outcome.broker,
            mergeById(tradesByBroker.get(outcome.broker) ?? [], mappedTrades),
          );
        const incomingDividends = incoming.dividends ?? [];
        if (complete) dividendsByBroker.set(outcome.broker, incomingDividends);
        else if (incomingDividends.length > 0)
          dividendsByBroker.set(
            outcome.broker,
            mergeById(dividendsByBroker.get(outcome.broker) ?? [], incomingDividends),
          );
        if (
          (incoming.cashBalances?.length ?? 0) > 0 ||
          (complete && cashBalancesComplete(incoming)) ||
          !cashBalancesByBroker.has(outcome.broker)
        ) {
          cashBalancesByBroker.set(outcome.broker, incoming.cashBalances ?? []);
        }
        const incomingFlows = incoming.cashFlows ?? [];
        if (complete) cashFlowsByBroker.set(outcome.broker, incomingFlows);
        else if (incomingFlows.length > 0)
          cashFlowsByBroker.set(
            outcome.broker,
            mergeById(cashFlowsByBroker.get(outcome.broker) ?? [], incomingFlows),
          );
      }
      problems = result.problems;
      if (result.outcomes.some((outcome) => outcome.result !== null)) dataVersion += 1;
    },
    read() {
      return {
        positions: [...positionsByBroker.values()].flat(),
        trades: [...tradesByBroker.values()].flat(),
        dividends: [...dividendsByBroker.values()].flat(),
        cashBalances: [...cashBalancesByBroker.values()].flat(),
        cashFlows: [...cashFlowsByBroker.values()].flat(),
        problems: [...problems],
        dataVersion,
      };
    },
    restore,
    snapshot(): RuntimeBrokerDataSnapshot {
      const snapshot: RuntimeBrokerDataSnapshot = {};
      for (const broker of new Set([
        ...positionsByBroker.keys(),
        ...tradesByBroker.keys(),
        ...dividendsByBroker.keys(),
        ...cashBalancesByBroker.keys(),
        ...cashFlowsByBroker.keys(),
      ])) {
        if (broker !== "ibkr" && broker !== "trading212") continue;
        snapshot[broker] = {
          positions: structuredClone(positionsByBroker.get(broker) ?? []),
          trades: structuredClone(tradesByBroker.get(broker) ?? []),
          dividends: structuredClone(dividendsByBroker.get(broker) ?? []),
          cashBalances: structuredClone(cashBalancesByBroker.get(broker) ?? []),
          cashFlows: structuredClone(cashFlowsByBroker.get(broker) ?? []),
        };
      }
      return snapshot;
    },
  };
}

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
    const brokerData = createRuntimeBrokerDataCache(
      (await credentials.status()) === "unlocked" ? await credentials.getBrokerData() : {},
    );
    if (devFixtureEnabled) {
      brokerData.restore(createDevFixtureBrokerData());
      await priceStore.upsert(tenantId, createDevFixturePriceBars());
      onPriceDataChanged();
    }
    const restoreBrokerData = async () => brokerData.restore(await credentials.getBrokerData());
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
      : createFileBrokerSyncStateStore(tenantSyncStateFile(tenantId));
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
      async (result) => {
        brokerData.apply(result);
        if (!result.outcomes.some((outcome) => outcome.result !== null)) return;
        try {
          await credentials.putBrokerData(brokerData.snapshot());
        } catch (error) {
          result.problems.push(
            `Broker snapshot could not be stored: ${error instanceof Error ? error.message : "unknown error"}`,
          );
        }
      },
      credentials,
      syncStateStore,
      updateProgress,
      tenantId,
    );
    const brokerSync = async (force: boolean) => {
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
        return { outcomes: [], problems: [] };
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
        const result = await scheduledBrokerSync(force);
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
    const dashboardCache = new Map<string, { version: number; data: InvestingDashboardData }>();
    const dashboardReader = async ({ symbol }: { symbol?: string }) => {
      const { positions, trades, dividends, cashBalances, cashFlows, problems, dataVersion } =
        brokerData.read();
      const version = dataVersion + priceDataVersion;
      const selectedBenchmarks = options.benchmarkSymbols
        ? await options.benchmarkSymbols(tenantId)
        : (await benchmarkSelectionStore.get(tenantId)).symbols;
      const cacheKey = `${symbol?.trim().toUpperCase() ?? ""}\u0000${selectedBenchmarks.join("\u0000")}`;
      const cached = dashboardCache.get(cacheKey);
      if (cached?.version === version) return cached.data;
      const symbols = [
        ...new Set([
          ...positions.map((position) => position.symbol),
          ...trades.map((trade) => trade.symbol),
        ]),
      ];
      const prices = await readPriceBars(priceStore, tenantId, symbols);
      const benches = await readPriceBars(priceStore, tenantId, selectedBenchmarks);
      const priceProblems =
        prices.failed + benches.failed > 0 ? ["Prijsdata kon niet volledig worden geladen"] : [];
      const fxResult = await fxProvider
        .getLatestRate()
        .catch(() => ({ rate: undefined, problems: ["FX-koers kon niet worden geladen"] }));
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
        fxRates: fxResult.rate,
        selectedSymbol: symbol,
        problems: [...problems, ...priceProblems, ...fxResult.problems],
        dataVersion: version,
      });
      dashboardCache.set(cacheKey, { version, data });
      return data;
    };
    const agentInFlight = new Map<string, Promise<AgentRunRecord>>();
    const runPortfolioAgentOnce = async (
      agentId?: PortfolioAgentId,
      model?: string,
    ): Promise<AgentRunRecord> => {
      const agent = getPortfolioAgent(agentId);
      const runKey = `${agent.id}\u0000${model?.trim() ?? ""}`;
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
                prompt: PORTFOLIO_AGENT_PROMPT,
                tools: createPortfolioAgentTools({
                  readBrokerData: () => brokerData.read(),
                  priceStore,
                }),
              })
            : await runPortfolioAgent({ agentId: agent.id, dashboard, model });
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
  const brokerSync = async (force: boolean) => (await currentRuntime()).brokerSync(force);
  const dashboardReader: InvestingDashboardReader = async ({ symbol }) =>
    (await currentRuntime()).dashboardReader({ symbol });
  const runPortfolioAgentOnce = async (
    agentId?: PortfolioAgentId,
    model?: string,
  ): Promise<AgentRunRecord> => (await currentRuntime()).runPortfolioAgentOnce(agentId, model);

  const withPortfolioAgentRoute = (honoApp: ReturnType<typeof createApp>): RuntimeApp => {
    honoApp.get("/api/agents/portfolio", (c) =>
      c.json({
        agents: listPortfolioAgents().map(({ systemPrompt: _systemPrompt, ...agent }) => agent),
      }),
    );
    honoApp.post("/api/agents/portfolio/run", async (c) => {
      const body: { agentId?: unknown; model?: unknown } = await c.req
        .json<{ agentId?: unknown; model?: unknown }>()
        .catch(() => ({}));
      const agentId =
        typeof body.agentId === "string" ? getPortfolioAgent(body.agentId).id : undefined;
      const model =
        typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
      try {
        const run = await runPortfolioAgentOnce(agentId, model);
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
