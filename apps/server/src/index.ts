import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig, maskApplicationId } from "./config.js";

export const PORT = Number(process.env.PORT) || 8787;

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

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
