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

export const PORT = Number(process.env.PORT) || 8787;
// Absolute path to the built web app, derived from THIS file (apps/server/src)
// so it resolves the same whether the process runs from the repo root or the
// package dir (pnpm --filter runs scripts in the package dir). Overridable via env.
const WEB_DIST = process.env.WEB_DIST || resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");

export const app = new Hono();

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

/* Serve the built web app (all-in-one deploy). Registered AFTER the API routes,
 * so /health and /api/* win; everything else serves a static file from the web
 * build, falling back to index.html (this is an SPA — client-side view state,
 * no server routes). In local dev the web runs on Vite (:5173) and WEB_DIST may
 * not exist yet, in which case these simply 404 — the API still works. */
app.use("/*", serveStatic({ root: WEB_DIST }));
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
