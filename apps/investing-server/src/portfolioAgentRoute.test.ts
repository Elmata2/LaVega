import { expect, test, vi } from "vitest";
import { createInMemoryPriceStore } from "@lavega/adapters";
import { createRuntimeApp } from "./index.js";

const run = { judgments: [], model: "jev-test", snapshotHash: "snapshot" };

test("portfolio route returns aggregate typed judgments", async () => {
  const runAgent = vi.fn(async () => run);
  const app = await createRuntimeApp({ priceStore: createInMemoryPriceStore(), runAgent });
  const response = await app.request("http://localhost/api/agents/portfolio/run", { method: "POST" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ result: run });
  expect(runAgent).toHaveBeenCalledOnce();
});

test("portfolio catalog does not expose judgment instructions", async () => {
  const app = await createRuntimeApp({ priceStore: createInMemoryPriceStore(), runAgent: async () => run });
  const response = await app.request("http://localhost/api/agents/portfolio");
  const body = (await response.json()) as { agents: Array<Record<string, unknown>> };
  expect(body.agents).toHaveLength(6);
  expect(body.agents[0]).not.toHaveProperty("instructions");
  expect(body.agents[0]).not.toHaveProperty("criteria");
});

test("provider error returns 502", async () => {
  const app = await createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    runAgent: async () => { throw new Error("provider unavailable"); },
  });
  const response = await app.request("http://localhost/api/agents/portfolio/run", { method: "POST" });
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ problems: ["provider unavailable"] });
});
