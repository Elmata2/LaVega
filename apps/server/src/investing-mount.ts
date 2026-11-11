import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPartnerBudgetClient, hasBrokerSyncTime, PartnerBudget } from "@lavega/adapters";
import * as Sentry from "@sentry/node";
import { LOCAL_TENANT_ID } from "@lavega/core";
import { listBrokerSyncTenants } from "@lavega/database";
import { syncBudgets } from "@lavega/investing-server/src/priceOrchestrator.js";
import { createProblemReporter } from "@lavega/investing-server/src/observability.js";
import { createDashboardCache, createRuntimeApp } from "@lavega/investing-server/src/index.js";
import { getAuth, verifiedSession } from "./auth.js";
import { secretsMatch } from "./secrets.js";
import { createDockerFetch } from "@lavega/investing-server/src/docker.js";
import {
  createFileBenchmarkSelectionStore,
  runtimeBenchmarkSelectionFile,
} from "@lavega/investing-server/src/fileBenchmarkSelectionStore.js";
import {
  createFileMarketDataConsentStore,
  runtimeMarketDataConsentFile,
} from "@lavega/investing-server/src/fileMarketDataConsentStore.js";
import {
  createFileInvestingLayoutStore,
  runtimeInvestingLayoutFile,
} from "@lavega/investing-server/src/fileInvestingLayoutStore.js";
import {
  createFileIdentifierOverrideStore,
  createFileIdentifierSelectionSettingStore,
  runtimeIdentifierOverrideFile,
  runtimeIdentifierSelectionSettingFile,
} from "@lavega/investing-server/src/fileIdentifierSelectionStore.js";
import {
  createFileAccountWrapperStore,
  runtimeAccountWrapperFile,
} from "@lavega/investing-server/src/fileAccountWrapperStore.js";
import {
  createFileSharedPriceStore,
  runtimePriceStoreFile,
} from "@lavega/investing-server/src/filePriceStore.js";
import {
  createFileCashFlowStore,
  runtimeCashFlowStoreFile,
} from "@lavega/investing-server/src/fileCashFlowStore.js";
import { runtimeDatabase } from "@lavega/investing-server/src/credentialStore.js";
import {
  createNeonAccountWrapperStore,
  createNeonBenchmarkSelectionStore,
  createNeonIdentifierOverrideStore,
  createNeonIdentifierSelectionSettingStore,
  createNeonInvestingLayoutStore,
  createNeonCashFlowStore,
  createNeonMarketDataConsentStore,
  createNeonPartnerBudget,
  createNeonPersonalNetWorthStore,
  createNeonSharedPriceStore,
  createNeonSectorCorrectionStore,
  createNeonSectorInferenceSettingStore,
} from "@lavega/investing-server/src/neonStores.js";
import { createInMemoryPersonalNetWorthStore } from "@lavega/investing-server/src/personalNetWorthStore.js";
import { createNeonSectorProfileStore } from "@lavega/investing-server/src/neonSectorProfileStore.js";
import {
  createFileSectorCorrectionStore,
  runtimeSectorCorrectionFile,
} from "@lavega/investing-server/src/fileSectorCorrectionStore.js";
import {
  createFileSectorInferenceSettingStore,
  runtimeSectorInferenceSettingFile,
} from "@lavega/investing-server/src/fileSectorInferenceSettingStore.js";
import {
  createFileSectorProfileStore,
  runtimeSectorStoreFile,
} from "@lavega/investing-server/src/fileSectorProfileStore.js";

const serverDir = dirname(fileURLToPath(import.meta.url));
const defaultInvestingDist = resolve(serverDir, "../../investing-web/dist");
/* Runtime dependencies must die with each request. Dashboard data may survive
 * for its bounded TTL because it is tenant-keyed and contains no connections. */
const dashboardCache = createDashboardCache();
/* Without a database the budget is this process's own, so it has to outlive
 * the per-request runtime like the dashboard cache does. With a database it is
 * Neon's, and the runtime builds it from that request's pool. */
const localPartnerBudget = createPartnerBudgetClient(PartnerBudget.memoryLayer);

