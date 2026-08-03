import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfig, maskApplicationId } from "./config.js";
import { getRates } from "./rates.js";

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

/* Serve the built web app (all-in-one deploy). Registered AFTER the API routes,
 * so /health and /api/* win; everything else serves a static file from the web
 * build, falling back to index.html (this is an SPA — client-side view state,
 * no server routes). In local dev the web runs on Vite (:5173) and WEB_DIST may
 * not exist yet, in which case these simply 404 — the API still works. */
app.use("/*", serveStatic({ root: WEB_DIST }));
app.get("/*", serveStatic({ path: `${WEB_DIST}/index.html` }));

/* Only start listening when run directly (`tsx src/index.ts`), not when imported by tests. */
if (import.meta.url === `file://${process.argv[1]}`) {
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`LaVega server listening on http://localhost:${info.port}`);
  });
}
