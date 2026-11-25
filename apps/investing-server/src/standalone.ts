import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createRuntimeApp } from "./index.js";
import { redactProblem } from "@lavega/core";
import { createFileSharedPriceStore, runtimePriceStoreFile } from "./filePriceStore.js";
import {
  createFileBenchmarkSelectionStore,
  runtimeBenchmarkSelectionFile,
} from "./fileBenchmarkSelectionStore.js";
import {
  createFileMarketDataConsentStore,
  runtimeMarketDataConsentFile,
} from "./fileMarketDataConsentStore.js";
import {
  createFileInvestingLayoutStore,
  runtimeInvestingLayoutFile,
} from "./fileInvestingLayoutStore.js";
import {
  createFileIdentifierOverrideStore,
  createFileIdentifierSelectionSettingStore,
  runtimeIdentifierOverrideFile,
  runtimeIdentifierSelectionSettingFile,
} from "./fileIdentifierSelectionStore.js";
import {
  createFileAccountWrapperStore,
  runtimeAccountWrapperFile,
} from "./fileAccountWrapperStore.js";
import {
  createFileDisposalLabelStore,
  runtimeDisposalLabelFile,
} from "./fileDisposalLabelStore.js";
import { createDevFixturePersonalNetWorthSeed } from "./devFixture.js";
import { createInMemoryAgentMemoryStore } from "./inMemoryAgentMemory.js";
import { createInMemoryPersonalNetWorthStore } from "./personalNetWorthStore.js";

const port = Number(process.env.PORT) || 8788;
const serverDir = dirname(fileURLToPath(import.meta.url));
const staticRoot =
  process.env.INVESTING_WEB_DIST?.trim() || resolve(serverDir, "../../investing-web/dist");

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=UTF-8",
  ".html": "text/html; charset=UTF-8",
  ".js": "text/javascript; charset=UTF-8",
  ".json": "application/json; charset=UTF-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const isApiRequest = (pathname: string) => pathname === "/health" || pathname.startsWith("/api/");

type ApplicationFetch = (request: Request) => Response | Promise<Response>;

export function createStaticFetch(applicationFetch: ApplicationFetch, root = staticRoot) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (isApiRequest(url.pathname) || request.method !== "GET") return applicationFetch(request);

    let relativePath: string;
    try {
      relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const candidate = normalize(join(root, relativePath));
    if (candidate !== root && !candidate.startsWith(`${root}/`))
      return new Response("Not found", { status: 404 });

    const serveFile = async (path: string) => {
      try {
        const body = await readFile(path);
        return new Response(body, {
          headers: { "content-type": contentTypes[extname(path)] ?? "application/octet-stream" },
        });
      } catch {
        return null;
      }
    };

    return (
      (await serveFile(candidate)) ??
      (await serveFile(join(root, "index.html"))) ??
      new Response("Not found", { status: 404 })
    );
  };
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  /* One shared, instrument-keyed price series for this installation, in a file
   * store (issue #307). It converts an old per-tenant `prices.json` once. */
  const priceStoreFile = runtimePriceStoreFile();
  const priceStore = createFileSharedPriceStore(priceStoreFile);
  const runtimeApp = await createRuntimeApp({
    priceStore,
    sharedPriceStore: false,
    clearPriceCache: () => priceStore.clear(),
    benchmarkSelectionStore: createFileBenchmarkSelectionStore(runtimeBenchmarkSelectionFile()),
    marketDataConsentStore: createFileMarketDataConsentStore(runtimeMarketDataConsentFile()),
    investingLayoutStore: createFileInvestingLayoutStore(runtimeInvestingLayoutFile()),
    identifierSelectionSettingStore: createFileIdentifierSelectionSettingStore(
      runtimeIdentifierSelectionSettingFile(),
    ),
    identifierOverrideStore: createFileIdentifierOverrideStore(runtimeIdentifierOverrideFile()),
    accountWrapperStore: createFileAccountWrapperStore(runtimeAccountWrapperFile()),
    disposalLabelStore: createFileDisposalLabelStore(runtimeDisposalLabelFile()),
    // The dev fixture answers the Personal side of the net-worth bridge too, so
    // a local run can show the combined figure (WS4.7 #298). Never production:
    // this only mounts when the fixture itself is on.
    ...(process.env.INVESTING_DEV_FIXTURE === "1"
      ? {
          agentMemory: createInMemoryAgentMemoryStore(),
          personalNetWorthStore: createInMemoryPersonalNetWorthStore(
            createDevFixturePersonalNetWorthSeed(),
          ),
        }
      : {}),
  });
  serve(
    { fetch: createStaticFetch(runtimeApp.fetch, staticRoot), port, hostname: "0.0.0.0" },
    (info) => {
      console.log(`LaVega investing standalone server listening on 0.0.0.0:${info.port}`);
    },
  );
  if (process.env.LAVEGA_PORTFOLIO_AGENT === "1") {
    const timer = setInterval(
      () => {
        runtimeApp
          .runPortfolioAgentOnce()
          .then((record) =>
            console.log(
              redactProblem(
                `Portfolio agent run ${record.status}: ${record.summary ?? record.error ?? ""}`,
              ),
            ),
          )
          .catch((error) =>
            console.error(
              redactProblem(
                `Portfolio agent run failed: ${error instanceof Error ? error.message : error}`,
              ),
            ),
          );
      },
      6 * 60 * 60 * 1000,
    );
    timer.unref();
  }
}