/** Built investing SPA path. Set in production Docker (`INVESTING_WEB_DIST`). */
export function investingDist(): string {
  return process.env.INVESTING_WEB_DIST?.trim() || defaultInvestingDist;
}

/**
 * Whether this server answers the investing API and serves its UI.
 *
 * The default asks whether the built SPA sits next to this server, which is the
 * right question for the Docker image that ships both. It is the wrong question
 * on Vercel: there the CDN serves those files and the function never has them
 * on disk, so the check said no and `/api/investing/*` 404'd while `/investing/`
 * loaded — a dashboard with no backend. INVESTING_MOUNT answers it outright.
 */
export function shouldMountInvesting(): boolean {
  if (process.env.INVESTING_MOUNT === "0") return false;
  if (process.env.INVESTING_MOUNT === "1") return true;
  return existsSync(investingDist());
}

/* The investing runtime is one long-lived app, so tenant identity cannot live
 * on it — it has to travel with the request. An async-local scope carries it
 * without a header, which means there is no inbound value anything could spoof. */
const tenantScope = new AsyncLocalStorage<string>();

/** The tenant of the request being handled, or the local tenant outside one. */
export function currentInvestingTenant(): string {
  return tenantScope.getStore() ?? LOCAL_TENANT_ID;
}

export function withInvestingTenant<T>(tenantId: string, fn: () => T): T {
  return tenantScope.run(tenantId, fn);
}

/**
 * Who the nightly cron syncs: everyone with a connected broker, least recently
 * synced first (SQL has already deduplicated). Without authentication there is
 * one local tenant. Throws when the database cannot be read; the caller answers
 * that without the cause.
 */
export async function investingCronTenantIds(): Promise<string[]> {
  const database = runtimeDatabase();
  /* getAuth() is set only together with a runtime database. */
  if (!getAuth() || !database) return [LOCAL_TENANT_ID];
  return listBrokerSyncTenants(database);
}

const reportCronProblem = createProblemReporter();
const cronProblem = (message: string, cause?: unknown) =>
  reportCronProblems([cause instanceof Error ? `${message}: ${cause.message}` : message]);
const reportCronProblems = (problems: string[]) =>
  reportCronProblem({ source: "broker-sync", problems });

export function authorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return secretsMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

/**
 * The tenant an investing request belongs to, or `null` when it may not be
 * served. Without authentication configured (local dev, self-hosted) there is
 * one local tenant; with it, only a verified session names a tenant.
 */
export async function investingTenantId(request: Request): Promise<string | null> {
  if (!getAuth()) return LOCAL_TENANT_ID;
  const session = await verifiedSession(request);
  return session?.user?.id ?? null;
}

/** The `/api/<namespace>` segments the investing app answers, read from its own
 *  routing table. This server holding a second, hand-written copy is what let
 *  `/api/agents` ship and 404: the copy went stale and nobody noticed. */
export async function investingOwnsApiPath(path: string): Promise<boolean> {
  const { apiNamespaces } = await getInvestingFetch();
  return apiNamespaces.has(path.split("/")[2] ?? "");
}

