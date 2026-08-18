import { Hono } from "hono";
import { LocalKeySource } from "@lavega/adapters";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "investing-server" }));

app.get("/api/config/status", (c) => {
  const keys = new LocalKeySource();
  return c.json({
    keys: {
      llm: keys.getStatus("llm"),
      marketData: keys.getStatus("market-data"),
    },
  });
});
