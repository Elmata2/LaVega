import { expect, test } from "vitest";
import { app } from "./app.js";

test("GET /health reports investing server health through Hono app.request", async () => {
  const response = await app.request("/health");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, service: "investing-server" });
});
