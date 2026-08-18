import { serve } from "@hono/node-server";
import { app } from "./app.js";

export { app };

const port = Number(process.env.PORT) || 8788;

if (import.meta.url === `file://${process.argv[1]}`) {
  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
    console.log(`LaVega investing server listening on 0.0.0.0:${info.port}`);
  });
}
