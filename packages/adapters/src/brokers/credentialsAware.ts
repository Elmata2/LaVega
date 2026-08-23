import { LOCAL_TENANT_ID, type CredentialStore } from "@lavega/core";
import type { BrokerAccessAdapter } from "./BrokerAccessAdapter.js";
import { createIbkrFlexAdapter } from "./ibkr/flexAdapter.js";
import { createTrading212Adapter, type Trading212DiagnosticEvent } from "./trading212/index.js";

export type ScheduledBrokerName = "ibkr" | "trading212";

export type CredentialsAwareBrokerAdaptersOptions = {
  credentials: CredentialStore;
  tenantId?: string;
  /** Config override for tests; defaults to reading process.env. */
  environment?: (name: string) => string | undefined;
  onTrading212Diagnostic?: (event: Trading212DiagnosticEvent) => void;
};

function defaultEnvironment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

/** One BrokerAccessAdapter per scheduled broker, with credential lookup and
 *  env config resolved inside each adapter's own module instead of server
 *  wiring. The "not configured" fallbacks mirror the wording the server used
 *  to fabricate; syncScheduledBrokers normally refuses to call sync without
 *  credentials, so these are the wording of record for direct callers. */
export function createCredentialsAwareBrokerAdapters(options: CredentialsAwareBrokerAdaptersOptions): { broker: ScheduledBrokerName; adapter: BrokerAccessAdapter }[] {
  const tenantId = options.tenantId ?? LOCAL_TENANT_ID;
  const environment = options.environment ?? defaultEnvironment;
  return [
    {
      broker: "ibkr",
      adapter: {
        async sync(input) {
          const stored = await options.credentials.getCredentials(tenantId, "ibkr");
          if (!stored) return { positions: [], trades: [], source: "ibkr-flex", problems: ["IBKR: credentials are not configured"] };
          return createIbkrFlexAdapter({ token: stored.token, queryId: stored.queryId, endpoint: environment("IBKR_FLEX_ENDPOINT") }).sync(input);
        },
      },
    },
    {
      broker: "trading212",
      adapter: {
        async sync(input) {
          const stored = await options.credentials.getCredentials(tenantId, "trading212");
          if (!stored) return { positions: [], trades: [], source: "trading-212", problems: ["Trading 212: credentials are not configured"] };
          return createTrading212Adapter({
            token: stored.token,
            secret: stored.secret,
            baseUrl: environment("TRADING212_BASE_URL") ?? "https://live.trading212.com",
            diagnostics: (details) => {
              console.log(JSON.stringify({ event: "investing.trading212.http", ...details }));
              options.onTrading212Diagnostic?.(details);
            },
          }).sync(input);
        },
      },
    },
  ];
}
