import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfig, maskApplicationId } from "./config.js";
import { getRates } from "./rates.js";
import { getFxRate } from "./fx.js";
import { privacyHtml, termsHtml } from "./legal.js";
import { registerEbRoutes } from "./eb-routes.js";
import { registerAgentRoutes } from "./agent-routes.js";
import { loadCatalogue } from "./catalogFile.js";
import { forwardInvesting, shouldMountInvesting } from "./investing-mount.js";

export const PORT = Number(process.env.PORT) || 8787;
// Absolute path to the built web app, derived from THIS file (apps/server/src)
// so it resolves the same whether the process runs from the repo root or the
// package dir (pnpm --filter runs scripts in the package dir). Overridable via env.
const WEB_DIST = process.env.WEB_DIST || resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");

/* Extensions that mean "a file", so a miss must 404 instead of falling back to
 * index.html. An allowlist, deliberately — the tempting rule ("the path has a
 * dot in it") breaks real deep links: the investing SPA routes /positions/:symbol
 * and a ticker like BRK.B would be read as a file request and refused. */
const STATIC_ASSET_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".css", ".map", ".json", ".wasm",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico",
  ".webmanifest", ".xml", ".txt",
]);

/** Is `pathname` a request for a file rather than for an SPA view? Everything
 *  Vite emits lives under /assets/; anything else has to carry a known
 *  extension to count. */
export function isStaticAssetPath(pathname: string): boolean {
  if (pathname.startsWith("/assets/")) return true;
  const name = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return STATIC_ASSET_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

export const app = new Hono();

/* The committed catalogue, read once as this module loads — before any request
 * can arrive. Every figure it holds is one the travel block answers from a file
 * instead of waiting 40s-5min on a lookup; every figure it does NOT hold (no
 * conditions established, older than what is already cached) is refused here
 * rather than served wrong. Both counts are logged, because "accepted 0" and "a
 * broken loader" look identical otherwise. A missing or malformed file logs and
 * the server boots anyway. */
loadCatalogue();

/** A loopback origin — localhost or 127.0.0.1, any port. */
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * CORS for local development only, and only for a loopback origin.
 *
 * In production the web app is served from THIS origin, so none of this applies
 * and nothing changes. In development Vite serves the app on :5173 (or the next
 * free port) while the server runs on :8787, which makes every agent call
 * cross-origin. Without these headers the browser blocks the request, the fetch
 * throws, and `App.tsx`'s status check falls into its catch and concludes the
 * server has no AI key. That is exactly what happened: both servers answered
 * `configured: true` to curl while the app on screen insisted there was no key.
 *
 * Deliberately NOT `Access-Control-Allow-Origin: *` the way /api/rates is. Those
 * two endpoints return public data; these routes SPEND the owner's Anthropic
 * key, so an open policy would let any page on the internet spend it. Only a
 * loopback origin is echoed back, which no remote site can claim.
 */
app.use("/api/*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && LOOPBACK_ORIGIN.test(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Headers", "content-type, x-ingest-token, x-lavega-token");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    // A JSON POST triggers a preflight; answer it here or the real call never runs.
    if (c.req.method === "OPTIONS") return c.body(null, 204);
  }
  await next();
});

app.get("/health", (c) => c.json({ ok: true }));

/**
 * Public NL savings-rate benchmark for the Optimisatie tab. Returns generic,
 * non-personal data only — the client sends nothing about the user. CORS is
 * open ("*") because this is public data and a simple GET (no preflight).
 */
app.get("/api/rates", async (c) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Cache-Control", "public, max-age=3600");
  return c.json(await getRates());
});

/**
 * ECB mid-market FX rates (base EUR), proxied from Frankfurter. Public data
 * only — no user data is sent. CORS is open ("*") for the same reason as
 * /api/rates above. The client derives from->to cross rates locally.
 */
app.get("/api/fx/rate", async (c) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Cache-Control", "public, max-age=3600");
  return c.json(await getFxRate());
});

/**
 * Enable Banking config status. The Enable Banking routes themselves
 * (aspsps/auth/callback/sync/forget) are Task 3 — this is scaffold-only.
 */
app.get("/api/eb/status", (c) => {
  const config = loadConfig();
  return c.json({
    configured: config.configured,
    applicationId: maskApplicationId(config.applicationId),
  });
});

/* Enable Banking AIS flow: /api/eb/aspsps, /auth, /callback, /accounts. */
registerEbRoutes(app);

/* Agent proxy: /api/agent/status, /api/agent/extract-invoice. Must precede the
 * static catch-all below so the API routes win. */
registerAgentRoutes(app);

/* Legal pages (standalone HTML) — required for the Enable Banking app
 * registration and linked from the app footer. Before the static catch-all. */
app.get("/privacy", (c) => c.html(privacyHtml));
app.get("/terms", (c) => c.html(termsHtml));

/* Investing dashboard (apps/investing-web + apps/investing-server) on `/investing`
 * with API routes at `/api/investing/*`, `/api/brokers/*`, etc. Enabled when the
 * investing-web dist exists (production Docker build). */
if (shouldMountInvesting()) {
  const toInvesting = (c: { req: { raw: Request } }) => forwardInvesting(c.req.raw);
  app.all("/api/investing/*", toInvesting);
  app.all("/api/brokers/*", toInvesting);
  app.all("/api/prices/*", toInvesting);
  app.all("/api/market-data/*", toInvesting);
  app.all("/api/config/status", toInvesting);
  app.get("/investing", (c) => c.redirect("/investing/"));
  app.all("/investing/*", toInvesting);
}

/* Serve the built web app (all-in-one deploy). Registered AFTER the API routes,
 * so /health and /api/* win; everything else serves a static file from the web
 * build, falling back to index.html (this is an SPA — client-side view state,
 * no server routes). In local dev the web runs on Vite (:5173) and WEB_DIST may
 * not exist yet, in which case these simply 404 — the API still works. */
app.use("/*", serveStatic({ root: WEB_DIST }));
/* …but the fallback is for VIEWS, not for files. A request for a file that is
 * not in the build used to get index.html with `200 text/html`, and that is how
 * the /investing blank page hid for as long as it did: the browser asked for
 * /assets/index-DQzV9ttd.js, got HTML, never executed a module, and every probe
 * we had still saw 200s. Cloudflare then cached the HTML under the .js URL for
 * four hours. A file that is not there is a 404. */
app.get("/*", (c, next) => (isStaticAssetPath(c.req.path) ? c.text("Not Found", 404) : next()));
app.get("/*", serveStatic({ path: `${WEB_DIST}/index.html` }));

/* Only start listening when run directly (`tsx src/index.ts`), not when imported by tests. */
if (import.meta.url === `file://${process.argv[1]}`) {
  // Bind 0.0.0.0 so a container host (Railway) can reach it for the health check
  // and public traffic — not just loopback.
  serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`LaVega server listening on 0.0.0.0:${info.port}`);
  });
}
