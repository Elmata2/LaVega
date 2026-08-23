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

test("the portfolio agent route returns the model summary and persists a done run", async () => {
  const runAgent = vi.fn(async () => "Portfolio is healthy.");
  const { runtimeApp, agentRunStore } = await appWith(runAgent);

  const response = await post(runtimeApp);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ summary: "Portfolio is healthy." });
  expect(runAgent).toHaveBeenCalledOnce();
  expect(await agentRunStore.get()).toMatchObject({ status: "done", summary: "Portfolio is healthy.", error: null });
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
