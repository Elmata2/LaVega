import { randomUUID } from "node:crypto";
import { app, createApp, type BrokerCredentialInput, type BrokerSyncProgress } from "./app.js";
import { createFileAgentRunStore, type AgentRunRecord, type AgentRunStore } from "./fileAgentRunStore.js";
import { createPortfolioAgentTools, runPortfolioAgent } from "./portfolioAgent.js";
import { createProblemReporter } from "./observability.js";
import { buildInvestingDashboard, type BenchmarkSelectionStore, type CashBalance, type CashFlow, type Dividend, type InvestingDashboardData, type Position, type Trade } from "@lavega/core";
import {
  createCredentialsAwareBrokerAdapters,
  createFrankfurterFxProvider,
  createInMemoryBenchmarkSelectionStore,
  syncScheduledBrokers,
  tradesComplete,
  type BrokerSyncStateStore,
  type PriceStore,
  type ScheduledSyncResult,
  type Trading212DiagnosticEvent,
} from "@lavega/adapters";
import { createFileCredentialStore, type RuntimeBrokerDataSnapshot } from "./fileCredentialStore.js";
import { createFileBrokerSyncStateStore } from "./fileBrokerSyncStateStore.js";
import { createInMemoryMarketDataConsentStore, type MarketDataConsentStore } from "./marketDataConsent.js";
import { createFileSectorProfileStore, runtimeSectorStoreFile } from "./fileSectorProfileStore.js";
import { createDevFixtureBrokerData, createDevFixtureFxProvider, createDevFixturePriceBars } from "./devFixture.js";
import { discoverPriceSyncTargets } from "./priceOrchestrator.js";

export { app };

const LOCAL_TENANT_ID = "local";

function environment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

type RuntimeCredentialStore = ReturnType<typeof createFileCredentialStore>;

export function createRuntimeBrokerCredentialSetup(credentials: RuntimeCredentialStore, onUnlocked?: () => void | Promise<void>) {
  return async (input: BrokerCredentialInput): Promise<void> => {
    const status = await credentials.status();
    if (status === "empty") await credentials.setup(input.passphrase);
    else if (!(await credentials.unlock(input.passphrase))) throw new Error("Vault passphrase is incorrect");
    await onUnlocked?.();
    if (input.broker === "ibkr") {
      await credentials.putCredentials({ broker: "ibkr", tenantId: LOCAL_TENANT_ID, token: input.token, queryId: input.queryId! });
    } else {
      await credentials.putCredentials({ broker: "trading212", tenantId: LOCAL_TENANT_ID, token: input.token, secret: input.secret! });
    }
  };
}