async function getInvestingFetch(): Promise<{
  fetch: (request: Request) => Promise<Response>;
  apiNamespaces: Set<string>;
}> {
  /* With a database these stores are per user and survive the invocation.
   * Without one they are files, which is what local and self-hosted runs want
   * and what Vercel's /tmp cannot actually keep. */
  const database = runtimeDatabase();
  /* Prices are public reference data, stored once per instrument for every
   * user (issue #307): the database store is shared, and the file fallback
   * converts an old per-tenant file once. */
  const filePriceStore = database ? null : createFileSharedPriceStore(runtimePriceStoreFile());
  const runtimeApp = await createRuntimeApp({
    resolveTenantId: currentInvestingTenant,
    priceStore: database ? createNeonSharedPriceStore(database) : filePriceStore!,
    sharedPriceStore: Boolean(database),
    clearPriceCache: filePriceStore ? () => filePriceStore.clear() : undefined,
    benchmarkSelectionStore: database
      ? createNeonBenchmarkSelectionStore(database)
      : createFileBenchmarkSelectionStore(runtimeBenchmarkSelectionFile()),
    marketDataConsentStore: database
      ? createNeonMarketDataConsentStore(database)
      : createFileMarketDataConsentStore(runtimeMarketDataConsentFile()),
    // No file fallback: without a database, Personal's own PUT/DELETE route is
    // not mounted either (net-worth-routes.ts), so there is never anything to
    // read locally — an empty in-memory store answers exactly the same as a
    // real one with nothing shared yet.
    personalNetWorthStore: database
      ? createNeonPersonalNetWorthStore(database)
      : createInMemoryPersonalNetWorthStore(),
    investingLayoutStore: database
      ? createNeonInvestingLayoutStore(database)
      : createFileInvestingLayoutStore(runtimeInvestingLayoutFile()),
    identifierSelectionSettingStore: database
      ? createNeonIdentifierSelectionSettingStore(database)
      : createFileIdentifierSelectionSettingStore(runtimeIdentifierSelectionSettingFile()),
    identifierOverrideStore: database
      ? createNeonIdentifierOverrideStore(database)
      : createFileIdentifierOverrideStore(runtimeIdentifierOverrideFile()),
    accountWrapperStore: database
      ? createNeonAccountWrapperStore(database)
      : createFileAccountWrapperStore(runtimeAccountWrapperFile()),
    sectorStore: database
      ? createNeonSectorProfileStore(database)
      : createFileSectorProfileStore(runtimeSectorStoreFile()),
    sectorCorrectionStore: database
      ? createNeonSectorCorrectionStore(database)
      : createFileSectorCorrectionStore(runtimeSectorCorrectionFile()),
    sectorInferenceSettingStore: database
      ? createNeonSectorInferenceSettingStore(database)
      : createFileSectorInferenceSettingStore(runtimeSectorInferenceSettingFile()),
    dashboardCache,
    cashFlowStore: database
      ? createNeonCashFlowStore(database, currentInvestingTenant())
      : createFileCashFlowStore(runtimeCashFlowStoreFile()),
    ...(database
      ? { partnerBudget: createNeonPartnerBudget(database) }
      : { partnerBudgetClient: localPartnerBudget }),
  });
  const apiNamespaces = new Set(
    runtimeApp.routes
      .map((route) => route.path.split("/"))
      .filter((segments) => segments[1] === "api" && segments[2])
      .map((segments) => segments[2]!),
  );
  return {
    apiNamespaces,
    fetch: createDockerFetch(runtimeApp.fetch.bind(runtimeApp), investingDist()),
  };
}

/** Strip the `/investing` prefix before handing static requests to the investing server. */
export function rewriteInvestingRequest(request: Request): Request {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/investing")) return request;
  url.pathname = url.pathname.slice("/investing".length) || "/";
  return new Request(url, request);
}

/**
 * Hand one request to the investing app under `tenantId`.
 *
 * `tenantId` is REQUIRED, deliberately. It used to default to `LOCAL_TENANT_ID`
 * and `toInvestingStatic` omitted it, which is how `/investing/api/*` came to
 * be served as the local tenant with no session (security review 2026-10-17,
 * H1): a default that looks convenient is a default a future call site will
 * silently inherit. Every caller now has to name the tenant, and the SPA/static
 * callers name `LOCAL_TENANT_ID` out loud because they carry no tenant data.
 */
export async function forwardInvesting(request: Request, tenantId: string): Promise<Response> {
  const runtime = await getInvestingFetch();
  /* initServerSentry runs once for the shared process and tags everything
   * app=server. Anything captured while the investing app handles the request
   * is its own, so it is re-tagged for the duration of this call. */
  return Sentry.withScope((scope) => {
    scope.setTag("app", "investing-server");
    return withInvestingTenant(tenantId, () => runtime.fetch(rewriteInvestingRequest(request)));
  });
}

/** How many self-continuations one daily cron pass may chain. 40 x 240 s is
 *  about 2.5 h of tenant work, the cap the issue states for Hobby. */
export const CRON_MAX_HOPS = 40;

/** The cron chain has the same Vercel limit as the run chain (508 after the
 *  fifth self-request, issue #306), so it is off unless a deployment explicitly
 *  turns it on: every trigger advances the work by one budget. */
function cronChainEnabled(): boolean {
  return process.env.INVESTING_SYNC_CHAIN === "on";
}

