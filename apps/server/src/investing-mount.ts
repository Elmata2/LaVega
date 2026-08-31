import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_TENANT_ID } from "@lavega/core";
import { createRuntimeApp } from "@lavega/investing-server/src/index.js";
import { getAuth, verifiedSession } from "./auth.js";
import { createDockerFetch } from "@lavega/investing-server/src/docker.js";
import { createFileBenchmarkSelectionStore, runtimeBenchmarkSelectionFile } from "@lavega/investing-server/src/fileBenchmarkSelectionStore.js";
import { createFileMarketDataConsentStore, runtimeMarketDataConsentFile } from "@lavega/investing-server/src/fileMarketDataConsentStore.js";
import { createFilePriceStore, runtimePriceStoreFile } from "@lavega/investing-server/src/filePriceStore.js";
import { runtimeDatabase } from "@lavega/investing-server/src/credentialStore.js";
import { createNeonBenchmarkSelectionStore, createNeonMarketDataConsentStore, createNeonPriceStore } from "@lavega/investing-server/src/neonStores.js";

const serverDir = dirname(fileURLToPath(import.meta.url));
const defaultInvestingDist = resolve(serverDir, "../../investing-web/dist");

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
 * The tenant an investing request belongs to, or `null` when it may not be
 * served. Without authentication configured (local dev, self-hosted) there is
 * one local tenant; with it, only a verified session names a tenant.
 */
export async function investingTenantId(request: Request): Promise<string | null> {
  if (!getAuth()) return LOCAL_TENANT_ID;
  const session = await verifiedSession(request);
  return session?.user?.id ?? null;
}

let investingFetch: ((request: Request) => Promise<Response>) | null = null;

async function getInvestingFetch(): Promise<(request: Request) => Promise<Response>> {
  if (investingFetch) return investingFetch;
  /* With a database these stores are per user and survive the invocation.
   * Without one they are files, which is what local and self-hosted runs want
   * and what Vercel's /tmp cannot actually keep. */
  const database = runtimeDatabase();
  const runtimeApp = await createRuntimeApp({
    resolveTenantId: currentInvestingTenant,
    priceStore: database ? createNeonPriceStore(database, currentInvestingTenant) : createFilePriceStore(runtimePriceStoreFile()),
    benchmarkSelectionStore: database ? createNeonBenchmarkSelectionStore(database) : createFileBenchmarkSelectionStore(runtimeBenchmarkSelectionFile()),
    marketDataConsentStore: database ? createNeonMarketDataConsentStore(database) : createFileMarketDataConsentStore(runtimeMarketDataConsentFile()),
  });
  investingFetch = createDockerFetch(runtimeApp.fetch.bind(runtimeApp), investingDist());
  return investingFetch;
}

/** Strip the `/investing` prefix before handing static requests to the investing server. */
export function rewriteInvestingRequest(request: Request): Request {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/investing")) return request;
  url.pathname = url.pathname.slice("/investing".length) || "/";
  return new Request(url, request);
}

export async function forwardInvesting(request: Request, tenantId = LOCAL_TENANT_ID): Promise<Response> {
  const fetch = await getInvestingFetch();
  return withInvestingTenant(tenantId, () => fetch(rewriteInvestingRequest(request)));
}
