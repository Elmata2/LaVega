import { expect, test, vi } from "vitest";
import { createInMemoryPriceStore } from "@lavega/adapters";
import { createRuntimeApp, type RuntimeApp } from "./index.js";
import type { AgentRunRecord, AgentRunStore } from "./fileAgentRunStore.js";

function memoryAgentRunStore() {
  let record: AgentRunRecord | null = null;
  return {
    async get() {
      return record;
    },
    async put(next: AgentRunRecord) {
      record = next;
    },
  } satisfies AgentRunStore;
}

async function appWith(runAgent: (options: { prompt: string }) => Promise<string>) {
  const agentRunStore = memoryAgentRunStore();
  const runtimeApp: RuntimeApp = await createRuntimeApp({ priceStore: createInMemoryPriceStore(), agentRunStore, runAgent });
  return { runtimeApp, agentRunStore };
}

const post = async (runtimeApp: RuntimeApp) => runtimeApp.request("http://localhost/api/agents/portfolio/run", { method: "POST" });

test("the portfolio agent route returns the model summary, insight payload and persists a done run", async () => {
  const runAgent = vi.fn(async () => "Portfolio is healthy.");
  const { runtimeApp, agentRunStore } = await appWith(runAgent);

  const response = await post(runtimeApp);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    summary: "Portfolio is healthy.",
    result: { agentId: "warren_buffett", displayName: "Warren Buffett", summary: "Portfolio is healthy." },
  });
  expect(runAgent).toHaveBeenCalledOnce();
  expect(await agentRunStore.get()).toMatchObject({ agentId: "warren_buffett", status: "done", summary: "Portfolio is healthy.", error: null });
});

test("a failed agent run returns 502 and persists the error", async () => {
  const { runtimeApp, agentRunStore } = await appWith(vi.fn(async () => {
    throw new Error("model unavailable");
  }));

  const response = await post(runtimeApp);
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ problems: ["model unavailable"] });
  expect(await agentRunStore.get()).toMatchObject({ status: "error", error: "model unavailable" });
});

test("concurrent runs share a single in-flight agent execution", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const runAgent = vi.fn(async () => {
    await gate;
    return "done";
  });
  const { runtimeApp } = await appWith(runAgent);

  const pending = [post(runtimeApp), post(runtimeApp)];
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  const [first, second] = await Promise.all(pending);

  expect([first.status, second.status]).toEqual([200, 200]);
  expect(runAgent).toHaveBeenCalledOnce();
});

test("the portfolio agent route accepts a selected investor persona", async () => {
  const runAgent = vi.fn(async () => "Ackman view.");
  const { runtimeApp, agentRunStore } = await appWith(runAgent);

  const response = await runtimeApp.request("http://localhost/api/agents/portfolio/run", {
    method: "POST",
    body: JSON.stringify({ agentId: "bill_ackman" }),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ result: { agentId: "bill_ackman", displayName: "Bill Ackman" } });
  expect(await agentRunStore.get()).toMatchObject({ agentId: "bill_ackman", summary: "Ackman view." });
});

test("the portfolio agent route accepts a model override", async () => {
  const runAgent = vi.fn(async () => "Munger view.");
  const { runtimeApp } = await appWith(runAgent);

  const response = await runtimeApp.request("http://localhost/api/agents/portfolio/run", {
    method: "POST",
    body: JSON.stringify({ agentId: "charlie_munger", model: "openai/gpt-5-mini" }),
  });

  expect(response.status).toBe(200);
  expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: "charlie_munger", model: "openai/gpt-5-mini" }));
});

test("the portfolio agent registry exposes investor personas", async () => {
  const { runtimeApp } = await appWith(vi.fn(async () => "unused"));

  const response = await runtimeApp.request("http://localhost/api/agents/portfolio");

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    agents: expect.arrayContaining([
      expect.objectContaining({ id: "warren_buffett", displayName: "Warren Buffett" }),
      expect.objectContaining({ id: "charlie_munger", displayName: "Charlie Munger" }),
      expect.objectContaining({ id: "bill_ackman", displayName: "Bill Ackman" }),
    ]),
  });
});