export function createRuntimeBrokerSync(
  onCompleted?: (result: ScheduledSyncResult) => void | Promise<void>,
  credentials = createFileCredentialStore(),
  state: BrokerSyncStateStore = createFileBrokerSyncStateStore(),
  onTrading212Diagnostic?: (event: Trading212DiagnosticEvent) => void,
): (force: boolean) => Promise<ScheduledSyncResult> {
  let inFlight: Promise<ScheduledSyncResult> | null = null;
  const entity = environment("LAVEGA_INVESTING_ENTITY") ?? "personal";
  const adapters = createCredentialsAwareBrokerAdapters({ credentials, onTrading212Diagnostic });
  return async (force) => {
    if (inFlight) return inFlight;
    const run = syncScheduledBrokers({ adapters, credentials, state, tenantId: LOCAL_TENANT_ID, entity, force })
      .then(async (result) => {
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

export type RuntimeAppOptions = { priceStore: PriceStore; benchmarkSelectionStore?: BenchmarkSelectionStore; benchmarkSymbols?: (tenantId: string) => Promise<string[]> | string[]; marketDataConsentStore?: MarketDataConsentStore; agentRunStore?: AgentRunStore; runAgent?: typeof runPortfolioAgent };

export type RuntimeApp = ReturnType<typeof createApp> & { runPortfolioAgentOnce: () => Promise<AgentRunRecord> };

const PORTFOLIO_AGENT_PROMPT = [
  "You are the portfolio health assistant of a personal investing dashboard.",
  "Use the read-only tools to look at the current positions, prices and total portfolio value, then summarize the portfolio's health in at most five sentences:",
  "total value, largest position, and anything that looks off such as missing prices or empty broker data.",
].join(" ");

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
        positionsByBroker.set(outcome.broker, outcome.result.positions);
        // A truncated trade history (pagination failed mid-chain) must not wipe
        // good stored trades; keep the previous set until a complete sync lands.
        if (tradesComplete(outcome.result)) tradesByBroker.set(outcome.broker, outcome.result.trades.map((trade, index) => ({ ...trade, id: `${outcome.broker}:${trade.brokerTradeId ?? index}` })));
        dividendsByBroker.set(outcome.broker, outcome.result.dividends ?? []);
        cashBalancesByBroker.set(outcome.broker, outcome.result.cashBalances ?? []);
        cashFlowsByBroker.set(outcome.broker, outcome.result.cashFlows ?? []);
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
      for (const broker of new Set([...positionsByBroker.keys(), ...tradesByBroker.keys(), ...dividendsByBroker.keys(), ...cashBalancesByBroker.keys(), ...cashFlowsByBroker.keys()])) {
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
  const benchmarkSelectionStore = options.benchmarkSelectionStore ?? createInMemoryBenchmarkSelectionStore();
  const marketDataConsentStore = options.marketDataConsentStore ?? createInMemoryMarketDataConsentStore();
  const devFixtureEnabled = environment("INVESTING_DEV_FIXTURE") === "1";
  const fxProvider = devFixtureEnabled ? createDevFixtureFxProvider() : createFrankfurterFxProvider();
  let priceDataVersion = 0;
  let syncProgress: BrokerSyncProgress = { status: "idle", pages: 0, ordersRead: 0, positionsRead: 0, waitUntil: null, remaining: null, updatedAt: null, message: null };
  const credentials = createFileCredentialStore();
  const startupPassphrase = environment("LAVEGA_VAULT_PASSPHRASE");
  if (startupPassphrase && await credentials.status() === "locked") await credentials.unlock(startupPassphrase);
  const brokerData = createRuntimeBrokerDataCache(await credentials.status() === "unlocked" ? await credentials.getBrokerData() : {});
  if (devFixtureEnabled) {
    brokerData.restore(createDevFixtureBrokerData());
    await priceStore.upsert(createDevFixturePriceBars());
    priceDataVersion += 1;
  }
  const restoreBrokerData = async () => brokerData.restore(await credentials.getBrokerData());
  const updateProgress = (event: Trading212DiagnosticEvent) => {
    const updatedAt = new Date().toISOString();
    if (event.type === "history-page") {
      syncProgress = { ...syncProgress, status: "running", pages: event.page, ordersRead: event.ordersRead, waitUntil: null, updatedAt, message: event.hasNext ? "Order history is loading" : "Order history is complete" };
    } else if (event.type === "cash-history-page") {
      syncProgress = { ...syncProgress, status: "running", updatedAt, message: `${event.history === "transactions" ? "Cash transaction" : "Dividend"} history ${event.hasNext ? "is loading" : "is complete"}` };
    } else if (event.type === "wait") {
      syncProgress = { ...syncProgress, status: "waiting", waitUntil: new Date(Date.now() + event.waitMs).toISOString(), remaining: 0, updatedAt, message: "Waiting for new Trading 212 API capacity" };
    } else if (event.type === "positions") {
      syncProgress = { ...syncProgress, status: "running", positionsRead: event.count, updatedAt, message: "Positions are loaded" };
    } else {
      syncProgress = { ...syncProgress, status: "running", remaining: event.remaining, updatedAt, message: event.status === 429 ? "Trading 212 rate limit response received" : syncProgress.message };
    }
  };
  const scheduledBrokerSync = createRuntimeBrokerSync(async (result) => {
    brokerData.apply(result);
    if (result.outcomes.some((outcome) => outcome.result !== null)) await credentials.putBrokerData(brokerData.snapshot());
  }, credentials, createFileBrokerSyncStateStore(), updateProgress);
  const brokerSync = async (force: boolean) => {
    if (devFixtureEnabled) {
      syncProgress = { status: "completed", pages: 0, ordersRead: 0, positionsRead: 0, waitUntil: null, remaining: null, updatedAt: new Date().toISOString(), message: "Dev fixture data active — real broker sync skipped" };
      return { outcomes: [], problems: [] };
    }
    if (syncProgress.status !== "running" && syncProgress.status !== "waiting") {
      syncProgress = { status: "running", pages: 0, ordersRead: 0, positionsRead: 0, waitUntil: null, remaining: null, updatedAt: new Date().toISOString(), message: "Broker synchronization started" };
    }
    try {
      const result = await scheduledBrokerSync(force);
      const trading212Problem = result.problems.find((problem) => problem.startsWith("trading212:"));
      syncProgress = { ...syncProgress, status: trading212Problem ? "problem" : "completed", waitUntil: null, updatedAt: new Date().toISOString(), message: trading212Problem ?? "Trading 212 synchronization completed" };
      return result;
    } catch (error) {
      syncProgress = { ...syncProgress, status: "problem", waitUntil: null, updatedAt: new Date().toISOString(), message: error instanceof Error ? error.message : "Broker synchronization failed" };
      throw error;
    }
  };
  const dashboardCache = new Map<string, { version: number; data: InvestingDashboardData }>();
  const dashboardReader = async ({ symbol }: { symbol?: string }) => {
    const { positions, trades, dividends, cashBalances, cashFlows, problems, dataVersion } = brokerData.read();
    const version = dataVersion + priceDataVersion;
    const selectedBenchmarks = options.benchmarkSymbols
      ? await options.benchmarkSymbols(LOCAL_TENANT_ID)
      : (await benchmarkSelectionStore.get(LOCAL_TENANT_ID)).symbols;
    const cacheKey = `${symbol?.trim().toUpperCase() ?? ""}\u0000${selectedBenchmarks.join("\u0000")}`;
    const cached = dashboardCache.get(cacheKey);
    if (cached?.version === version) return cached.data;
    const symbols = [...new Set([...positions.map((position) => position.symbol), ...trades.map((trade) => trade.symbol)])];
    const priceBars = (await Promise.all(symbols.map((value) => priceStore.getRange(LOCAL_TENANT_ID, value, "0000-01-01", "9999-12-31")))).flat();
    const benchmarkBars = (await Promise.all(selectedBenchmarks.map((benchmark) => priceStore.getRange(LOCAL_TENANT_ID, benchmark, "0000-01-01", "9999-12-31")))).flat();
    const fxResult = await fxProvider.getLatestRate();
    const data = buildInvestingDashboard({ positions, trades, dividends, cashBalances, cashFlows, priceBars, benchmarkBars, benchmarkInstruments: selectedBenchmarks.map((benchmark) => ({ symbol: benchmark, name: benchmark, exchange: "Yahoo Finance", currency: benchmarkBars.find((bar) => bar.symbol === benchmark)?.currency ?? "EUR" })), presentationCurrency: "EUR", fxRates: fxResult.rate, selectedSymbol: symbol, problems: [...problems, ...fxResult.problems], dataVersion: version });
    dashboardCache.set(cacheKey, { version, data });
    return data;
  };
  const credentialDependencies = {
    configureBroker: createRuntimeBrokerCredentialSetup(credentials, restoreBrokerData),
    credentialStatus: () => credentials.status(),
    unlockCredentials: async (passphrase: string) => {
      const unlocked = await credentials.unlock(passphrase);
      if (unlocked) await restoreBrokerData();
      return unlocked;
    },
    brokerSyncStatus: () => ({ ...syncProgress }),
    priceSyncTargets: async (tenantId: string) => {
      const { positions, trades } = brokerData.read();
      const benchmarkSymbols = options.benchmarkSymbols ? await options.benchmarkSymbols(tenantId) : (await benchmarkSelectionStore.get(tenantId)).symbols;
      return discoverPriceSyncTargets({ positions, trades, benchmarkSymbols });
    },
  };
  const onPriceDataChanged = () => { priceDataVersion += 1; };
  const agentRunStore = options.agentRunStore ?? createFileAgentRunStore();
  let agentInFlight: Promise<AgentRunRecord> | null = null;
  const runPortfolioAgentOnce = async (): Promise<AgentRunRecord> => {
    if (agentInFlight) return agentInFlight;
    const record: AgentRunRecord = { id: randomUUID(), startedAt: new Date().toISOString(), finishedAt: null, status: "running", summary: null, error: null };
    void agentRunStore.put(record);
    const run = (async () => {
      try {
        if ((await credentials.status()) === "unlocked") await restoreBrokerData();
        const summary = await (options.runAgent ?? runPortfolioAgent)({ prompt: PORTFOLIO_AGENT_PROMPT, tools: createPortfolioAgentTools({ readBrokerData: () => brokerData.read(), priceStore }) });
        const done: AgentRunRecord = { ...record, finishedAt: new Date().toISOString(), status: "done", summary };
        await agentRunStore.put(done);
        return done;
      } catch (error) {
        const failed: AgentRunRecord = { ...record, finishedAt: new Date().toISOString(), status: "error", error: error instanceof Error ? error.message : "Portfolio agent run failed" };
        await agentRunStore.put(failed);
        throw error;
      }
    })();
    agentInFlight = run;
    try {
      return await run;
    } finally {
      if (agentInFlight === run) agentInFlight = null;
    }
  };
  const withPortfolioAgentRoute = (honoApp: ReturnType<typeof createApp>): RuntimeApp => {
    honoApp.post("/api/agents/portfolio/run", async (c) => {
      try {
        return c.json({ summary: (await runPortfolioAgentOnce()).summary });
      } catch (error) {
        return c.json({ problems: [error instanceof Error ? error.message : "Portfolio agent run failed"] }, 502);
      }
    });
    return Object.assign(honoApp, { runPortfolioAgentOnce });
  };
  const sectorDependencies = { sectorStore: createFileSectorProfileStore(runtimeSectorStoreFile()) };
  if (!dsn) return withPortfolioAgentRoute(createApp({ brokerSync, ...credentialDependencies, ...sectorDependencies, store: priceStore, fxProvider, benchmarkSelectionStore, marketDataConsentStore, dashboardReader, onPriceDataChanged }));
  const sentry = await import("@sentry/node");
  sentry.init({ dsn, environment: process.env.NODE_ENV });
  return withPortfolioAgentRoute(createApp({ brokerSync, ...credentialDependencies, ...sectorDependencies, store: priceStore, fxProvider, benchmarkSelectionStore, marketDataConsentStore, dashboardReader, onPriceDataChanged, problemReporter: createProblemReporter({ dsn, sentry }) }));
}
