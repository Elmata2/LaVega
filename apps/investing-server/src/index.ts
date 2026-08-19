import { app } from "./app.js";
import { createApp, type BrokerCredentialInput, type BrokerSyncProgress } from "./app.js";
import { createProblemReporter } from "./observability.js";
import { buildInvestingDashboard, type Dividend, type Position, type Trade } from "@lavega/core";
import {
  createFrankfurterFxProvider,
  createIbkrFlexAdapter,
  createTrading212Adapter,
  syncScheduledBrokers,
  type BrokerSyncStateStore,
  type PriceStore,
  type ScheduledSyncResult,
  type Trading212DiagnosticEvent,
} from "@lavega/adapters";
import { createFileCredentialStore, type RuntimeBrokerDataSnapshot } from "./fileCredentialStore.js";
import { createFileBrokerSyncStateStore } from "./fileBrokerSyncStateStore.js";

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
  const adapters = [
    {
      broker: "ibkr" as const,
      adapter: {
        async sync(input: { entity: string }) {
          const stored = await credentials.getCredentials(LOCAL_TENANT_ID, "ibkr");
          if (!stored) return { positions: [], trades: [], source: "ibkr-flex", problems: ["IBKR: credentials are not configured"] };
          return createIbkrFlexAdapter({ token: stored.token, queryId: stored.queryId, endpoint: environment("IBKR_FLEX_ENDPOINT") }).sync(input);
        },
      },
    },
    {
      broker: "trading212" as const,
      adapter: {
        async sync(input: { entity: string }) {
          const stored = await credentials.getCredentials(LOCAL_TENANT_ID, "trading212");
          if (!stored) return { positions: [], trades: [], source: "trading-212", problems: ["Trading 212: credentials are not configured"] };
          return createTrading212Adapter({
            token: stored.token,
            secret: stored.secret,
            baseUrl: environment("TRADING212_BASE_URL") ?? "https://live.trading212.com",
            diagnostics: (details) => {
              console.log(JSON.stringify({ event: "investing.trading212.http", ...details }));
              onTrading212Diagnostic?.(details);
            },
          }).sync(input);
        },
      },
    },
  ];
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

export type RuntimeAppOptions = { priceStore: PriceStore };

export function createRuntimeBrokerDataCache(initial: RuntimeBrokerDataSnapshot = {}) {
  const positionsByBroker = new Map<string, Position[]>();
  const tradesByBroker = new Map<string, Trade[]>();
  const dividendsByBroker = new Map<string, Dividend[]>();
  let problems: string[] = [];

  const restore = (snapshot: RuntimeBrokerDataSnapshot) => {
    positionsByBroker.clear();
    tradesByBroker.clear();
    dividendsByBroker.clear();
    for (const [broker, data] of Object.entries(snapshot)) {
      if (!data) continue;
      positionsByBroker.set(broker, structuredClone(data.positions));
      tradesByBroker.set(broker, structuredClone(data.trades));
      dividendsByBroker.set(broker, structuredClone(data.dividends));
    }
  };
  restore(initial);

  return {
    apply(result: ScheduledSyncResult) {
      for (const outcome of result.outcomes) {
        if (outcome.status !== "synced" || outcome.result === null) continue;
        positionsByBroker.set(outcome.broker, outcome.result.positions);
        tradesByBroker.set(outcome.broker, outcome.result.trades.map((trade, index) => ({ ...trade, id: `${outcome.broker}:${trade.brokerTradeId ?? index}` })));
        dividendsByBroker.set(outcome.broker, outcome.result.dividends ?? []);
      }
      problems = result.problems;
    },
    read() {
      return {
        positions: [...positionsByBroker.values()].flat(),
        trades: [...tradesByBroker.values()].flat(),
        dividends: [...dividendsByBroker.values()].flat(),
        problems: [...problems],
      };
    },
    restore,
    snapshot(): RuntimeBrokerDataSnapshot {
      const snapshot: RuntimeBrokerDataSnapshot = {};
      for (const broker of new Set([...positionsByBroker.keys(), ...tradesByBroker.keys(), ...dividendsByBroker.keys()])) {
        if (broker !== "ibkr" && broker !== "trading212") continue;
        snapshot[broker] = {
          positions: structuredClone(positionsByBroker.get(broker) ?? []),
          trades: structuredClone(tradesByBroker.get(broker) ?? []),
          dividends: structuredClone(dividendsByBroker.get(broker) ?? []),
        };
      }
      return snapshot;
    },
  };
}

export async function createRuntimeApp(options: RuntimeAppOptions) {
  const dsn = process.env.SENTRY_DSN;
  const priceStore = options.priceStore;
  const fxProvider = createFrankfurterFxProvider();
  let syncProgress: BrokerSyncProgress = { status: "idle", pages: 0, ordersRead: 0, positionsRead: 0, waitUntil: null, remaining: null, updatedAt: null, message: null };
  const credentials = createFileCredentialStore();
  const startupPassphrase = environment("LAVEGA_VAULT_PASSPHRASE");
  if (startupPassphrase && await credentials.status() === "locked") await credentials.unlock(startupPassphrase);
  const brokerData = createRuntimeBrokerDataCache(await credentials.status() === "unlocked" ? await credentials.getBrokerData() : {});
  const restoreBrokerData = async () => brokerData.restore(await credentials.getBrokerData());
  const updateProgress = (event: Trading212DiagnosticEvent) => {
    const updatedAt = new Date().toISOString();
    if (event.type === "history-page") {
      syncProgress = { ...syncProgress, status: "running", pages: event.page, ordersRead: event.ordersRead, waitUntil: null, updatedAt, message: event.hasNext ? "Order history is loading" : "Order history is complete" };
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
  const dashboardReader = async ({ symbol }: { symbol?: string }) => {
    const { positions, trades, dividends, problems } = brokerData.read();
    const symbols = [...new Set(positions.map((position) => position.symbol))];
    const priceBars = (await Promise.all(symbols.map((value) => priceStore.getRange(value, "0000-01-01", "9999-12-31")))).flat();
    const benchmarkBars = await priceStore.getRange("SP500", "0000-01-01", "9999-12-31");
    const fxResult = await fxProvider.getLatestRate();
    return buildInvestingDashboard({ positions, trades, dividends, priceBars, benchmarkBars, presentationCurrency: "EUR", fxRates: fxResult.rate, selectedSymbol: symbol, problems: [...problems, ...fxResult.problems] });
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
  };
  if (!dsn) return createApp({ brokerSync, ...credentialDependencies, store: priceStore, fxProvider, dashboardReader });
  const sentry = await import("@sentry/node");
  sentry.init({ dsn, environment: process.env.NODE_ENV });
  return createApp({ brokerSync, ...credentialDependencies, store: priceStore, fxProvider, dashboardReader, problemReporter: createProblemReporter({ dsn, sentry }) });
}
