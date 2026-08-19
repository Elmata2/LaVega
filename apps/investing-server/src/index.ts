import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { createApp } from "./app.js";
import { createProblemReporter } from "./observability.js";
import {
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

export function createRuntimeBrokerSync(): (force: boolean) => Promise<ScheduledSyncResult> {
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
  return (force) => syncScheduledBrokers({ adapters, credentials, state, tenantId: LOCAL_TENANT_ID, entity, force });
}

export async function createRuntimeApp() {
  const dsn = process.env.SENTRY_DSN;
  const brokerSync = createRuntimeBrokerSync();
  if (!dsn) return createApp({ brokerSync });
  const sentry = await import("@sentry/node");
  sentry.init({ dsn, environment: process.env.NODE_ENV });
  return createApp({ brokerSync, problemReporter: createProblemReporter({ dsn, sentry }) });
}
