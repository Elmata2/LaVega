import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { createRuntimeApp } from "./index.js";
import { createFilePriceStore } from "./filePriceStore.js";

const port = Number(process.env.PORT) || 8788;
const staticRoot = process.env.INVESTING_WEB_DIST ?? join(process.cwd(), "apps/investing-web", "dist");

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

export function createDockerFetch(applicationFetch: ApplicationFetch, root = staticRoot) {
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
    if (candidate !== root && !candidate.startsWith(`${root}/`)) return new Response("Not found", { status: 404 });

    const serveFile = async (path: string) => {
      try {
        const body = await readFile(path);
        return new Response(body, { headers: { "content-type": contentTypes[extname(path)] ?? "application/octet-stream" } });
      } catch {
        return null;
      }
    };

    return (await serveFile(candidate)) ?? (await serveFile(join(root, "index.html"))) ?? new Response("Not found", { status: 404 });
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtimeApp = await createRuntimeApp({ priceStore: createFilePriceStore(process.env.INVESTING_PRICE_STORE_FILE ?? "/data/prices.json") });
  serve({ fetch: createDockerFetch(runtimeApp.fetch, staticRoot), port, hostname: "0.0.0.0" }, (info) => {
    console.log(`LaVega investing Docker server listening on 0.0.0.0:${info.port}`);
  });
}
