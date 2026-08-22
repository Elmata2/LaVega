import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeApp } from "@lavega/investing-server/src/index.js";
import { createDockerFetch } from "@lavega/investing-server/src/docker.js";
import { createFileBenchmarkSelectionStore, runtimeBenchmarkSelectionFile } from "@lavega/investing-server/src/fileBenchmarkSelectionStore.js";
import { createFileMarketDataConsentStore, runtimeMarketDataConsentFile } from "@lavega/investing-server/src/fileMarketDataConsentStore.js";
import { createFilePriceStore, runtimePriceStoreFile } from "@lavega/investing-server/src/filePriceStore.js";

const serverDir = dirname(fileURLToPath(import.meta.url));
const defaultInvestingDist = resolve(serverDir, "../../investing-web/dist");

/** Built investing SPA path. Set in production Docker (`INVESTING_WEB_DIST`). */
export function investingDist(): string {
  return process.env.INVESTING_WEB_DIST?.trim() || defaultInvestingDist;
}

/** Mount investing API + `/investing` UI when the investing-web build exists. */
export function shouldMountInvesting(): boolean {
  if (process.env.INVESTING_MOUNT === "0") return false;
  return existsSync(investingDist());
}

let investingFetch: ((request: Request) => Promise<Response>) | null = null;

async function getInvestingFetch(): Promise<(request: Request) => Promise<Response>> {
  if (investingFetch) return investingFetch;
  const runtimeApp = await createRuntimeApp({
    priceStore: createFilePriceStore(runtimePriceStoreFile()),
    benchmarkSelectionStore: createFileBenchmarkSelectionStore(runtimeBenchmarkSelectionFile()),
    marketDataConsentStore: createFileMarketDataConsentStore(runtimeMarketDataConsentFile()),
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

export async function forwardInvesting(request: Request): Promise<Response> {
  const fetch = await getInvestingFetch();
  return fetch(rewriteInvestingRequest(request));
}
