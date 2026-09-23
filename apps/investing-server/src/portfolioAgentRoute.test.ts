import { expect, test, vi } from "vitest";
import { createInMemoryPriceStore } from "@lavega/adapters";
import { createRuntimeApp } from "./index.js";
import type { AgentRunRecord, AgentRunStore } from "./fileAgentRunStore.js";

const run = { judgments: [], model: "jev-test", snapshotHash: "snapshot" };
function agentRunStore(): AgentRunStore {
  let current: AgentRunRecord | null = null;
  return {
    get: async () => current,
    start: async (record) => {
      current = record;
      return true;
    },
    finish: async (record) => {
      current = record;
      return true;
    },
  };
}

test("portfolio route returns aggregate typed judgments", async () => {
  const runAgent = vi.fn(async () => run);
  const app = await createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    runAgent,
    agentRunStore: agentRunStore(),
  });
  const response = await app.request("http://localhost/api/agents/portfolio/run", {
    method: "POST",
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ result: run });
  expect(runAgent).toHaveBeenCalledOnce();
});

test("portfolio catalog does not expose judgment instructions", async () => {
  const app = await createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    runAgent: async () => run,
    agentRunStore: agentRunStore(),
  });
  const response = await app.request("http://localhost/api/agents/portfolio");
  const body = (await response.json()) as { agents: Array<Record<string, unknown>> };
  expect(body.agents).toHaveLength(6);
  expect(body.agents[0]).not.toHaveProperty("instructions");
  expect(body.agents[0]).not.toHaveProperty("criteria");
});

test("provider error returns 502", async () => {
  const app = await createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    runAgent: async () => {
      throw new Error("provider unavailable");
    },
    agentRunStore: agentRunStore(),
  });
  const response = await app.request("http://localhost/api/agents/portfolio/run", {
    method: "POST",
  });
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ problems: ["provider unavailable"] });
});

test("start storage failure returns 502 without model work", async () => {
  const runAgent = vi.fn(async () => run);
  const app = await createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    runAgent,
    agentRunStore: {
      ...agentRunStore(),
      start: async () => {
        throw new Error("disk full");
      },
    },
  });
  const response = await app.request("http://localhost/api/agents/portfolio/run", {
    method: "POST",
  });
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ problems: ["Agent run storage failed to start"] });
  expect(runAgent).not.toHaveBeenCalled();
});

test("conversation sends selected persona, question and Jev judgment to text model", async () => {
  const runAgent = vi.fn(async () => run);
  const runConversation = vi.fn(async () => ({
    agentId: "warren_buffett" as const,
    displayName: "Warren Buffett",
    text: "ASML is your largest position.",
    model: "openrouter-test",
    snapshotHash: "snapshot",
    judgment: { signal: "bullish" as const, confidence: 80 },
  }));
  const app = await createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    runAgent,
    runConversation,
    agentRunStore: agentRunStore(),
  });

  const response = await app.request("http://localhost/api/agents/portfolio/conversation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId: "warren_buffett",
      prompt: "Why is ASML my largest risk?",
      history: [{ role: "assistant", content: "Ask me about your positions." }],
    }),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ result: await runConversation.mock.results[0]?.value });
  expect(runAgent).toHaveBeenCalledOnce();
  expect(runConversation).toHaveBeenCalledWith(
    expect.objectContaining({
      agentId: "warren_buffett",
      prompt: "Why is ASML my largest risk?",
      history: [{ role: "assistant", content: "Ask me about your positions." }],
      judgment: run,
    }),
  );
});
