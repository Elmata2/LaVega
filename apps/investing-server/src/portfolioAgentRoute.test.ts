import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
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

function streamingModel(text: string) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: text },
          { type: "text-end", id: "text-1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 5, text: 5, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });
}

function conversation(
  app: { request: (url: string, init: RequestInit) => Response | Promise<Response> },
  body: unknown,
) {
  return app.request("http://localhost/api/agents/portfolio/conversation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("conversation streams one persona's answer without running the six-persona judgment", async () => {
  const runAgent = vi.fn(async () => run);
  const chatModel = streamingModel("ASML is your largest position.");
  const app = await createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    runAgent,
    chatModel,
    agentRunStore: agentRunStore(),
  });

  const response = await conversation(app, {
    agentId: "charlie_munger",
    messages: [
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Ask me about your positions." }],
      },
      { id: "u1", role: "user", parts: [{ type: "text", text: "Why is ASML my largest risk?" }] },
    ],
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  expect(await response.text()).toContain("ASML is your largest position.");
  expect(runAgent).not.toHaveBeenCalled();
  const prompt = JSON.stringify(chatModel.doStreamCalls[0]?.prompt);
  expect(prompt).toContain("You are Charlie Munger");
  expect(prompt).toContain("Portfolio brief");
  expect(prompt).toContain("Why is ASML my largest risk?");
});

test("conversation rejects an unknown persona or a missing user message", async () => {
  const app = await createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    chatModel: streamingModel("unused"),
    agentRunStore: agentRunStore(),
  });

  expect((await conversation(app, { agentId: "nobody", messages: [] })).status).toBe(400);
  expect((await conversation(app, { agentId: "warren_buffett", messages: [] })).status).toBe(400);
});
