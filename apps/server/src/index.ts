import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig, maskApplicationId } from "./config.js";
import { getRates } from "./rates.js";

export const PORT = Number(process.env.PORT) || 8787;

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

/* Only start listening when run directly (`node src/index.ts`), not when imported by tests. */
if (import.meta.url === `file://${process.argv[1]}`) {
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`LaVega server listening on http://localhost:${info.port}`);
  });
}
