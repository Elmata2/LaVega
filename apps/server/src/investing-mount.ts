import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasBrokerSyncTime } from "@lavega/adapters";
import * as Sentry from "@sentry/node";
import { LOCAL_TENANT_ID } from "@lavega/core";
import { listBrokerSyncTenants } from "@lavega/database";
import { syncBudgets } from "@lavega/investing-server/src/priceOrchestrator.js";
import { createProblemReporter } from "@lavega/investing-server/src/observability.js";
import { createDashboardCache, createRuntimeApp } from "@lavega/investing-server/src/index.js";
import { getAuth, verifiedSession } from "./auth.js";
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
  createFilePriceStore,
  runtimePriceStoreFile,
} from "@lavega/investing-server/src/filePriceStore.js";
import { runtimeDatabase } from "@lavega/investing-server/src/credentialStore.js";
import {
  createNeonBenchmarkSelectionStore,
  createNeonInvestingLayoutStore,
  createNeonMarketDataConsentStore,
  createNeonPersonalNetWorthStore,
  createNeonPriceStore,
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
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
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
  const runtimeApp = await createRuntimeApp({
    resolveTenantId: currentInvestingTenant,
    priceStore: database
      ? createNeonPriceStore(database, currentInvestingTenant)
      : createFilePriceStore(runtimePriceStoreFile()),
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

export async function forwardInvesting(
  request: Request,
  tenantId = LOCAL_TENANT_ID,
): Promise<Response> {
  const runtime = await getInvestingFetch();
  /* initServerSentry runs once for the shared process and tags everything
   * app=server. Anything captured while the investing app handles the request
   * is its own, so it is re-tagged for the duration of this call. */
  return Sentry.withScope((scope) => {
    scope.setTag("app", "investing-server");
    return withInvestingTenant(tenantId, () => runtime.fetch(rewriteInvestingRequest(request)));
  });
}

export async function runInvestingCron(request: Request): Promise<Response> {
  if (!authorizedCronRequest(request))
    return Response.json({ problems: ["Unauthorized cron request"] }, { status: 401 });
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
  const origin = new URL(request.url).origin;
  const results = [];
  let reached = 0;
  for (const tenantId of tenants) {
    /* /api/brokers/sync runs the tenant's price slice itself, under the same
     * deadline, so one request is the whole tenant and one slice bounds it. */
    if (!hasBrokerSyncTime(deadlineMs, sliceMs ?? 0)) break;
    reached += 1;
    try {
      const broker = await forwardInvesting(
        new Request(`${origin}/api/brokers/sync`, { method: "POST" }),
        tenantId,
      );
      results.push({ tenantId, brokerStatus: broker.status });
    } catch (error) {
      cronProblem(`Tenant ${tenantId} sync failed`, error);
      results.push({ tenantId, error: "Tenant sync failed" });
    }
  }
  if (tenants.length > 0 && reached === 0) {
    cronProblem(
      "No tenant fits the cron budget; check INVESTING_SYNC_BUDGET_MS and INVESTING_PRICE_SYNC_BUDGET_MS",
    );
    return Response.json({ problems: ["Sync budget too small for one tenant"] }, { status: 500 });
  }
  return Response.json({ tenants: results, skipped: tenants.length - reached });
}
