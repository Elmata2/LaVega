import {
  app,
  createApp,
  type BrokerCredentialInput,
  type BrokerHistoryProgress,
  type BrokerSyncProgress,
  type InvestingHealth,
  type InvestingDashboardReader,
} from "./app.js";
import {
  createFileAgentRunStore,
  type AgentRunRecord,
  type AgentRunStore,
} from "./fileAgentRunStore.js";
import {
  isPortfolioAgentId,
  listPortfolioAgents,
  runPortfolioConversation,
  runPortfolioAgent,
  type PortfolioConversationReply,
  type PortfolioConversationTurn,
  type PortfolioJudgmentRun,
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
import { useDatabaseSource } from "./systemOneUsage.js";
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
import { createDashboardCache, type DashboardCache } from "./dashboardCache.js";
import { createDashboardSnapshotRepository } from "@lavega/database";
import { createBrokerSnapshotReader } from "./brokerSnapshotReader.js";

export { app };
export { createDashboardCache } from "./dashboardCache.js";

const LOCAL_TENANT_ID = "local";
const DASHBOARD_CACHE_TTL_MS = 15_000;
const TRADING212_HEALTH_MAX_AGE_MS = 26 * 60 * 60 * 1_000;

function environment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function trading212SyncHealth(
  lastSyncedAt: string | null,
  problem: boolean,
): InvestingHealth["checks"]["trading212Sync"] {
  if (problem) return "problem";
  if (!lastSyncedAt) return "never";
  const syncedAt = Date.parse(lastSyncedAt);
  if (!Number.isFinite(syncedAt) || Date.now() - syncedAt > TRADING212_HEALTH_MAX_AGE_MS)
    return "stale";
  return "fresh";
}

type RuntimeCredentialStore = RuntimeCredentialStoreType;

export function createRuntimeBrokerCredentialSetup(
  credentials: RuntimeCredentialStore,
  onStored?: (broker: BrokerCredentialInput["broker"]) => void | Promise<void>,
  tenantId: string = LOCAL_TENANT_ID,
) {
  return async (input: BrokerCredentialInput): Promise<void> => {
    const status = await credentials.status();
    if (status === "empty") await credentials.setup(input.passphrase ?? "");
    else if (!(await credentials.unlock(input.passphrase ?? "")))
      throw new Error("Vault passphrase is incorrect");
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
    await onStored?.(input.broker);
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
  options: RunPortfolioAgentOptions,
) => Promise<PortfolioJudgmentRun>;
export type PortfolioConversationRunner = (input: {
  agentId: import("./portfolioAgent.js").PortfolioAgentId;
  prompt: string;
  history: readonly PortfolioConversationTurn[];
  dashboard: InvestingDashboardData;
  judgment: PortfolioJudgmentRun;
}) => Promise<PortfolioConversationReply>;
export type RuntimeAppOptions = {
  priceStore: PriceStore;
  resolveTenantId?: () => string | Promise<string>;
  benchmarkSelectionStore?: BenchmarkSelectionStore;
  benchmarkSymbols?: (tenantId: string) => Promise<string[]> | string[];
  marketDataConsentStore?: MarketDataConsentStore;
  agentRunStore?: AgentRunStore;
  runAgent?: PortfolioAgentRunner;
  runConversation?: PortfolioConversationRunner;
  dashboardCache?: DashboardCache;
};

export type RuntimeApp = ReturnType<typeof createApp> & {
  runPortfolioAgentOnce: (model?: string) => Promise<AgentRunRecord>;
  answerPortfolioConversation: (
    agentId: import("./portfolioAgent.js").PortfolioAgentId,
    prompt: string,
    history: readonly PortfolioConversationTurn[],
  ) => Promise<PortfolioConversationReply>;
};

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
  const dashboardCache = options.dashboardCache ?? createDashboardCache();
  let priceDataVersion = 0;
  const onPriceDataChanged = () => {
    priceDataVersion += 1;
    dashboardCache.invalidate();
  };
  const resolveTenantId = options.resolveTenantId ?? (() => LOCAL_TENANT_ID);
  /* The request path must not import node:async_hooks, so systemOneUsage is
   * handed its database source here rather than importing it. See its comment. */
  useDatabaseSource(runtimeDatabase);
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
    const brokerData = createBrokerDataCache({});
    const dashboardSnapshots =
      database && !devFixtureEnabled ? createDashboardSnapshotRepository(database, tenantId) : null;
    if (devFixtureEnabled) {
      brokerData.restore(createDevFixtureBrokerData());
      await priceStore.upsert(tenantId, createDevFixturePriceBars());
      onPriceDataChanged();
    }
    const brokerSnapshot = createBrokerSnapshotReader({
      cache: brokerData,
      load: () => credentials.getBrokerData(),
      hosted: Boolean(database) && !devFixtureEnabled,
      isSyncing: () => syncProgress.status === "running" || syncProgress.status === "waiting",
      ttlMs: DASHBOARD_CACHE_TTL_MS,
    });
    /* The runtime is built per request (docs/investing/STACK.md), and most
     * requests never read positions, so the vault's snapshots are read on first
     * use rather than here. */
    let brokerDataLoad: Promise<void> | null = devFixtureEnabled ? Promise.resolve() : null;
    const restoreBrokerData = async () => {
      brokerSnapshot.restore(await credentials.getBrokerData());
      brokerDataLoad = Promise.resolve();
    };
    const loadBrokerData = () =>
      (brokerDataLoad ??= (async () => {
        if ((await credentials.status()) === "unlocked") await restoreBrokerData();
      })().catch((error: unknown) => {
        brokerDataLoad = null;
        throw error;
      }));
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
        await loadBrokerData().catch(() => undefined);
        brokerData.restore({ ...brokerData.snapshot(), ...result.committed });
        brokerSnapshot.markCurrent();
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
    const dashboardReader = async ({ symbol }: { symbol?: string }) => {
      const storedKey = symbol?.trim().toUpperCase() ?? "";
      const stored = await dashboardSnapshots?.get(storedKey).catch(() => null);
      if (stored?.dashboard) return stored.dashboard as InvestingDashboardData;
      const refreshProblems: string[] = [];
      try {
        await loadBrokerData();
        await brokerSnapshot.read("cached");
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
      const cached = dashboardCache.get({ tenantId, key: cacheKey });
      if (cached) {
        if (refreshProblems.length > 0)
          return { ...cached, problems: [...cached.problems, ...refreshProblems] };
        return cached;
      }
      const buildDashboard = async () => {
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
        const dashboard = buildInvestingDashboard({
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
        /* A failed price or FX read is a problem of this moment, not of the
         * data; storing it would show it until the next sync. */
        const transientProblems =
          refreshProblems.length +
          priceProblems.length +
          latestFx.problems.length +
          historicalFx.problems.length;
        if (stored && transientProblems === 0)
          await dashboardSnapshots
            ?.put(storedKey, stored.version, dashboard)
            .catch(() => undefined);
        return dashboard;
      };
      return refreshProblems.length > 0
        ? buildDashboard()
        : dashboardCache.load({ tenantId, key: cacheKey }, buildDashboard);
    };
    const healthCheck = async (): Promise<InvestingHealth> => {
      const checks: InvestingHealth["checks"] = {
        database: database ? "ok" : "not-configured",
        migrationLedger: database ? "ok" : "not-applicable",
        tenantIsolation: database ? "enforced" : "not-applicable",
        vault: "empty",
        trading212Credentials: "missing",
        trading212Sync: "never",
        snapshot: "empty",
      };
      const trading212 = { lastSyncedAt: null as string | null, positions: 0 };

      if (database) {
        try {
          const ledger = await database.query<{ ledger: string | null }>(
            "SELECT to_regclass('public.schema_migrations') AS ledger",
          );
          if (!ledger.rows[0]?.ledger) checks.migrationLedger = "down";
          const role = await database.query<{ bypasses: boolean }>(
            "SELECT rolsuper OR rolbypassrls AS bypasses FROM pg_roles WHERE rolname = current_user",
          );
          if (role.rows[0]?.bypasses !== false) checks.tenantIsolation = "down";
        } catch {
          return {
            status: "down",
            storage: "neon",
            checks: {
              ...checks,
              database: "down",
              migrationLedger: "down",
              tenantIsolation: "down",
              vault: "down",
              trading212Credentials: "down",
              trading212Sync: "down",
              snapshot: "down",
            },
            trading212,
          };
        }
      }

      try {
        const vaultStatus = await credentials.status();
        checks.vault = vaultStatus === "unlocked" ? "ok" : vaultStatus;
        const configured =
          vaultStatus === "unlocked" &&
          (await credentials.getCredentials(tenantId, "trading212")) !== null;
        checks.trading212Credentials = configured ? "configured" : "missing";
        if (configured) {
          await restoreBrokerData();
          const snapshot = brokerData.snapshot().trading212;
          trading212.positions = snapshot?.positions.length ?? 0;
          checks.snapshot = snapshot ? "loaded" : "empty";
          const state = await syncStateStore.get("trading212");
          const progress = await syncStateStore.progress("trading212");
          trading212.lastSyncedAt = state.lastSyncedAt;
          checks.trading212Sync = trading212SyncHealth(
            state.lastSyncedAt,
            progress?.status === "problem",
          );
        }
      } catch {
        checks.vault = "down";
        checks.trading212Credentials = "down";
        checks.trading212Sync = "down";
        checks.snapshot = "down";
      }

      const status = Object.values(checks).some((value) => value === "down")
        ? "down"
        : checks.trading212Credentials === "configured" &&
            checks.trading212Sync === "fresh" &&
            checks.snapshot === "loaded" &&
            checks.migrationLedger !== "down"
          ? "ok"
          : "degraded";
      return { status, storage: database ? "neon" : "file", checks, trading212 };
    };
    const agentInFlight = new Map<string, Promise<AgentRunRecord>>();
    const runPortfolioAgentOnce = async (model?: string): Promise<AgentRunRecord> => {
      const runKey = model?.trim() ?? "";
      const inFlight = agentInFlight.get(runKey);
      if (inFlight) return inFlight;
      const record: AgentRunRecord = {
        id: crypto.randomUUID(),
        agentId: "portfolio-judgments",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        status: "running",
        summary: null,
        error: null,
      };
      void agentRunStore.put(record);
      const run = (async () => {
        try {
          const dashboard = await dashboardReader({});
          const result = options.runAgent
            ? await options.runAgent({ dashboard, model })
            : await runPortfolioAgent({ dashboard, model });
          const done: AgentRunRecord = {
            ...record,
            finishedAt: new Date().toISOString(),
            status: "done",
            summary: null,
            result,
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
    const answerPortfolioConversation = async (
      agentId: import("./portfolioAgent.js").PortfolioAgentId,
      prompt: string,
      history: readonly PortfolioConversationTurn[],
    ): Promise<PortfolioConversationReply> => {
      const judgmentRecord = await runPortfolioAgentOnce();
      const judgment = judgmentRecord.result;
      if (
        !judgment ||
        typeof judgment !== "object" ||
        !Array.isArray((judgment as { judgments?: unknown }).judgments) ||
        typeof (judgment as { model?: unknown }).model !== "string" ||
        typeof (judgment as { snapshotHash?: unknown }).snapshotHash !== "string"
      )
        throw new Error("Portfolio judgment did not return a result");
      const dashboard = await dashboardReader({});
      const input = {
        agentId,
        prompt,
        history,
        dashboard,
        judgment: judgment as PortfolioJudgmentRun,
      };
      return options.runConversation
        ? options.runConversation(input)
        : runPortfolioConversation(input);
    };
    return {
      brokerSync,
      brokerSyncStatus: async () => ({ ...syncProgress, history: await readHistoryProgress() }),
      configureBroker: createRuntimeBrokerCredentialSetup(
        credentials,
        async (broker) => {
          if (!database)
            await (syncStateStore as ReturnType<typeof createFileBrokerSyncStateStore>).reset(
              broker,
            );
          await restoreBrokerData();
        },
        tenantId,
      ),
      credentialStatus: () => credentials.status(),
      brokerReadability: () => credentials.brokerReadability?.(),
      unlockCredentials: async (passphrase: string) => {
        const unlocked = await credentials.unlock(passphrase);
        if (unlocked) await restoreBrokerData();
        return unlocked;
      },
      dashboardReader,
      healthCheck,
      priceSyncTargets: async () => {
        await loadBrokerData();
        const { positions, trades } = await brokerSnapshot.read("fresh");
        const benchmarkSymbols = options.benchmarkSymbols
          ? await options.benchmarkSymbols(tenantId)
          : (await benchmarkSelectionStore.get(tenantId)).symbols;
        return discoverPriceSyncTargets({ positions, trades, benchmarkSymbols });
      },
      runPortfolioAgentOnce,
      answerPortfolioConversation,
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
    brokerReadability: async () => (await currentRuntime()).brokerReadability(),
    unlockCredentials: async (passphrase: string) =>
      (await currentRuntime()).unlockCredentials(passphrase),
    brokerSyncStatus: async () => (await currentRuntime()).brokerSyncStatus(),
    healthCheck: async () => (await currentRuntime()).healthCheck(),
    passphraseMode: () => (credentialsArePerTenant() ? ("unused" as const) : ("required" as const)),
    priceSyncTargets: async (tenantId: string) =>
      (await tenantRuntime(tenantId)).priceSyncTargets(),
  };
  const brokerSync = async (force: boolean, deadlineMs?: number) => {
    const tenantId = await resolveTenantId();
    const result = await (await tenantRuntime(tenantId)).brokerSync(force, deadlineMs);
    dashboardCache.invalidate(tenantId);
    return result;
  };
  const dashboardReader: InvestingDashboardReader = async ({ symbol }) =>
    (await currentRuntime()).dashboardReader({ symbol });
  const runPortfolioAgentOnce = async (model?: string): Promise<AgentRunRecord> =>
    (await currentRuntime()).runPortfolioAgentOnce(model);
  const answerPortfolioConversation = async (
    agentId: import("./portfolioAgent.js").PortfolioAgentId,
    prompt: string,
    history: readonly PortfolioConversationTurn[],
  ) => (await currentRuntime()).answerPortfolioConversation(agentId, prompt, history);

  const withPortfolioAgentRoute = (honoApp: ReturnType<typeof createApp>): RuntimeApp => {
    honoApp.get("/api/agents/portfolio", (c) =>
      c.json({
        agents: listPortfolioAgents().map(
          ({ instructions: _instructions, criteria: _criteria, ...agent }) => agent,
        ),
      }),
    );
    honoApp.post("/api/agents/portfolio/run", async (c) => {
      const body: { model?: unknown } = await c.req.json<{ model?: unknown }>().catch(() => ({}));
      const model =
        typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
      try {
        const run = await runPortfolioAgentOnce(model);
        return c.json({ result: run.result ?? null });
      } catch (error) {
        return c.json(
          { problems: [error instanceof Error ? error.message : "Portfolio agent run failed"] },
          502,
        );
      }
    });
    honoApp.post("/api/agents/portfolio/conversation", async (c) => {
      const body: { agentId?: unknown; prompt?: unknown; history?: unknown } = await c.req
        .json()
        .catch(() => ({}));
      if (!isPortfolioAgentId(body.agentId))
        return c.json({ problems: ["Unknown portfolio agent"] }, 400);
      if (typeof body.prompt !== "string" || !body.prompt.trim())
        return c.json({ problems: ["Conversation prompt is required"] }, 400);
      const history = Array.isArray(body.history)
        ? body.history
            .slice(-12)
            .filter(
              (item): item is PortfolioConversationTurn =>
                !!item &&
                typeof item === "object" &&
                ((item as { role?: unknown }).role === "user" ||
                  (item as { role?: unknown }).role === "assistant") &&
                typeof (item as { content?: unknown }).content === "string",
            )
        : [];
      try {
        return c.json({
          result: await answerPortfolioConversation(body.agentId, body.prompt.trim(), history),
        });
      } catch (error) {
        return c.json(
          { problems: [error instanceof Error ? error.message : "Portfolio conversation failed"] },
          502,
        );
      }
    });
    return Object.assign(honoApp, { runPortfolioAgentOnce, answerPortfolioConversation });
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
