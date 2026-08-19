import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { createApp } from "./app.js";
import { createProblemReporter } from "./observability.js";

export { app };

const port = Number(process.env.PORT) || 8788;

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtimeApp = await createRuntimeApp();
  serve({ fetch: runtimeApp.fetch, port, hostname: "0.0.0.0" }, (info) => {
    console.log(`LaVega investing server listening on 0.0.0.0:${info.port}`);
  });
}

async function createRuntimeApp() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return app;
  const sentry = await import("@sentry/node");
  sentry.init({ dsn, environment: process.env.NODE_ENV });
  return createApp({ problemReporter: createProblemReporter({ dsn, sentry }) });
}
