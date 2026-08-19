import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { createApp } from "./app.js";
import { createProblemReporter } from "./observability.js";
import { buildInvestingDashboard, type Dividend, type Position, type Trade } from "@lavega/core";
import {
  createInMemoryPriceStore,
  createFrankfurterFxProvider,
  createIbkrFlexAdapter,
  createLocalCredentialStore,
  createMemoryBrokerSyncStateStore,
  createTrading212Adapter,
  syncScheduledBrokers,
  type ScheduledSyncResult,
} from "@lavega/adapters";

export { app };

const port = Number(process.env.PORT) || 8788;
const LOCAL_TENANT_ID = "local";

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtimeApp = await createRuntimeApp();
  serve({ fetch: runtimeApp.fetch, port, hostname: "0.0.0.0" }, (info) => {
    console.log(`LaVega investing server listening on 0.0.0.0:${info.port}`);
  });
}

function environment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function createRuntimeBrokerSync(onCompleted?: (result: ScheduledSyncResult) => void): (force: boolean) => Promise<ScheduledSyncResult> {
  const credentials = createLocalCredentialStore(environment("LAVEGA_VAULT_DB"));
  const state = createMemoryBrokerSyncStateStore();
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
          return createTrading212Adapter({ token: stored.token, secret: stored.secret, baseUrl: environment("TRADING212_BASE_URL") ?? "https://live.trading212.com" }).sync(input);
        },
      },
    },
  ];
  return async (force) => {
    const result = await syncScheduledBrokers({ adapters, credentials, state, tenantId: LOCAL_TENANT_ID, entity, force });
    onCompleted?.(result);
    return result;
  };
}

export type RuntimeAppOptions = { priceStore?: ReturnType<typeof createInMemoryPriceStore> };

export async function createRuntimeApp(options: RuntimeAppOptions = {}) {
  const dsn = process.env.SENTRY_DSN;
  const priceStore = options.priceStore ?? createInMemoryPriceStore();
  const fxProvider = createFrankfurterFxProvider();
  let positions: Position[] = [];
  let trades: Trade[] = [];
  let dividends: Dividend[] = [];
  let syncProblems: string[] = [];
  const brokerSync = createRuntimeBrokerSync((result) => {
    const outcomes = result.outcomes.filter((outcome) => outcome.result !== null);
    positions = outcomes.flatMap((outcome) => outcome.result?.positions ?? []);
    trades = outcomes.flatMap((outcome) => (outcome.result?.trades ?? []).map((trade, index) => ({ ...trade, id: `${outcome.broker}:${trade.brokerTradeId ?? index}` })));
    dividends = outcomes.flatMap((outcome) => outcome.result?.dividends ?? []);
    syncProblems = result.problems;
  });
  const dashboardReader = async ({ symbol }: { symbol?: string }) => {
    const symbols = [...new Set(positions.map((position) => position.symbol))];
    const priceBars = (await Promise.all(symbols.map((value) => priceStore.getRange(value, "0000-01-01", "9999-12-31")))).flat();
    const benchmarkBars = await priceStore.getRange("SP500", "0000-01-01", "9999-12-31");
    const fxResult = await fxProvider.getLatestRate();
    return buildInvestingDashboard({ positions, trades, dividends, priceBars, benchmarkBars, presentationCurrency: "EUR", fxRates: fxResult.rate, selectedSymbol: symbol, problems: [...syncProblems, ...fxResult.problems] });
  };
  if (!dsn) return createApp({ brokerSync, store: priceStore, fxProvider, dashboardReader });
  const sentry = await import("@sentry/node");
  sentry.init({ dsn, environment: process.env.NODE_ENV });
  return createApp({ brokerSync, store: priceStore, fxProvider, dashboardReader, problemReporter: createProblemReporter({ dsn, sentry }) });
}
