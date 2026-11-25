import { afterEach, expect, test, vi } from "vitest";
import { createInMemorySharedPriceStore } from "@lavega/adapters";
import { createApp } from "./app.js";
import { createRuntimeApp } from "./index.js";
import { createInMemoryAgentMemoryStore } from "./inMemoryAgentMemory.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

test("GET /api/auth/get-session returns 503 when INVESTING_DEV_FIXTURE is not 1", async () => {
  vi.stubEnv("INVESTING_DEV_FIXTURE", "");
  const app = createApp();

  const response = await app.request("/api/auth/get-session");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ message: "Authentication is not configured" });
});

test("GET /api/auth/get-session returns 200 dev session when INVESTING_DEV_FIXTURE=1", async () => {
  vi.stubEnv("INVESTING_DEV_FIXTURE", "1");
  const app = createApp();

  const response = await app.request("/api/auth/get-session");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    session: { id: "dev-fixture-session" },
    user: { id: "local", email: "local@lavega.dev", name: "Local Dev" },
  });
});

test("in-memory agent memory store serves GET /api/memory 200 and updates risk tolerance", async () => {
  vi.stubEnv("INVESTING_DEV_FIXTURE", "1");
  const app = await createRuntimeApp({
    priceStore: createInMemorySharedPriceStore(),
    agentMemory: createInMemoryAgentMemoryStore(),
  });

  const initial = await app.request("/api/memory");
  expect(initial.status).toBe(200);
  expect(await initial.json()).toEqual({
    riskTolerance: null,
    theses: [],
    goals: [],
  });

  const put = await app.request("/api/memory/risk-tolerance", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ riskTolerance: "balanced" }),
  });
  expect(put.status).toBe(200);

  const after = await app.request("/api/memory");
  expect(after.status).toBe(200);
  expect(await after.json()).toEqual({
    riskTolerance: "balanced",
    theses: [],
    goals: [],
  });
});