/**
 * The daily cron worker. For each tenant it asks the investing app to drive the
 * tenant's run in this invocation (`POST /api/sync/drive`, awaited: the cron
 * invocation itself is the worker) and passes its own deadline so one tenant can
 * never eat the next one's time.
 *
 * Hobby allows one cron per day, so continuity comes from a hop chain: when the
 * budget ends with tenants left, this invocation sends ONE authenticated
 * request to the same route with `after=<last tenant>` and `hop=<n>` and ends.
 * The cursor travels in the query string; nothing is stored.
 */
export async function runInvestingCron(request: Request): Promise<Response> {
  if (!authorizedCronRequest(request))
    return Response.json({ problems: ["Unauthorized cron request"] }, { status: 401 });
  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  const hopParam = url.searchParams.get("hop");
  const hop = hopParam === null ? 0 : Number(hopParam);
  if (!Number.isInteger(hop) || hop < 0 || hop > CRON_MAX_HOPS)
    return Response.json({ problems: [`Invalid cron hop: ${hopParam}`] }, { status: 400 });
  /* One clock for the whole pass, started before the first thing that costs time. */
  const { cronMs, sliceMs } = syncBudgets((name) => process.env[name]?.trim() || undefined);
  const deadlineMs = cronMs === undefined ? undefined : Date.now() + cronMs;
  let tenants: string[];
  try {
    tenants = await investingCronTenantIds();
  } catch (error) {
    cronProblem("Could not list tenants to sync", error);
    return Response.json({ problems: ["Could not list tenants to sync"] }, { status: 503 });
  }
  /* A cursor that is no longer in the list means it left the queue: start over
   * rather than skip the tenants before it. */
  const startIndex = after === null ? 0 : Math.max(0, tenants.indexOf(after) + 1);
  const queue = tenants.slice(startIndex);
  const origin = url.origin;
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const results: Array<{ tenantId: string; status?: number; result?: unknown; error?: string }> =
    [];
  let lastProcessed: string | null = null;

  for (const tenantId of queue) {
    /* A tenant costs at most one price-slice margin more than the drive's own
     * deadline. The margin keeps the last tenant's persistence inside the pass. */
    if (!hasBrokerSyncTime(deadlineMs, sliceMs ?? 0)) break;
    /* Counted as processed once it is started: its drive returns "continue"
     * when its own budget ends, and the run resumes on its next trigger. */
    lastProcessed = tenantId;
    try {
      const response = await forwardInvesting(
        new Request(`${origin}/api/sync/drive`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ force: false, deadlineMs }),
        }),
        tenantId,
      );
      const body = (await response.json().catch(() => null)) as { result?: unknown } | null;
      results.push({ tenantId, status: response.status, result: body?.result ?? null });
    } catch (error) {
      cronProblem(`Tenant ${tenantId} sync failed`, error);
      results.push({ tenantId, error: "Tenant sync failed" });
    }
  }

  const skipped = queue.length - results.length;
  const continuing =
    skipped > 0 && lastProcessed !== null && hop < CRON_MAX_HOPS && cronChainEnabled();
  if (continuing && lastProcessed !== null) {
    const next = new URL(request.url);
    next.searchParams.set("after", lastProcessed);
    next.searchParams.set("hop", String(hop + 1));
    /* Fire and end. The next hop is a fresh invocation; holding this one open
     * for another budget would exceed the function's maxDuration. */
    void fetch(next, { headers: { authorization: `Bearer ${secret}` } }).catch((error: unknown) =>
      cronProblem("Cron continuation failed", error),
    );
  } else if (skipped > 0 && hop >= CRON_MAX_HOPS) {
    cronProblem(`Stopped at hop ${hop} with ${skipped} tenants left`);
  }

  if (queue.length > 0 && results.length === 0) {
    cronProblem(
      "No tenant fits the cron budget; check INVESTING_SYNC_BUDGET_MS and INVESTING_PRICE_SYNC_BUDGET_MS",
    );
    return Response.json({ problems: ["Sync budget too small for one tenant"] }, { status: 500 });
  }
  return Response.json({ tenants: results, skipped, hop, continued: continuing });
}
